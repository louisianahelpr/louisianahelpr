#!/usr/bin/env node
/**
 * Q2106 (PGlite proof for 20261105030604_declutter_gift_cards; lead decisions 11-04): a Declutter order paid with ONE
 * gift card, the jobs shape.
 *   (1) the gift covers the whole order: paid at once with no card page (no payment intent, no card fee, items sold),
 *       the gift lowered to what it paid and redeemed, the leftover split off as the buyer's child gift (value kept);
 *   (2) the gift covers part: reserved, the order's gift_cents set, the card remainder answered; the card payment of
 *       exactly the remainder pays the order, the trigger redeems the gift, the card fee is the card's share;
 *   (3) a card payment of the whole price on a gift order is an amount mismatch (refunded), never a second payment;
 *   (4) an abandoned page (the sweep closes the order): the reserved gift goes back to 'sent' at its full amount, once;
 *       a late in-time card payment then refunds only the card's share;
 *   (5) a card remainder of 1-49 cents is refused with a sentence and nothing changes; exactly 50 cents is allowed;
 *   (6) the gates: someone else's gift, an unfunded or expired gift, a gift set aside for another order, a used gift,
 *       someone else's order, a closed order, a card page still open (the retired one is allowed and cleared);
 *   (7) a fully covered order that is no longer payable (the buyer blocked the seller) raises and rolls back: the gift
 *       is untouched and no refund is recorded;
 *   (8) a second gift on the same order (no page opened) puts the first back to 'sent';
 *   (9) an order with no gift pays exactly as before; grants service_role only; the file replays 3x;
 *   (10) S3: a refund's gift share goes back to the gift balance as the buyer's own spendable child, once per refund
 *       key, capped at the gift (net of earlier give-backs); a split order's share is proportional (rounded down), a
 *       gift-only order's is all of it, a card-only order's is 0.
 *
 *   node src/test/pglite/declutterGiftCards.pglite.mjs                       # all PASS
 *   NEW_MIGRATION=skip node src/test/pglite/declutterGiftCards.pglite.mjs    # RED: no gift path (the columns only)
 *
 * Real (newest definition on this branch, any dollar-quote tag): declutter_record_refund,
 * declutter_seller_out_fee_notice, declutter_mark_order_paid, redeem_gift_card_for_declutter_order and the trigger
 * (this file applied for real, 3x). Stubbed, said so: the tables reduced to the columns read; declutter_seller_out reads
 * a test table; declutter_notify records calls; the small helpers are fixed stand-ins (as in
 * declutterLatePaymentBuyerBlock.pglite.mjs). pglite is not a dependency (CLAUDE.md): loaded from ~/.lh-pglite.
 */
import os from "node:os";
import { readFileSync, readdirSync } from "node:fs";

const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const MIG_DIR = new URL("../../../supabase/migrations/", import.meta.url).pathname;
const THIS = "20261105030604_declutter_gift_cards.sql";
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
const U = (n) => `cdcdcdcf-0000-0000-0000-${String(n).padStart(12, "0")}`;

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
  setup_fee_state text, stripe_payment_intent_id text, stripe_checkout_session_id text, paid_at timestamptz, stripe_paid_at timestamptz,
  card_fee_cents integer, handover text, pickup_slot_start timestamptz);
CREATE TABLE public.declutter_cart_items (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), item_id uuid, order_id uuid,
  status text DEFAULT 'in_cart', checkout_by timestamptz, closed_at timestamptz);
CREATE TABLE public.declutter_strikes (cart_line_id uuid, reason text, removed_at timestamptz);
CREATE TABLE public.declutter_refunds (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), order_id uuid, stripe_payment_intent_id text UNIQUE,
  reason text, fee_policy text, paid_cents integer, card_fee_cents integer, kept_cents integer, refund_cents integer);
CREATE TABLE public.declutter_seller_fee_debts (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), seller_id uuid, refund_id uuid UNIQUE,
  amount_cents integer, remaining_cents integer, fee_estimated boolean NOT NULL DEFAULT false);
CREATE TABLE public.helpr_tasks (helpr_id uuid, source_kind text, source_id uuid);
CREATE TABLE public.notices (user_id uuid, kind text, title text, message text);
CREATE TABLE public.gift_cards (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), donor_id uuid, recipient_id uuid, recipient_email text,
  amount numeric NOT NULL, status text NOT NULL, payment_status text, category text, message text, occasion text, design_id text, parent_credit_id uuid,
  job_id uuid, split_for_job_id uuid, restored_from_job_id uuid, expires_at timestamptz, redeemed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now());
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
  SELECT jsonb_build_object('result', 'refunded', 'reason', r.reason, 'fee_policy', r.fee_policy, 'refund_cents', r.refund_cents,
    'paid_cents', r.paid_cents) FROM public.declutter_refunds r WHERE r.id = p $$;
`);
for (const fn of ["declutter_record_refund", "declutter_seller_out_fee_notice"]) await db.exec(definitionBefore(fn, "99999999"));
const mig = readFileSync(MIG_DIR + THIS, "utf8");
if (skip) {
  // The state before this file: the old paid step, and (so the no-gift checks run) the new columns alone.
  await db.exec(definitionBefore("declutter_mark_order_paid", THIS));
  await db.exec(mig.slice(mig.indexOf("ALTER TABLE public.gift_cards"), mig.indexOf("CREATE OR REPLACE FUNCTION public.declutter_mark_order_paid")));
} else {
  for (let k = 1; k <= 3; k++) await db.exec(mig);
}

const q = async (s, p = []) => (await db.query(s, p)).rows;
/** An open order (awaiting payment) for one reserved item of `cents`. */
async function openOrder(seller, buyer, cents = 4000, setup = 0) {
  const item = (await q(`INSERT INTO public.declutter_items (seller_id, status) VALUES ($1, 'reserved') RETURNING id`, [seller]))[0].id;
  const order = (await q(`INSERT INTO public.declutter_orders (status, buyer_id, seller_id, items_cents, total_cents, setup_fee_cents)
    VALUES ('awaiting_payment', $1, $2, $3, $3, $4) RETURNING id`, [buyer, seller, cents, setup]))[0].id;
  await q(`INSERT INTO public.declutter_cart_items (item_id, order_id, checkout_by) VALUES ($1, $2, now() + interval '1 day')`, [item, order]);
  return { order, item };
}
const gift = async (to, dollars, extra = {}) => (await q(`INSERT INTO public.gift_cards (donor_id, recipient_id, amount, status, payment_status, expires_at)
  VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`, [U(999), to, dollars, extra.status ?? "sent", extra.paid ?? "paid", extra.expires ?? null]))[0].id;
const redeem = async (g, order, user, retired = null) => {
  try { return (await q(`SELECT public.redeem_gift_card_for_declutter_order($1, $2, $3, $4) AS r`, [g, order, user, retired]))[0].r; }
  catch (e) { return { error: e.message }; }
};
const pay = async (order, pi, cents, fee = 80) => {
  try { return (await q(`SELECT public.declutter_mark_order_paid($1, $2, $3, now(), $4) AS r`, [order, pi, cents, fee]))[0].r; }
  catch (e) { return { error: e.message }; }
};
const row = async (t, id) => (await q(`SELECT * FROM public.${t} WHERE id = $1`, [id]))[0];
const cents = (n) => Math.round(Number(n) * 100);
const giftsOf = async (uid) => q(`SELECT * FROM public.gift_cards WHERE recipient_id = $1 ORDER BY created_at, amount`, [uid]);

// (1) Covered in full: $50 gift on a $40 order with a $2 setup fee.
const S1 = U(1), B1 = U(2);
const o1 = await openOrder(S1, B1, 4000, 200);
const g1 = await gift(B1, 50);
const r1 = await redeem(g1, o1.order, B1);
check(r1?.outcome === "settled" && r1?.applied_cents === 4200 && r1?.leftover_cents === 800 && r1?.paid?.result === "paid",
  "(1) a gift that covers the whole order pays it at once", JSON.stringify(r1));
const ord1 = await row("declutter_orders", o1.order);
check(ord1?.status === "paid" && ord1.stripe_payment_intent_id === null && ord1.card_fee_cents === 0 && ord1.gift_cents === 4200,
  "(1) the order is paid with no payment intent, no card fee, gift_cents = the price", JSON.stringify(ord1));
check((await row("declutter_items", o1.item))?.status === "sold", "(1) the item is sold");
const gs1 = await giftsOf(B1);
const parent1 = gs1.find((g) => g.id === g1), child1 = gs1.find((g) => g.parent_credit_id === g1);
check(parent1?.status === "redeemed" && cents(parent1.amount) === 4200 && parent1.declutter_order_id === o1.order,
  "(1) the gift is lowered to what it paid and redeemed for the order", JSON.stringify(parent1));
check(child1?.status === "sent" && cents(child1.amount) === 800 && child1.split_for_declutter_order_id === o1.order
  && cents(parent1?.amount ?? 0) + cents(child1?.amount ?? 0) === 5000,
  "(1) the leftover is the buyer's own gift; parent + child = the original $50", JSON.stringify(child1));
check((await q(`SELECT 1 FROM public.declutter_refunds WHERE order_id = $1`, [o1.order])).length === 0, "(1) no refund recorded");
const n1 = await q(`SELECT message FROM public.notices WHERE user_id = $1 AND title = 'Payment received'`, [B1]);
check(n1.length === 1 && /You paid \$42 /.test(n1[0].message), "(1) the buyer is told the full price they paid", JSON.stringify(n1));
check((await redeem(child1?.id, o1.order, B1))?.error === "This order can no longer be paid", "(1) a paid order takes no second gift");

// (2) Covers part: $25 gift on a $40 order, then the card pays exactly $15.
const S2 = U(3), B2 = U(4);
const o2 = await openOrder(S2, B2);
const g2 = await gift(B2, 25);
const r2 = await redeem(g2, o2.order, B2);
check(r2?.outcome === "needs_payment" && r2?.difference_cents === 1500 && r2?.applied_cents === 2500,
  "(2) a part-covering gift answers the card remainder", JSON.stringify(r2));
check((await row("gift_cards", g2))?.status === "reserved" && (await row("declutter_orders", o2.order))?.gift_cents === 2500
  && (await row("declutter_orders", o2.order))?.status === "awaiting_payment", "(2) the gift is reserved, the order still open");
const p2 = await pay(o2.order, "pi_q2106_2", 1500, 75);
const ord2 = await row("declutter_orders", o2.order);
check(p2?.result === "paid" && ord2.status === "paid" && ord2.stripe_payment_intent_id === "pi_q2106_2" && ord2.card_fee_cents === 75,
  "(2) the card payment of the remainder pays the order; the card fee is the card's", JSON.stringify({ p2, ord2 }));
check((await row("gift_cards", g2))?.status === "redeemed", "(2) the trigger redeems the reserved gift on payment");
check(/You paid \$40 /.test((await q(`SELECT message FROM public.notices WHERE user_id = $1 AND title = 'Payment received'`, [B2]))[0]?.message ?? ""),
  "(2) the buyer is told the full price (gift + card)");

// (3) A card payment of the WHOLE price on a gift order: amount mismatch, refunded, the order still open.
const S3 = U(5), B3 = U(6);
const o3 = await openOrder(S3, B3);
const g3 = await gift(B3, 25);
await redeem(g3, o3.order, B3);
const p3 = await pay(o3.order, "pi_q2106_3", 4000);
check(p3?.result === "refunded" && p3?.reason === "amount_mismatch" && (await row("declutter_orders", o3.order))?.status === "awaiting_payment"
  && (await row("gift_cards", g3))?.status === "reserved", "(3) the whole price on a gift order is refused as a mismatch", JSON.stringify(p3));

// (4) Abandoned: the sweep closes the order; the gift goes back whole, once; a late in-time payment refunds the card only.
const S4 = U(7), B4 = U(8);
const o4 = await openOrder(S4, B4);
const g4 = await gift(B4, 25);
await redeem(g4, o4.order, B4);
await q(`UPDATE public.declutter_orders SET status = 'expired', close_reason = 'missed_checkout', closed_at = now() WHERE id = $1`, [o4.order]);
await q(`UPDATE public.declutter_cart_items SET status = 'missed' WHERE order_id = $1`, [o4.order]);
await q(`UPDATE public.declutter_items SET status = 'live' WHERE id = $1`, [o4.item]);
const gb4 = await row("gift_cards", g4);
const total4 = (await giftsOf(B4)).filter((g) => g.status === "sent").reduce((a, g) => a + cents(g.amount), 0);
check(gb4?.status === "sent" && gb4.declutter_order_id === null && cents(gb4.amount) === 2500 && total4 === 2500,
  "(4) the closed order's gift is back to 'sent' at $25, never doubled", JSON.stringify(gb4));
const p4 = await pay(o4.order, "pi_q2106_4", 1500);
check(p4?.result === "refunded" && p4?.paid_cents === 1500 && p4?.refund_cents === 1500,
  "(4) a late in-time card payment refunds only the card's $15", JSON.stringify(p4));
check((await row("gift_cards", g4))?.status === "sent", "(4) the gift stays the buyer's after the late payment");

// (5) A card remainder of 1-49 cents is refused; exactly 50 cents is allowed.
const S5 = U(9), B5 = U(10);
const o5 = await openOrder(S5, B5);
const g5 = await gift(B5, 39.7);
const r5 = await redeem(g5, o5.order, B5);
check(/covers all but \$0\.30 of this order/.test(r5?.error ?? "") && (await row("gift_cards", g5))?.status === "sent"
  && cents((await row("gift_cards", g5)).amount) === 3970 && (await row("declutter_orders", o5.order))?.gift_cents === 0,
  "(5) a 30-cent card remainder is refused with a sentence, nothing changed", JSON.stringify(r5));
const g5b = await gift(B5, 39.5);
check((await redeem(g5b, o5.order, B5))?.difference_cents === 50, "(5) a 50-cent card remainder is allowed");

// (6) The gates.
const S6 = U(11), B6 = U(12), X6 = U(13);
const o6 = await openOrder(S6, B6);
check((await redeem(await gift(X6, 50), o6.order, B6))?.error === "This gift is not yours to redeem", "(6) someone else's gift");
check((await redeem(await gift(B6, 50, { paid: "pending" }), o6.order, B6))?.error === "This gift has not been funded yet", "(6) an unfunded gift");
check((await redeem(await gift(B6, 50, { expires: "2020-01-01" }), o6.order, B6))?.error === "This gift has expired", "(6) an expired gift");
check((await redeem(await gift(B6, 50, { status: "redeemed" }), o6.order, B6))?.error === "This gift is no longer available", "(6) a used gift");
const other6 = await openOrder(S6, X6);
const gx = await gift(X6, 10);
await redeem(gx, other6.order, X6);
await q(`UPDATE public.gift_cards SET recipient_id = $1 WHERE id = $2`, [B6, gx]);
check((await redeem(gx, o6.order, B6))?.error === "This gift is set aside for something else", "(6) a gift set aside for another order");
const gj = await gift(B6, 10, { status: "reserved" });
await q(`UPDATE public.gift_cards SET job_id = $1 WHERE id = $2`, [U(77), gj]);
check((await redeem(gj, o6.order, B6))?.error === "This gift is set aside for something else", "(6) a gift reserved for a job");
check((await redeem(await gift(X6, 50), o6.order, X6))?.error === "This is not your order", "(6) someone else's order");
await q(`UPDATE public.declutter_orders SET stripe_checkout_session_id = 'cs_test_open' WHERE id = $1`, [o6.order]);
const g6 = await gift(B6, 10);
check(/A card payment for this order is already open/.test((await redeem(g6, o6.order, B6))?.error ?? "")
  && (await row("gift_cards", g6))?.status === "sent", "(6) an open card page refuses the gift");
const r6 = await redeem(g6, o6.order, B6, "cs_test_open");
check(r6?.outcome === "needs_payment" && (await row("declutter_orders", o6.order))?.stripe_checkout_session_id === null,
  "(6) the page the caller retired is allowed and cleared", JSON.stringify(r6));
const closed6 = await openOrder(S6, B6);
await q(`UPDATE public.declutter_orders SET status = 'expired' WHERE id = $1`, [closed6.order]);
check((await redeem(await gift(B6, 50), closed6.order, B6))?.error === "This order can no longer be paid", "(6) a closed order");

// (7) Covered in full but no longer payable (the buyer blocked the seller): raises, the gift untouched, no refund.
const S7 = U(14), B7 = U(15);
const o7 = await openOrder(S7, B7);
await q(`INSERT INTO public.user_blocks VALUES ($1, $2)`, [B7, S7]);
const g7 = await gift(B7, 50);
const r7 = await redeem(g7, o7.order, B7);
const gg7 = await row("gift_cards", g7);
check(/gift_payment_not_payable/.test(r7?.error ?? "") && gg7?.status === "sent" && cents(gg7.amount) === 5000
  && (await giftsOf(B7)).length === 1 && (await row("declutter_orders", o7.order))?.status === "awaiting_payment"
  && (await q(`SELECT 1 FROM public.declutter_refunds WHERE order_id = $1`, [o7.order])).length === 0,
  "(7) not payable: refused, the whole redeem rolled back, no refund", JSON.stringify({ r7, gg7 }));
check((await pay(o7.order, null, 0))?.error?.includes("gift_payment_not_payable"), "(7) the gift-paid step alone never pays an order without a redeemed gift");

// (8) A second gift on the same order (no page opened) puts the first back.
const S8 = U(16), B8 = U(17);
const o8 = await openOrder(S8, B8);
const g8a = await gift(B8, 20), g8b = await gift(B8, 30);
await redeem(g8a, o8.order, B8);
const r8 = await redeem(g8b, o8.order, B8);
check(r8?.difference_cents === 1000 && (await row("gift_cards", g8a))?.status === "sent" && (await row("gift_cards", g8a))?.declutter_order_id === null
  && (await row("declutter_orders", o8.order))?.gift_card_id === g8b, "(8) the second gift replaces the first, which is the buyer's again", JSON.stringify(r8));

// (9) No gift: exactly as before.
const S9 = U(18), B9 = U(19);
const o9 = await openOrder(S9, B9);
const p9 = await pay(o9.order, "pi_q2106_9", 4000, 150);
check(p9?.result === "paid" && (await row("declutter_orders", o9.order))?.card_fee_cents === 150, "(9) an order with no gift pays as before", JSON.stringify(p9));
const o9b = await openOrder(S9, B9);
check((await pay(o9b.order, null, 0))?.error != null, "(9) a call with no payment intent never pays a no-gift order");

// (10) S3: a refund's gift share goes back to the gift balance, once per refund key, proportionally on a split order.
const sq = async (sql, p) => { try { return (await q(sql, p))[0]; } catch (e) { return { error: e.message }; } };
const split = async (o, c) => (await sq(`SELECT public.declutter_refund_gift_split($1, $2) AS v`, [o, c]))?.v;
const net = async (o) => (await sq(`SELECT public.declutter_order_gift_net_cents($1) AS v`, [o]))?.v;
const restore = async (o, k, c) => (await sq(`SELECT public.restore_gift_card_for_declutter_order($1, $2, $3) AS r`, [o, k, c]))?.r;
// Mixed (2): $40 order, gift $25, card $15. A full refund: the gift's share is exactly the gift; a $10 part: 625.
check(await split(o2.order, 4000) === 2500 && await split(o2.order, 1000) === 625 && await split(o2.order, 1) === 0,
  "(10) a split order's refund is proportional (gift share rounded down, the card takes the odd cent)",
  JSON.stringify([await split(o2.order, 4000), await split(o2.order, 1000), await split(o2.order, 1)]));
const r10a = await restore(o2.order, "refund:o2:part1", 625);
const child10 = r10a?.credit_id ? await row("gift_cards", r10a.credit_id) : null;
check(r10a?.outcome === "restored" && cents(child10?.amount) === 625 && child10?.status === "sent" && child10?.recipient_id === B2
  && child10?.parent_credit_id === g2 && child10?.payment_status === "paid", "(10) the gift share comes back as the buyer's own spendable gift", JSON.stringify(r10a));
const r10b = await restore(o2.order, "refund:o2:part1", 625);
check(r10b?.outcome === "already_restored" && r10b?.credit_id === r10a?.credit_id
  && (await q(`SELECT 1 FROM public.gift_cards WHERE restored_from_declutter_order_id = $1`, [o2.order])).length === 1,
  "(10) the same refund key never restores twice", JSON.stringify(r10b));
check(await net(o2.order) === 1875 && await split(o2.order, 4000) === 1875, "(10) the net gift drops by what came back; a later split never exceeds it");
const r10c = await restore(o2.order, "refund:o2:rest", 99999);
check(r10c?.restore_cents === 1875 && await net(o2.order) === 0 && await restore(o2.order, "refund:o2:more", 100).then((r) => r?.outcome) === "nothing_to_restore",
  "(10) restores are capped at the gift: never more back than the gift paid", JSON.stringify(r10c));
// Gift-only (1): $42 paid by the gift, no card. All of a refund is the gift's.
check(await split(o1.order, 4200) === 4200 && await split(o1.order, 500) === 500, "(10) a gift-only order's refund is all gift (no card to refund)");
const r10d = await restore(o1.order, "refund:o1:full", 4200);
check(r10d?.restore_cents === 4200 && await net(o1.order) === 0, "(10) a gift-only order refunds whole to the gift balance", JSON.stringify(r10d));
// No gift (9): nothing to restore; the split is 0.
check(await split(o9.order, 4000) === 0 && (await restore(o9.order, "refund:o9", 4000))?.outcome === "no_credit", "(10) a card-only order has no gift share");
check((await sq(`SELECT public.restore_gift_card_for_declutter_order($1, NULL, 1) AS r`, [o2.order]))?.error?.includes("required"), "(10) no refund key: refused");

if (!skip) {
  for (const sig of ["public.redeem_gift_card_for_declutter_order(uuid, uuid, uuid, text)",
    "public.declutter_mark_order_paid(uuid, text, integer, timestamptz, integer)",
    "public.restore_gift_card_for_declutter_order(uuid, text, integer)", "public.declutter_refund_gift_split(uuid, integer)",
    "public.declutter_order_gift_net_cents(uuid)"]) {
    const acl = (await q(`SELECT has_function_privilege('anon', '${sig}', 'EXECUTE') a, has_function_privilege('authenticated', '${sig}', 'EXECUTE') u,
      has_function_privilege('service_role', '${sig}', 'EXECUTE') s`))[0];
    check(!acl.a && !acl.u && acl.s, `grants on ${sig}: anon ${acl.a} authenticated ${acl.u} service_role ${acl.s}`);
  }
}

console.log(failures ? `\n${failures} FAILED` : "\nall PASS");
process.exit(failures ? 1 : 0);
