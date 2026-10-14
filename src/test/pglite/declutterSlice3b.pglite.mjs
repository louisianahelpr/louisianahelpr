#!/usr/bin/env node
/**
 * PGlite proof for 20261014224914_declutter_slice3b_payments (Declutter slice
 * 3b: card on file, mark-paid with refund reasons, the seller card-fee debt
 * ledger, in-time payments recorded late, price drops that stop above the
 * floor, the switch turned off mid-sale, withdraw voiding offers; spec rows
 * 36, 60-62, build decisions B39-B47), on top of slices 1-3.
 *
 *   node src/test/pglite/declutterSlice3b.pglite.mjs
 *   NEW_MIGRATION=skip node src/test/pglite/declutterSlice3b.pglite.mjs   # RED: every check fails
 *   MIGRATION_PATH=<planted copy> node src/test/pglite/declutterSlice3b.pglite.mjs
 *
 * Setup: scripts/declutter/slice3Harness.mjs (slice 3 once, slice 3b 3x).
 * pglite is not a dependency (CLAUDE.md): loaded from ~/.lh-pglite.
 * The concurrent half (webhook vs sweep, double webhook, double checkout, two
 * payouts on one debt) is scripts/declutter/race-accept.mjs.
 */
import os from "node:os";
import { setupStatements, liveItemSql, CARDS_SQL, USERS } from "../../../scripts/declutter/slice3Harness.mjs";

const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const { SELLER, BUYER, OUTSIDER, BUYER2, BUYER3, SELLER2, NOCARD } = USERS;

const skip = process.env.NEW_MIGRATION === "skip";
const db = new PGlite();
for (const sql of setupStatements({ times: 1, times3b: skip ? 0 : 3, slice3bPath: process.env.MIGRATION_PATH })) await db.exec(sql);
await db.exec(CARDS_SQL);
// log_cron_defect (a sweep line that throws is filed, not fatal) is not part of the harness.
await db.exec(`CREATE OR REPLACE FUNCTION public.log_cron_defect(a text, b text, c text) RETURNS void LANGUAGE plpgsql AS $f$ BEGIN RAISE WARNING 'cron defect % % %', a, b, c; END $f$;`);

let pass = 0;
let fail = 0;
const ok = (cond, label) => {
  if (cond) pass++;
  else fail++;
  console.log(`${cond ? "PASS" : "FAIL"}  ${label}`);
};
const svc = async (sql) => { try { return (await db.query(sql)).rows; } catch (e) { return { error: String(e.message ?? e), code: e.code }; } };
async function as(role, uid, sql) {
  try {
    await db.exec(`SET request.jwt.claim.sub = '${uid ?? ""}'; SET ROLE ${role};`);
    return (await db.query(sql)).rows;
  } catch (e) {
    return { error: String(e.message ?? e), code: e.code };
  } finally {
    await db.exec(`RESET ROLE; RESET request.jwt.claim.sub;`);
  }
}
const me = (uid, sql) => as("authenticated", uid, sql);
const run = (sql) => db.exec(sql).catch((e) => console.log(`setup step failed: ${String(e.message).slice(0, 120)}`));
const refused = (r, re, code) => !Array.isArray(r) && re.test(r.error) && (code === undefined || r.code === code);
const one = (r) => (Array.isArray(r) && r[0] ? Object.values(r[0])[0] : undefined);
const I = (n) => `33333333-0000-0000-0000-0000000000${String(n).padStart(2, "0")}`;
const status = async (item) => one(await svc(`SELECT status FROM public.declutter_items WHERE id = '${item}'`));
const notes = async (uid, title) => Number(one(await svc(`SELECT count(*) FROM public.notifications WHERE user_id = '${uid}' AND title = '${title}'`)));
const activeStrikes = async (uid, reason) => Number(one(await svc(`SELECT count(*) FROM public.declutter_strikes WHERE user_id = '${uid}' AND reason = '${reason}' AND removed_at IS NULL`)));
const buy = (uid, item, cents) => me(uid, `SELECT public.declutter_buy_now('${item}', ${cents}) AS id`);
const checkout = async (uid, seller, handover = "porch") => (await me(uid, `SELECT * FROM public.declutter_start_checkout('${seller}', '${handover}')`))[0];
const pay = async (order, pi, cents, paidAt = "now()", fee = "NULL") =>
  one(await svc(`SELECT public.declutter_mark_order_paid('${order}', '${pi}', ${cents}, ${paidAt}, ${fee}) AS r`));
const orderRow = async (id) => (await svc(`SELECT * FROM public.declutter_orders WHERE id = '${id}'`))[0];
const refundRow = async (pi) => (await svc(`SELECT * FROM public.declutter_refunds WHERE stripe_payment_intent_id = '${pi}'`))[0];

for (let n = 1; n <= 20; n++) await run(liveItemSql({ id: I(n), title: `Thing ${n}` }));
await run(liveItemSql({ id: I(30), seller: SELLER2, title: "Second seller chair", price: 1000, floor: 600 }));

// --- Card on file (row 36, B39)
ok(refused(await me(NOCARD, `SELECT public.declutter_save_card('${NOCARD}', 'cus_x', 'pm_x', 'visa', '1111', 'live')`), /permission denied/),
  "a member cannot write a saved card (only the webhook can)");
await svc(`SELECT public.declutter_save_card('${NOCARD}', 'cus_nocard1', 'pm_nocard1', 'visa', '1111', 'test')`);
const card = (await svc(`SELECT * FROM public.declutter_buyer_cards WHERE user_id = '${NOCARD}'`))[0];
ok(card?.last4 === "1111" && card.card_mode === "test" && card.stripe_customer_id === "cus_nocard1", "the webhook saves the card with its Stripe mode");
await svc(`SELECT public.declutter_save_card('${NOCARD}', 'cus_nocard1', 'pm_nocard2', 'mastercard', '2222', 'test')`);
ok(one(await svc(`SELECT payment_method_id FROM public.declutter_buyer_cards WHERE user_id = '${NOCARD}'`)) === "pm_nocard2"
   && Number(one(await svc(`SELECT count(*) FROM public.declutter_buyer_cards WHERE user_id = '${NOCARD}'`))) === 1,
  "saving again replaces the card (one per member)");
ok(await notes(NOCARD, "Card saved") === 2, "the member is told their card is saved");
ok(refused(await svc(`SELECT public.declutter_save_card('${NOCARD}', 'cus_nocard1', 'pm_x', 'visa', '1111', 'sandbox')`), /declutter_buyer_cards_mode/),
  "a card's mode is live or test, nothing else");
ok(refused(await me(NOCARD, `SELECT card_mode, payment_method_id FROM public.declutter_buyer_cards`), /permission denied/),
  "the member still cannot read the Stripe ids of their card");

// --- Price drops stop above the floor (row 61, B42)
const stops = await svc(`SELECT p.floor_price_cents AS f, p.drop_stop_cents AS s FROM public.declutter_item_private p`);
ok(Array.isArray(stops) && stops.length >= 20 && stops.every((r) => r.s > r.f && r.s >= Math.round(r.f * 1.02) && r.s <= Math.round(r.f * 1.08) + 1),
  "every item has a stop point 2-8% above its floor, strictly above it");
ok(new Set(Array.isArray(stops) ? stops.map((r) => r.s) : []).size > 1, "the stop point is random per item (not one fixed offset)");
await run(`UPDATE public.declutter_items SET current_price_cents = 10000, price_cents = 10000 WHERE id = '${I(20)}';
           UPDATE public.declutter_item_private SET floor_price_cents = 9000 WHERE item_id = '${I(20)}';`);
const stop20 = Number(one(await svc(`SELECT drop_stop_cents FROM public.declutter_item_private WHERE item_id = '${I(20)}'`)));
ok(stop20 > 9000 && stop20 <= 9721, "changing the floor picks a new stop above the new floor");
// Only item 20 drops in this block: every other item counts as dropped today.
await svc(`UPDATE public.declutter_items SET last_price_drop_on = (now() AT TIME ZONE 'America/Chicago')::date WHERE id <> '${I(20)}'`);
let p20 = 0;
for (let d = 0; d < 6; d++) {
  await svc(`UPDATE public.declutter_items SET last_price_drop_on = NULL WHERE id = '${I(20)}'`);
  await svc(`SELECT public.declutter_price_drop_sweep()`);
  p20 = Number(one(await svc(`SELECT current_price_cents FROM public.declutter_items WHERE id = '${I(20)}'`)));
}
ok(p20 === stop20 && p20 > 9000, "after many evenings the price rests at the stop point, above the hidden floor (never at it)");
const sellerView = await me(SELLER, `SELECT * FROM public.declutter_my_offers()`);
ok(refused(await me(BUYER, `SELECT drop_stop_cents FROM public.declutter_item_private`), /permission denied/)
   && Array.isArray(sellerView) && sellerView.every((r) => !("drop_stop_cents" in r)),
  "no member can read the stop point (private table, no reader returns it)");
ok(refused(await svc(`UPDATE public.declutter_item_private SET drop_stop_cents = floor_price_cents WHERE item_id = '${I(19)}'`), /stop_above_floor/)
   || Number(one(await svc(`SELECT drop_stop_cents - floor_price_cents FROM public.declutter_item_private WHERE item_id = '${I(19)}'`))) > 0,
  "the stop point can never equal the floor (CHECK)");

// --- Withdraw voids open offers (B46)
const off1 = one(await me(BUYER2, `SELECT public.declutter_make_offer('${I(19)}', 3000) AS id`));
const off2 = one(await me(BUYER3, `SELECT public.declutter_make_offer('${I(19)}', 3100) AS id`));
await me(SELLER, `SELECT public.declutter_withdraw_item('${I(19)}')`);
ok(one(await svc(`SELECT string_agg(status, ',') FROM public.declutter_offers WHERE id IN ('${off1}', '${off2}')`)) === "voided,voided",
  "withdrawing a listing voids its open offers");
ok(await notes(BUYER2, "Item taken down") === 1 && await notes(BUYER3, "Item taken down") === 1, "each buyer with an open offer is told");

// --- Paying: the right amount (B40)
await buy(BUYER, I(1), 4000);
const o1 = await checkout(BUYER, SELLER);
ok(o1?.total_cents === 4600, "checkout freezes $40 + $6 = $46");
ok(refused(await svc(`SELECT public.declutter_attach_checkout_session('${o1?.order_id}', 'sess_bad')`), /invalid_session/), "only a Stripe session id can be attached");
await svc(`SELECT public.declutter_attach_checkout_session('${o1?.order_id}', 'cs_test_o1')`);
ok(Array.isArray(await svc(`SELECT public.declutter_attach_checkout_session('${o1?.order_id}', 'cs_test_o1')`)),
  "attaching the same session twice is fine (two calls share one Stripe idempotency key)");
ok(refused(await svc(`SELECT public.declutter_attach_checkout_session('${o1?.order_id}', 'cs_test_other')`), /order_not_payable/),
  "a second, different session never replaces the first");
ok(refused(await svc(`SELECT public.declutter_mark_order_paid('${o1?.order_id}', 'nope', 4600, now(), NULL)`), /invalid_payment/),
  "mark-paid refuses a missing / malformed PaymentIntent (no silent refund of nothing)");
const r1 = await pay(o1?.order_id, "pi_o1", 4600, "now()", 163);
ok(r1?.result === "paid" && await status(I(1)) === "sold", "the right amount marks the order paid and the item sold");
const or1 = await orderRow(o1?.order_id);
ok(or1?.card_fee_cents === 163 && or1.stripe_paid_at !== null, "the order keeps the card fee Stripe kept and the Stripe payment time");
ok((await pay(o1?.order_id, "pi_o1", 4600))?.result === "already_paid", "the same payment again (webhook replay) is a no-op");
const dup = await pay(o1?.order_id, "pi_o1_dup", 4600);
ok(dup?.result === "refund" && dup.reason === "duplicate_payment" && dup.fee_policy === "full_platform_absorbs" && dup.refund_cents === 4600,
  "a second payment on a paid order: refunded IN FULL (our mistake, card fee absorbed)");
ok(typeof dup?.refund_id === "string" && (await pay(o1?.order_id, "pi_o1_dup", 4600))?.refund_id === dup?.refund_id, "a replayed refund answer is the same refund row (never two refunds)");

// --- Our mistakes: full refunds
await buy(BUYER, I(2), 4000);
const o2 = await checkout(BUYER, SELLER);
const wrong = await pay(o2?.order_id, "pi_wrong", 4500);
ok(wrong?.reason === "amount_mismatch" && wrong.refund_cents === 4500, "a wrong amount is refunded in full (every cent paid)");
await svc(`UPDATE public.declutter_orders SET stripe_checkout_session_id = 'cs_test_o2' WHERE id = '${o2?.order_id}'`);
const o2b = await checkout(BUYER, SELLER, "pickup_home");
ok(o2b?.superseded_session_id === "cs_test_o2" && (await orderRow(o2?.order_id))?.close_reason === "superseded",
  "restarting checkout supersedes the old order (close_reason recorded) and hands back its page to expire");
const sup = await pay(o2?.order_id, "pi_sup", 4600, "now()", 163);
ok(sup?.reason === "buyer_restarted_checkout" && sup.fee_policy === "keep_card_fee" && sup.refund_cents === 4600 - 163,
  "a payment on an order the buyer restarted (the app expired that page first): refunded, the card fee is kept");
const missing = await pay("44444444-0000-0000-0000-000000000000", "pi_missing", 999);
ok(missing?.reason === "order_missing" && missing.refund_cents === 999, "a payment naming no order: full refund");
ok((await svc(`SELECT public.declutter_retire_order('${o2b?.order_id}', '${BUYER2}', 'cs_test_x')`))[0]?.declutter_retire_order === false,
  "retiring an order needs its own buyer and its own session");
await svc(`SELECT public.declutter_attach_checkout_session('${o2b?.order_id}', 'cs_test_o2b')`);
ok(one(await svc(`SELECT public.declutter_retire_order('${o2b?.order_id}', '${BUYER}', 'cs_test_o2b')`)) === true
   && (await orderRow(o2b?.order_id))?.close_reason === "session_expired",
  "a timed-out Stripe page retires its order");
const expiredPay = await pay(o2b?.order_id, "pi_o2b_dead", 4600, "now()", 163);
ok(expiredPay?.reason === "superseded" && expiredPay.fee_policy === "full_platform_absorbs" && expiredPay.refund_cents === 4600,
  "a payment on a page Stripe itself timed out (it should not be payable): our mistake, full refund");
const o2c = await checkout(BUYER, SELLER);
ok(o2c?.order_id && o2c.order_id !== o2b?.order_id && o2c.superseded_session_id === null, "the next checkout makes a fresh order");
ok((await pay(o2c?.order_id, "pi_o2c", 4600))?.result === "paid", "and that order can be paid");

// --- Seller backs out (row 60, B43)
await buy(BUYER2, I(3), 4000);
const o3 = await checkout(BUYER2, SELLER);
await svc(`SELECT public.declutter_attach_checkout_session('${o3?.order_id}', 'cs_test_o3')`);
const paidBefore = one(await svc(`SELECT (now() - interval '1 minute')::text`));
await me(SELLER, `SELECT public.declutter_seller_cancel_sale('${I(3)}')`);
ok(one(await svc(`SELECT public.declutter_cancelled_sale_session('${I(3)}', '${SELLER}')`)) === "cs_test_o3"
   && one(await svc(`SELECT public.declutter_cancelled_sale_session('${I(3)}', '${SELLER2}')`)) === null,
  "the cancelled sale's Stripe page is found for its seller only (to expire it, B45)");
const backed = await pay(o3?.order_id, "pi_backed", 4600, `'${paidBefore}'::timestamptz`, 163);
ok(backed?.reason === "seller_backed_out" && backed.fee_policy === "full_seller_pays_fee" && backed.refund_cents === 4600,
  "row 60: the buyer had paid when the seller backed out -> every cent back");
const debt = (await svc(`SELECT d.* FROM public.declutter_seller_fee_debts d JOIN public.declutter_refunds r ON r.id = d.refund_id WHERE r.stripe_payment_intent_id = 'pi_backed'`))[0];
ok(debt?.seller_id === SELLER && debt.amount_cents === 163 && debt.remaining_cents === 163, "row 60: the card fee is booked to the SELLER as a debt");
await pay(o3?.order_id, "pi_backed", 4600, `'${paidBefore}'::timestamptz`, 163);
ok(Number(one(await svc(`SELECT count(*) FROM public.declutter_seller_fee_debts WHERE seller_id = '${SELLER}'`))) === 1,
  "a replayed webhook books the debt once");
await buy(BUYER2, I(4), 4000);
const o4 = await checkout(BUYER2, SELLER);
await me(SELLER, `SELECT public.declutter_seller_cancel_sale('${I(4)}')`);
const after = await pay(o4?.order_id, "pi_after", 4600, `now() + interval '1 minute'`, 163);
ok(after?.reason === "seller_backed_out" && after.refund_cents === 4600,
  "paid AFTER the seller cancelled (a cancel made around the app leaves the page open): the seller caused it, every cent back");
ok(Number(one(await svc(`SELECT count(*) FROM public.declutter_seller_fee_debts WHERE seller_id = '${SELLER}'`))) === 2, "and the seller owes that card fee too");

// --- Paid in time, recorded late (B41)
await buy(BUYER3, I(5), 4000);
const o5 = await checkout(BUYER3, SELLER);
await svc(`UPDATE public.declutter_cart_items SET checkout_by = now() - interval '2 hours' WHERE order_id = '${o5?.order_id}'`);
const sw = (await svc(`SELECT public.declutter_deadline_sweep() AS r`))[0]?.r;
ok(sw?.checkouts_missed >= 1 && await activeStrikes(BUYER3, "missed_checkout") === 1 && await status(I(5)) === "live",
  "past the grace the sweep strikes the buyer and puts the item back up");
ok((await orderRow(o5?.order_id))?.close_reason === "missed_checkout", "the order records why it closed");
const inTime = await pay(o5?.order_id, "pi_intime", 4600, `now() - interval '2 hours' + interval '30 minutes'`);
ok(inTime?.result === "paid" && await status(I(5)) === "sold", "B41: a payment made by the deadline + 1 h, recorded later, is honoured");
ok(await activeStrikes(BUYER3, "missed_checkout") === 0, "B41: and the missed-checkout strike is removed");
// Taken by someone else meanwhile.
await buy(BUYER3, I(6), 4000);
const o6 = await checkout(BUYER3, SELLER);
await svc(`UPDATE public.declutter_cart_items SET checkout_by = now() - interval '2 hours' WHERE order_id = '${o6?.order_id}'`);
await svc(`SELECT public.declutter_deadline_sweep()`);
await buy(BUYER, I(6), 4000);
const taken = await pay(o6?.order_id, "pi_taken", 4600, `now() - interval '2 hours'`);
ok(taken?.reason === "sold_elsewhere" && taken.fee_policy === "full_platform_absorbs" && await activeStrikes(BUYER3, "missed_checkout") === 0,
  "B41: paid in time but the item went to another buyer -> full refund AND no strike");
ok(Number(one(await svc(`SELECT count(*) FROM public.declutter_cart_items WHERE item_id = '${I(6)}' AND status IN ('in_cart', 'paid')`))) === 1,
  "the other buyer's sale is untouched (never two sales of one item)");
// A newer open order for the same buyer + seller exists when the late webhook lands (money review 3b #1).
await buy(BUYER3, I(18), 4000);
const o18 = await checkout(BUYER3, SELLER);
await svc(`UPDATE public.declutter_cart_items SET checkout_by = now() - interval '2 hours' WHERE order_id = '${o18?.order_id}'`);
await svc(`SELECT public.declutter_deadline_sweep()`);
await buy(BUYER3, I(15), 4000);
const o15 = await checkout(BUYER3, SELLER);
const honoured = await pay(o18?.order_id, "pi_o18", 4600, `now() - interval '2 hours'`);
ok(honoured?.result === "paid" && await status(I(18)) === "sold" && (await orderRow(o18?.order_id))?.status === "paid"
   && (await orderRow(o15?.order_id))?.status === "awaiting_payment",
  "B41: an in-time payment is honoured even while a newer order for the same seller is open (that order is untouched)");
await svc(`UPDATE public.declutter_cart_items SET checkout_by = now() - interval '3 hours' WHERE order_id = '${o15?.order_id}'`);
await svc(`SELECT public.declutter_deadline_sweep()`);
await svc(`UPDATE public.declutter_strikes SET removed_at = now() WHERE user_id = '${BUYER3}' AND item_id = '${I(15)}'`);
// Taken down by the seller meanwhile (item no longer live, no other sale).
await buy(BUYER3, I(16), 4000);
const o16 = await checkout(BUYER3, SELLER);
await svc(`UPDATE public.declutter_cart_items SET checkout_by = now() - interval '2 hours' WHERE order_id = '${o16?.order_id}'`);
await svc(`SELECT public.declutter_deadline_sweep()`);
await me(SELLER, `SELECT public.declutter_withdraw_item('${I(16)}')`);
const gone = await pay(o16?.order_id, "pi_gone", 4600, `now() - interval '2 hours'`);
ok(gone?.reason === "sold_elsewhere" && await status(I(16)) === "withdrawn",
  "B41: paid in time but the seller took the item down meanwhile -> full refund, the item stays down");
// Too late.
await buy(BUYER3, I(7), 4000);
const o7 = await checkout(BUYER3, SELLER);
await svc(`UPDATE public.declutter_cart_items SET checkout_by = now() - interval '3 hours' WHERE order_id = '${o7?.order_id}'`);
await svc(`SELECT public.declutter_deadline_sweep()`);
const tooLate = await pay(o7?.order_id, "pi_late", 4600, `now() - interval '1 hour'`);
ok(tooLate?.reason === "order_closed" && await activeStrikes(BUYER3, "missed_checkout") === 1,
  "paid after the deadline + 1 h: refunded in full, the strike stays");

// --- Refunding a PAID order (slice 4's entry, B40)
await buy(BUYER2, I(8), 4000);
const o8 = await checkout(BUYER2, SELLER);
await pay(o8?.order_id, "pi_o8", 4600, "now()", 163);
const keep = one(await svc(`SELECT public.declutter_refund_paid_order('${o8?.order_id}', 'buyer_cancelled') AS r`));
ok(keep?.fee_policy === "keep_card_fee" && keep.refund_cents === 4600 - 163,
  "a buyer-caused refund keeps the card fee (owner: never absorb a fee)");
ok((await orderRow(o8?.order_id))?.status === "refunded" && await status(I(8)) === "live", "the order is refunded and the item back on sale");
ok(typeof keep?.refund_id === "string" && one(await svc(`SELECT public.declutter_refund_paid_order('${o8?.order_id}', 'buyer_cancelled') AS r`))?.refund_id === keep?.refund_id,
  "refunding the same order again returns the same refund (idempotent)");
await buy(BUYER2, I(9), 4000);
const o9 = await checkout(BUYER2, SELLER);
await pay(o9?.order_id, "pi_o9", 4600, "now()", "NULL");
const sb = one(await svc(`SELECT public.declutter_refund_paid_order('${o9?.order_id}', 'seller_backed_out') AS r`));
const est = Number(one(await svc(`SELECT public.declutter_card_fee_estimate(4600)`)));
ok(sb?.refund_cents === 4600 && est === 163, "row 60 on a paid order: the buyer gets all $46 back (fee estimated 2.9%+30c when Stripe's is unknown)");
ok(Number(one(await svc(`SELECT sum(amount_cents) FROM public.declutter_seller_fee_debts WHERE seller_id = '${SELLER}'`))) === 489
   && await activeStrikes(SELLER, "item_gone_after_sale") === 1 && await status(I(9)) === "withdrawn",
  "row 60: the seller owes that card fee, gets a strike, and the item comes down");
ok(refused(await svc(`SELECT public.declutter_refund_paid_order('${o9?.order_id}', 'whatever')`), /invalid_refund_reason/), "only the two paid-order reasons exist");
ok(refused(await svc(`INSERT INTO public.declutter_refunds (stripe_payment_intent_id, reason, fee_policy, paid_cents, card_fee_cents, refund_cents)
                      VALUES ('pi_forged', 'superseded', 'keep_card_fee', 1000, 59, 941)`), /declutter_refunds_policy/),
  "the table ties the fee policy to the reason (an our-mistake refund cannot keep the fee)");
ok(refused(await svc(`INSERT INTO public.declutter_refunds (stripe_payment_intent_id, reason, fee_policy, paid_cents, card_fee_cents, refund_cents)
                      VALUES ('pi_forged2', 'superseded', 'full_platform_absorbs', 1000, 59, 941)`), /declutter_refunds_amount/),
  "the table ties the amount to the policy (a full refund is every cent)");

// --- The fee debt ledger (B43): never negative, never twice
ok(Number(one(await svc(`SELECT public.declutter_consume_fee_debt('${SELLER}', 'payout_A', 100)`))) === 100, "a payout takes what it can (capped at the payout)");
ok(Number(one(await svc(`SELECT public.declutter_consume_fee_debt('${SELLER}', 'payout_A', 100)`))) === 100
   && Number(one(await svc(`SELECT sum(remaining_cents) FROM public.declutter_seller_fee_debts WHERE seller_id = '${SELLER}'`))) === 389,
  "the same payout again returns the same answer and deducts nothing more");
ok(Number(one(await svc(`SELECT public.declutter_consume_fee_debt('${SELLER}', 'payout_B', 100000)`))) === 389
   && Number(one(await svc(`SELECT sum(remaining_cents) FROM public.declutter_seller_fee_debts WHERE seller_id = '${SELLER}'`))) === 0,
  "a big payout clears the rest and takes no more than is owed");
ok(Number(one(await svc(`SELECT public.declutter_consume_fee_debt('${SELLER}', 'payout_C', 500)`))) === 0, "with nothing owed, nothing is taken");
ok(Number(one(await svc(`SELECT public.declutter_consume_fee_debt('${SELLER2}', 'payout_A', 500)`))) === 0,
  "another seller's payout with the same ref takes nothing from this seller");
ok(refused(await svc(`UPDATE public.declutter_seller_fee_debts SET remaining_cents = -1 WHERE seller_id = '${SELLER}'`), /declutter_fee_debt_remaining/),
  "a debt can never go negative (CHECK)");
ok(refused(await svc(`SELECT public.declutter_consume_fee_debt('${SELLER}', '', 5)`), /invalid_payout/), "a payout needs a reference");

// --- Refund execution report
ok(one(await svc(`SELECT public.declutter_refund_executed('${dup?.refund_id}', 're_1', true)`)) === "succeeded", "a refund is recorded as done with Stripe's id");
ok(one(await svc(`SELECT public.declutter_refund_executed('${dup?.refund_id}', NULL, false)`)) === "succeeded", "a late failure report cannot undo a succeeded refund");

// --- The switch turned off mid-sale (row 62, B44)
// SELLER reached 3 strikes above (two cancels + one paid back-out), which
// hides their items; clear them so the seller can sell again for what follows.
ok(Number(one(await svc(`SELECT public.declutter_active_strike_count('${SELLER}')`))) === 3, "(the seller's backing out added up to 3 strikes)");
await svc(`UPDATE public.declutter_strikes SET removed_at = now() WHERE user_id = '${SELLER}'`);
await buy(BUYER2, I(10), 4000);
await buy(BUYER2, I(11), 4000);
await svc(`DELETE FROM public.test_accounts WHERE user_id = '${BUYER2}'`); // switch now off for BUYER2
ok(refused(await me(BUYER2, `SELECT public.declutter_make_offer('${I(12)}', 3000)`), /feature_disabled/)
   && refused(await buy(BUYER2, I(12), 4000), /feature_disabled/), "switch off: nothing new can start (offer, Buy)");
ok(one(await me(BUYER2, `SELECT public.declutter_has_agreed_sales() AS h`)) === true
   && one(await me(OUTSIDER, `SELECT public.declutter_has_agreed_sales() AS h`)) === false,
  "the app can tell a member with an agreed sale from one with none");
ok(Array.isArray(await me(BUYER2, `SELECT * FROM public.declutter_my_cart()`)) && (await me(BUYER2, `SELECT * FROM public.declutter_my_cart()`)).length >= 2,
  "switch off: the buyer still reads their cart");
const o10 = await checkout(BUYER2, SELLER);
ok(o10?.items_cents === 8000, "switch off: an agreed sale still checks out (row 62)");
ok((await pay(o10?.order_id, "pi_o10", o10?.total_cents))?.result === "paid", "switch off: and the payment is recorded");
ok(refused(await checkout(OUTSIDER, SELLER).then((r) => r ?? { error: "no row" }), /cart_empty|no row/)
   || refused(await me(OUTSIDER, `SELECT * FROM public.declutter_start_checkout('${SELLER}', 'porch')`), /cart_empty/),
  "switch off with nothing agreed: checkout has nothing to do");
await buy(BUYER3, I(13), 4000);
await svc(`DELETE FROM public.test_accounts WHERE user_id = '${BUYER3}'`);
const s3Before = await activeStrikes(BUYER3, "missed_checkout");
await svc(`UPDATE public.declutter_cart_items SET checkout_by = now() - interval '1 minute' WHERE item_id = '${I(13)}'`);
const sw2 = (await svc(`SELECT public.declutter_deadline_sweep() AS r`))[0]?.r;
ok(sw2?.missed_without_strike === 1 && await activeStrikes(BUYER3, "missed_checkout") === s3Before && await notes(BUYER3, "Checkout closed") === 1,
  "row 62: a sale the switch interrupted ends with NO strike, and the buyer is told");
await svc(`INSERT INTO public.test_accounts (user_id) VALUES ('${BUYER2}'), ('${BUYER3}') ON CONFLICT DO NOTHING`);

// --- Seller blocks the buyer after the buyer paid (row 60 path via the webhook)
await buy(BUYER, I(14), 4000);
const o14 = await checkout(BUYER, SELLER);
await svc(`INSERT INTO public.user_blocks (blocker_id, blocked_id) VALUES ('${SELLER}', '${BUYER}')`);
const blocked = await pay(o14?.order_id, "pi_blocked", o14?.total_cents, "now()", 163);
ok(blocked?.reason === "seller_backed_out" && blocked.refund_cents === o14?.total_cents, "the seller blocked the buyer while they paid: seller backed out, every cent back");
await svc(`DELETE FROM public.user_blocks WHERE blocker_id = '${SELLER}'`);
// The BUYER blocks the seller while paying (lh-authz-rls review 3b #1): their own doing, the fee is kept.
const lineBefore = await buy(BUYER2, I(17), 4000);
const o17 = await checkout(BUYER2, SELLER);
await svc(`INSERT INTO public.user_blocks (blocker_id, blocked_id) VALUES ('${BUYER2}', '${SELLER}')`);
const buyerBlocked = await pay(o17?.order_id, "pi_buyer_blocked", o17?.total_cents, "now()", 163);
ok(typeof one(lineBefore) === "string" && buyerBlocked?.reason === "buyer_cancelled" && buyerBlocked.fee_policy === "keep_card_fee"
   && buyerBlocked.refund_cents === o17?.total_cents - 163,
  "a buyer who blocks the seller mid-payment cannot make us absorb the card fee");
await svc(`DELETE FROM public.user_blocks WHERE blocker_id = '${BUYER2}'`);

// --- Reads and grants
ok(Array.isArray(await me(BUYER2, `SELECT reason, refund_cents FROM public.declutter_refunds`))
   && (await me(BUYER2, `SELECT id FROM public.declutter_refunds`)).length >= 2
   && (await me(OUTSIDER, `SELECT id FROM public.declutter_refunds`)).length === 0,
  "the two sides of an order read its refunds; nobody else does");
ok(refused(await me(BUYER2, `SELECT stripe_payment_intent_id FROM public.declutter_refunds`), /permission denied/), "members never read the Stripe ids of a refund");
ok((await me(SELLER, `SELECT amount_cents FROM public.declutter_seller_fee_debts`)).length === 4
   && (await me(BUYER, `SELECT amount_cents FROM public.declutter_seller_fee_debts`)).length === 0,
  "a seller reads their own fee debts; nobody else does");
// export_my_data reads many prod tables this harness does not stub, so its
// body is checked as installed (the newest definition), not run.
const expDef = String(one(await svc(`SELECT pg_get_functiondef('public.export_my_data(uuid)'::regprocedure) AS d`)) ?? "");
ok(/'declutter_seller_fee_debts'[\s\S]*t\.seller_id = v_uid/.test(expDef) && /'declutter_buyer_cards'/.test(expDef),
  "Download My Data includes a seller's fee debts and keeps the slice 3 sections");
const anonExec = await svc(`SELECT string_agg(p.proname, ',') AS f FROM pg_proc p
  WHERE p.pronamespace = 'public'::regnamespace AND p.proname LIKE 'declutter%' AND has_function_privilege('anon', p.oid, 'EXECUTE')`);
ok(Array.isArray(anonExec) && one(anonExec) === null && !skip, "anon can EXECUTE no Declutter function");
const internal = ["declutter_save_card", "declutter_record_refund", "declutter_refund_answer", "declutter_refund_executed",
  "declutter_mark_order_paid", "declutter_refund_paid_order", "declutter_consume_fee_debt", "declutter_retire_order",
  "declutter_cancelled_sale_session", "declutter_card_fee_estimate", "declutter_pick_drop_stop", "declutter_give_strike",
  "declutter_attach_checkout_session", "declutter_money_rows_seed", "declutter_item_private_drop_stop"];
const authInternal = await svc(`SELECT string_agg(p.proname, ',') AS f FROM pg_proc p
  WHERE p.pronamespace = 'public'::regnamespace AND p.proname = ANY (ARRAY[${internal.map((n) => `'${n}'`).join(",")}])
    AND has_function_privilege('authenticated', p.oid, 'EXECUTE')`);
ok(Array.isArray(authInternal) && one(authInternal) === null && !skip, "authenticated can EXECUTE none of the internal slice-3b functions");
const writes = await svc(`SELECT string_agg(c.relname || ':' || r.rolname || ':' || pr.p, ',') AS w
  FROM pg_class c CROSS JOIN (VALUES ('anon'), ('authenticated')) r(rolname)
  CROSS JOIN (VALUES ('INSERT'), ('UPDATE'), ('DELETE'), ('TRUNCATE')) pr(p)
  WHERE c.relnamespace = 'public'::regnamespace AND c.relname LIKE 'declutter%' AND c.relkind = 'r'
    AND has_table_privilege(r.rolname, c.oid, pr.p)`);
ok(Array.isArray(writes) && one(writes) === null && !skip, "no client role can write any Declutter table (incl. refunds and debts)");
ok(one(await svc(`SELECT string_agg(pronargs::text, ',') FROM pg_proc WHERE proname = 'declutter_mark_order_paid'`)) === "5",
  "exactly one mark-paid (the old 3-argument door is gone)");

console.log(`\n${pass} PASS, ${fail} FAIL${skip ? " (NEW_MIGRATION=skip)" : ""}`);
process.exit(fail === 0 ? 0 : 1);
