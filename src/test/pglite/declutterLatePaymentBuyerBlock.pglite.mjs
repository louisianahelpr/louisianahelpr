#!/usr/bin/env node
/**
 * Q1926 buyer half (PGlite proof for 20261103173111_declutter_late_payment_buyer_block; owner 2026-11-03): a late,
 * in-time Declutter payment (B41: paid before the deadline, recorded after the missed-checkout sweep closed the order;
 * BUY-1 refunds it) where the BUYER had blocked the seller reads buyer_cancelled, so the card fee is kept from the
 * refund, as the same block on an open checkout does (path c). Before, it read order_closed and the platform paid it,
 * and the buyer was told "every cent is coming back".
 *   (1) the buyer blocked the seller: buyer_cancelled, refund less the card fee, no seller debt, the notice says
 *       "less the card fee" and not "every cent", the strike still goes, a replay books and tells nothing twice;
 *   (2) the buyer blocked the seller and the item went to someone else: still buyer_cancelled (as in path c);
 *   (3) both blocked each other: seller_backed_out, every cent (the seller's block comes first, as in path c);
 *   (4) the buyer blocked a seller who is out: seller_out, every cent (as in path c);
 *   (5) no block: order_closed, every cent, the "every cent" notice (unchanged);
 *   and the grants stay service_role only, and the file replays 3x.
 *
 *   node src/test/pglite/declutterLatePaymentBuyerBlock.pglite.mjs                       # all PASS
 *   NEW_MIGRATION=skip node src/test/pglite/declutterLatePaymentBuyerBlock.pglite.mjs    # RED: (1) (2) read order_closed
 *
 * Real (newest definition on this branch, any dollar-quote tag): declutter_record_refund,
 * declutter_seller_out_fee_notice, and declutter_mark_order_paid (this file applied for real, 3x; or with
 * NEW_MIGRATION=skip the definition before it). Stubbed, said so: the tables reduced to the columns read;
 * declutter_seller_out reads a test table; declutter_notify records calls; the small helpers are fixed stand-ins
 * (as in declutterLatePaymentSellerBlock.pglite.mjs). pglite is not a dependency (CLAUDE.md): loaded from ~/.lh-pglite.
 */
import os from "node:os";
import { readFileSync, readdirSync } from "node:fs";

const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const MIG_DIR = new URL("../../../supabase/migrations/", import.meta.url).pathname;
const THIS = "20261103173111_declutter_late_payment_buyer_block.sql";
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
const U = (n) => `cdcdcdce-0000-0000-0000-${String(n).padStart(12, "0")}`;
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

const strikeNotice = async (uid) => q(`SELECT message FROM public.notices WHERE user_id = $1 AND title = 'Your strike was removed'`, [uid]);

// (1) The buyer blocked the seller; the item is still free, the seller can still sell.
const S1 = U(1), B1 = U(2);
await block(B1, S1);
const one = await lateCheckout(S1, B1);
const r1 = await pay(one.order, "pi_q1926b_1");
check(r1?.reason === "buyer_cancelled" && r1?.fee_policy === "keep_card_fee" && r1?.refund_cents === 4000 - FEE,
  "(1) late in-time payment, the buyer blocked the seller: buyer_cancelled, the card fee kept", JSON.stringify(r1));
check(!(await debt("pi_q1926b_1")) && (await owes(S1)).length === 0, "(1) no seller debt, no seller notice");
const n1 = await strikeNotice(B1);
check(n1.length === 1 && /less the card fee/.test(n1[0].message) && !/every cent/.test(n1[0].message),
  "(1) the buyer is told the payment comes back less the card fee, never 'every cent'", JSON.stringify(n1));
const strike = (await q(`SELECT removed_at FROM public.declutter_strikes WHERE cart_line_id = $1`, [one.line]))[0];
check(strike?.removed_at != null, "(1) the buyer's missed-checkout strike still goes (paid in time)");
await pay(one.order, "pi_q1926b_1");
check((await strikeNotice(B1)).length === 1 && Number((await q(`SELECT count(*)::int n FROM public.declutter_refunds WHERE stripe_payment_intent_id = 'pi_q1926b_1'`))[0].n) === 1,
  "(1) a replayed webhook books and tells nothing twice");

// (2) The buyer blocked the seller and the item went to someone else after the hold ended: still the buyer's doing.
const S2 = U(3), B2 = U(4);
await block(B2, S2);
const r2 = await pay((await lateCheckout(S2, B2, "sold")).order, "pi_q1926b_2");
check(r2?.reason === "buyer_cancelled" && r2?.refund_cents === 4000 - FEE, "(2) item went elsewhere, the buyer blocked: buyer_cancelled", JSON.stringify(r2));

// (3) Both blocked each other: the seller's block comes first (path c): every cent, the seller owes the fee.
const S3 = U(5), B3 = U(6);
await block(S3, B3); await block(B3, S3);
const r3 = await pay((await lateCheckout(S3, B3)).order, "pi_q1926b_3");
check(r3?.reason === "seller_backed_out" && r3?.refund_cents === 4000, "(3) both blocked: seller_backed_out, every cent", JSON.stringify(r3));
check(/every cent/.test((await strikeNotice(B3))[0]?.message ?? ""), "(3) the buyer is told every cent");

// (4) The buyer blocked a seller who is out: seller_out (path c's order).
const S4 = U(7), B4 = U(8);
await q(`INSERT INTO public.out_sellers VALUES ($1)`, [S4]);
await block(B4, S4);
const r4 = await pay((await lateCheckout(S4, B4)).order, "pi_q1926b_4");
check(r4?.reason === "seller_out" && r4?.refund_cents === 4000, "(4) the buyer blocked a seller who is out: seller_out", JSON.stringify(r4));

// (5) No block: order_closed, every cent, as before.
const S5 = U(9), B5 = U(10);
const r5 = await pay((await lateCheckout(S5, B5)).order, "pi_q1926b_5");
check(r5?.reason === "order_closed" && r5?.refund_cents === 4000, "(5) no block: order_closed, every cent (unchanged)", JSON.stringify(r5));
const n5 = await strikeNotice(B5);
check(n5.length === 1 && /every cent is coming back/.test(n5[0].message), "(5) the 'every cent' notice (unchanged)", JSON.stringify(n5));

if (!skip) {
  const sig = "public.declutter_mark_order_paid(uuid, text, integer, timestamptz, integer)";
  const acl = (await q(`SELECT has_function_privilege('anon', '${sig}', 'EXECUTE') a, has_function_privilege('authenticated', '${sig}', 'EXECUTE') u,
    has_function_privilege('service_role', '${sig}', 'EXECUTE') s`))[0];
  check(!acl.a && !acl.u && acl.s, `grants on mark_order_paid: anon ${acl.a} authenticated ${acl.u} service_role ${acl.s}`);
}

console.log(failures ? `\n${failures} FAILED` : "\nall PASS");
process.exit(failures ? 1 : 0);
