#!/usr/bin/env node
/**
 * PGlite proof for 20261029162620_declutter_smart_offers (owner 2026-10-29: "No offers" and smart offers).
 *
 *   npx tsx src/test/pglite/declutterSmartOffers.pglite.mjs                     # all PASS (migration applied 3x)
 *   NEW_MIGRATION=skip npx tsx src/test/pglite/declutterSmartOffers.pglite.mjs  # RED: the migration absent
 *   MIGRATION_PATH=<planted copy> npx tsx src/test/pglite/declutterSmartOffers.pglite.mjs
 *
 * Base: Declutter slices 1-5 (scripts/declutter/slice3Harness.mjs) as declutterMyPaidCents.pglite.mjs builds them.
 * The helpers the restated bodies call (declutter_lock_buyable_item, declutter_take_item, declutter_notify) are
 * the chain's own versions, not prod's newest: this proves the smart-offer branches, not the helpers' wording.
 *
 * Proves: offers off refuses a new offer and a buyer counter (offers_off), the seller can still answer; auto off
 * behaves as before; auto on with the floor below the price accepts an offer at or above the floor at once
 * (item reserved to the buyer at the offered amount, accept event by the seller side, offer accepted, the seller's
 * "Accepted automatically" notice), counters one below the floor AT the floor (awaiting buyer, 48 h,
 * counter_count 1, a seller counter event); a buyer counter at the floor is accepted; auto with the floor equal to
 * the price does nothing automatic; no card refuses; declutter_set_offer_rules is the seller's own and turns auto
 * off with offers off; grants by role name.
 *
 * pglite is not a dependency (CLAUDE.md): loaded from ~/.lh-pglite.
 */
import os from "node:os";
import { readFileSync } from "node:fs";
import { setupStatements, liveItemSql, CARDS_SQL, USERS, FEE_F1_FILE, SLICE4_FILE } from "../../../scripts/declutter/slice3Harness.mjs";

const NEW_FILE = "20261029162620_declutter_smart_offers.sql";
const SETUP_FEE_FILE = "20261026154738_declutter_setup_fee_once.sql";
const MIG_DIR = new URL("../../../supabase/migrations/", import.meta.url).pathname;
const BEFORE = [
  "20261017055500_declutter_refund_hand_settle.sql",
  "20261017055502_declutter_handover_private_bucket.sql",
  "20261017055504_declutter_porch_default.sql",
  "20261017055505_declutter_helpr_delivery.sql",
  "20261018183715_declutter_handover_no_qr_no_code.sql",
  "20261018184535_declutter_delivery_no_dropoff_code.sql",
  "20261021181118_helpr_delivery_payout_round_down.sql",
];
const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const { SELLER, BUYER, BUYER2, BUYER3, NOCARD } = USERS;
const skip = process.env.NEW_MIGRATION === "skip";
const NEW_SQL = readFileSync(process.env.MIGRATION_PATH ?? `${MIG_DIR}${NEW_FILE}`, "utf8");

const db = new PGlite();
await db.exec(`CREATE SCHEMA IF NOT EXISTS storage;
  CREATE TABLE storage.buckets (id text PRIMARY KEY, name text NOT NULL, public boolean DEFAULT false,
    file_size_limit bigint, allowed_mime_types text[]);`);
const extra = [{ file: FEE_F1_FILE, times: 1 }, { file: SLICE4_FILE, times: 1 }, ...BEFORE.map((file) => ({ file, times: 1 }))];
const stmts = setupStatements({ times: 1, times3b: 1, extra });
stmts.splice(1, 0, `
  ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS full_name text;
  CREATE TABLE public.user_violations (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL,
    violation_type text NOT NULL, description text, job_id uuid, action_taken text, created_at timestamptz DEFAULT now());
  CREATE TABLE public.cron_defects_seen (fn text, ref text, msg text);
  CREATE FUNCTION public.log_cron_defect(p_fn text, p_ref text, p_msg text) RETURNS void LANGUAGE sql
    AS $$ INSERT INTO public.cron_defects_seen VALUES (p_fn, p_ref, p_msg) $$;`);
for (const sql of stmts) await db.exec(sql);
// What prod holds that the slice chain lacks and the setup-fee migration reads (as declutterSetupFeeOnce's proof).
await db.exec(`
  ALTER TABLE public.declutter_orders ADD COLUMN IF NOT EXISTS shipping_cents integer NOT NULL DEFAULT 0;
  ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS onboarding_fee_paid boolean NOT NULL DEFAULT false,
    ADD COLUMN IF NOT EXISTS onboarding_fee_charged_at timestamptz;
  CREATE TABLE IF NOT EXISTS public.platform_settings (id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    onboarding_fee_cents integer NOT NULL DEFAULT 200);
  INSERT INTO public.platform_settings (onboarding_fee_cents) VALUES (200);`);
await db.exec(readFileSync(`${MIG_DIR}${SETUP_FEE_FILE}`, "utf8"));
await db.exec(CARDS_SQL);
if (!skip) for (let i = 0; i < 3; i++) await db.exec(NEW_SQL);

let pass = 0;
let fail = 0;
const ok = (cond, label) => { if (cond) pass++; else fail++; console.log(`${cond ? "PASS" : "FAIL"}  ${label}`); };
const svc = async (sql) => { try { return (await db.query(sql)).rows; } catch (e) { return { error: String(e.message ?? e), code: e.code }; } };
async function as(role, uid, sql) {
  try {
    await db.exec(`${uid ? `SET request.jwt.claim.sub = '${uid}';` : ""} SET ROLE ${role};`);
    return (await db.query(sql)).rows;
  } catch (e) {
    return { error: String(e.message ?? e), code: e.code };
  } finally {
    await db.exec(`RESET ROLE; RESET request.jwt.claim.sub;`);
  }
}
const one = (r) => (Array.isArray(r) && r[0] ? Object.values(r[0])[0] : undefined);
const refused = (r, re) => !Array.isArray(r) && typeof r?.error === "string" && re.test(r.error);


const I = (n) => `77777777-0000-0000-0000-${String(n).padStart(12, "0")}`;
const me = (uid, sql) => as("authenticated", uid, sql);
// seed-policy: not prod (throwaway PGlite only)
async function item(n, { price = 4000, floor = 3000, accepts = true, auto = false } = {}) {
  await db.exec(liveItemSql({ id: I(n), seller: SELLER, title: `Smart ${n}`, price, floor }));
  if (!skip) await db.exec(`UPDATE public.declutter_items SET accepts_offers = ${accepts} WHERE id = '${I(n)}';
    UPDATE public.declutter_item_private SET auto_offers = ${auto} WHERE item_id = '${I(n)}';`);
}
const offer = async (id) => (await svc(`SELECT * FROM public.declutter_offers WHERE id = '${id}'`))?.[0];
const itemRow = async (n) => (await svc(`SELECT status, current_price_cents FROM public.declutter_items WHERE id = '${I(n)}'`))?.[0];
const cartOf = async (n) => (await svc(`SELECT buyer_id, price_cents, source FROM public.declutter_cart_items WHERE item_id = '${I(n)}'`))?.[0];
const events = async (id) => (await svc(`SELECT actor_side, action, amount_cents FROM public.declutter_offer_events WHERE offer_id = '${id}' ORDER BY created_at, action`)) ?? [];
const make = (uid, n, cents) => me(uid, `SELECT public.declutter_make_offer('${I(n)}', ${cents})::text AS id`);

// (a) offers off.
await item(1, { accepts: false });
ok(refused(await make(BUYER, 1, 3500), /offers_off/), "offers off: a new offer is refused (offers_off)");

// auto off: as before, the offer waits for the seller.
await item(2, { auto: false });
const o2 = one(await make(BUYER, 2, 3500));
ok(typeof o2 === "string", `auto off: the offer is made (${JSON.stringify(o2)})`);
ok((await offer(o2))?.status === "open" && (await offer(o2))?.awaiting === "seller", "auto off: open, waiting for the seller");

// (b) auto on, floor $30 < price $40: $35 accepted at once.
await item(3, { auto: true });
const o3 = one(await make(BUYER, 3, 3500));
const off3 = await offer(o3);
ok(off3?.status === "accepted", `auto on, at/above the floor: the offer is accepted at once (${off3?.status})`);
const c3 = await cartOf(3);
ok(c3?.buyer_id === BUYER && Number(c3?.price_cents) === 3500 && c3?.source === "offer", `reserved to the buyer at $35 from the offer (${JSON.stringify(c3)})`);
ok((await itemRow(3))?.status === "reserved", "the item is reserved");
const e3 = await events(o3);
ok(e3.some((e) => e.actor_side === "seller" && e.action === "accept" && Number(e.amount_cents) === 3500), `an accept event on the seller's side (${JSON.stringify(e3)})`);
const n3 = await svc(`SELECT count(*)::int AS n FROM public.notifications WHERE user_id = '${SELLER}' AND message LIKE 'Accepted automatically at or above your lowest price%'`);
ok(one(n3) === 1, "the seller is told: Accepted automatically at or above your lowest price");
const nNew = await svc(`SELECT count(*)::int AS n FROM public.notifications WHERE user_id = '${SELLER}' AND title = 'New offer' AND message LIKE '%Smart 3%'`);
ok(one(nNew) === 0, "no 'answer within 48 hours' notice to the seller for an offer already accepted");

// exactly at the floor is accepted too.
await item(4, { auto: true });
const o4 = one(await make(BUYER2, 4, 3000));
ok((await offer(o4))?.status === "accepted" && Number((await cartOf(4))?.price_cents) === 3000, "an offer exactly at the floor is accepted at $30");

// below the floor: a seller counter AT the floor.
await item(5, { auto: true });
const o5 = one(await make(BUYER, 5, 2500));
const off5 = await offer(o5);
ok(off5?.status === "open" && off5?.awaiting === "buyer" && Number(off5?.amount_cents) === 3000 && Number(off5?.counter_count) === 1,
  `below the floor: countered at $30, the buyer's turn, counter_count 1 (${JSON.stringify(off5 && { s: off5.status, a: off5.awaiting, c: off5.amount_cents, n: off5.counter_count })})`);
const hrs = (new Date(off5?.respond_by).getTime() - Date.now()) / 3_600_000;
ok(hrs > 47.9 && hrs <= 48.01, `48 hours to answer (${hrs.toFixed(2)})`);
ok((await events(o5)).some((e) => e.actor_side === "seller" && e.action === "counter" && Number(e.amount_cents) === 3000), "a counter event on the seller's side at $30");
ok((await itemRow(5))?.status === "live" && !(await cartOf(5)), "nothing reserved");
// the buyer counters $32 (>= floor): accepted at once.
const r5 = await me(BUYER, `SELECT public.declutter_respond_offer('${o5}', 'counter', 3200) AS r`);
ok(one(r5) === "accepted" && Number((await cartOf(5))?.price_cents) === 3200, `a buyer counter at/above the floor is accepted at $32 (${JSON.stringify(r5)})`);

// floor == price: nothing automatic.
await item(6, { price: 4000, floor: 4000, auto: true });
const o6 = one(await make(BUYER3, 6, 3500));
ok((await offer(o6))?.status === "open" && (await offer(o6))?.awaiting === "seller", "auto on but the floor is the price: the offer waits for the seller");

// offers turned off with a thread open: the buyer cannot counter, the seller can still answer.
await item(7, { auto: false });
const o7 = one(await make(BUYER, 7, 3000));
await me(SELLER, `SELECT public.declutter_respond_offer('${o7}', 'counter', 3800)`);
ok(Array.isArray(await me(SELLER, `SELECT public.declutter_set_offer_rules('${I(7)}', false, true)`)), "the seller turns offers off");
const p7 = await svc(`SELECT i.accepts_offers, p.auto_offers FROM public.declutter_items i JOIN public.declutter_item_private p ON p.item_id = i.id WHERE i.id = '${I(7)}'`);
ok(p7?.[0]?.accepts_offers === false && p7?.[0]?.auto_offers === false, "offers off turns auto off too");
ok(refused(await me(BUYER, `SELECT public.declutter_respond_offer('${o7}', 'counter', 3500)`), /offers_off/), "offers off: a buyer counter is refused");
ok(one(await me(BUYER, `SELECT public.declutter_respond_offer('${o7}', 'accept', NULL) AS r`)) === "accepted", "offers off: the open thread can still be accepted");

// set_offer_rules: only the seller.
await item(8);
ok(refused(await me(BUYER, `SELECT public.declutter_set_offer_rules('${I(8)}', true, true)`), /item_not_found/), "another member cannot set the rules");
ok(refused(await as("anon", null, `SELECT public.declutter_set_offer_rules('${I(8)}', true, true)`), /permission denied/), "anon cannot");
ok(Array.isArray(await me(SELLER, `SELECT public.declutter_set_offer_rules('${I(8)}', true, true)`))
  && (await svc(`SELECT auto_offers FROM public.declutter_item_private WHERE item_id = '${I(8)}'`))?.[0]?.auto_offers === true, "the seller turns auto on");

// no card: the auto accept is refused like Buy.
await item(9, { auto: true });
ok(refused(await make(NOCARD, 9, 3500), /card_required/), "no saved card: refused (card_required), nothing reserved");
ok((await itemRow(9))?.status === "live", "the item stays live");

const acl = await svc(`SELECT proacl::text AS acl FROM pg_proc WHERE proname = 'declutter_set_offer_rules'`);
ok(/authenticated=X/.test(acl?.[0]?.acl ?? "") && !/anon=/.test(acl?.[0]?.acl ?? "") && !/(^|[{,])=X/.test(acl?.[0]?.acl ?? ""), `grants by role name (${acl?.[0]?.acl})`);

console.log(`\n${pass} passed, ${fail} failed${skip ? " (NEW_MIGRATION=skip)" : ""}`);
process.exit(fail ? 1 : 0);
