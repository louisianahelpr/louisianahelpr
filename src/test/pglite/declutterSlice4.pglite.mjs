#!/usr/bin/env node
/**
 * PGlite proof for 20261015042253_declutter_slice4_handover_payout (Declutter
 * slice 4: booking, exact address, handover, porch, no-shows, problems,
 * payouts, refund/payout queues, reviews), on top of slices 1-3b, the $1,000
 * cap and F1. Spec: docs/specs/declutter-auctions.md, "Slice 4 plan", B49-B58.
 *
 *   node src/test/pglite/declutterSlice4.pglite.mjs
 *   NEW_MIGRATION=skip node src/test/pglite/declutterSlice4.pglite.mjs    # RED: slice 4 absent
 *   MIGRATION_PATH=<planted copy> node src/test/pglite/declutterSlice4.pglite.mjs
 *
 * pglite is not a dependency (CLAUDE.md): loaded from ~/.lh-pglite.
 */
import os from "node:os";
import { setupStatements, liveItemSql, CARDS_SQL, USERS, FEE_F1_FILE, SLICE4_FILE } from "../../../scripts/declutter/slice3Harness.mjs";

const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const { SELLER, BUYER, BUYER2, BUYER3, SELLER2, OUTSIDER, ADMIN } = USERS;
const skip = process.env.NEW_MIGRATION === "skip";

const db = new PGlite();
const extra = [{ file: FEE_F1_FILE, times: 1 }];
if (!skip) extra.push(process.env.MIGRATION_PATH ? { path: process.env.MIGRATION_PATH, times: 3 } : { file: SLICE4_FILE, times: 3 });
for (const sql of setupStatements({ times: 1, times3b: 1, extra })) await db.exec(sql);
await db.exec(CARDS_SQL);
await db.exec(`CREATE OR REPLACE FUNCTION public.log_cron_defect(a text, b text, c text) RETURNS void LANGUAGE plpgsql AS $f$ BEGIN RAISE WARNING 'cron defect % % %', a, b, c; END $f$;`);
// Pickup windows: every day 09:00-18:00 Louisiana time, for both sellers.
await db.exec(`INSERT INTO public.declutter_pickup_windows (seller_id, weekday, starts_local, ends_local)
  SELECT s, d, '09:00', '18:00' FROM unnest(ARRAY['${SELLER}', '${SELLER2}']::uuid[]) s, generate_series(0, 6) d
  ON CONFLICT DO NOTHING;`);

let pass = 0;
let fail = 0;
const ok = (cond, label) => { if (cond) pass++; else fail++; console.log(`${cond ? "PASS" : "FAIL"}  ${label}`); };
const svc = async (sql) => { try { return (await db.query(sql)).rows; } catch (e) { return { error: String(e.message ?? e), code: e.code }; } };
async function me(uid, sql) {
  try {
    await db.exec(`SET request.jwt.claim.sub = '${uid}'; SET ROLE authenticated;`);
    return (await db.query(sql)).rows;
  } catch (e) {
    return { error: String(e.message ?? e), code: e.code };
  } finally {
    await db.exec(`RESET ROLE; RESET request.jwt.claim.sub;`);
  }
}
const refused = (r, re) => !Array.isArray(r) && re.test(r.error);
const rows = (r) => (Array.isArray(r) ? r : []);
const one = (r) => (Array.isArray(r) && r[0] ? Object.values(r[0])[0] : undefined);
const I = (n) => `55555555-0000-0000-0000-${String(n).padStart(12, "0")}`;
// Tomorrow at <h>:00 Louisiana time.
const at = (h, days = 1) => `((date_trunc('day', now() AT TIME ZONE 'America/Chicago') + interval '${days} day ${h} hours') AT TIME ZONE 'America/Chicago')`;

/** A paid order: one item at `price`, bought, checked out, paid (card fee `fee`). */
async function paidOrder(n, buyer, seller, price, handover = "pickup_home", fee = 150) {
  await db.exec(liveItemSql({ id: I(n), seller, title: `Slice4 item ${n}`, price, floor: Math.min(price, 100) }));
  await me(buyer, `SELECT public.declutter_buy_now('${I(n)}', ${price})`);
  const o = (await me(buyer, `SELECT * FROM public.declutter_start_checkout('${seller}', '${handover}')`))[0];
  await svc(`SELECT public.declutter_mark_order_paid('${o?.order_id}', 'pi_s4_${n}', ${o?.total_cents}, now(), ${fee})`);
  return o ?? {};
}
const status = async (id) => one(await svc(`SELECT status FROM public.declutter_orders WHERE id = '${id}'`));
const book = (uid, id, ts) => me(uid, `SELECT public.declutter_book_pickup('${id}', ${ts}) AS r`);
// Move a booking's slot into the past by `mins` minutes (time passing).
const slotAgo = (id, mins) => svc(`UPDATE public.declutter_bookings SET slot_start = now() - interval '${mins} minutes',
  slot_end = now() - interval '${mins} minutes' + interval '30 minutes' WHERE order_id = '${id}'`);

// ---------------------------------------------------------------------------
// A. Booking + address (rows 14, 52, 98; B49, B56).
const A = await paidOrder(1, BUYER, SELLER, 4000);
ok(await status(A.order_id) === "paid", "setup: order A is paid ($40 + F1 fee $2.70)");
ok(refused(await book(OUTSIDER, A.order_id, at(12)), /item_not_found/), "a stranger cannot book someone else's pickup (not told it exists)");
ok(refused(await book(SELLER, A.order_id, at(12)), /not_booked_yet/), "the seller cannot book first: the buyer books");
ok(refused(await book(BUYER, A.order_id, at(3)), /invalid_slot/), "3 AM is outside the seller's pickup times");
ok(refused(await book(BUYER, A.order_id, at(12, 9)), /invalid_slot/), "a slot after the 7-day pickup deadline is refused");
ok(refused(await book(BUYER, A.order_id, `now() - interval '1 hour'`), /invalid_slot/), "a slot in the past is refused");
ok(one(await book(BUYER, A.order_id, at(12)))?.result === "booked", "the buyer books tomorrow noon");
ok(one(await book(BUYER, A.order_id, at(13)))?.result === "rescheduled", "the buyer may move it once");
ok(refused(await book(BUYER, A.order_id, at(14)), /reschedule_used/), "but not twice");
ok(one(await book(SELLER, A.order_id, at(15, 2)))?.result === "seller_rescheduled", "the seller may move it once too");
ok(refused(await book(SELLER, A.order_id, at(16, 2)), /reschedule_used/), "and not twice");
const addr = await me(BUYER, `SELECT pickup_address FROM public.declutter_item_address('${I(1)}')`);
ok(Array.isArray(addr) && /Example St/.test(addr[0]?.pickup_address ?? ""), "the PAID buyer sees the exact address (row 98)");
ok(refused(await me(BUYER2, `SELECT * FROM public.declutter_item_address('${I(1)}')`), /item_not_found/), "another member does not");
await svc(`UPDATE public.feature_switches SET audience = 'off' WHERE key = 'declutter'`);
const addrOff = await me(BUYER, `SELECT pickup_address FROM public.declutter_item_address('${I(1)}')`);
ok(Array.isArray(addrOff) && addrOff.length === 1, "with Declutter switched OFF the paid buyer still sees the address (row 62)");
const privOff = await me(SELLER, `SELECT pickup_address FROM public.declutter_seller_item_private('${I(1)}')`);
ok(Array.isArray(privOff) && privOff.length === 1, "and the seller still reads their private half for the agreed sale (row 62)");
const hOff = await me(BUYER, `SELECT public.declutter_my_handover('${A.order_id}') AS h`);
await svc(`UPDATE public.feature_switches SET audience = 'testers' WHERE key = 'declutter'`);

// B. Handover code (rows 25, 28, 93; B50, B52).
const hb = one(hOff);
const hs = one(await me(SELLER, `SELECT public.declutter_my_handover('${A.order_id}') AS h`));
ok(/^[0-9]{4}$/.test(hb?.code ?? "") && hb?.qr === `lhdeclutter:${A.order_id}:${hb?.code}`, "the buyer gets the 4-digit code and the QR payload (switch off too)");
ok(hs && hs.code == null && hs.qr == null, "the seller never gets the code");
ok(refused(await me(SELLER, `SELECT code FROM public.declutter_handovers`), /permission denied/),
  "no client role can read the handover table");
ok(refused(await me(BUYER, `SELECT public.declutter_confirm_handover('${A.order_id}', 'code', '${hb?.code}')`), /wrong_side/),
  "the buyer cannot 'scan' themself paid");
ok(refused(await me(SELLER, `SELECT public.declutter_confirm_handover('${A.order_id}', 'buyer', NULL)`), /wrong_side/),
  "the seller cannot tap \"I got it\"");
const wrong = hb?.code === "0000" ? "0001" : "0000";
const w1 = one(await me(SELLER, `SELECT public.declutter_confirm_handover('${A.order_id}', 'code', '${wrong}') AS r`));
ok(w1?.result === "wrong_code" && w1.attempts_left === 4, "a wrong code is refused and counted (4 tries left)");
const done = one(await me(SELLER, `SELECT public.declutter_confirm_handover('${A.order_id}', 'scan', '${hb?.code}') AS r`));
ok(done?.result === "handed_over", "scanning the buyer's QR completes the handover");
ok(await status(A.order_id) === "handed_over", "  the order is handed_over");
const pA = (await svc(`SELECT items_cents, debt_cents, amount_cents, status FROM public.declutter_payouts WHERE order_id = '${A.order_id}'`))[0];
ok(pA?.items_cents === 4000 && pA.debt_cents === 0 && pA.amount_cents === 4000 && pA.status === "pending",
  "  one payout row: the item price, $40.00, pending (row 22: seller keeps 100%)");
ok(one(await me(BUYER, `SELECT public.declutter_confirm_handover('${A.order_id}', 'buyer', NULL) AS r`))?.result === "already_handed_over",
  "a second confirmation is a no-op");
ok(Number(one(await svc(`SELECT count(*) FROM public.declutter_payouts WHERE order_id = '${A.order_id}'`))) === 1, "  still exactly one payout");
ok(refused(await me(BUYER, `SELECT public.declutter_report_problem('${A.order_id}', 'damaged', 'Broken leg', NULL)`), /sale_final/),
  "after the seller is paid a problem cannot be opened (row 96)");
ok(one(await svc(`SELECT status FROM public.declutter_items WHERE id = '${I(1)}'`)) === "completed", "  the item is completed");

// Five wrong codes lock the code (B52).
const L = await paidOrder(2, BUYER2, SELLER, 2000);
await book(BUYER2, L.order_id, at(12));
const codeL = one(await me(BUYER2, `SELECT public.declutter_my_handover('${L.order_id}') AS h`))?.code;
const wrongL = codeL === "0000" ? "0001" : "0000";
for (let i = 0; i < 5; i++) await me(SELLER, `SELECT public.declutter_confirm_handover('${L.order_id}', 'code', '${wrongL}')`);
ok(one(await me(SELLER, `SELECT public.declutter_confirm_handover('${L.order_id}', 'code', '${codeL}') AS r`))?.result === "code_locked",
  "after 5 wrong codes even the right code is refused (the count survives: returned, not raised)");
ok(one(await me(BUYER2, `SELECT public.declutter_confirm_handover('${L.order_id}', 'buyer', NULL) AS r`))?.result === "handed_over",
  "the buyer's \"I got it\" still completes it");

// C. Seller fee debt comes out of the payout (row 60, B43, B53).
const C = await paidOrder(3, BUYER3, SELLER, 3000, "pickup_home", 120);
await svc(`SELECT public.declutter_refund_paid_order('${C.order_id}', 'seller_backed_out')`);
const debt = Number(one(await svc(`SELECT remaining_cents FROM public.declutter_seller_fee_debts d JOIN public.declutter_refunds r ON r.id = d.refund_id WHERE r.order_id = '${C.order_id}'`)));
ok(debt === 120, "setup: the seller backed out of order C and owes its 120c card fee");
const D = await paidOrder(4, BUYER3, SELLER, 1000);
await me(BUYER3, `SELECT public.declutter_confirm_handover('${D.order_id}', 'buyer', NULL)`);
const pD = (await svc(`SELECT debt_cents, amount_cents FROM public.declutter_payouts WHERE order_id = '${D.order_id}'`))[0];
ok(pD?.debt_cents === 120 && pD.amount_cents === 880, "the next payout keeps back the 120c debt: $10.00 -> $8.80 sent");
ok(Number(one(await svc(`SELECT remaining_cents FROM public.declutter_seller_fee_debts d JOIN public.declutter_refunds r ON r.id = d.refund_id WHERE r.order_id = '${C.order_id}'`))) === 0,
  "  and the debt is paid off");

// D. Problems hold the money; admin decides (rows 15, 67, 96; B54).
const E = await paidOrder(5, BUYER, SELLER2, 5000);
await book(BUYER, E.order_id, at(12));
ok(refused(await me(BUYER, `SELECT public.declutter_report_problem('${E.order_id}', 'damaged', '   ', NULL)`), /note_required/), "a problem needs a note");
ok(refused(await me(BUYER, `SELECT public.declutter_report_problem('${E.order_id}', 'damaged', 'x', ARRAY['${BUYER}/declutter/problem/${E.order_id}/a.jpg'])`), /photo_not_uploaded/),
  "a problem photo must be uploaded to the caller's own folder");
await svc(`INSERT INTO storage.objects (bucket_id, name) VALUES ('job-photos', '${BUYER}/declutter/problem/${E.order_id}/a.jpg')`);
const prob = one(await me(BUYER, `SELECT public.declutter_report_problem('${E.order_id}', 'not_as_described', 'Table has a crack', ARRAY['${BUYER}/declutter/problem/${E.order_id}/a.jpg']) AS id`));
ok(/^[0-9a-f-]{36}$/.test(prob ?? ""), "the buyer reports a problem with a photo");
ok(one(await me(SELLER2, `SELECT public.declutter_report_problem('${E.order_id}', 'other', 'They are lying', NULL) AS id`)) === prob,
  "a second report while one is open returns the open one");
const codeE = one(await me(BUYER, `SELECT public.declutter_my_handover('${E.order_id}') AS h`))?.code;
ok(refused(await me(SELLER2, `SELECT public.declutter_confirm_handover('${E.order_id}', 'code', '${codeE}')`), /problem_open/),
  "an open problem blocks the handover");
await slotAgo(E.order_id, 60 * 25);
await svc(`SELECT public.declutter_handover_sweep()`);
ok(await status(E.order_id) === "paid", "  and the 24 h auto-pay (rows 26, 28)");
ok(refused(await me(SELLER2, `SELECT public.declutter_admin_decide_problem('${prob}', 'pay_seller', 'none', false, NULL)`), /not_authorized/),
  "only an admin decides");
ok(refused(await me(ADMIN, `SELECT public.declutter_admin_decide_problem('${prob}', 'refund_buyer', 'none', true, NULL)`), /invalid_decision/),
  "a strike needs someone at fault");
const dec = one(await me(ADMIN, `SELECT public.declutter_admin_decide_problem('${prob}', 'refund_buyer', 'seller', true, 'Crack is visible in photo') AS r`));
ok(dec?.result === "refund" && dec.reason === "not_as_described" && dec.fee_policy === "full_seller_pays_fee" && dec.refund_cents === E.total_cents,
  "admin: not as described -> the buyer gets ALL $" + ((E.total_cents ?? 0) / 100).toFixed(2) + " back, card fee to the seller (row 15)");
ok(Number(one(await svc(`SELECT count(*) FROM public.declutter_strikes WHERE user_id = '${SELLER2}' AND reason = 'not_as_described'`))) === 1,
  "  and the seller gets a strike");
ok(Number(one(await svc(`SELECT count(*) FROM public.declutter_payouts WHERE order_id = '${E.order_id}'`))) === 0, "  and nothing is paid out");
ok(Number(one(await svc(`SELECT count(*) FROM public.admin_audit_log WHERE action = 'declutter_problem_decided'`))) === 1, "  the decision is audit-logged");

const F = await paidOrder(6, BUYER2, SELLER2, 2500);
const probF = one(await me(SELLER2, `SELECT public.declutter_report_problem('${F.order_id}', 'other', 'Buyer wants to change price', NULL) AS id`));
ok(one(await me(ADMIN, `SELECT public.declutter_admin_decide_problem('${probF}', 'pay_seller', 'buyer', false, NULL) AS r`))?.result === "handed_over",
  "admin 'pay the seller' completes the handover");
ok(one(await svc(`SELECT confirmed_by FROM public.declutter_handovers WHERE order_id = '${F.order_id}'`)) === "admin", "  recorded as admin");
// Review fixes 2026-10-15 (lh-money-escrow 2.5/2.6, lh-authz-rls 2.3/2.4).
const AO = await paidOrder(21, BUYER2, ADMIN, 1800);
const probA = one(await me(BUYER2, `SELECT public.declutter_report_problem('${AO.order_id}', 'other', 'Admin is the seller here', NULL) AS id`));
const rA = await me(ADMIN, `SELECT public.declutter_admin_decide_problem('${probA}', 'pay_seller', 'none', false, NULL)`);
ok(refused(rA, /not_authorized/),
  "an admin cannot decide a problem on their own sale");
const NF = await paidOrder(22, BUYER3, SELLER2, 3000, "pickup_home", 150);
const probNF = one(await me(BUYER3, `SELECT public.declutter_report_problem('${NF.order_id}', 'other', 'Not sure', NULL) AS id`));
const decNF = one(await me(ADMIN, `SELECT public.declutter_admin_decide_problem('${probNF}', 'refund_buyer', 'none', false, NULL) AS r`));
ok(decNF?.reason === "admin_no_fault" && decNF.refund_cents === NF.total_cents - 150,
  `admin, nobody's fault: the payment back MINUS the card fee (${decNF?.refund_cents} = ${NF.total_cents} - 150; never absorb, row 100)`);
const BF = await paidOrder(23, BUYER3, SELLER2, 2600);
const probBF = one(await me(SELLER2, `SELECT public.declutter_report_problem('${BF.order_id}', 'other', 'Buyer changed mind', NULL) AS id`));
const decBF = one(await me(ADMIN, `SELECT public.declutter_admin_decide_problem('${probBF}', 'refund_buyer', 'buyer', false, NULL) AS r`));
ok(decBF?.reason === "admin_buyer_fault" && decBF.refund_cents === 2600, `admin, the buyer's fault: EXACTLY the item price back (${decBF?.refund_cents})`);
ok(refused(await me(BUYER, `SELECT decided_by FROM public.declutter_problems`), /permission denied/), "members never read which admin decided");
ok(Array.isArray(await me(BUYER, `SELECT decision, fault, admin_note FROM public.declutter_problems`)), "  but they read the decision itself");

// E. No-shows (rows 94, 95, 19; B55).
const G = await paidOrder(7, BUYER, SELLER, 6000);
await book(BUYER, G.order_id, at(12));
ok(refused(await me(SELLER, `SELECT public.declutter_report_no_show('${G.order_id}')`), /too_early/), "\"They didn't show\" is not offered before the booked time + 15 min");
await slotAgo(G.order_id, 10);
ok(refused(await me(SELLER, `SELECT public.declutter_report_no_show('${G.order_id}')`), /too_early/), "  nor at +10 min");
await slotAgo(G.order_id, 16);
ok(one(await me(SELLER, `SELECT public.declutter_report_no_show('${G.order_id}') AS r`))?.result === "buyer_may_rebook",
  "the buyer's first miss: they may rebook once (row 95)");
ok(Number(one(await svc(`SELECT count(*) FROM public.declutter_strikes WHERE user_id = '${BUYER}' AND reason = 'not_picked_up'`))) === 0, "  no strike yet");
ok(one(await book(BUYER, G.order_id, at(12, 2)))?.result === "rebooked", "the buyer rebooks");
await slotAgo(G.order_id, 20);
const g2 = one(await me(SELLER, `SELECT public.declutter_report_no_show('${G.order_id}') AS r`));
ok(g2?.reason === "buyer_no_show" && g2.refund_cents === 6000,
  "second miss: refund of EXACTLY the item price, $60.00 (buyer's fee kept; owner, row 95)");
const rG = (await svc(`SELECT paid_cents, kept_cents, refund_cents, fee_policy FROM public.declutter_refunds WHERE order_id = '${G.order_id}'`))[0];
ok(rG?.paid_cents === G.total_cents && rG.kept_cents === G.premium_cents && rG.fee_policy === "keep_buyer_fee",
  `  kept = the buyer's fee, ${G.premium_cents}c`);
ok(Number(one(await svc(`SELECT count(*) FROM public.declutter_strikes WHERE user_id = '${BUYER}' AND reason = 'not_picked_up'`))) === 1, "  1 buyer strike");
// Money review 2.7 + 2.4: a buyer no-show keeps the buyer's fee ONLY; sales tax goes back with the price
// (a refunded sale owes no tax; tax is not a fee). Today every order's tax is 0, so a taxed order is planted
// with the amounts-frozen trigger briefly off, then closed through the real path.
const TX = await paidOrder(33, BUYER2, SELLER2, 2000);
await db.exec(`ALTER TABLE public.declutter_orders DISABLE TRIGGER trg_declutter_orders_amounts_frozen;
           UPDATE public.declutter_orders SET tax_cents = 190, total_cents = total_cents + 190 WHERE id = '${TX.order_id}';
           ALTER TABLE public.declutter_orders ENABLE TRIGGER trg_declutter_orders_amounts_frozen;`);
ok(Number(one(await svc(`SELECT tax_cents FROM public.declutter_orders WHERE id = '${TX.order_id}'`))) === 190, "  (setup: the planted order carries $1.90 tax)");
const tx = one(await svc(`SELECT public.declutter_close_paid_order('${TX.order_id}', 'buyer_no_show', 'buyer', 'not_picked_up', 'test') AS r`));
const rTX = (await svc(`SELECT kept_cents, refund_cents FROM public.declutter_refunds WHERE order_id = '${TX.order_id}'`))[0];
ok(rTX?.kept_cents === TX.premium_cents && rTX?.refund_cents === 2000 + 190 && tx?.refund_cents === 2190,
  `a taxed buyer no-show refunds the price + its tax ($21.90) and keeps only the buyer's fee (${JSON.stringify(rTX)})`);
const txMsg = String(one(await svc(`SELECT message FROM public.notifications WHERE user_id = '${BUYER2}' AND title = 'Refund on its way' ORDER BY created_at DESC LIMIT 1`)) ?? "");
ok(/^The item price and its tax, \$21\.90, is coming back to your card\. Your buyer's fee is not refunded\.$/.test(txMsg),
  `  the buyer is told in the second person ("Your buyer's fee"): ${txMsg}`);
ok(one(await svc(`SELECT status FROM public.declutter_items WHERE id = '${I(7)}'`)) === "live", "  the item is back on sale, free");

const H = await paidOrder(8, BUYER2, SELLER, 3000, "pickup_home", 117);
await book(BUYER2, H.order_id, at(12));
await slotAgo(H.order_id, 16);
const h2 = one(await me(BUYER2, `SELECT public.declutter_report_no_show('${H.order_id}') AS r`));
ok(h2?.reason === "seller_no_show" && h2.refund_cents === H.total_cents, "seller no-show: the buyer gets everything back (row 19)");
ok(Number(one(await svc(`SELECT count(*) FROM public.declutter_strikes WHERE user_id = '${SELLER}' AND reason = 'seller_no_show'`))) === 1, "  1 seller strike");
ok(Number(one(await svc(`SELECT sum(remaining_cents) FROM public.declutter_seller_fee_debts WHERE seller_id = '${SELLER}'`))) === 117,
  "  and the 117c card fee becomes the seller's debt (row 60)");
ok(refused(await me(BUYER2, `SELECT public.declutter_confirm_handover('${H.order_id}', 'buyer', NULL)`), /order_not_paid/),
  "a refunded sale can never be handed over (one transition out of paid)");
ok(Number(one(await svc(`SELECT count(*) FROM public.declutter_payouts WHERE order_id = '${H.order_id}'`))) === 0, "  and is never paid out");

// F. The sweep (B57).
const J = await paidOrder(9, BUYER3, SELLER2, 1500);
await svc(`UPDATE public.declutter_orders SET paid_at = now() - interval '7 days 1 minute' WHERE id = '${J.order_id}'`);
const K = await paidOrder(10, BUYER3, SELLER2, 1200);
await book(BUYER3, K.order_id, at(12));
await slotAgo(K.order_id, 60 * 23);
const sw = one(await svc(`SELECT public.declutter_handover_sweep() AS r`));
ok(await status(J.order_id) === "refunded" && sw?.not_picked_up === 1, "never booked in 7 days: buyer no-show (rows 18, 95)");
ok(Number(one(await svc(`SELECT refund_cents FROM public.declutter_refunds WHERE order_id = '${J.order_id}'`))) === 1500, "  refund = the item price, $15.00");
ok(await status(K.order_id) === "paid", "23 h after the booked time: not auto-paid yet");
await slotAgo(K.order_id, 60 * 24 + 1);
await svc(`SELECT public.declutter_handover_sweep()`);
ok(await status(K.order_id) === "handed_over" && one(await svc(`SELECT confirmed_by FROM public.declutter_handovers WHERE order_id = '${K.order_id}'`)) === "auto",
  "24 h after the booked time: auto-paid (row 28)");

// G. Porch pickup (rows 26, 97).
const P = await paidOrder(11, BUYER, SELLER2, 2200, "porch");
await book(BUYER, P.order_id, at(12));
ok(refused(await me(SELLER2, `SELECT public.declutter_set_porch_time('${P.order_id}', 'until', ${at(11)})`), /invalid_porch_time/),
  "\"out until\" must be after the booked time");
ok(Array.isArray(await me(SELLER2, `SELECT public.declutter_set_porch_time('${P.order_id}', 'until', ${at(17)})`)), "the seller is out until 5 PM");
const sp = `${SELLER2}/declutter/handover/${P.order_id}/out.jpg`;
const bp = `${BUYER}/declutter/handover/${P.order_id}/got.jpg`;
await svc(`INSERT INTO storage.objects (bucket_id, name) VALUES ('job-photos', '${sp}'), ('job-photos', '${bp}')`);
ok(refused(await me(SELLER2, `SELECT public.declutter_porch_photo('${P.order_id}', '${bp}', NULL, NULL)`), /photo_not_uploaded/),
  "the seller cannot use the buyer's photo");
ok(one(await me(SELLER2, `SELECT public.declutter_porch_photo('${P.order_id}', '${sp}', NULL, NULL) AS r`))?.result === "set_out", "the seller posts the set-out photo");
await slotAgo(P.order_id, 20);
ok(refused(await me(BUYER, `SELECT public.declutter_report_no_show('${P.order_id}')`), /seller_set_out/),
  "the buyer cannot call the seller a no-show once the item was set out");
ok(refused(await me(BUYER, `SELECT public.declutter_porch_photo('${P.order_id}', '${bp}', 30.46, -91.15)`), /not_at_pickup/),
  "a \"picked up\" photo ~1 km away is refused");
const pu = one(await me(BUYER, `SELECT public.declutter_porch_photo('${P.order_id}', '${bp}', 30.4513, -91.1543) AS r`));
ok(pu?.result === "picked_up" && pu.distance_m <= 200, `a "picked up" photo at the address is recorded (${pu?.distance_m} m)`);
// Owner 2026-10-15: the buyer's "Picked up" photo + tap PAYS THE SELLER RIGHT AWAY
// (same as "I got it"); the 24 h auto-pay only covers buyers who never tap.
ok(pu?.paid === true && pu?.payout_id, "  and it pays the seller right away (owner 2026-10-15)");
ok(await status(P.order_id) === "handed_over", "  the porch order is handed over at once (no 24 h wait)");
ok(one(await svc(`SELECT confirmed_by FROM public.declutter_handovers WHERE order_id = '${P.order_id}'`)) === "porch",
  "  the handover records it was confirmed by the porch photo");
ok(Number(one(await svc(`SELECT count(*) FROM public.declutter_payouts WHERE order_id = '${P.order_id}' AND items_cents = 2200`))) === 1,
  "  one payout row for the item price");
ok(one(await me(BUYER, `SELECT public.declutter_porch_photo('${P.order_id}', '${bp}', 30.4513, -91.1543) AS r`))?.result === "already_handed_over",
  "  a second tap pays nothing more");
// lh-authz-rls review of session 3 (should-fix 2): the exact address is for the PAID buyer only, not after the
// handover and not after a refund.
ok(refused(await me(BUYER, `SELECT * FROM public.declutter_item_address('${I(11)}')`), /item_not_found/),
  "  after the handover the buyer no longer reads the exact address");
ok(refused(await me(BUYER2, `SELECT * FROM public.declutter_item_address('${I(8)}')`), /item_not_found/),
  "a buyer whose order was refunded (seller no-show) does not read the exact address");
ok(Number(one(await svc(`SELECT count(*) FROM public.declutter_payouts WHERE order_id = '${P.order_id}'`))) === 1, "  still one payout row");
ok(refused(await me(SELLER2, `SELECT public.declutter_report_no_show('${P.order_id}')`), /already_picked_up|order_not_paid/), "the seller cannot call it a no-show after pickup");
// Prod's job-photos bucket is public (readable); without a read policy a DELETE sees no rows and proves nothing.
await svc(`DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'proof: objects readable') THEN
  CREATE POLICY "proof: objects readable" ON storage.objects FOR SELECT TO authenticated USING (true); END IF; END $$`);
const del = await me(BUYER, `DELETE FROM storage.objects WHERE bucket_id = 'job-photos' AND name = '${bp}' RETURNING name`);
ok(Array.isArray(del) && del.length === 0 && Number(one(await svc(`SELECT count(*) FROM storage.objects WHERE name = '${bp}'`))) === 1,
  "the buyer cannot delete their \"picked up\" evidence photo (lh-authz-rls 2.2)");
// An open problem still holds the money: the photo is kept, nobody is paid.
const P2 = await paidOrder(12, BUYER2, SELLER2, 1500, "porch");
await book(BUYER2, P2.order_id, at(13));
const bp2 = `${BUYER2}/declutter/handover/${P2.order_id}/got.jpg`;
await svc(`INSERT INTO storage.objects (bucket_id, name) VALUES ('job-photos', '${bp2}')`);
await svc(`INSERT INTO public.declutter_problems (order_id, reporter_id, reporter_side, reason, note)
           VALUES ('${P2.order_id}', '${SELLER2}', 'seller', 'other', 'planted open problem')`);
const pu2 = one(await me(BUYER2, `SELECT public.declutter_porch_photo('${P2.order_id}', '${bp2}', 30.4513, -91.1543) AS r`));
ok(pu2?.result === "picked_up" && pu2?.paid === false && await status(P2.order_id) === "paid",
  "with a problem open the \"picked up\" photo is kept but the seller is not paid (admin decides)");
ok(Number(one(await svc(`SELECT count(*) FROM public.declutter_payouts WHERE order_id = '${P2.order_id}'`))) === 0, "  no payout row");

// A multi-item porch order whose items sit at two addresses ~5.5 km apart (authz review 2.7): the
// "picked up" photo counts at EITHER item's pickup point. The test stands at the item that is NOT the
// order's first cart line (the one the old code measured), so it is red on the first-item-only code.
await db.exec(liveItemSql({ id: I(31), seller: SELLER2, title: "Porch lamp", price: 900, floor: 100 }));
await db.exec(liveItemSql({ id: I(32), seller: SELLER2, title: "Porch rug", price: 700, floor: 100 }));
await svc(`UPDATE public.declutter_item_private SET pickup_address = '9 Far Rd, Baton Rouge, LA 70810', pickup_lat = 30.401234, pickup_lng = -91.154321
           WHERE item_id = '${I(32)}'`);
await me(BUYER3, `SELECT public.declutter_buy_now('${I(31)}', 900)`);
await me(BUYER3, `SELECT public.declutter_buy_now('${I(32)}', 700)`);
const PM = (await me(BUYER3, `SELECT * FROM public.declutter_start_checkout('${SELLER2}', 'porch')`))[0] ?? {};
await svc(`SELECT public.declutter_mark_order_paid('${PM.order_id}', 'pi_s4_pm', ${PM.total_cents}, now(), 150)`);
ok(Number(one(await svc(`SELECT count(*) FROM public.declutter_cart_items WHERE order_id = '${PM.order_id}'`))) === 2,
  "setup: a paid 2-item porch order (items at two addresses)");
await book(BUYER3, PM.order_id, at(14));
const firstItem = one(await svc(`SELECT item_id FROM public.declutter_cart_items WHERE order_id = '${PM.order_id}' ORDER BY id LIMIT 1`));
const otherPt = firstItem === I(31) ? "30.4013, -91.1543" : "30.4513, -91.1543";
const bpm = `${BUYER3}/declutter/handover/${PM.order_id}/got.jpg`;
await svc(`INSERT INTO storage.objects (bucket_id, name) VALUES ('job-photos', '${bpm}')`);
// lh-authz-rls review of session 3 (should-fix 2): a point near neither of the order's items is refused.
ok(refused(await me(BUYER3, `SELECT public.declutter_porch_photo('${PM.order_id}', '${bpm}', 30.30, -91.00)`), /not_at_pickup/),
  "a \"picked up\" photo far from every item in the order is refused");
const pum = one(await me(BUYER3, `SELECT public.declutter_porch_photo('${PM.order_id}', '${bpm}', ${otherPt}) AS r`));
ok(pum?.result === "picked_up" && pum.distance_m <= 200,
  `a multi-item porch pickup counts at the second item's address too (${pum?.distance_m ?? JSON.stringify(pum)} m)`);

// H. Reviews (row 45; B58).
ok(refused(await me(BUYER2, `SELECT public.declutter_leave_review('${H.order_id}', 5, NULL)`), /not_handed_over/), "no review on a refunded sale");
const rv1 = one(await me(BUYER, `SELECT public.declutter_leave_review('${A.order_id}', 5, 'Great chair') AS id`));
ok(/^[0-9a-f-]{36}$/.test(rv1 ?? ""), "the buyer reviews the seller after handover");
ok(refused(await me(BUYER, `SELECT public.declutter_leave_review('${A.order_id}', 4, NULL)`), /already_reviewed/), "once");
ok(refused(await me(SELLER, `SELECT public.declutter_leave_review('${A.order_id}', 5, 'call me 225-555-0199')`), /review_contact_info/),
  "the contact-leak rule applies to review text");
const hidden = await me(OUTSIDER, `SELECT * FROM public.declutter_visible_reviews('${SELLER}')`);
ok(Array.isArray(hidden) && hidden.length === 0, "a one-sided review stays hidden from others (blind period)");
await me(SELLER, `SELECT public.declutter_leave_review('${A.order_id}', 5, 'Easy pickup')`);
const shown = await me(OUTSIDER, `SELECT stars FROM public.declutter_visible_reviews('${SELLER}')`);
ok(Array.isArray(shown) && shown.length === 1 && shown[0].stars === 5, "both reviewed: visible");
ok(refused(await me(BUYER, `SELECT * FROM public.declutter_reviews`), /permission denied/), "no client reads the reviews table directly");

// I. Money queues (B53, B57).
const due = await svc(`SELECT payout_id, amount_cents FROM public.declutter_payouts_due(50)`);
ok(Array.isArray(due) && due.length >= 3 && due.every((d) => d.amount_cents > 0), `payouts due: ${due.length} rows, none for 0 cents`);
ok(refused(await svc(`SELECT public.declutter_payout_executed('${due[0]?.payout_id}', 'po_x', true, NULL)`), /invalid_transfer/),
  "a payout cannot be marked sent without a Stripe transfer id");
ok(one(await svc(`SELECT public.declutter_payout_executed('${due[0]?.payout_id}', NULL, false, 'account not ready') AS s`)) === "failed", "a failed transfer is recorded");
ok(!rows(await svc(`SELECT payout_id FROM public.declutter_payouts_due(50)`)).some((d) => d.payout_id === due[0]?.payout_id), "  and backs off");
await svc(`UPDATE public.declutter_payouts SET next_attempt_at = now() WHERE id = '${due[0]?.payout_id}'`);
ok(one(await svc(`SELECT public.declutter_payout_executed('${due[0]?.payout_id}', 'tr_ok1', true, NULL) AS s`)) === "succeeded", "the retry succeeds");
ok(one(await svc(`SELECT public.declutter_payout_executed('${due[0]?.payout_id}', NULL, false, 'late') AS s`)) === "succeeded", "  and a late failure cannot undo it");
const rf = one(await svc(`SELECT id FROM public.declutter_refunds WHERE order_id = '${G.order_id}'`));
await svc(`UPDATE public.declutter_refunds SET created_at = now() - interval '5 minutes' WHERE id = '${rf}'`);
ok(rows(await svc(`SELECT refund_id FROM public.declutter_refunds_due(50)`)).some((d) => d.refund_id === rf), "a pending refund older than 2 min is due");
await svc(`SELECT public.declutter_refund_executed('${rf}', NULL, false)`);
ok(!rows(await svc(`SELECT refund_id FROM public.declutter_refunds_due(50)`)).some((d) => d.refund_id === rf), "a failed refund backs off");
await svc(`UPDATE public.declutter_refunds SET next_attempt_at = now() - interval '1 second' WHERE id = '${rf}'`);
ok(rows(await svc(`SELECT refund_id FROM public.declutter_refunds_due(50)`)).some((d) => d.refund_id === rf), "  then is retried");
// Money review 3.6: the payment's Stripe mode is stored on the refund row, set once, and the queue returns it.
ok(one(await svc(`SELECT public.declutter_refund_set_mode('${rf}', false) AS m`)) === false, "the refund row records the payment's Stripe mode (test)");
ok(refused(await svc(`SELECT public.declutter_refund_set_mode('${rf}', true)`), /refund_mode_conflict/), "  once: the other mode is refused, never rewritten");
ok(rows(await svc(`SELECT refund_id, livemode FROM public.declutter_refunds_due(50)`)).some((d) => d.refund_id === rf && d.livemode === false),
  "  and the refund queue hands it to declutter-money");
// charge.refund.updated: a refund Stripe took and later failed reopens the row (only the recorded refund does).
await svc(`SELECT public.declutter_refund_executed('${rf}', 're_took1', true)`);
ok(one(await svc(`SELECT public.declutter_refund_reversed('${rf}', 're_other', 'failed') AS r`)) === "unchanged",
  "a late failure of a refund the row did not record changes nothing");
ok(one(await svc(`SELECT public.declutter_refund_reversed('${rf}', 're_took1', 'failed') AS r`)) === "reopened",
  "Stripe failing the recorded refund reopens the row");
ok(rows(await svc(`SELECT refund_id FROM public.declutter_refunds_due(50)`)).some((d) => d.refund_id === rf),
  "  and it is due again at once (a NEW refund is sent)");
ok(one(await svc(`SELECT public.declutter_refund_reversed('${rf}', 're_took1', 'failed') AS r`)) === "unchanged", "  a redelivered event does it once");
// lh-money-escrow re-review should-fix 1: a reversal COUNTS as a try (a refund Stripe keeps failing must not loop
// forever); when it reaches the 12-try cap the queue stops offering the row and the answer says 'gave_up', so the
// page asks for a refund by hand instead of promising a new one.
ok(one(await svc(`SELECT attempts FROM public.declutter_refunds WHERE id = '${rf}'`)) === 2, "  the reversal counted as a try (1 failure + 1 reversal)");
await svc(`UPDATE public.declutter_refunds SET attempts = 11 WHERE id = '${rf}'`);
await svc(`SELECT public.declutter_refund_executed('${rf}', 're_took12', true)`);
ok(one(await svc(`SELECT public.declutter_refund_reversed('${rf}', 're_took12', 'failed') AS r`)) === "gave_up",
  "Stripe failing a refund that succeeded on the row's 12th try answers 'gave_up' (refund it by hand), never 'reopened'");
ok(!rows(await svc(`SELECT refund_id FROM public.declutter_refunds_due(50)`)).some((d) => d.refund_id === rf),
  "  and the queue does not offer it again");
// Should-fix 3: the queue hands declutter-money the order's Checkout Session id, whose prefix names the payment's mode.
await svc(`UPDATE public.declutter_orders SET stripe_checkout_session_id = 'cs_test_s4G' WHERE id = '${G.order_id}'`);
await svc(`UPDATE public.declutter_refunds SET attempts = 3 WHERE id = '${rf}'`);
ok(rows(await svc(`SELECT refund_id, checkout_session_id FROM public.declutter_refunds_due(50)`)).some((d) => d.refund_id === rf && d.checkout_session_id === "cs_test_s4G"),
  "the refund queue returns the order's Checkout Session id (its mode when none was recorded)");
// Should-fix 2: the webhook builds the refund's metadata from the ROW (like declutter-money): the answer carries the
// row's order_id, NULL for an order_missing row (whatever order the Checkout page named).
ok(one(await svc(`SELECT public.declutter_refund_answer('${rf}') ->> 'order_id' AS o`)) === G.order_id, "the refund answer carries the row's order_id");
const orphan = one(await svc(`SELECT public.declutter_record_refund(NULL, 'pi_s4_orphan', 'order_missing', 4600, 150) AS id`));
const orphanAnswer = one(await svc(`SELECT public.declutter_refund_answer('${orphan}') AS a`));
ok(orphan && orphanAnswer && "order_id" in orphanAnswer && orphanAnswer.order_id === null, "  and null for an order_missing row");
ok(refused(await me(BUYER, `SELECT public.declutter_refund_reversed('${rf}', 're_took1', 'x')`), /permission denied/) &&
   refused(await me(BUYER, `SELECT public.declutter_refund_set_mode('${rf}', true)`), /permission denied/) &&
   refused(await me(BUYER, `SELECT public.declutter_refund_answer('${rf}')`), /permission denied/), "  members can call none of them (reversed, set_mode, answer)");

// J. The table holds every refund to its reason.
ok(refused(await svc(`INSERT INTO public.declutter_refunds (stripe_payment_intent_id, reason, fee_policy, paid_cents, card_fee_cents, kept_cents, refund_cents)
                      VALUES ('pi_plant1', 'buyer_no_show', 'keep_buyer_fee', 4270, 150, 0, 4270)`), /declutter_refunds_amount/),
  "a buyer no-show refund cannot be the full payment");
ok(refused(await svc(`INSERT INTO public.declutter_refunds (stripe_payment_intent_id, reason, fee_policy, paid_cents, card_fee_cents, kept_cents, refund_cents)
                      VALUES ('pi_plant2', 'seller_no_show', 'keep_card_fee', 4270, 150, 0, 4120)`), /declutter_refunds_policy/),
  "a seller no-show cannot keep the buyer's card fee");

// K0. The handover code comes from a strong random source (authz review 2.6): never random().
const codeDef = String(one(await svc(`SELECT pg_get_functiondef('public.declutter_new_handover_code()'::regprocedure) AS d`)) ?? "");
ok(/gen_random_uuid\(\)/.test(codeDef) && !/\brandom\(\)/.test(codeDef.replace(/gen_random_uuid\(\)/g, "")),
  "the 4-digit handover code is drawn from gen_random_uuid(), not random()");
const codes = (await svc(`SELECT public.declutter_new_handover_code() AS c FROM generate_series(1, 4000)`)).map((r) => r.c);
ok(codes.every((c) => /^[0-9]{4}$/.test(c)) && new Set(codes.map((c) => c[0])).size === 10 && codes.some((c) => c.startsWith("0")),
  "  and every code is 4 digits, zero-padded, across all leading digits (4000 draws)");

// K. Grants: internals are service only; anon reaches nothing.
for (const fn of ["declutter_complete_handover('00000000-0000-0000-0000-000000000000', 'buyer')",
                  "declutter_close_paid_order('00000000-0000-0000-0000-000000000000', 'buyer_no_show', NULL, NULL, NULL)",
                  "declutter_handover_sweep()", "declutter_payouts_due(1)", "declutter_refunds_due(1)",
                  "declutter_payout_executed('00000000-0000-0000-0000-000000000000', NULL, false, NULL)"]) {
  ok(refused(await me(BUYER, `SELECT public.${fn}`), /permission denied/), `members cannot call ${fn.split("(")[0]}`);
}
ok(refused(await db.query(`SET ROLE anon`).then(() => db.query(`SELECT public.declutter_book_pickup('${A.order_id}', now())`)).then((r) => r.rows, (e) => ({ error: String(e.message) })).finally(() => db.exec("RESET ROLE")), /permission denied/),
  "anon cannot call the member RPCs (REVOKE ... FROM PUBLIC, anon)");

console.log(`\n${pass} passed, ${fail} failed${skip ? " (NEW_MIGRATION=skip: RED baseline)" : ""}`);
process.exit(fail ? 1 : 0);
