/**
 * Q1424 PGlite proof: declutter_deadline_sweep's clock windows, on a fixed clock (./lib/fixedClock.mjs, newest CREATE
 * of the function). declutterSlice3.pglite.mjs moves row timestamps relative to now(); this one moves the clock and
 * reads each edge 1 ms either side:
 *   offer expiry     respond_by <= now                      (exactly at respond_by: expired; 1 ms before: open)
 *   24 h reminder    checkout_by in (now + 2 h, now + 24 h]  (exactly 24 h left: reminded; 24 h + 1 ms: not yet;
 *                    exactly 2 h left: not the 24 h one)    only for a hold longer than 24 h
 *   2 h reminder     checkout_by in (now, now + 2 h]         (exactly 2 h left: reminded; 2 h + 1 ms: not yet)
 *   missed checkout  checkout_by <= now                      (exactly at checkout_by: missed, strike; 1 ms before: held)
 *   Stripe grace     an awaiting-payment order waits 10 min past checkout_by (exactly 10 min past: missed;
 *                    1 ms less: still held)
 *   talks close      handover talk expires_at <= now         (exactly: closed; 1 ms before: open)
 *
 *   node src/test/pglite/declutterDeadlineSweepClock.pglite.mjs
 *   DEADLINE_OFFER_STRICT=1 ...    # RED: respond_by edge made strict
 *   DEADLINE_R24_INCLUSIVE=1 ...   # RED: the 24 h window's far edge made strict
 *   DEADLINE_MISSED_STRICT=1 ...   # RED: checkout_by edge made strict
 *   DEADLINE_GRACE_INCLUSIVE=1 ... # RED: the 10-minute grace edge made inclusive
 *
 * Helpers with their own proofs (notices, strikes, talk checks, offer reopening) are stubbed to record the call.
 * pglite is loaded from ~/.lh-pglite (CLAUDE.md). Registered in src/test/clockFunctionsProven.test.ts.
 */
import os from "node:os";
import { installClock, newestFunction, onFixedClock, setClock } from "./lib/fixedClock.mjs";

const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);

let failures = 0;
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
  if (!ok) failures++;
};

const db = new PGlite();
const q = async (sql, params) => (await db.query(sql, params)).rows;
await installClock(db);
await db.exec(`
SET TIME ZONE 'UTC';
CREATE ROLE service_role;
CREATE ROLE authenticated;
CREATE ROLE anon;
CREATE TABLE public.declutter_items (id uuid PRIMARY KEY, title text DEFAULT 'Oak chair', status text DEFAULT 'reserved', updated_at timestamptz);
CREATE TABLE public.declutter_offers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), buyer_id uuid, seller_id uuid, awaiting text DEFAULT 'seller', item_id uuid,
  status text DEFAULT 'open', respond_by timestamptz, closed_at timestamptz, updated_at timestamptz);
CREATE TABLE public.declutter_offer_events (offer_id uuid, actor_side text, action text);
CREATE TABLE public.declutter_orders (id uuid PRIMARY KEY, status text DEFAULT 'awaiting_payment', close_reason text, closed_at timestamptz);
CREATE TABLE public.declutter_cart_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), item_id uuid, buyer_id uuid, seller_id uuid, status text DEFAULT 'in_cart',
  checkout_by timestamptz, created_at timestamptz, reminded_24h_at timestamptz, reminded_2h_at timestamptz,
  price_cents int DEFAULT 5000, source text DEFAULT 'offer', order_id uuid, closed_at timestamptz);
CREATE TABLE public.user_blocks (blocker_id uuid, blocked_id uuid);
CREATE TABLE public.declutter_handover_talks (id int PRIMARY KEY, buyer_id uuid, seller_id uuid, opened_at timestamptz, expires_at timestamptz, closed_at timestamptz);
CREATE TABLE public.calls (what text);
CREATE FUNCTION public.declutter_notify(p_user uuid, p_type text, p_title text, p_body text, p_link text, p_other uuid DEFAULT NULL) RETURNS void
  LANGUAGE sql AS $$ INSERT INTO public.calls VALUES ('notify:' || p_title) $$;
CREATE FUNCTION public.declutter_notify_strict(p_user uuid, p_type text, p_title text, p_body text, p_link text, p_other uuid DEFAULT NULL) RETURNS void
  LANGUAGE sql AS $$ INSERT INTO public.calls VALUES ('notify:' || p_title) $$;
CREATE FUNCTION public.declutter_give_strike(u uuid, side text, why text, item uuid, words text, line uuid) RETURNS void
  LANGUAGE sql AS $$ INSERT INTO public.calls VALUES ('strike:' || why) $$;
CREATE FUNCTION public.declutter_pair_talking(a uuid, b uuid) RETURNS boolean LANGUAGE sql AS $$ SELECT false $$;
CREATE FUNCTION public.declutter_pair_needs_talk(a uuid, b uuid) RETURNS boolean LANGUAGE sql AS $$ SELECT false $$;
CREATE FUNCTION public.declutter_seller_out(u uuid) RETURNS boolean LANGUAGE sql AS $$ SELECT false $$;
CREATE FUNCTION public.declutter_reopen_voided_offers(l uuid) RETURNS int LANGUAGE sql AS $$ SELECT 0 $$;
CREATE FUNCTION public.feature_enabled_for_user(k text, u uuid) RETURNS boolean LANGUAGE sql AS $$ SELECT true $$;
CREATE FUNCTION public.log_cron_defect(a text, b text, c text) RETURNS void LANGUAGE sql AS $$ INSERT INTO public.calls VALUES ('defect:' || c) $$;
`);
const { file, stmt } = newestFunction("declutter_deadline_sweep");
const base = onFixedClock(stmt);
let fixed = base;
check(`every clock read is on the fixed clock (${file})`, !/\bnow\s*\(\s*\)/i.test(fixed) && /_probe_now\(\)/.test(fixed));
const mutations = {
  DEADLINE_OFFER_STRICT: ["WHERE o.status = 'open' AND o.respond_by <= public._probe_now()", "WHERE o.status = 'open' AND o.respond_by < public._probe_now()"],
  DEADLINE_R24_INCLUSIVE: ["AND c.checkout_by <= public._probe_now() + interval '24 hours'", "AND c.checkout_by < public._probe_now() + interval '24 hours'"],
  DEADLINE_MISSED_STRICT: ["WHERE c.status = 'in_cart' AND c.checkout_by <= public._probe_now()\n", "WHERE c.status = 'in_cart' AND c.checkout_by < public._probe_now()\n"],
  DEADLINE_GRACE_INCLUSIVE: ["AND v_line.checkout_by > public._probe_now() - interval '10 minutes'", "AND v_line.checkout_by >= public._probe_now() - interval '10 minutes'"],
};
let mutated = false;
for (const [env, [from, to]] of Object.entries(mutations)) {
  if (!process.env[env]) continue;
  console.log(`${env}=1 (expect FAILs)`);
  check(`${env}: the text to change is in the newest body`, fixed.includes(from));
  fixed = fixed.replace(from, to);
  mutated = true;
}
check("the mutation (if any) applied", !mutated || fixed !== base);
// Replay-safe: applies 3x (the REVOKE/GRANT tail needs the three roles created above).
for (let i = 0; i < 3; i++) await db.exec(fixed);

const ITEM = "66666666-6666-4666-8666-666666666666";
const ORDER = "77777777-7777-4777-8777-777777777777";
const BUYER = "88888888-8888-4888-8888-888888888888";
const SELLER = "99999999-9999-4999-8999-999999999999";
const iso = (ms) => (ms == null ? null : new Date(ms).toISOString());
const MIN = 60_000;
const H = 60 * MIN;
const reset = async () => db.exec(`DELETE FROM public.calls; DELETE FROM public.declutter_offer_events; DELETE FROM public.declutter_offers;
  DELETE FROM public.declutter_cart_items; DELETE FROM public.declutter_orders; DELETE FROM public.declutter_items; DELETE FROM public.declutter_handover_talks;
  INSERT INTO public.declutter_items (id) VALUES ('${ITEM}');`);
const line = async ({ checkoutBy, createdAt, order = false }) => {
  if (order) await q(`INSERT INTO public.declutter_orders (id) VALUES ($1)`, [ORDER]);
  await q(`INSERT INTO public.declutter_cart_items (item_id, buyer_id, seller_id, checkout_by, created_at, order_id) VALUES ($1, $2, $3, $4, $5, $6)`,
    [ITEM, BUYER, SELLER, iso(checkoutBy), iso(createdAt), order ? ORDER : null]);
};
const sweep = async (nowMs) => {
  await setClock(db, iso(nowMs));
  const r = (await q(`SELECT public.declutter_deadline_sweep() AS r`))[0].r;
  const calls = (await q(`SELECT what FROM public.calls`)).map((c) => c.what);
  const lines = await q(`SELECT status FROM public.declutter_cart_items`);
  return { r, calls, line: lines[0]?.status ?? null };
};

const N = Date.UTC(2026, 6, 15, 20, 0, 0);
// 1. Offer expiry.
for (const [label, now, want] of [["1 ms before respond_by: still open", N - 1, 0], ["exactly at respond_by: expired, both told", N, 1]]) {
  await reset();
  await q(`INSERT INTO public.declutter_offers (buyer_id, seller_id, item_id, respond_by) VALUES ($1, $2, $3, $4)`, [BUYER, SELLER, ITEM, iso(N)]);
  const r = await sweep(now);
  check(`offer, ${label}`, r.r.offers_expired === want && r.calls.filter((c) => c === "notify:Offer expired").length === 2 * want, JSON.stringify(r));
}
// 2. The 24 h reminder (a 48 h hold, so it qualifies), and the 2 h reminder.
const reminders = [
  { name: "24 h + 1 ms left: no reminder yet", left: 24 * H + 1, r24: 0, r2: 0 },
  { name: "exactly 24 h left: the 24 h reminder", left: 24 * H, r24: 1, r2: 0 },
  { name: "2 h + 1 ms left: still the 24 h window", left: 2 * H + 1, r24: 1, r2: 0 },
  { name: "exactly 2 h left: the 2 h reminder, not the 24 h one", left: 2 * H, r24: 0, r2: 1 },
  { name: "1 ms left: the 2 h reminder", left: 1, r24: 0, r2: 1 },
];
for (const c of reminders) {
  await reset();
  await line({ checkoutBy: N + c.left, createdAt: N + c.left - 48 * H });
  const r = await sweep(N);
  check(c.name, r.r.reminded_24h === c.r24 && r.r.reminded_2h === c.r2 && r.line === "in_cart", JSON.stringify(r.r));
}
// 3. Missed checkout (no order yet): exactly at checkout_by.
{
  await reset();
  await line({ checkoutBy: N + 1, createdAt: N - 24 * H });
  const early = await sweep(N);
  check("1 ms before checkout_by: still held", early.line === "in_cart" && early.r.checkouts_missed === 0, JSON.stringify(early));
  await reset();
  await line({ checkoutBy: N, createdAt: N - 24 * H });
  const at = await sweep(N);
  check("exactly at checkout_by: missed, the buyer gets a strike", at.line === "missed" && at.calls.includes("strike:missed_checkout"), JSON.stringify(at));
  check("no sweep defect", !at.calls.some((c) => c.startsWith("defect:")), JSON.stringify(at.calls));
}
// 4. The 10-minute Stripe grace for an awaiting-payment order.
{
  await reset();
  await line({ checkoutBy: N - 10 * MIN + 1, createdAt: N - 24 * H, order: true });
  const held = await sweep(N);
  check("awaiting payment, 10 min minus 1 ms past checkout_by: still held for Stripe", held.line === "in_cart", JSON.stringify(held));
  await reset();
  await line({ checkoutBy: N - 10 * MIN, createdAt: N - 24 * H, order: true });
  const gone = await sweep(N);
  const [{ status, close_reason }] = await q(`SELECT status, close_reason FROM public.declutter_orders`);
  check("awaiting payment, exactly 10 min past: missed, order expired", gone.line === "missed" && status === "expired" && close_reason === "missed_checkout", JSON.stringify({ ...gone, status, close_reason }));
}
// 5. Handover talks close at their expiry.
{
  await reset();
  await q(`INSERT INTO public.declutter_handover_talks (id, buyer_id, seller_id, opened_at, expires_at) VALUES (1, $1, $2, $3, $4), (2, $1, $2, $3, $5)`,
    [BUYER, SELLER, iso(N - 72 * H), iso(N), iso(N + 1)]);
  await sweep(N);
  const talks = await q(`SELECT id, closed_at::text c FROM public.declutter_handover_talks ORDER BY id`);
  check("a talk expiring exactly now closes (at the clock); one expiring 1 ms later stays open",
    talks[0].c === "2026-07-15 20:00:00+00" && talks[1].c === null, JSON.stringify(talks));
}

console.log(failures ? `${failures} FAILED` : "ALL PASS");
process.exit(failures ? 1 : 0);
