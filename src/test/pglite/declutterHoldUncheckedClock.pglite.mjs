/**
 * Q1424 PGlite proof: declutter_hold_unchecked_listings' 15-minute window, on a fixed clock (./lib/fixedClock.mjs,
 * newest CREATE of the function). declutterCheckAfterPost.pglite.mjs rewrites live_at 20 and 30 minutes back; this
 * one moves the clock and reads the edge 1 ms either side, for both loops:
 *   live listing      i.live_at < now - 15 min, and the check failed 3 times (or flagged): held for review
 *                     (live exactly 15 min: not held; 15 min + 1 ms: held, updated_at = the clock)
 *   reserved / sold   the same edge: the item is marked judged ("didn't finish", ai_checked_at = the clock) and the
 *                     seller's payouts are held (payout_holds.held_at = the clock); exactly 15 min: nothing yet.
 * An admin's approval after it went live stands (never held), at the same instant.
 *
 *   node src/test/pglite/declutterHoldUncheckedClock.pglite.mjs
 *   HOLD_LIVE_INCLUSIVE=1 node src/test/pglite/declutterHoldUncheckedClock.pglite.mjs  # RED: live listings held at exactly 15 min
 *   HOLD_SOLD_INCLUSIVE=1 node src/test/pglite/declutterHoldUncheckedClock.pglite.mjs  # RED: sold listings held at exactly 15 min
 *
 * declutter_notify and is_test_subject (their own proofs) are stubbed. pglite is loaded from ~/.lh-pglite
 * (CLAUDE.md). Registered in src/test/clockFunctionsProven.test.ts.
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
CREATE TABLE public.declutter_items (
  id uuid PRIMARY KEY, seller_id uuid DEFAULT gen_random_uuid(), title text DEFAULT 'Oak chair', status text DEFAULT 'live',
  live_at timestamptz, admin_approved_at timestamptz, updated_at timestamptz);
CREATE TABLE public.declutter_item_private (
  item_id uuid PRIMARY KEY, ai_checked_at timestamptz, ai_check_attempts int DEFAULT 3, ai_flag_reason text, updated_at timestamptz);
CREATE TABLE public.declutter_cart_items (item_id uuid, order_id uuid, status text, created_at timestamptz DEFAULT '2026-01-01');
CREATE TABLE public.payout_holds (helper_id uuid PRIMARY KEY, reason text, held_by uuid, held_at timestamptz);
CREATE TABLE public.notifications (user_id uuid, title text, message text, type text, link text);
CREATE TABLE public.user_roles (user_id uuid, role text);
CREATE TABLE public.sent (title text);
CREATE FUNCTION public.is_test_subject(u uuid) RETURNS boolean LANGUAGE sql AS $$ SELECT true $$;
CREATE FUNCTION public.declutter_notify(p_user uuid, p_type text, p_title text, p_body text, p_link text, p_other uuid) RETURNS void
  LANGUAGE sql AS $$ INSERT INTO public.sent VALUES (p_title) $$;
`);
const { file, stmt } = newestFunction("declutter_hold_unchecked_listings");
const base = onFixedClock(stmt);
let fixed = base;
check(`every clock read is on the fixed clock (${file})`, !/\bnow\s*\(\s*\)/i.test(fixed) && /_probe_now\(\)/.test(fixed));
const EDGE = "AND i.live_at < public._probe_now() - interval '15 minutes'";
const WIDE = "AND i.live_at <= public._probe_now() - interval '15 minutes'";
const at = (n) => { let k = -1; for (let i = 0; i <= n; i++) k = fixed.indexOf(EDGE, k + 1); return k; };
check("both loops carry the 15-minute edge", at(0) > 0 && at(1) > at(0) && at(2) === -1);
let mutated = false;
for (const [env, n] of [["HOLD_LIVE_INCLUSIVE", 0], ["HOLD_SOLD_INCLUSIVE", 1]]) {
  if (!process.env[env]) continue;
  console.log(`${env}=1 (expect FAILs)`);
  const k = at(n);
  fixed = fixed.slice(0, k) + WIDE + fixed.slice(k + EDGE.length);
  mutated = true;
}
check("the mutation (if any) applied", !mutated || fixed !== base);
// Replay-safe: applies 3x (the REVOKE/GRANT tail needs the three roles created above).
for (let i = 0; i < 3; i++) await db.exec(fixed);

const ITEM = "11111111-1111-4111-8111-111111111111";
const iso = (ms) => (ms == null ? null : new Date(ms).toISOString());
const MIN = 60_000;
const seed = async ({ status = "live", liveAt, approvedAt = null }) => {
  await db.exec(`DELETE FROM public.sent; DELETE FROM public.payout_holds; DELETE FROM public.declutter_cart_items;
                 DELETE FROM public.declutter_item_private; DELETE FROM public.declutter_items;`);
  await q(`INSERT INTO public.declutter_items (id, status, live_at, admin_approved_at) VALUES ($1, $2, $3, $4)`, [ITEM, status, iso(liveAt), iso(approvedAt)]);
  await q(`INSERT INTO public.declutter_item_private (item_id) VALUES ($1)`, [ITEM]);
};
const sweep = async (nowMs) => {
  await setClock(db, iso(nowMs));
  const n = (await q(`SELECT public.declutter_hold_unchecked_listings() AS n`))[0].n;
  const [it] = await q(`SELECT i.status, i.updated_at::text upd, p.ai_checked_at::text checked, p.ai_flag_reason flag
                          FROM public.declutter_items i JOIN public.declutter_item_private p ON p.item_id = i.id`);
  const holds = await q(`SELECT held_at::text held FROM public.payout_holds`);
  return { n, ...it, holds: holds.map((h) => h.held) };
};

const N = Date.UTC(2026, 6, 15, 20, 0, 0);
{
  await seed({ liveAt: N - 15 * MIN });
  const r = await sweep(N);
  check("live exactly 15 min, check failed 3 times: not held yet", r.n === 0 && r.status === "live", JSON.stringify(r));
  await seed({ liveAt: N - 15 * MIN - 1 });
  const r2 = await sweep(N);
  check("live 15 min + 1 ms: held for review, updated_at = the clock", r2.n === 1 && r2.status === "pending_review" && r2.upd === "2026-07-15 20:00:00+00", JSON.stringify(r2));
  await seed({ liveAt: N - 15 * MIN - 1, approvedAt: N - 15 * MIN });
  const r3 = await sweep(N);
  check("an admin approved it after it went live: stays live", r3.n === 0 && r3.status === "live", JSON.stringify(r3));
}
{
  await seed({ status: "sold", liveAt: N - 15 * MIN });
  const r = await sweep(N);
  check("sold, live exactly 15 min: nothing yet", r.n === 0 && r.checked === null && r.holds.length === 0, JSON.stringify(r));
  await seed({ status: "sold", liveAt: N - 15 * MIN - 1 });
  const r2 = await sweep(N);
  check("sold, 15 min + 1 ms: marked judged at the clock and the seller's payouts held at the clock",
    r2.n === 1 && r2.checked === "2026-07-15 20:00:00+00" && r2.flag === "The automatic check didn't finish." && r2.holds[0] === "2026-07-15 20:00:00+00", JSON.stringify(r2));
  const again = await sweep(N + 5 * MIN);
  check("the next run: once per item", again.n === 0, JSON.stringify(again));
}

console.log(failures ? `${failures} FAILED` : "ALL PASS");
process.exit(failures ? 1 : 0);
