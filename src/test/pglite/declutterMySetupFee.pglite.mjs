#!/usr/bin/env node
/**
 * PGlite proof for 20261111212343_declutter_my_setup_fee (owner 11-11 ~3:25 PM): the caller-only read names the fee
 * the server will take and the ONE sale it comes out of: among payout rows declutter_payout_take_setup_fee could take
 * it from, the one the payout run sends first (due now before held, then next_attempt_at, then id); else the paid sale
 * still to hand over that was paid first. Never another seller's rows; no fee -> no sale.
 *
 *   node src/test/pglite/declutterMySetupFee.pglite.mjs                     # all PASS
 *   NEW_MIGRATION=skip node src/test/pglite/declutterMySetupFee.pglite.mjs  # RED: no such read
 *
 * Real: the migration, applied 3x. Stubbed, said so: tables reduced to the columns read; auth.uid() reads a setting;
 * declutter_setup_fee_from_payout_cents answers a per-seller table (its own rules are proven by 20261031214749's
 * proofs); declutter_sale_final answers a per-order table. pglite is loaded from ~/.lh-pglite.
 */
import os from "node:os";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const MIG = fileURLToPath(new URL("../../../supabase/migrations/20261111212343_declutter_my_setup_fee.sql", import.meta.url));
const skip = process.env.NEW_MIGRATION === "skip";

let failures = 0;
const check = (ok, name, detail = "") => { console.log(`${ok ? "PASS" : "FAIL"}  ${name}${!ok && detail ? `  (${detail})` : ""}`); if (!ok) failures++; };

const db = new PGlite();
await db.exec(`
  CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
  CREATE SCHEMA auth;
  CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT NULLIF(current_setting('test.uid', true), '')::uuid $$;
  GRANT USAGE ON SCHEMA auth TO anon, authenticated;
  CREATE TABLE public.fee_owed (seller uuid PRIMARY KEY, cents integer);
  CREATE TABLE public.final_orders (order_id uuid PRIMARY KEY);
  CREATE FUNCTION public.declutter_setup_fee_from_payout_cents(uuid) RETURNS integer LANGUAGE sql STABLE AS $$ SELECT COALESCE((SELECT cents FROM public.fee_owed WHERE seller = $1), 0) $$;
  CREATE FUNCTION public.declutter_sale_final(uuid) RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT EXISTS (SELECT 1 FROM public.final_orders WHERE order_id = $1) $$;
  CREATE TABLE public.declutter_orders (id uuid PRIMARY KEY, seller_id uuid, status text, items_cents integer, paid_at timestamptz, stripe_payment_intent_id text,
    handover text DEFAULT 'porch', delivery_cents integer DEFAULT 0, pickup_slot_start timestamptz);
  CREATE TABLE public.declutter_bookings (order_id uuid PRIMARY KEY, slot_start timestamptz);
  CREATE TABLE public.declutter_payouts (id uuid PRIMARY KEY, order_id uuid, seller_id uuid, amount_cents integer, attempts integer DEFAULT 0,
    status text DEFAULT 'pending', next_attempt_at timestamptz NOT NULL DEFAULT now(), setup_fee_cents integer DEFAULT 0, send_tried boolean DEFAULT false);
  CREATE TABLE public.payout_send_marks (payout_kind text, payout_id uuid);
  CREATE TABLE public.admin_audit_log (action text, target_type text, target_id text);
  CREATE TABLE public.declutter_problems (order_id uuid, status text);
  CREATE TABLE public.declutter_refunds (order_id uuid, stripe_payment_intent_id text, reason text, status text);
`);
if (!skip) {
  const sql = readFileSync(MIG, "utf8");
  for (let i = 0; i < 3; i++) await db.exec(sql);
  check(true, "the migration replays 3x");
}

const u = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const S = u(1); // the seller
const OTHER = u(2);
/** Calls the read as `uid` (role authenticated); returns the answer or the error message. */
async function mine(uid) {
  try {
    await db.exec(`SET test.uid = '${uid ?? ""}'`);
    return (await db.query(`SELECT public.declutter_my_setup_fee() AS r`)).rows[0].r;
  } catch (e) {
    return { error: String(e.message) };
  }
}
const order = (n, seller, status, items, paidAgo) => db.query(
  `INSERT INTO public.declutter_orders VALUES ($1, $2, $3, $4, now() - ($5 || ' hours')::interval, $6)`, [u(n), seller, status, items, String(paidAgo), `pi_${n}`]);
const payout = (n, orderN, seller, amount, nextAgoHours, extra = {}) => db.query(
  `INSERT INTO public.declutter_payouts (id, order_id, seller_id, amount_cents, next_attempt_at, attempts, send_tried, setup_fee_cents)
   VALUES ($1, $2, $3, $4, now() - ($5 || ' hours')::interval, $6, $7, $8)`,
  [u(n), u(orderN), seller, amount, String(nextAgoHours), extra.attempts ?? 0, extra.sendTried ?? false, extra.fee ?? 0]);

// No caller: refused.
const anon = await mine(null);
check(/not_authenticated/.test(anon.error ?? ""), "no caller is refused", JSON.stringify(anon));

// No fee owed (admin / exempt / paid / switch off: all decided by the fee function): 0 and no sale.
await order(10, S, "paid", 3000, 5);
let r = await mine(S);
check(r.fee_cents === 0 && r.order_id === null, "no fee owed: fee 0, no sale named", JSON.stringify(r));

await db.query(`INSERT INTO public.fee_owed VALUES ($1, 200), ($2, 200)`, [S, OTHER]);
// Pre-handover only: the paid sale paid FIRST takes it (order 11 paid 9 h ago beats order 10 paid 5 h ago); a sale whose
// items leave under $1 is skipped (order 12, $2.50 paid 20 h ago); another seller's sale never counts.
await order(11, S, "paid", 2500, 9);
await order(12, S, "paid", 250, 20);
await order(13, OTHER, "paid", 5000, 30);
r = await mine(S);
check(r.fee_cents === 200 && r.order_id === u(11), "before any handover, nothing booked: the sale paid first (with $1 left) takes it", JSON.stringify(r));
// Best guess follows the booked time: order 10 (paid later) is booked tomorrow, order 11 the day after: order 10.
await db.query(`INSERT INTO public.declutter_bookings VALUES ($1, now() + interval '1 day'), ($2, now() + interval '2 days')`, [u(10), u(11)]);
r = await mine(S);
check(r.order_id === u(10), "before any handover: the sale booked first is the best guess", JSON.stringify(r));
await db.query(`DELETE FROM public.declutter_bookings`);
// A seller delivery's rate counts toward the $1 left: $2.50 items + $5 delivery can take a $2 fee (booked first).
await db.query(`UPDATE public.declutter_orders SET handover = 'seller_delivery', delivery_cents = 500 WHERE id = $1`, [u(12)]);
r = await mine(S);
check(r.order_id === u(12), "a seller delivery's rate counts, as the payout row will (items + v_rate)", JSON.stringify(r));
await db.query(`UPDATE public.declutter_orders SET handover = 'porch', delivery_cents = 0 WHERE id = $1`, [u(12)]);

// Handed over: payout rows. Order 20 (held by an open problem, older next_attempt_at) and order 21 (due now).
for (const n of [20, 21, 22, 23, 24, 25, 26]) await order(n, S, "handed_over", 4000, 40);
await payout(120, 20, S, 4000, 30);
await payout(121, 21, S, 4000, 2);
await db.query(`INSERT INTO public.declutter_problems VALUES ($1, 'open')`, [u(20)]);
await db.query(`INSERT INTO public.final_orders VALUES ($1), ($2)`, [u(20), u(21)]);
r = await mine(S);
check(r.order_id === u(21), "a payout due now beats an older one held by an open problem (the run sends it first)", JSON.stringify(r));
check(r.order_id !== u(11), "a payout row beats a sale still to hand over");

// The problem closes: both due, the older next_attempt_at goes first.
await db.query(`UPDATE public.declutter_problems SET status = 'decided'`);
r = await mine(S);
check(r.order_id === u(20), "both due: the older next_attempt_at goes first", JSON.stringify(r));

// A held-for-review refund holds order 20 (declutter_payouts_due's own WHERE): order 21 is sent first again.
await db.query(`INSERT INTO public.declutter_refunds VALUES ($1, 'pi_20', 'refund_request_part', 'held_for_review')`, [u(20)]);
r = await mine(S);
check(r.order_id === u(21), "a held refund on the older row moves the fee to the row the run sends", JSON.stringify(r));
// Refunds that do NOT hold the payout (declutter_payouts_due 20261111211749) do not move the fee: a held
// delivery_damage refund and a refund held on another payment of order 20.
await db.query(`UPDATE public.declutter_refunds SET reason = 'delivery_damage' WHERE order_id = $1`, [u(20)]);
r = await mine(S);
check(r.order_id === u(20), "a held delivery_damage refund does not hold the row (Q1934), so it still goes first", JSON.stringify(r));
await db.query(`UPDATE public.declutter_refunds SET reason = 'duplicate_payment', stripe_payment_intent_id = 'pi_other' WHERE order_id = $1`, [u(20)]);
r = await mine(S);
check(r.order_id === u(20), "a refund held on another payment does not hold the row either", JSON.stringify(r));
await db.query(`UPDATE public.declutter_refunds SET reason = 'refund_request_part', stripe_payment_intent_id = 'pi_20' WHERE order_id = $1`, [u(20)]);
// A pending part refund on order 21 too: neither due, the older next_attempt_at.
await db.query(`INSERT INTO public.declutter_refunds VALUES ($1, 'pi_21', 'refund_request_part', 'pending')`, [u(21)]);
r = await mine(S);
check(r.order_id === u(20), "neither due: the older next_attempt_at", JSON.stringify(r));

// Rows the fee can no longer come out of are skipped (declutter_payout_take_setup_fee's test): a try made, a send
// tried, a send mark, too small to leave $1. Only those left: falls back to the sale still to hand over.
await db.query(`DELETE FROM public.declutter_payouts`);
await payout(122, 22, S, 4000, 50, { attempts: 1 });
await payout(123, 23, S, 4000, 50, { sendTried: true });
await payout(124, 24, S, 4000, 50);
await db.query(`INSERT INTO public.payout_send_marks VALUES ('declutter', $1)`, [u(124)]);
await payout(125, 25, S, 250, 50);
// A row an admin released (attempts back to 0, no send_tried in this fixture) is not untouched either.
await payout(126, 26, S, 4000, 50);
await db.query(`INSERT INTO public.admin_audit_log VALUES ('admin_payout_release', 'declutter', $1)`, [u(126)]);
r = await mine(S);
check(r.order_id === u(11), "rows with a try, a send tried, a send mark, an admin release or under $1 left never take it", JSON.stringify(r));

// Another seller sees only their own sale.
r = await mine(OTHER);
check(r.order_id === u(13), "another seller's answer names only their own sale", JSON.stringify(r));

// Nothing can take it: null.
await db.query(`UPDATE public.declutter_orders SET status = 'handed_over' WHERE seller_id = $1`, [S]);
r = await mine(S);
check(r.fee_cents === 200 && r.order_id === null, "no sale can take it: no sale named", JSON.stringify(r));

let acl = { a: null, u: null };
try {
  acl = (await db.query(`SELECT has_function_privilege('anon', 'public.declutter_my_setup_fee()', 'EXECUTE') a,
    has_function_privilege('authenticated', 'public.declutter_my_setup_fee()', 'EXECUTE') u`)).rows[0];
} catch (e) { acl = { error: String(e.message) }; }
check(acl.a === false && acl.u === true, "grants: authenticated, not anon", JSON.stringify(acl));

console.log(failures ? `\n${failures} FAILED` : "\nall PASS");
process.exit(failures ? 1 : 0);
