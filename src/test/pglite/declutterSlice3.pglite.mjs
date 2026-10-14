#!/usr/bin/env node
/**
 * PGlite proof for 20261014210518_declutter_slice3_offers_checkout (Declutter
 * slice 3: offers, price drops, cart + checkout records, strikes, hidden
 * sellers; docs/specs/declutter-auctions.md rows 13, 16-22, 36, 38, 53, 56-59,
 * build decisions B25-B37), on top of slices 1 + 2 applied once.
 *
 *   node src/test/pglite/declutterSlice3.pglite.mjs
 *   NEW_MIGRATION=skip node src/test/pglite/declutterSlice3.pglite.mjs   # RED: every check fails
 *   MIGRATION_PATH=<planted copy> node src/test/pglite/declutterSlice3.pglite.mjs
 *
 * Setup (prod-shaped stubs, newest helper definitions, slices 1-2): see
 * scripts/declutter/slice3Harness.mjs. pglite is not a dependency (CLAUDE.md):
 * loaded from ~/.lh-pglite (PGLITE_DIR). The concurrent half of the race proof
 * (two real sessions) is scripts/declutter/race-accept.mjs.
 */
import os from "node:os";
import { setupStatements, liveItemSql, CARDS_SQL, USERS, U } from "../../../scripts/declutter/slice3Harness.mjs";

const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const { SELLER, BUYER, OUTSIDER, MINOR, BANNED, STRUCK, BUYER2, BUYER3, SELLER2, NOCARD, SELLER3 } = USERS;

const skip = process.env.NEW_MIGRATION === "skip";
const db = new PGlite();
for (const sql of setupStatements({ times: skip ? 0 : 3, slice3Path: process.env.MIGRATION_PATH })) await db.exec(sql);
const svcTry = async (sql) => { try { return (await db.query(sql)).rows; } catch (e) { return { error: String(e.message ?? e), code: e.code }; } };
if (!skip) await db.exec(CARDS_SQL);
await svcTry(`INSERT INTO public.declutter_strikes (user_id, offender_side, reason, given_at, expires_at)
              SELECT '${STRUCK}', 'buyer', 'missed_checkout', now(), now() FROM generate_series(1, 3)`);

let pass = 0;
let fail = 0;
const ok = (cond, label) => {
  if (cond) pass++;
  else fail++;
  console.log(`${cond ? "PASS" : "FAIL"}  ${label}`);
};
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
const svc = svcTry;
/** Multi-statement setup SQL (db.query takes one statement). Throws: setup must not fail silently. */
const run = (sql) => (skip ? db.exec(sql).catch((e) => console.log(`(skip run) setup step failed: ${String(e.message).slice(0, 80)}`)) : db.exec(sql));
const refused = (r, re, code) => !Array.isArray(r) && re.test(r.error) && (code === undefined || r.code === code);
const one = (r) => (Array.isArray(r) && r[0] ? Object.values(r[0])[0] : undefined);
const I = (n) => `11111111-0000-0000-0000-0000000000${String(n).padStart(2, "0")}`;
const offer = (uid, item, cents) => me(uid, `SELECT public.declutter_make_offer('${item}', ${cents}) AS id`);
const respond = (uid, id, action, cents = "NULL") => me(uid, `SELECT public.declutter_respond_offer('${id}', '${action}', ${cents}) AS r`);
const status = async (item) => one(await svc(`SELECT status FROM public.declutter_items WHERE id = '${item}'`));
const notes = async (uid, title) => Number(one(await svc(`SELECT count(*) FROM public.notifications WHERE user_id = '${uid}' AND title = '${title}'`)));
const strikes = async (uid, reason) => Number(one(await svc(`SELECT count(*) FROM public.declutter_strikes WHERE user_id = '${uid}' AND reason = '${reason}'`)));

for (let n = 1; n <= 14; n++) await run(liveItemSql({ id: I(n), title: `Item number ${n}` }));
await run(liveItemSql({ id: I(20), seller: SELLER2, title: "Second seller lamp", price: 300, floor: 200 }));
await run(liveItemSql({ id: I(21), seller: SELLER2, title: "Second seller rug", price: 400, floor: 300 }));
await run(liveItemSql({ id: I(22), seller: SELLER3, title: "Small vase", price: 200, floor: 100 }));

// --- Offer rules (rows 36, 53, 57, 58)
ok(refused(await offer(NOCARD, I(1), 3000), /card_required/, "42501"), "no saved card: offering is refused (row 36)");
ok(refused(await offer(BUYER, I(1), 1999), /offer_too_low/, "22023"), "an offer under half the current price is refused (row 58)");
ok(refused(await offer(BUYER, I(1), 4000), /invalid_offer_amount/), "an offer of the full price is refused (use Buy)");
ok(refused(await offer(SELLER, I(1), 3000), /own_item/), "a seller cannot offer on their own item (row 48)");
ok(refused(await offer(MINOR, I(1), 3000), /under_18/), "under 18 cannot offer (row 53)");
ok(refused(await offer(BANNED, I(1), 3000), /account_restricted/), "a banned member cannot offer");
ok(refused(await offer(STRUCK, I(1), 3000), /declutter_strikes_blocked/), "3 strikes: cannot offer (row 16)");
ok(refused(await offer(OUTSIDER, I(1), 3000), /feature_disabled/), "a member the switch is off for cannot offer");
ok(refused(await as("anon", null, `SELECT public.declutter_make_offer('${I(1)}', 3000)`), /permission denied/), "anon cannot execute declutter_make_offer");

const underFloor = one(await offer(BUYER, I(1), 2000)); // floor 2000 -> exactly half, at floor
const o1 = underFloor;
ok(typeof o1 === "string", "an offer of exactly half the price is accepted for the seller to answer");
const below = one(await offer(BUYER3, I(1), 2001));
ok(typeof below === "string", "B26: an offer is never auto-declined for the hidden floor");
await svc(`UPDATE public.declutter_item_private SET floor_price_cents = 3500 WHERE item_id = '${I(1)}'`);
const underHidden = one(await offer(BUYER2, I(1), 2500));
ok(typeof underHidden === "string" && one(await svc(`SELECT status FROM public.declutter_offers WHERE id = '${underHidden}'`)) === "open",
  "B26: an offer UNDER the hidden floor reaches the seller (open), so the floor cannot be probed");
ok(await notes(SELLER, "New offer") === 3, "the seller gets a 'New offer' alert for each offer (row 44)");
ok(refused(await offer(BUYER, I(1), 3000), /offer_already_open/), "one open offer per buyer per item");

// --- Turns, counters, RLS
ok(refused(await respond(BUYER, o1, "accept"), /not_your_turn/), "the buyer cannot accept their own offer");
ok(refused(await respond(OUTSIDER, o1, "accept"), /feature_disabled|offer_not_found/), "a stranger cannot answer");
ok(refused(await respond(BUYER2, o1, "decline"), /offer_not_found/, "P0002"), "another buyer cannot see or answer this thread");
ok(one(await respond(SELLER, o1, "counter", 3800)) === "countered", "the seller counters");
ok(refused(await respond(SELLER, o1, "counter", 3700), /not_your_turn/), "the seller cannot counter twice in a row");
ok(refused(await respond(BUYER, o1, "counter", 1999), /offer_too_low/), "a buyer's counter must still be >= half the price");
ok(one(await respond(BUYER, o1, "counter", 3000)) === "countered", "the buyer counters back (unlimited counters)");
ok(one(await respond(SELLER, o1, "counter", 3500)) === "countered", "the seller counters again");
ok(Number(one(await svc(`SELECT counter_count FROM public.declutter_offers WHERE id = '${o1}'`))) === 3, "counter_count counts each counter");
ok(await notes(BUYER, "New counteroffer") === 2, "each counter alerts the other side");
ok((await me(BUYER2, `SELECT id FROM public.declutter_offers`)).length === 1, "RLS: a buyer reads only their own threads");
ok((await me(SELLER, `SELECT id FROM public.declutter_offers WHERE item_id = '${I(1)}'`)).length === 3, "RLS: the seller reads every thread on their item");
ok((await me(OUTSIDER, `SELECT id FROM public.declutter_offers`)).length === 0, "RLS: a stranger reads no offers");
ok(Number(one(await svc(`SELECT count(*) FROM public.declutter_offer_events WHERE offer_id = '${o1}'`))) === 4, "every step is kept in the thread history");

// --- Accept: first accepted wins, others voided, cart line (rows 57, 59; B29)
ok(one(await respond(BUYER, o1, "accept")) === "accepted", "the buyer accepts the seller's counter");
ok(await status(I(1)) === "reserved", "accepting reserves the item");
ok(one(await svc(`SELECT string_agg(status, ',' ORDER BY status) FROM public.declutter_offers WHERE item_id = '${I(1)}'`)) === "accepted,voided,voided",
  "every other open thread on the item is voided");
ok(await notes(BUYER2, "Item no longer available") === 1 && await notes(BUYER3, "Item no longer available") === 1,
  "voided buyers are told, nothing charged");
const line1 = (await svc(`SELECT price_cents, buyer_id, source, extract(epoch FROM checkout_by - now()) AS secs FROM public.declutter_cart_items WHERE item_id = '${I(1)}'`))[0];
ok(line1?.price_cents === 3500 && line1.buyer_id === BUYER && line1.source === "offer" && Math.abs(line1.secs - 172800) < 60,
  "the accepted amount goes into the buyer's cart with 48 h to check out (row 59)");
ok(refused(await respond(SELLER, underHidden, "accept"), /offer_not_open/), "a voided offer cannot be accepted afterwards");
ok(refused(await offer(BUYER2, I(1), 3000), /item_not_available/), "no new offer on a reserved item");
ok(refused(await me(BUYER2, `SELECT public.declutter_buy_now('${I(1)}', 4000)`), /item_not_available/), "no Buy on a reserved item");
ok(refused(await svc(`SELECT public.declutter_take_item('${I(1)}', '${BUYER2}', 4000, 'buy', NULL)`), /item_not_available/),
  "the take path itself refuses an item already reserved (status predicate)");
// Backstops (B29): even a path that skipped every check cannot make a second winner.
await svc(`INSERT INTO public.declutter_offers (id, item_id, buyer_id, seller_id, amount_cents, awaiting, respond_by)
           VALUES ('22222222-0000-0000-0000-000000000001', '${I(1)}', '${BUYER2}', '${SELLER}', 3000, 'seller', now() + interval '1 day')`);
ok(refused(await svc(`UPDATE public.declutter_offers SET status = 'accepted' WHERE id = '22222222-0000-0000-0000-000000000001'`), /declutter_offers_one_accepted/),
  "unique index: a second accepted offer on one item is impossible");
ok(refused(await svc(`INSERT INTO public.declutter_cart_items (item_id, buyer_id, seller_id, price_cents, source, checkout_by)
                      VALUES ('${I(1)}', '${BUYER2}', '${SELLER}', 3000, 'buy', now() + interval '2 days')`), /declutter_cart_one_active/),
  "unique index: a second active cart line for one item is impossible");
await svc(`DELETE FROM public.declutter_offers WHERE id = '22222222-0000-0000-0000-000000000001'`);

// --- Decline wording is identical whatever the floor (B26)
const d1 = one(await offer(BUYER2, I(2), 2000));
const d2 = one(await offer(BUYER3, I(2), 3900));
await respond(SELLER, d1, "decline");
await respond(SELLER, d2, "decline");
const msgs = await svc(`SELECT DISTINCT message FROM public.notifications WHERE title = 'Offer declined' AND user_id IN ('${BUYER2}', '${BUYER3}')`);
ok(Array.isArray(msgs) && msgs.length === 1, "B26: a decline reads the same whatever the amount (one wording)");

// --- Rate limit (B27) and withdraw
const w1 = one(await offer(BUYER2, I(3), 2500));
ok(one(await respond(BUYER2, w1, "withdraw")) === "withdrawn", "the buyer withdraws an open offer");
ok(refused(await respond(SELLER, w1, "withdraw"), /offer_not_open|invalid_action/), "the seller cannot withdraw a buyer's offer");
const w2 = one(await offer(BUYER2, I(3), 2600));
await respond(BUYER2, w2, "withdraw");
const w3 = one(await offer(BUYER2, I(3), 2700));
await respond(BUYER2, w3, "withdraw");
ok(refused(await offer(BUYER2, I(3), 2800), /offer_rate_limited/, "54000"), "B27: a 4th offer thread on one item in 24 h is refused");

// --- Buy at the current price (rows 57-59)
ok(refused(await me(BUYER2, `SELECT public.declutter_buy_now('${I(4)}', 3999)`), /price_changed/), "Buy refuses when the price is above what the buyer saw");
ok(refused(await me(NOCARD, `SELECT public.declutter_buy_now('${I(4)}', 4000)`), /card_required/), "Buy needs a saved card too (row 36)");
const openOnFour = one(await offer(BUYER3, I(4), 3000));
ok(typeof one(await me(BUYER2, `SELECT public.declutter_buy_now('${I(4)}', 4000) AS id`)) === "string", "Buy at the current price takes the item at once");
ok(one(await svc(`SELECT status FROM public.declutter_offers WHERE id = '${openOnFour}'`)) === "voided", "Buy voids the open offers on the item");
ok(one(await svc(`SELECT price_cents FROM public.declutter_cart_items WHERE item_id = '${I(4)}' AND status = 'in_cart'`)) === 4000, "Buy puts the current price in the cart");

// --- Checkout: one order per seller, amounts frozen (rows 20-22, 38)
await me(BUYER2, `SELECT public.declutter_buy_now('${I(20)}', 300)`);
await me(BUYER2, `SELECT public.declutter_buy_now('${I(21)}', 400)`);
ok(refused(await me(BUYER2, `SELECT * FROM public.declutter_start_checkout('${SELLER2}', 'delivery')`), /handover_unavailable/),
  "Helpr delivery is refused at checkout for now (slice 5)");
const co1 = (await me(BUYER2, `SELECT * FROM public.declutter_start_checkout('${SELLER2}', 'porch')`))[0];
ok(co1?.items_cents === 700 && co1.premium_cents === 105 && co1.tax_cents === 0 && co1.total_cents === 805,
  "two items from one seller = one order: $7.00 + 15% ($1.05) = $8.05, no tax for a casual seller");
ok(Number(one(await svc(`SELECT count(*) FROM public.declutter_cart_items WHERE order_id = '${co1?.order_id}'`))) === 2, "both lines belong to the one order");
await svc(`UPDATE public.declutter_orders SET stripe_checkout_session_id = 'cs_test_old' WHERE id = '${co1?.order_id}'`);
const co2 = (await me(BUYER2, `SELECT * FROM public.declutter_start_checkout('${SELLER2}', 'pickup_home')`))[0];
ok(co2?.superseded_session_id === "cs_test_old" && one(await svc(`SELECT status FROM public.declutter_orders WHERE id = '${co1?.order_id}'`)) === "superseded",
  "restarting checkout supersedes the old order and hands back its Stripe session to expire");
ok(Number(one(await svc(`SELECT count(*) FROM public.declutter_orders WHERE buyer_id = '${BUYER2}' AND status = 'awaiting_payment'`))) === 1,
  "only one payable order per buyer + seller");
const co4 = (await me(BUYER2, `SELECT * FROM public.declutter_start_checkout('${SELLER}', 'porch')`))[0];
ok(co4?.items_cents === 4000 && co4.premium_cents === 600 && co4.total_cents === 4600, "$40 item: premium 15% = $6, total $46");
ok(refused(await me(BUYER3, `SELECT * FROM public.declutter_start_checkout('${SELLER}', 'porch')`), /cart_empty/), "nothing in the cart: no order");
await me(BUYER3, `SELECT public.declutter_buy_now('${I(22)}', 200)`);
const coSmall = (await me(BUYER3, `SELECT * FROM public.declutter_start_checkout('${SELLER3}', 'porch')`))[0];
ok(coSmall?.items_cents === 200 && coSmall.premium_cents === 100 && coSmall.total_cents === 300,
  "a $2 item: the premium is the $1 minimum (row 21), total $3");
ok(Number(one(await svc(`SELECT count(*) FROM public.notifications WHERE user_id = '${BUYER3}' AND message LIKE '%Small vase%'`))) === 0
   && Number(one(await svc(`SELECT count(*) FROM public.notifications WHERE user_id = '${SELLER3}' AND message LIKE '%Small vase%'`))) >= 1,
  "Q137: a seed (test) seller's sale never notifies a real buyer; the seed seller is told");
const coSmall2 = (await me(BUYER3, `SELECT * FROM public.declutter_start_checkout('${SELLER3}', 'porch')`))[0];
ok(coSmall2?.order_id === coSmall?.order_id && coSmall2?.superseded_session_id === null,
  "money review #3: the same checkout twice (double tap) returns the open order, never supersedes it");
ok(refused(await me(BUYER, `SELECT * FROM public.declutter_start_checkout('${BANNED}', 'porch')`), /cart_empty/)
   && refused(await me(BUYER, `SELECT * FROM public.declutter_start_checkout('${STRUCK}', 'porch')`), /cart_empty/),
  "authz review #2: with nothing in the cart, checkout says nothing about a seller's ban or strikes");
ok(refused(await me(BUYER2, `SELECT stripe_payment_intent_id FROM public.declutter_orders`), /permission denied/)
   && Array.isArray(await me(BUYER2, `SELECT total_cents FROM public.declutter_orders`)),
  "members read their orders but not the Stripe ids (column grant)");
ok(refused(await svc(`INSERT INTO public.declutter_orders (buyer_id, seller_id, handover, items_cents, premium_cents, total_cents)
                      VALUES ('${BUYER3}', '${SELLER}', 'porch', 500, 75, 575)`), /declutter_orders_premium/),
  "the table refuses a premium under the $1 minimum (row 21)");
ok(refused(await me(BUYER2, `UPDATE public.declutter_orders SET total_cents = 1 WHERE buyer_id = '${BUYER2}' RETURNING id`), /permission denied/),
  "a buyer cannot write their order");
ok(refused(await me(BUYER2, `SELECT public.declutter_mark_order_paid('${co2?.order_id}', 'pi_x', 805)`), /permission denied/),
  "only the service (webhook) can mark an order paid");

// --- Paying (webhook side)
ok(one(await svc(`SELECT public.declutter_mark_order_paid('${co2?.order_id}', 'pi_1', 800)`)) === "refund_in_full", "a wrong amount is refunded in full, never kept");
ok(one(await svc(`SELECT public.declutter_mark_order_paid('${co1?.order_id}', 'pi_old', 805)`)) === "refund_in_full",
  "a payment on a superseded order is refunded in full (our mistake)");
ok(one(await svc(`SELECT public.declutter_mark_order_paid('${co2?.order_id}', 'pi_2', 805)`)) === "paid", "the right amount marks the order paid");
ok(await status(I(20)) === "sold" && await status(I(21)) === "sold", "paid: both items are sold");
ok(one(await svc(`SELECT public.declutter_mark_order_paid('${co2?.order_id}', 'pi_2', 805)`)) === "already_paid", "a replayed webhook is a no-op");
ok(one(await svc(`SELECT public.declutter_mark_order_paid('${co2?.order_id}', 'pi_3', 805)`)) === "refund_in_full", "a second payment on a paid order is refunded in full");

// --- Tax hook (B33)
await svc(`INSERT INTO public.declutter_seller_flags (user_id, business_like) VALUES ('${SELLER}', true)`);
ok(refused(await me(BUYER2, `SELECT * FROM public.declutter_start_checkout('${SELLER}', 'porch')`), /seller_tax_not_ready/),
  "B33: a business-like seller's sale is not taken untaxed");
await svc(`DELETE FROM public.declutter_seller_flags WHERE user_id = '${SELLER}'`);

// --- Seller backs out (row 19)
await me(BUYER3, `SELECT public.declutter_buy_now('${I(5)}', 4000)`);
ok(refused(await me(SELLER2, `SELECT public.declutter_seller_cancel_sale('${I(5)}')`), /item_not_found/), "only the item's seller can cancel its sale");
ok(Number(one(await me(SELLER, `SELECT public.declutter_seller_cancel_sale('${I(5)}') AS n`))) === 1, "the seller cancels an accepted sale: 1 strike");
ok(await strikes(SELLER, "cancelled_after_offers") === 1 && await status(I(5)) === "withdrawn", "seller strike given, item withdrawn");
ok(await notes(BUYER3, "The seller cancelled") === 1, "the buyer is told they were not charged");
ok(Number(one(await svc(`SELECT count(*) FROM public.notifications WHERE user_id = '${SELLER}' AND title = 'You got a Declutter strike' AND message LIKE '%You have 1 of 3 strikes%'`))) === 1,
  "the strike alert says 'You have 1 of 3 strikes'");
ok(refused(await me(SELLER2, `SELECT public.declutter_seller_cancel_sale('${I(20)}')`), /sale_already_paid/), "a paid sale cannot be cancelled here (slice 4)");

// --- Deadlines (rows 13, 57, 59)
const late = one(await offer(BUYER3, I(6), 3000));
await svc(`UPDATE public.declutter_offers SET respond_by = now() - interval '1 minute' WHERE id = '${late}'`);
ok(refused(await respond(SELLER, late, "accept"), /offer_expired/), "an offer past 48 h cannot be accepted");
await me(BUYER3, `SELECT public.declutter_buy_now('${I(7)}', 4000)`);
await me(BUYER, `SELECT public.declutter_buy_now('${I(8)}', 4000)`);
await me(BUYER2, `SELECT public.declutter_buy_now('${I(9)}', 4000)`);
await me(BUYER3, `SELECT public.declutter_buy_now('${I(10)}', 4000)`);
await run(`UPDATE public.declutter_cart_items SET checkout_by = now() + interval '20 hours' WHERE item_id = '${I(7)}';
           UPDATE public.declutter_cart_items SET checkout_by = now() + interval '1 hour' WHERE item_id = '${I(8)}';
           UPDATE public.declutter_cart_items SET checkout_by = now() - interval '1 minute' WHERE item_id = '${I(9)}';`);
const coLate = (await me(BUYER3, `SELECT * FROM public.declutter_start_checkout('${SELLER}', 'porch')`))[0];
await svc(`UPDATE public.declutter_cart_items SET checkout_by = now() - interval '10 minutes' WHERE item_id = '${I(10)}'`);
const sweep1 = (await svc(`SELECT public.declutter_deadline_sweep() AS r`))[0]?.r;
ok(sweep1?.offers_expired === 1 && await notes(BUYER3, "Offer expired") === 1, "the sweep expires an unanswered offer and tells the buyer");
ok(sweep1?.reminded_24h >= 1 && await notes(BUYER3, "Check out within 24 hours") === 1, "24 h reminder sent");
ok(sweep1?.reminded_2h === 1 && await notes(BUYER, "2 hours left to check out") === 1, "2 h reminder sent");
ok(await status(I(9)) === "live" && await strikes(BUYER2, "missed_checkout") === 1, "missed checkout: buyer strike, item back on sale (rows 7, 59)");
ok(await status(I(10)) === "reserved", "a payable order gets 1 h of grace past the deadline");
const sweep2 = (await svc(`SELECT public.declutter_deadline_sweep() AS r`))[0]?.r;
ok(sweep2?.reminded_24h === 0 && sweep2.reminded_2h === 0 && sweep2.checkouts_missed === 0 && sweep2.offers_expired === 0,
  "a second sweep sends nothing twice and strikes nobody twice");
await svc(`UPDATE public.declutter_cart_items SET checkout_by = now() - interval '2 hours' WHERE item_id = '${I(10)}'`);
await svc(`SELECT public.declutter_deadline_sweep()`);
ok(await status(I(10)) === "live" && one(await svc(`SELECT status FROM public.declutter_orders WHERE id = '${coLate?.order_id}'`)) === "expired",
  "past the grace: missed, order expired");
ok(one(await svc(`SELECT public.declutter_mark_order_paid('${coLate?.order_id}', 'pi_late', ${coLate?.total_cents})`)) === "refund_in_full",
  "a payment landing after the deadline is refunded in full");

// --- Price drops (row 56)
await run(`UPDATE public.declutter_items SET current_price_cents = 10000, price_cents = 10000 WHERE id = '${I(11)}';
           UPDATE public.declutter_item_private SET floor_price_cents = 9000 WHERE item_id = '${I(11)}';
           UPDATE public.declutter_items SET live_at = now() - interval '2 hours' WHERE id = '${I(12)}';`);
await me(BUYER2, `SELECT public.declutter_set_watch('${I(11)}', true)`);
const dropped = Number(one(await svc(`SELECT public.declutter_price_drop_sweep()`)));
const p11 = async () => Number(one(await svc(`SELECT current_price_cents FROM public.declutter_items WHERE id = '${I(11)}'`)));
ok(await p11() === 9500, "the evening drop lowers the price 5%");
ok(dropped >= 1 && Number(one(await svc(`SELECT current_price_cents FROM public.declutter_items WHERE id = '${I(12)}'`))) === 4000,
  "an item live under 12 h is not dropped yet (while others are)");
ok(await notes(BUYER2, "Price dropped") === 1 && await notes(BUYER3, "Price dropped") === 0, "watchers (only) get 'Price dropped'");
ok(dropped >= 1 && Number(one(await svc(`SELECT public.declutter_price_drop_sweep()`))) === 0 && await p11() === 9500,
  "a second run the same Louisiana day drops nothing (idempotent)");
await svc(`UPDATE public.declutter_items SET last_price_drop_on = last_price_drop_on - 1 WHERE id = '${I(11)}'`);
await svc(`SELECT public.declutter_price_drop_sweep()`);
ok(await p11() === 9025, "the next evening: 5% again");
await svc(`UPDATE public.declutter_items SET last_price_drop_on = last_price_drop_on - 1 WHERE id = '${I(11)}'`);
await svc(`SELECT public.declutter_price_drop_sweep()`);
ok(await p11() === 9000, "never below the hidden floor");
await svc(`UPDATE public.declutter_items SET last_price_drop_on = last_price_drop_on - 1 WHERE id = '${I(11)}'`);
await svc(`SELECT public.declutter_price_drop_sweep()`);
ok(await p11() === 9000 && await notes(BUYER2, "Price dropped") === 3, "at the floor: no more drops, no more alerts");
ok(await status(I(1)) === "reserved" && Number(one(await svc(`SELECT current_price_cents FROM public.declutter_items WHERE id = '${I(1)}'`))) === 4000,
  "a reserved item is not dropped");

// --- Hidden sellers (B36)
const visible = async () => (await me(BUYER, `SELECT id FROM public.declutter_items WHERE seller_id = '${SELLER2}'`)).length;
await svc(`UPDATE public.declutter_items SET status = 'live' WHERE id = '${I(20)}'`);
const before = await visible();
await svc(`UPDATE public.profiles SET ban_status = 'banned' WHERE user_id = '${SELLER2}'`);
ok(before === 1 && await visible() === 0, "a banned seller's live listing is hidden from buyers");
ok(await visible() === 0 && (await me(SELLER2, `SELECT id FROM public.declutter_items WHERE seller_id = '${SELLER2}'`)).length === 2,
  "hidden from buyers, the seller still reads their own");
ok(refused(await offer(BUYER, I(20), 250), /item_not_found/), "a banned seller's item cannot be offered on");
await run(`UPDATE public.profiles SET ban_status = 'active' WHERE user_id = '${SELLER2}';
           INSERT INTO public.declutter_strikes (user_id, offender_side, reason, given_at, expires_at)
           SELECT '${SELLER2}', 'seller', 'seller_no_show', now(), now() FROM generate_series(1, 3);`);
ok(await visible() === 0 && refused(await me(BUYER, `SELECT public.declutter_buy_now('${I(20)}', 300)`), /item_not_found/),
  "a 3-strike seller's listing is hidden and not buyable");

// --- Review fixes
// Accept never costs more than Buy (money review #5).
const cl = one(await offer(BUYER2, I(13), 3000));
await respond(SELLER, cl, "counter", 3700);
await svc(`UPDATE public.declutter_items SET current_price_cents = 3200 WHERE id = '${I(13)}'`);
await respond(BUYER2, cl, "accept");
ok(one(await svc(`SELECT price_cents FROM public.declutter_cart_items WHERE item_id = '${I(13)}' AND status = 'in_cart'`)) === 3200,
  "an accepted counter above today's price is charged at today's price");
// A seller who blocks the buyer takes the strike, not the buyer (both reviews, must-fix).
const b3Before = await strikes(BUYER3, "missed_checkout");
await me(BUYER3, `SELECT public.declutter_buy_now('${I(14)}', 4000)`);
await svc(`INSERT INTO public.user_blocks (blocker_id, blocked_id) VALUES ('${SELLER}', '${BUYER3}')`);
ok(refused(await me(BUYER3, `SELECT * FROM public.declutter_start_checkout('${SELLER}', 'porch')`), /item_not_found/), "a blocked buyer cannot check out");
const sBefore = await strikes(SELLER, "cancelled_after_offers");
await svc(`UPDATE public.declutter_cart_items SET checkout_by = now() - interval '1 minute' WHERE item_id = '${I(14)}'`);
await svc(`SELECT public.declutter_deadline_sweep()`);
ok(await strikes(BUYER3, "missed_checkout") === b3Before && await strikes(SELLER, "cancelled_after_offers") === sBefore + 1
   && await status(I(14)) === "withdrawn",
  "seller blocked the buyer after the sale: the SELLER gets the strike, the buyer none, the item comes down");
await svc(`DELETE FROM public.user_blocks WHERE blocker_id = '${SELLER}'`);
// An under-18 seller cannot sell (authz review #3).
await run(liveItemSql({ id: I(23), seller: SELLER3, title: "Teen lamp", price: 500, floor: 300 }));
await svc(`UPDATE public.profiles SET date_of_birth = (now() - interval '16 years')::date WHERE user_id = '${SELLER3}'`);
ok(refused(await me(BUYER2, `SELECT public.declutter_buy_now('${I(23)}', 500)`), /item_not_found/)
   && (await me(BUYER2, `SELECT id FROM public.declutter_items WHERE id = '${I(23)}'`)).length === 0,
  "a seller whose birthday says under 18 is hidden and cannot sell (row 53)");
await svc(`UPDATE public.profiles SET date_of_birth = '1987-01-01' WHERE user_id = '${SELLER3}'`);

// --- Readers (B37)
const sellerRows = await me(SELLER, `SELECT * FROM public.declutter_my_offers()`);
const buyerRows = await me(BUYER2, `SELECT * FROM public.declutter_my_offers()`);
ok(Array.isArray(sellerRows) && sellerRows.length > 0 && sellerRows.every((r) => r.my_side === "seller" && r.floor_price_cents !== null),
  "the seller's offers list carries their own floor");
ok(Array.isArray(buyerRows) && buyerRows.length > 0 && buyerRows.every((r) => r.my_side === "buyer" && r.floor_price_cents === null),
  "B26: a buyer's offers list never carries the floor");
const cartRows = await me(BUYER2, `SELECT * FROM public.declutter_my_cart()`);
ok(Array.isArray(cartRows) && cartRows.some((r) => r.status === "paid" && r.item_title === "Second seller lamp" && r.total_cents === 805),
  "the cart reader shows a paid line with its title and total, though the item is no longer for sale");
ok(refused(await me(OUTSIDER, `SELECT * FROM public.declutter_my_cart()`), /feature_disabled/), "the readers need the switch");

// --- The policy helper is not a ban/strike oracle (B36)
ok(one(await me(BUYER, `SELECT public.declutter_seller_hidden('${BANNED}') AS h`)) === false,
  "declutter_seller_hidden says nothing about a banned member with no listing");
ok(one(await me(BUYER, `SELECT public.declutter_seller_hidden('${STRUCK}') AS h`)) === false,
  "declutter_seller_hidden says nothing about a 3-strike member with no listing");
ok(refused(await me(BUYER, `SELECT public.declutter_member_out('${BANNED}')`), /permission denied/), "declutter_member_out is service-only");

// --- Grants
const anonExec = await svc(`SELECT string_agg(p.proname, ',') AS f FROM pg_proc p
  WHERE p.pronamespace = 'public'::regnamespace AND p.proname LIKE 'declutter%' AND has_function_privilege('anon', p.oid, 'EXECUTE')`);
ok(Array.isArray(anonExec) && one(anonExec) === null && !skip, "anon can EXECUTE no Declutter function");
const internal = ["declutter_take_item", "declutter_lock_buyable_item", "declutter_mark_order_paid", "declutter_attach_checkout_session",
  "declutter_deadline_sweep", "declutter_price_drop_sweep", "declutter_give_strike", "declutter_notify", "declutter_member_out", "declutter_seller_out", "declutter_trade_rows_seed"];
const authInternal = await svc(`SELECT string_agg(p.proname, ',') AS f FROM pg_proc p
  WHERE p.pronamespace = 'public'::regnamespace AND p.proname = ANY (ARRAY[${internal.map((n) => `'${n}'`).join(",")}])
    AND has_function_privilege('authenticated', p.oid, 'EXECUTE')`);
ok(Array.isArray(authInternal) && one(authInternal) === null && !skip, "authenticated can EXECUTE none of the internal slice-3 functions");
const writes = await svc(`SELECT string_agg(c.relname || ':' || r.rolname || ':' || pr.p, ',') AS w
  FROM pg_class c CROSS JOIN (VALUES ('anon'), ('authenticated')) r(rolname)
  CROSS JOIN (VALUES ('INSERT'), ('UPDATE'), ('DELETE'), ('TRUNCATE')) pr(p)
  WHERE c.relnamespace = 'public'::regnamespace AND c.relname LIKE 'declutter%' AND c.relkind = 'r'
    AND has_table_privilege(r.rolname, c.oid, pr.p)`);
ok(Array.isArray(writes) && one(writes) === null && !skip, "no client role can write any Declutter table (RPCs only)");
ok(refused(await me(BUYER, `SELECT payment_method_id FROM public.declutter_buyer_cards`), /permission denied/),
  "a member cannot read the Stripe payment method id, even their own");
ok(one(await me(BUYER, `SELECT last4 FROM public.declutter_buyer_cards`)) === "4242", "a member reads their own card's last 4");
ok((await me(BUYER, `SELECT user_id FROM public.declutter_buyer_cards`)).length === 1, "RLS: only their own card row");

console.log(`\n${pass} PASS, ${fail} FAIL${skip ? " (NEW_MIGRATION=skip)" : ""}`);
process.exit(fail === 0 ? 0 : 1);
