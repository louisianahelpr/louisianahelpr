#!/usr/bin/env node
/**
 * Q1926 (PGlite proof for 20261103095253_declutter_late_payment_seller_block): a late, in-time Declutter payment
 * (B41: paid before the deadline, recorded after the missed-checkout sweep closed the order; BUY-1 refunds it in
 * full) where the SELLER had blocked the buyer reads seller_backed_out, so the seller owes the card fee, as the
 * same block on an open checkout does (path c). Before, it read order_closed and the platform paid the fee.
 *   (1) seller blocked the buyer, items still free: seller_backed_out, every cent back, the seller's debt, told once;
 *   (2) seller blocked the buyer AND is out: still seller_backed_out (the block decides, as in path c);
 *   (3) seller blocked the buyer but the item went to someone else: order_closed, no debt (the block stopped nothing);
 *   (4) seller out, no block: seller_out (unchanged);
 *   (5) the BUYER blocked the seller (owner's call, Q1926): order_closed, no debt (unchanged);
 *   and the strike still goes, the grants stay service_role only, and the file replays 3x.
 *
 *   node src/test/pglite/declutterLatePaymentSellerBlock.pglite.mjs                       # all PASS
 *   NEW_MIGRATION=skip node src/test/pglite/declutterLatePaymentSellerBlock.pglite.mjs    # RED: (1) (2) read order_closed
 *
 * Real (newest definition on this branch, any dollar-quote tag): declutter_record_refund,
 * declutter_seller_out_fee_notice, and declutter_mark_order_paid (this file applied for real, 3x; or with
 * NEW_MIGRATION=skip the definition before it). Stubbed, said so: the tables reduced to the columns read;
 * declutter_seller_out reads a test table; declutter_notify records calls; the small helpers are fixed stand-ins
 * (as in declutterBlockedOutSellerNotice.pglite.mjs). pglite is not a dependency (CLAUDE.md): loaded from ~/.lh-pglite.
 */
import os from "node:os";
import { readFileSync, readdirSync } from "node:fs";

const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const MIG_DIR = new URL("../../../supabase/migrations/", import.meta.url).pathname;
const THIS = "20261103095253_declutter_late_payment_seller_block.sql";
const skip = process.env.NEW_MIGRATION === "skip";

/** The newest definition of public.<name> in any migration sorting before `before` (any dollar-quote tag). */
function definitionBefore(name, before) {
  let last = null;
  for (const f of readdirSync(MIG_DIR).filter((x) => x.endsWith(".sql") && x < before).sort()) {
    const sql = readFileSync(MIG_DIR + f, "utf8");
    const head = new RegExp(`CREATE\\s+(?:OR\\s+REPLACE\\s+)?FUNCTION\\s+public\\.${name}\\s*\\(`, "gi");
    for (const m of sql.matchAll(head)) {
      const rest = sql.slice(m.index);
      const tag = /\bAS\s+(\$\w*\$)/i.exec(rest);
      const end = rest.indexOf(tag[1], tag.index + tag[0].length);
      last = rest.slice(0, end + tag[1].length) + ";";
    }
  }
  if (!last) throw new Error(`no definition of ${name} before ${before}`);
  return last;
}
let failures = 0;
const check = (ok, name, detail = "") => { console.log(`${ok ? "PASS" : "FAIL"}  ${name}${!ok && detail ? `  (${detail})` : ""}`); if (!ok) failures++; };
const U = (n) => `cdcdcdcd-0000-0000-0000-${String(n).padStart(12, "0")}`;
const FEE = 163;

const db = new PGlite();
await db.exec(`
CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO anon, authenticated, service_role;
CREATE TABLE public.user_blocks (blocker_id uuid, blocked_id uuid);
CREATE TABLE public.out_sellers (id uuid PRIMARY KEY);
CREATE TABLE public.declutter_items (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), seller_id uuid, status text, updated_at timestamptz);
CREATE TABLE public.declutter_orders (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), status text, close_reason text, closed_at timestamptz,
  buyer_id uuid, seller_id uuid, items_cents integer, premium_cents integer DEFAULT 0, tax_cents integer DEFAULT 0,
  delivery_cents integer DEFAULT 0, shipping_cents integer DEFAULT 0, total_cents integer, setup_fee_cents integer NOT NULL DEFAULT 0,
  setup_fee_state text, stripe_payment_intent_id text, paid_at timestamptz, stripe_paid_at timestamptz, card_fee_cents integer);
CREATE TABLE public.declutter_cart_items (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), item_id uuid, order_id uuid,
  status text DEFAULT 'in_cart', checkout_by timestamptz, closed_at timestamptz);
CREATE TABLE public.declutter_strikes (cart_line_id uuid, reason text, removed_at timestamptz);
CREATE TABLE public.declutter_refunds (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), order_id uuid, stripe_payment_intent_id text UNIQUE,
  reason text, fee_policy text, paid_cents integer, card_fee_cents integer, kept_cents integer, refund_cents integer);
CREATE TABLE public.declutter_seller_fee_debts (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), seller_id uuid, refund_id uuid UNIQUE,
  amount_cents integer, remaining_cents integer, fee_estimated boolean NOT NULL DEFAULT false);
CREATE TABLE public.helpr_tasks (helpr_id uuid, source_kind text, source_id uuid);
CREATE TABLE public.notices (user_id uuid, kind text, title text, message text);
CREATE FUNCTION public.declutter_seller_out(a uuid) RETURNS boolean LANGUAGE sql AS $$ SELECT EXISTS (SELECT 1 FROM public.out_sellers WHERE id = a) $$;
CREATE FUNCTION public.declutter_notify(p_user uuid, p_kind text, p_title text, p_message text, p_link text, p_other uuid DEFAULT NULL)
  RETURNS void LANGUAGE sql AS $$ INSERT INTO public.notices SELECT p_user, p_kind, p_title, p_message WHERE p_user IS NOT NULL $$;
CREATE FUNCTION public.declutter_card_fee_estimate(p integer) RETURNS integer LANGUAGE sql AS $$ SELECT 999 $$;
CREATE FUNCTION public.declutter_order_items_named(p uuid) RETURNS text LANGUAGE sql AS $$ SELECT 'Oak chair' $$;
CREATE FUNCTION public.declutter_delivery_reserved_cents(p uuid) RETURNS integer LANGUAGE sql AS $$ SELECT 0 $$;
CREATE FUNCTION public.declutter_shipping_reserved_cents(p uuid) RETURNS integer LANGUAGE sql AS $$ SELECT 0 $$;
CREATE FUNCTION public.declutter_price_text(p integer) RETURNS text LANGUAGE sql AS $$ SELECT '$' || (p / 100)::text $$;
CREATE FUNCTION public.declutter_paid_next_step(p uuid) RETURNS text LANGUAGE sql AS $$ SELECT '' $$;
CREATE FUNCTION public.declutter_claim_setup_fee(p uuid) RETURNS void LANGUAGE sql AS $$ SELECT $$;
CREATE FUNCTION public.declutter_refund_answer(p uuid) RETURNS jsonb LANGUAGE sql AS $$
  SELECT jsonb_build_object('result', 'refunded', 'reason', r.reason, 'fee_policy', r.fee_policy, 'refund_cents', r.refund_cents)
    FROM public.declutter_refunds r WHERE r.id = p $$;
`);
for (const fn of ["declutter_record_refund", "declutter_seller_out_fee_notice"]) await db.exec(definitionBefore(fn, "99999999"));
if (skip) {
  await db.exec(definitionBefore("declutter_mark_order_paid", THIS));
} else {
  const mig = readFileSync(MIG_DIR + THIS, "utf8");
  for (let k = 1; k <= 3; k++) await db.exec(mig);
}

const q = async (s, p = []) => (await db.query(s, p)).rows;
/**
 * A checkout the missed-checkout sweep closed (B41): the hold was released (item back 'live', line 'missed', a
 * strike booked), the deadline 10 minutes ago, and the buyer's payment made in time.
 */
async function lateCheckout(seller, buyer, itemStatus = "live") {
  const item = (await q(`INSERT INTO public.declutter_items (seller_id, status) VALUES ($1, $2) RETURNING id`, [seller, itemStatus]))[0].id;
  const order = (await q(`INSERT INTO public.declutter_orders (status, close_reason, buyer_id, seller_id, items_cents, total_cents)
    VALUES ('expired', 'missed_checkout', $1, $2, 4000, 4000) RETURNING id`, [buyer, seller]))[0].id;
  const line = (await q(`INSERT INTO public.declutter_cart_items (item_id, order_id, status, checkout_by)
    VALUES ($1, $2, 'missed', now() - interval '10 minutes') RETURNING id`, [item, order]))[0].id;
  await q(`INSERT INTO public.declutter_strikes (cart_line_id, reason) VALUES ($1, 'missed_checkout')`, [line]);
  return { order, line };
}
const pay = async (order, pi) => {
  try { return (await q(`SELECT public.declutter_mark_order_paid($1, $2, 4000, now() - interval '15 minutes', ${FEE}) AS r`, [order, pi]))[0].r; }
  catch (e) { return { error: e.message }; }
};
const debt = async (pi) => (await q(`SELECT d.seller_id, d.amount_cents FROM public.declutter_seller_fee_debts d
  JOIN public.declutter_refunds r ON r.id = d.refund_id WHERE r.stripe_payment_intent_id = $1`, [pi]))[0];
const owes = async (uid) => q(`SELECT title, message FROM public.notices WHERE user_id = $1 AND (message LIKE '%owing%' OR title IN ('You owe from a refund', 'Card fee owed', 'Amount owed'))`, [uid]);
const block = (a, b) => q(`INSERT INTO public.user_blocks VALUES ($1, $2)`, [a, b]);

// (1) The seller blocked the buyer; the item is still free, the seller can still sell.
const S1 = U(1), B1 = U(2);
await block(S1, B1);
const one = await lateCheckout(S1, B1);
const r1 = await pay(one.order, "pi_q1926_1");
check(r1?.reason === "seller_backed_out" && r1?.fee_policy === "full_seller_pays_fee" && r1?.refund_cents === 4000,
  "(1) late in-time payment, the seller blocked the buyer: seller_backed_out, every cent back", JSON.stringify(r1));
check((await debt("pi_q1926_1"))?.seller_id === S1 && (await debt("pi_q1926_1"))?.amount_cents === FEE,
  "(1) the card fee is the seller's debt", JSON.stringify(await debt("pi_q1926_1")));
check((await owes(S1)).length === 1, "(1) the seller is told once", JSON.stringify(await owes(S1)));
const strike = (await q(`SELECT removed_at FROM public.declutter_strikes WHERE cart_line_id = $1`, [one.line]))[0];
check(strike?.removed_at != null, "(1) the buyer's missed-checkout strike still goes (paid in time)");
await pay(one.order, "pi_q1926_1");
check((await owes(S1)).length === 1 && Number((await q(`SELECT count(*)::int n FROM public.declutter_refunds WHERE stripe_payment_intent_id = 'pi_q1926_1'`))[0].n) === 1,
  "(1) a replayed webhook books and tells nothing twice");

// (2) The seller blocked the buyer AND is out: the block decides (as in path c).
const S2 = U(3), B2 = U(4);
await q(`INSERT INTO public.out_sellers VALUES ($1)`, [S2]);
await block(S2, B2);
const r2 = await pay((await lateCheckout(S2, B2)).order, "pi_q1926_2");
check(r2?.reason === "seller_backed_out" && r2?.refund_cents === 4000, "(2) seller blocked the buyer and is out: seller_backed_out", JSON.stringify(r2));
check((await debt("pi_q1926_2"))?.amount_cents === FEE && (await owes(S2)).length === 1, "(2) debt booked, the seller told once", JSON.stringify(await owes(S2)));

// (3) The seller blocked the buyer, but the item was sold to someone else after the hold ended: ours, as before.
const S3 = U(5), B3 = U(6);
await block(S3, B3);
const r3 = await pay((await lateCheckout(S3, B3, "sold")).order, "pi_q1926_3");
check(r3?.reason === "order_closed" && r3?.fee_policy === "full_platform_absorbs" && r3?.refund_cents === 4000,
  "(3) the item went elsewhere: order_closed, every cent back", JSON.stringify(r3));
check(!(await debt("pi_q1926_3")) && (await owes(S3)).length === 0, "(3) no seller debt, no notice");

// (4) The seller is out, no block: seller_out (unchanged).
const S4 = U(7), B4 = U(8);
await q(`INSERT INTO public.out_sellers VALUES ($1)`, [S4]);
const r4 = await pay((await lateCheckout(S4, B4)).order, "pi_q1926_4");
check(r4?.reason === "seller_out" && r4?.refund_cents === 4000, "(4) seller out, no block: seller_out (unchanged)", JSON.stringify(r4));
check((await debt("pi_q1926_4"))?.amount_cents === FEE && (await owes(S4)).length === 1, "(4) debt booked, told once");

// (5) The BUYER blocked the seller (seller not out): order_closed, as before (who pays then is the owner's call).
const S5 = U(9), B5 = U(10);
await block(B5, S5);
const r5 = await pay((await lateCheckout(S5, B5)).order, "pi_q1926_5");
check(r5?.reason === "order_closed" && r5?.refund_cents === 4000, "(5) the buyer blocked the seller: order_closed (unchanged)", JSON.stringify(r5));
check(!(await debt("pi_q1926_5")), "(5) no seller debt");

if (!skip) {
  const sig = "public.declutter_mark_order_paid(uuid, text, integer, timestamptz, integer)";
  const acl = (await q(`SELECT has_function_privilege('anon', '${sig}', 'EXECUTE') a, has_function_privilege('authenticated', '${sig}', 'EXECUTE') u,
    has_function_privilege('service_role', '${sig}', 'EXECUTE') s`))[0];
  check(!acl.a && !acl.u && acl.s, `grants on mark_order_paid: anon ${acl.a} authenticated ${acl.u} service_role ${acl.s}`);
}

console.log(failures ? `\n${failures} FAILED` : "\nall PASS");
process.exit(failures ? 1 : 0);
