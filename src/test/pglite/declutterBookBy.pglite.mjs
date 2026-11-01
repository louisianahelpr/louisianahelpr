#!/usr/bin/env node
/**
 * PGlite proof for 20261101230519_declutter_book_by (B117, lead 11-01 5:01 PM, A3-18/19; A3-50: the 7-day rule).
 * Applied on top of B110's 20261101191500 (the checkout pickup time):
 *   1. book_by = paid_at + 7 days is set on payment for every pickup order (and backfilled on a replay).
 *   2. the "Payment received" notice names the checkout time ("Pickup <when> · porch.") or says "by <book_by>".
 *   3. the reminder sweep: 24 h and 2 h before book_by, once each, never in quiet hours, never for a booked order,
 *      and it never changes the order's status itself; book_by IS the handover sweep's 7-day no-show cutoff.
 *   4. grants: the two sides read book_by; nobody else does; the sweep and helper are service_role only.
 *
 *   node src/test/pglite/declutterBookBy.pglite.mjs                    # GREEN
 *   NEW_MIGRATION=skip node src/test/pglite/declutterBookBy.pglite.mjs # RED: without it
 *   MIGRATION_PATH=<planted copy> node ...                             # RED on a planted defect
 *
 * (Base fixture below is the same as B110's proof:)
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

const NEW_FILE = "20261101230519_declutter_book_by.sql";
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
  "20261101191500_declutter_checkout_pickup_time.sql",
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

const acl = one(await svc(`SELECT NOT has_function_privilege('authenticated', 'public.declutter_book_by_reminder_sweep(timestamptz)', 'EXECUTE')
  AND NOT has_function_privilege('anon', 'public.declutter_book_by_reminder_sweep(timestamptz)', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'public.declutter_pickup_when(uuid)', 'EXECUTE')
  AND has_column_privilege('authenticated', 'public.declutter_orders', 'book_by', 'SELECT')
  AND has_column_privilege('authenticated', 'public.declutter_orders', 'pickup_slot_end', 'SELECT')
  AND NOT has_column_privilege('anon', 'public.declutter_orders', 'book_by', 'SELECT')`));
ok(acl === true, `grants: sweep + helper service_role only; book_by / pickup_slot_* readable by signed-in members, not anon (got ${short(acl)})`);

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


const pay = async (o, pi) => svc(`SELECT public.declutter_mark_order_paid('${o.id}', '${pi}', ${Number(o.total_cents) + Number(o.setup_fee_cents)}, now(), 30)`);
const row = async (id) => (await svc(`SELECT status, paid_at, book_by, book_by_reminded_24_at, book_by_reminded_2_at FROM public.declutter_orders WHERE id = '${id}'`))?.[0];
const sevenDays = (r) => r?.book_by && r?.paid_at && Date.parse(r.book_by) - Date.parse(r.paid_at) === 7 * 86400_000;

// 1. A porch order with a checkout time (3 PM tomorrow): paid, booked, book_by = paid + 7 days, notice names the time.
ok(Array.isArray(await hold(1, BUYER, 2000)), "fixture: item 1 held for the buyer");
const t15 = await iso(at(1, "15:00"));
await checkout(BUYER, "porch", t15);
const oA = await openOrder(BUYER);
await pay(oA, "pi_b117a");
const rA = await row(oA.id);
ok(rA?.status === "paid" && sevenDays(rA), `paid porch order: book_by = paid_at + 7 days (${short(rA)})`);
// Lead 11-01 5:31 PM: book_by is exactly the handover sweep's no-show cutoff (o2.paid_at + interval '7 days').
const cutoff = one(await svc(`SELECT book_by = paid_at + interval '7 days' FROM public.declutter_orders WHERE id = '${oA.id}'`));
const sweepDef = one(await svc(`SELECT pg_get_functiondef('public.declutter_handover_sweep()'::regprocedure)`)) ?? "";
ok(cutoff === true && /o2\.paid_at \+ interval '7 days' <= now\(\)/.test(sweepDef) && /buyer_no_show/.test(sweepDef),
  `book_by = paid_at + interval '7 days', the sweep's no-show cutoff (${cutoff}; sweep has the cutoff: ${/o2\.paid_at \+ interval '7 days'/.test(sweepDef)})`);
const noteA = await svc(`SELECT message FROM public.notifications WHERE user_id = '${BUYER}' AND title = 'Payment received'`);
ok(Array.isArray(noteA) && noteA.some((x) => /Pickup \w{3} \d{1,2}\/\d{1,2}, 3–5 PM · porch\.$/.test(x.message)) && !noteA.some((x) => /\bby\b/.test(x.message)),
  `the buyer's "Payment received" names the chosen window, no "by" (${short(noteA)})`);

// 2. No time at checkout (the old path): book_by set, the notice says "by <book_by>".
ok(Array.isArray(await hold(2, BUYER2, 1500)), "fixture: item 2 held for buyer 2");
await checkout(BUYER2, "pickup_home", null);
const oB = await openOrder(BUYER2);
await pay(oB, "pi_b117b");
const rB = await row(oB.id);
ok(rB?.status === "paid" && sevenDays(rB), `paid door order with no time: book_by = paid_at + 7 days (${short(rB)})`);
const noteB = await svc(`SELECT message FROM public.notifications WHERE user_id = '${BUYER2}' AND title = 'Payment received'`);
ok(Array.isArray(noteB) && noteB.some((x) => /Next: choose your pickup time in Buying, by \w{3} \d{1,2}\/\d{1,2}, \d{1,2}:\d{2} [AP]M\.$/.test(x.message)),
  `the notice says "by <book_by>" (${short(noteB)})`);

// 3. The two sides read book_by; a stranger reads nothing.
const asBuyer = await me(BUYER2, `SELECT book_by FROM public.declutter_orders WHERE id = '${oB.id}'`);
const asSeller = await me(SELLER2, `SELECT book_by, pickup_slot_start FROM public.declutter_orders WHERE id = '${oB.id}'`);
const asOther = await me(BUYER3, `SELECT book_by FROM public.declutter_orders WHERE id = '${oB.id}'`);
ok(Array.isArray(asBuyer) && asBuyer.length === 1 && asBuyer[0].book_by, `the buyer reads book_by (${short(asBuyer)})`);
ok(Array.isArray(asSeller) && asSeller.length === 1 && asSeller[0].book_by, `the seller reads book_by (${short(asSeller)})`);
ok(Array.isArray(asOther) && asOther.length === 0, `another member reads no row (${short(asOther)})`);

// 4. Reminders. Day D 10:00 AM Chicago; book_by on D+1 at 9:00 AM (23 h ahead).
const D = (days, hhmm) => `(((now() AT TIME ZONE 'America/Chicago')::date + 3 + ${days} + time '${hhmm}') AT TIME ZONE 'America/Chicago')`;
await svc(`UPDATE public.declutter_orders SET book_by = ${D(1, "09:00")} WHERE id IN ('${oA.id}', '${oB.id}')`);
const sweep = async (expr) => one(await svc(`SELECT public.declutter_book_by_reminder_sweep(${expr})`));
const reminders = async (uid) => (await svc(`SELECT title, message FROM public.notifications WHERE user_id = '${uid}' AND title LIKE 'Pick a pickup time%'`)) ?? [];
ok(await sweep(D(0, "22:00")) == 0 && (await reminders(BUYER2)).length === 0, "quiet hours (10 PM, 11 h before): nothing sent");
const s1 = await sweep(D(0, "10:00"));
const r1 = await reminders(BUYER2);
ok(s1 == 1 && r1.length === 1 && /^Pick a pickup time by \w{3} 9:00 AM$/.test(r1[0].title) && /^Book a pickup time for Time item 2 by \w{3} \d{1,2}\/\d{1,2}, 9:00 AM, or the order is cancelled and the item price refunded\./.test(r1[0].message),
  `24-hour edge (23 h before): one reminder to the unbooked buyer (${s1}, ${short(r1)})`);
ok((await reminders(BUYER)).length === 0, "  and none to the buyer whose time is booked");
ok(await sweep(D(0, "10:10")) == 0, "  the next run sends it again: no (once per edge)");
ok(await sweep(D(0, "18:00")) == 0, "15 h before: nothing more (still the 24-hour edge, already sent)");
ok(await sweep(D(1, "07:30")) == 0 && (await reminders(BUYER2)).length === 1, "quiet hours at the 2-hour edge (7:30 AM, 1.5 h before): nothing sent");
const s2 = await sweep(D(1, "08:00"));
const r2 = await reminders(BUYER2);
ok(s2 == 1 && r2.length === 2 && r2.some((x) => /2 hours left/.test(x.title)), `2-hour edge (1 h before): the second reminder (${s2}, ${short(r2)})`);
ok(await sweep(D(1, "08:30")) == 0, "  once only");
ok(await sweep(D(1, "10:00")) == 0, "after book_by: nothing");
const rB2 = await row(oB.id);
ok(rB2?.status === "paid", `the reminder sweep itself closes nothing: still paid after book_by (${short(rB2)})`);
const closed = one(await svc(`SELECT count(*) FROM public.declutter_cart_items WHERE order_id = '${oB.id}' AND status <> 'paid'`));
ok(closed == 0, "  and its lines are still paid");

// 5. The 2-hour edge alone (the 24-hour one fell in quiet hours): one reminder, and no 24-hour one after it.
await svc(`UPDATE public.declutter_orders SET book_by = ${D(3, "09:30")}, book_by_reminded_24_at = NULL, book_by_reminded_2_at = NULL WHERE id = '${oB.id}'`);
const before = (await reminders(BUYER2)).length;
ok(await sweep(D(3, "08:00")) == 1 && (await reminders(BUYER2)).length === before + 1, "2-hour edge first: one reminder");
const rB3 = await row(oB.id);
ok(rB3?.book_by_reminded_24_at && rB3?.book_by_reminded_2_at, `  both edges marked, so the 24-hour one never follows (${short(rB3)})`);

// A book_by already past, never reminded: nothing (no reminder after the time).
await svc(`UPDATE public.declutter_orders SET book_by = ${D(4, "08:30")}, book_by_reminded_24_at = NULL, book_by_reminded_2_at = NULL WHERE id = '${oB.id}'`);
ok(await sweep(D(4, "09:00")) == 0, "book_by passed 30 minutes ago and never reminded: nothing sent");

// 6. Replay backfills an open paid pickup order that has no book_by.
await svc(`UPDATE public.declutter_orders SET book_by = NULL WHERE id = '${oB.id}'`);
if (!skip) await run(readFileSync(process.env.MIGRATION_PATH ?? `${MIG_DIR}${NEW_FILE}`, "utf8"));
ok(sevenDays(await row(oB.id)), "a replay backfills book_by = paid_at + 7 days");

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
