#!/usr/bin/env node
/**
 * PGlite proof for 20261111211749_declutter_payout_waits_for_held_refund (money reviewer, 11-11): the seller's payout
 * and the manager's share are NOT offered to the payout run while a refund on the order is 'held_for_review', and are
 * offered again once that refund is settled by hand or released and gone through. Every other row is unchanged.
 *
 *   node src/test/pglite/declutterPayoutWaitsForHeldRefund.pglite.mjs                     # all PASS
 *   NEW_MIGRATION=skip node src/test/pglite/declutterPayoutWaitsForHeldRefund.pglite.mjs  # RED: the held order is paid
 *
 * Grant checks fail with NEW_MIGRATION=skip only because the old bodies are loaded without their GRANT lines; the
 * bug's own red is the 4 hold checks (2026-11-11). Release and settle are plain status UPDATEs here (the admin functions' writes,
 * read in 20261101234732 and 20261106203016), not calls to them.
 * Real: both queue bodies (the newest definition before this file, then this file applied 3x) and the real
 * declutter_order_gift_net_cents. Stubbed, said so: tables reduced to the columns read; declutter_sale_final and
 * declutter_order_refunds_recorded_cents are fixed stand-ins (true, 0). pglite is loaded from ~/.lh-pglite.
 */
import os from "node:os";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const MIG_DIR = fileURLToPath(new URL("../../../supabase/migrations/", import.meta.url));
const FILES = readdirSync(MIG_DIR).filter((f) => f.endsWith(".sql")).sort();
const THIS = "20261111211749_declutter_payout_waits_for_held_refund.sql";
const skip = process.env.NEW_MIGRATION === "skip";
const FNS = ["declutter_payouts_due", "declutter_manager_payouts_due"];

/** The newest CREATE [OR REPLACE] FUNCTION public.<name>( before `before`, any dollar-quote tag. */
function newest(name, before) {
  for (let i = FILES.length - 1; i >= 0; i--) {
    if (FILES[i] >= before) continue;
    const src = readFileSync(MIG_DIR + FILES[i], "utf8");
    const m = [...src.matchAll(new RegExp(`CREATE (?:OR REPLACE )?FUNCTION public\\.${name}\\(`, "g"))].pop();
    if (!m) continue;
    const start = m.index;
    const tag = /AS\s+(\$[A-Za-z_]*\$)/.exec(src.slice(start))[1];
    const open = src.indexOf(tag, start);
    return src.slice(start, src.indexOf(tag, open + tag.length) + tag.length) + ";";
  }
  throw new Error(`${name}: no definition before ${before}`);
}

let failures = 0;
const check = (ok, name, detail = "") => { console.log(`${ok ? "PASS" : "FAIL"}  ${name}${!ok && detail ? `  (${detail})` : ""}`); if (!ok) failures++; };

const db = new PGlite();
await db.exec(`
  CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
  CREATE TABLE public.profiles (user_id uuid PRIMARY KEY, stripe_account_id text, ban_status text, auto_suspended_until timestamptz);
  CREATE TABLE public.declutter_orders (id uuid PRIMARY KEY, buyer_id uuid, stripe_payment_intent_id text, gift_cents integer NOT NULL DEFAULT 0);
  CREATE TABLE public.declutter_payouts (id uuid PRIMARY KEY, order_id uuid, seller_id uuid, amount_cents integer, attempts integer DEFAULT 0,
    status text DEFAULT 'pending', next_attempt_at timestamptz DEFAULT now() - interval '1 minute', review_held_at timestamptz);
  CREATE TABLE public.declutter_manager_payouts (id uuid PRIMARY KEY, order_id uuid, seller_id uuid, manager_id uuid, seller_payout_id uuid,
    amount_cents integer, attempts integer DEFAULT 0, status text DEFAULT 'pending', next_attempt_at timestamptz DEFAULT now() - interval '1 minute');
  CREATE TABLE public.declutter_problems (order_id uuid, status text);
  CREATE TABLE public.declutter_refunds (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), order_id uuid, stripe_payment_intent_id text, reason text, status text);
  CREATE TABLE public.payout_holds (helper_id uuid);
  CREATE TABLE public.user_blocks (blocker_id uuid, blocked_id uuid);
  CREATE TABLE public.gift_cards (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), amount numeric, restored_from_declutter_order_id uuid);
  CREATE FUNCTION public.declutter_order_refunds_recorded_cents(uuid) RETURNS integer LANGUAGE sql AS $$ SELECT 0 $$;
  CREATE FUNCTION public.declutter_sale_final(uuid) RETURNS boolean LANGUAGE sql AS $$ SELECT true $$;
`);
const u = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
// Orders: 1 = no refund (control), 2 = part refund held for review, 3 = a full refund (other reason) held for review,
// 4 = part refund already succeeded (control: paid), 5 = a delivery_damage refund held (Q1934: never holds the
// seller), 6 = a refund held on ANOTHER payment of the order (a duplicate payment: not the seller's money).
for (const n of [1, 2, 3, 4, 5, 6]) {
  await db.query(`INSERT INTO public.profiles (user_id, stripe_account_id) VALUES ($1, $2), ($3, $4) ON CONFLICT DO NOTHING`,
    [u(100 + n), `acct_s${n}`, u(200 + n), `acct_m${n}`]);
  await db.query(`INSERT INTO public.declutter_orders VALUES ($1, $2, $3, 0)`, [u(n), u(900), `pi_${n}`]);
  await db.query(`INSERT INTO public.declutter_payouts (id, order_id, seller_id, amount_cents) VALUES ($1, $2, $3, 2800)`, [u(10 + n), u(n), u(100 + n)]);
  await db.query(`INSERT INTO public.declutter_manager_payouts (id, order_id, seller_id, manager_id, seller_payout_id, amount_cents) VALUES ($1, $2, $3, $4, $5, 400)`,
    [u(20 + n), u(n), u(100 + n), u(200 + n), u(10 + n)]);
}
await db.query(`INSERT INTO public.declutter_refunds (id, order_id, stripe_payment_intent_id, reason, status) VALUES
  ($1, $2, 'pi_2', 'refund_request_part', 'held_for_review'),
  ($3, $4, 'pi_3', 'admin_no_fault', 'held_for_review'),
  ($5, $6, 'pi_4', 'refund_request_part', 'succeeded'),
  ($7, $8, 'pi_5', 'delivery_damage', 'held_for_review'),
  ($9, $10, 'pi_6_dup', 'duplicate_payment', 'held_for_review')`, [u(32), u(2), u(33), u(3), u(34), u(4), u(35), u(5), u(36), u(6)]);

await db.exec(newest("declutter_order_gift_net_cents", THIS));
for (const fn of FNS) await db.exec(newest(fn, THIS));
const orderIds = async (fn) => (await db.query(`SELECT order_id FROM public.${fn}(100) ORDER BY order_id`)).rows.map((r) => String(r.order_id));
const before = Object.fromEntries(await Promise.all(FNS.map(async (fn) => [fn, await orderIds(fn)])));
check(before.declutter_payouts_due.length === 6 && before.declutter_manager_payouts_due.length === 6,
  "the old bodies offer all 6 orders, held refunds included (the bug; inventory non-empty)", JSON.stringify(before));

if (!skip) {
  const sql = readFileSync(MIG_DIR + THIS, "utf8");
  for (let i = 0; i < 3; i++) await db.exec(sql);
  check(true, "the migration replays 3x");
}

for (const fn of FNS) {
  const ids = await orderIds(fn);
  check(!ids.includes(u(2)), `${fn}: a PART refund held for review holds the payout`, JSON.stringify(ids));
  check(!ids.includes(u(3)), `${fn}: a refund of any other reason held for review holds it too`, JSON.stringify(ids));
  check(ids.includes(u(1)) && ids.includes(u(4)), `${fn}: an order with no refund, or a refund gone through, is still paid`, JSON.stringify(ids));
  check(ids.includes(u(5)), `${fn}: a held delivery_damage refund does not hold the seller (Q1934)`, JSON.stringify(ids));
  check(ids.includes(u(6)), `${fn}: a refund held on another payment of the order does not hold it`, JSON.stringify(ids));
  const acl = (await db.query(`SELECT has_function_privilege('anon', 'public.${fn}(integer)', 'EXECUTE') a,
    has_function_privilege('authenticated', 'public.${fn}(integer)', 'EXECUTE') u, has_function_privilege('service_role', 'public.${fn}(integer)', 'EXECUTE') s`)).rows[0];
  check(!acl.a && !acl.u && acl.s, `${fn}: grants service_role only`, JSON.stringify(acl));
}

// Every other column of the rows still offered is the old body's answer.
await db.exec(newest("declutter_payouts_due", THIS).replace(/^CREATE FUNCTION/, "CREATE OR REPLACE FUNCTION"));
const oldRows = (await db.query(`SELECT * FROM public.declutter_payouts_due(100) WHERE order_id IN ($1, $2, $3, $4) ORDER BY order_id`, [u(1), u(4), u(5), u(6)])).rows;
if (!skip) await db.exec(readFileSync(MIG_DIR + THIS, "utf8"));
const newRows = (await db.query(`SELECT * FROM public.declutter_payouts_due(100) WHERE order_id IN ($1, $2, $3, $4) ORDER BY order_id`, [u(1), u(4), u(5), u(6)])).rows;
// (Meaningful with the migration applied; with NEW_MIGRATION=skip it compares the old body with itself.)
check(oldRows.length === 4 && JSON.stringify(oldRows) === JSON.stringify(newRows), "declutter_payouts_due: the rows still offered are identical to the old answer");

// The admin RELEASES the held part refund (admin_payout_release -> 'pending'): still held until it goes through.
await db.query(`UPDATE public.declutter_refunds SET status = 'pending' WHERE id = $1`, [u(32)]);
check(!(await orderIds("declutter_payouts_due")).includes(u(2)), "released part refund, still pending: the payout still waits");
await db.query(`UPDATE public.declutter_refunds SET status = 'succeeded' WHERE id = $1`, [u(32)]);
for (const fn of FNS) check((await orderIds(fn)).includes(u(2)), `${fn}: once the released refund went through, the payout is sent`);
// The admin SETTLES the other held refund by hand: the payout is offered again.
await db.query(`UPDATE public.declutter_refunds SET status = 'settled_by_hand' WHERE id = $1`, [u(33)]);
for (const fn of FNS) check((await orderIds(fn)).includes(u(3)), `${fn}: a held refund settled by hand lets the payout go`);

console.log(failures ? `\n${failures} FAILED` : "\nall PASS");
process.exit(failures ? 1 : 0);
