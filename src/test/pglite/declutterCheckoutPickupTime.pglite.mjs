#!/usr/bin/env node
/**
 * PGlite proof for 20261101191500_declutter_checkout_pickup_time (B110, owner 11-01; lead 1:14 PM time format):
 *   1. declutter_start_checkout keeps a pickup time for porch / pickup_home / meetup: refused when past, over 7 days
 *      out, or outside the seller's hours (and then no order is left); stored on the order (porch: a 2-hour window,
 *      cut at the window's end; a door pickup: 30 minutes); the same time hands back the same order, a new time
 *      opens a new one; no time keeps the old path.
 *   2. declutter_mark_order_paid books the chosen time (declutter_bookings + handover code) and the seller's
 *      "Buyer paid" notice carries it; an order with no time books nothing.
 *   3. declutter_take_item's accepted-offer notice says who accepted it and what to do next.
 *
 *   node src/test/pglite/declutterCheckoutPickupTime.pglite.mjs                    # GREEN
 *   NEW_MIGRATION=skip node src/test/pglite/declutterCheckoutPickupTime.pglite.mjs # RED: without it
 *   MIGRATION_PATH=<planted copy> node ...                                         # RED on a planted defect
 */
import { readFileSync } from "node:fs";
import { buildHandoverWorld, MIG_DIR } from "../../../scripts/declutter/handoverPhotoWorld.mjs";

const NEW_FILE = "20261101191500_declutter_checkout_pickup_time.sql";
const BASES = [
  "20261027211754_declutter_bundle_discount.sql",
  "20261028171944_declutter_notice_copy.sql",
  "20261028195840_declutter_pickup_window_reads.sql",
  "20261028200440_declutter_audit3_notices_and_empty_cart.sql",
  "20261028210552_declutter_sale_notices_name_inline.sql",
  "20261028225038_declutter_porch_pick_a_day.sql",
  "20261028235247_declutter_handover_choices.sql",
  "20261028235709_declutter_handover_photos_at_the_address.sql",
  "20261029002010_declutter_handover_photos_live_only.sql",
  "20261029161347_declutter_porch_weekdays.sql",
  "20261029201542_declutter_porch_photo_not_before_the_day.sql",
  "20261030164712_declutter_porch_places.sql",
  "20261031145652_declutter_place_hours.sql",
  "20261031164337_declutter_door_pickup_uses_places.sql",
  "20261031163021_declutter_porch_next_step_is_a_time.sql",
  "20261031171727_declutter_porch_days_without_places.sql",
  "20261101030040_declutter_buy_now_30_minutes.sql",
  "20261101032626_declutter_checkout_page_inside_hold.sql",
];
const skip = process.env.NEW_MIGRATION === "skip";
if (skip) console.log("NEW_MIGRATION=skip: running WITHOUT the new migration (expect FAILs)");
const { svc, run, one, me, refused, liveItemSql, USERS } = await buildHandoverWorld();
const { SELLER2, BUYER, BUYER2, BUYER3 } = USERS;

let pass = 0;
let fail = 0;
const ok = (cond, label) => { if (cond) pass++; else fail++; console.log(`${cond ? "PASS" : "FAIL"}  ${label}`); };
const short = (r) => JSON.stringify(r)?.slice(0, 260);

await svc(`ALTER TABLE public.declutter_items ADD COLUMN IF NOT EXISTS seller_hidden boolean NOT NULL DEFAULT false`);
for (const f of BASES) {
  const r = await run(readFileSync(`${MIG_DIR}${f}`, "utf8"));
  ok(!r?.error, `base ${f} applies${r?.error ? `: ${r.error}` : ""}`);
}
if (!skip) {
  const sql = readFileSync(process.env.MIGRATION_PATH ?? `${MIG_DIR}${NEW_FILE}`, "utf8");
  for (let i = 0; i < 3; i++) {
    const r = await run(sql);
    ok(!r?.error, `the migration applies (run ${i + 1} of 3)${r?.error ? `: ${r.error}` : ""}`);
  }
}
const acl = one(await svc(`SELECT has_function_privilege('authenticated', 'public.declutter_start_checkout(uuid, text, timestamptz, text)', 'EXECUTE')
  AND NOT has_function_privilege('anon', 'public.declutter_start_checkout(uuid, text, timestamptz, text)', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'public.declutter_checkout_pickup_end(uuid, uuid, text, timestamptz)', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'public.declutter_pickup_time_words(uuid)', 'EXECUTE')`));
ok(acl === true, `grants: start_checkout for signed-in members only; both helpers service_role only (got ${short(acl)})`);

// The seller's pickup times: every day 9 AM-5 PM, Chicago.
await svc(`INSERT INTO public.declutter_pickup_windows (seller_id, weekday, starts_local, ends_local)
  SELECT '${SELLER2}', d, '09:00', '17:00' FROM generate_series(0, 6) d ON CONFLICT DO NOTHING`);
await svc(`UPDATE public.profiles SET full_name = 'Dana Seller' WHERE user_id = '${SELLER2}'`);
const at = (days, hhmm) => `((now() AT TIME ZONE 'America/Chicago')::date + ${days} + time '${hhmm}') AT TIME ZONE 'America/Chicago'`;
const iso = async (expr) => one(await svc(`SELECT to_char((${expr}) AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')`));

const I = (n) => `cdcdcdcd-0000-0000-0000-${String(n).padStart(12, "0")}`;
const hold = async (n, buyer, price) => {
  await run(liveItemSql({ id: I(n), seller: SELLER2, title: `Time item ${n}`, price, floor: 100 }));
  await svc(`UPDATE public.declutter_items SET status = 'reserved' WHERE id = '${I(n)}'`);
  return svc(`INSERT INTO public.declutter_cart_items (item_id, buyer_id, seller_id, price_cents, source, status, checkout_by)
    VALUES ('${I(n)}', '${buyer}', '${SELLER2}', ${price}, 'buy', 'in_cart', now() + interval '30 minutes') RETURNING id`);
};
const checkout = (buyer, way, slotIso) =>
  me(buyer, `SELECT * FROM public.declutter_start_checkout('${SELLER2}', '${way}'${slotIso ? `, '${slotIso}'::timestamptz` : ""})`);
const openOrder = async (buyer) => (await svc(`SELECT id, pickup_slot_start, pickup_slot_end, total_cents, setup_fee_cents FROM public.declutter_orders
  WHERE buyer_id = '${buyer}' AND seller_id = '${SELLER2}' AND status = 'awaiting_payment'`))?.[0] ?? null;
const sameInstant = (a, b) => a && b && Date.parse(a) === Date.parse(b);

// 1. A door pickup tomorrow at 3 PM.
ok(Array.isArray(await hold(1, BUYER, 2000)), "fixture: item 1 held for the buyer");
const t15 = await iso(at(1, "15:00"));
const t1530 = await iso(at(1, "15:30"));
const off = await checkout(BUYER, "pickup_home", await iso(at(1, "20:00")));
ok(refused(off, /invalid_slot/), `outside the seller's hours (8 PM): refused (${short(off)})`);
ok(!(await openOrder(BUYER)), "  and no order is left");
const past = await checkout(BUYER, "pickup_home", await iso(at(-1, "15:00")));
ok(refused(past, /invalid_slot/), `a time already past (yesterday 3 PM, inside the hours): refused (${short(past)})`);
const far = await checkout(BUYER, "pickup_home", await iso(at(8, "10:00")));
ok(refused(far, /invalid_slot/), `8 days out (past the 7-day deadline): refused (${short(far)})`);
const home = await checkout(BUYER, "pickup_home", t15);
const o1 = await openOrder(BUYER);
ok(Array.isArray(home) && sameInstant(o1?.pickup_slot_start, t15) && sameInstant(o1?.pickup_slot_end, t1530),
  `door pickup at 3 PM: stored on the order, 30 minutes (${short(o1)})`);
const again = await checkout(BUYER, "pickup_home", t15);
ok(Array.isArray(again) && again[0]?.order_id === home[0]?.order_id, "the same time hands back the same order");
const moved = await checkout(BUYER, "pickup_home", t1530);
ok(Array.isArray(moved) && moved[0]?.order_id !== home[0]?.order_id && sameInstant((await openOrder(BUYER))?.pickup_slot_start, t1530),
  "a new time opens a new order with the new time");

// 2. Porch: a 2-hour window, cut at the end of the seller's window.
ok(Array.isArray(await hold(2, BUYER2, 3000)), "fixture: item 2 held for buyer 2");
const porch = await checkout(BUYER2, "porch", t15);
const o2 = await openOrder(BUYER2);
ok(Array.isArray(porch) && sameInstant(o2?.pickup_slot_end, await iso(at(1, "17:00"))), `porch at 3 PM: the window ends at 5 PM (${short(o2)})`);
const late = await checkout(BUYER2, "porch", await iso(at(1, "16:00")));
const o2b = await openOrder(BUYER2);
ok(Array.isArray(late) && sameInstant(o2b?.pickup_slot_end, await iso(at(1, "17:00"))), `porch at 4 PM: cut at the window's 5 PM end (${short(o2b)})`);
await checkout(BUYER2, "porch", t15);
const o2c = await openOrder(BUYER2);

// 3. Payment books it and tells the seller.
const paidRaw = await svc(`SELECT public.declutter_mark_order_paid('${o2c.id}', 'pi_b110porch', ${Number(o2c.total_cents) + Number(o2c.setup_fee_cents)}, now(), 30) AS r`);
const paid = Array.isArray(paidRaw) ? paidRaw[0]?.r : paidRaw;
ok(paid?.result === "paid", `the porch order is paid (${short(paidRaw)})`);
const bk = (await svc(`SELECT slot_start, slot_end FROM public.declutter_bookings WHERE order_id = '${o2c.id}'`))?.[0];
ok(sameInstant(bk?.slot_start, t15) && sameInstant(bk?.slot_end, t1530), `the chosen time is booked (${short(bk)})`);
ok(one(await svc(`SELECT count(*) FROM public.declutter_handovers WHERE order_id = '${o2c.id}'`)) == 1, "  with a handover code");
const sellerNote = await svc(`SELECT message FROM public.notifications WHERE user_id = '${SELLER2}' AND title = 'Buyer paid'`);
ok(Array.isArray(sellerNote) && sellerNote.some((x) => /Pickup \w{3} \d{1,2}\/\d{1,2}, 3–5 PM\. Have it ready on the porch\./.test(x.message)),
  `the seller's notice carries the window (${short(sellerNote)})`);

// 4. No time chosen: the old path, nothing booked at payment.
ok(Array.isArray(await hold(3, BUYER3, 1500)), "fixture: item 3 held for buyer 3");
const plain = await checkout(BUYER3, "pickup_home", null);
const o3 = await openOrder(BUYER3);
ok(Array.isArray(plain) && o3?.pickup_slot_start === null, "no time: the order has none (the old path)");
await svc(`SELECT public.declutter_mark_order_paid('${o3.id}', 'pi_b110plain', ${Number(o3.total_cents) + Number(o3.setup_fee_cents)}, now(), 30)`);
ok(one(await svc(`SELECT count(*) FROM public.declutter_bookings WHERE order_id = '${o3.id}'`)) == 0, "  and nothing is booked at payment");

// 5. The accepted-offer notice says what to do next.
await run(liveItemSql({ id: I(4), seller: SELLER2, title: "Offer lamp", price: 4000, floor: 100 }));
const offer = one(await svc(`INSERT INTO public.declutter_offers (item_id, buyer_id, seller_id, amount_cents, awaiting, status, respond_by)
  VALUES ('${I(4)}', '${BUYER}', '${SELLER2}', 3000, 'seller', 'open', now() + interval '1 hour') RETURNING id`));
const took = await svc(`SELECT public.declutter_take_item('${I(4)}', '${BUYER}', 3000, 'offer', '${offer}')`);
ok(Array.isArray(took), `fixture: the offer is accepted (${short(took)})`);
const offerNote = await svc(`SELECT message FROM public.notifications WHERE user_id = '${BUYER}' AND message LIKE '%Offer lamp%'`);
ok(Array.isArray(offerNote) && offerNote.some((x) => /^Dana .*accepted your \$30(\.00)? offer for "Offer lamp"\. Check out within 24 hours: choose pickup or delivery, pick a day and time, and pay/.test(x.message)),
  `the buyer is told who accepted and what to do next (${short(offerNote)})`);

// 6. B112 (B110 leftover 1): the order's two sides read the chosen window (20261101200035), so the order card shows
// the porch window, not the 30-minute booking. GRANT=skip: without it (expect FAILs).
const GRANT_FILE = "20261101200035_declutter_order_pickup_window_read.sql";
if (process.env.GRANT !== "skip") {
  for (let i = 0; i < 3; i++) {
    const r = await run(readFileSync(`${MIG_DIR}${GRANT_FILE}`, "utf8"));
    ok(!r?.error, `${GRANT_FILE} applies (run ${i + 1} of 3)${r?.error ? `: ${r.error}` : ""}`);
  }
}
const win = await me(BUYER2, `SELECT pickup_slot_start, pickup_slot_end FROM public.declutter_orders WHERE id = '${o2c.id}'`);
ok(Array.isArray(win) && sameInstant(win[0]?.pickup_slot_start, t15) && sameInstant(win[0]?.pickup_slot_end, await iso(at(1, "17:00"))),
  `the buyer reads the porch window 3-5 PM off the order (${short(win)})`);
const sellerWin = await me(SELLER2, `SELECT pickup_slot_end FROM public.declutter_orders WHERE id = '${o2c.id}'`);
ok(Array.isArray(sellerWin) && sellerWin.length === 1, `the seller reads it too (${short(sellerWin)})`);
const stranger = await me(BUYER3, `SELECT pickup_slot_end FROM public.declutter_orders WHERE id = '${o2c.id}'`);
ok(Array.isArray(stranger) && stranger.length === 0, `anyone else reads no row (${short(stranger)})`);
ok(refused(await me(BUYER2, `SELECT stripe_payment_intent_id FROM public.declutter_orders WHERE id = '${o2c.id}'`), /permission denied/),
  "the Stripe ids stay unreadable");

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
