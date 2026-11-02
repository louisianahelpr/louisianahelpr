#!/usr/bin/env node
/**
 * PGlite proof for 20261102005411_declutter_moved_pickup_keeps_the_window (A3-63 follow-up, lead 2026-11-01: the
 * owner's porch rule). A booked or moved pickup sets the order's chosen time: a porch pickup is a 2-hour window cut at
 * the seller's hours, a door pickup 30 minutes, a start outside every window 30 minutes; the other side's notice
 * says a porch window. On B110's checkout world plus B117's book_by (declutterBookBy.pglite.mjs's fixture).
 *
 *   node src/test/pglite/declutterMovedPickupKeepsTheWindow.pglite.mjs                    # GREEN
 *   NEW_MIGRATION=skip node src/test/pglite/declutterMovedPickupKeepsTheWindow.pglite.mjs # RED: without it
 *   MIGRATION_PATH=<planted copy> node ...                                                # RED on a planted defect
 */
import { readFileSync } from "node:fs";
import { buildHandoverWorld, MIG_DIR } from "../../../scripts/declutter/handoverPhotoWorld.mjs";

const NEW_FILE = "20261102005411_declutter_moved_pickup_keeps_the_window.sql";
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
  "20261101230519_declutter_book_by.sql",
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
const times = async (id) => (await svc(`SELECT pickup_slot_start, pickup_slot_end FROM public.declutter_orders WHERE id = '${id}'`))?.[0];
const bookingStart = async (id) => one(await svc(`SELECT slot_start FROM public.declutter_bookings WHERE order_id = '${id}'`));
const lastNote = async (uid) => one(await svc(`SELECT message FROM public.notifications WHERE user_id = '${uid}' AND title IN ('Pickup booked', 'Pickup time changed') ORDER BY created_at DESC, message DESC LIMIT 1`));
const book = (uid, id, slot) => me(uid, `SELECT public.declutter_book_pickup('${id}', '${slot}'::timestamptz)`);
const hours = (r) => r && (Date.parse(r.pickup_slot_end) - Date.parse(r.pickup_slot_start)) / 3600e3;

// 1. Porch order, checkout window 3-5 PM tomorrow, paid (booked at 3 PM).
ok(Array.isArray(await hold(1, BUYER, 2000)), "fixture: item 1 held for the buyer");
await checkout(BUYER, "porch", await iso(at(1, "15:00")));
const oA = await openOrder(BUYER);
await pay(oA, "pi_move_a");
ok(hours(await times(oA.id)) === 2, `fixture: the paid porch order holds a 2-hour window (${short(await times(oA.id))})`);

// 2. The buyer moves it to 11 AM the day after: the order's window moves with it, still 2 hours; the seller is told the window.
const t11 = await iso(at(2, "11:00"));
const m1 = await book(BUYER, oA.id, t11);
const tA = await times(oA.id);
ok(!m1?.error && sameInstant(tA?.pickup_slot_start, t11) && hours(tA) === 2 && sameInstant(await bookingStart(oA.id), t11),
  `buyer's move: the order's chosen time is the new 2-hour window (${short(m1)} ${short(tA)})`);
const nA = await lastNote(SELLER2);
ok(/^Pickup is \w{3} \d{1,2}\/\d{1,2}, 11 AM–1 PM\.$/.test(nA ?? ""), `the seller's notice says the window (${short(nA)})`);

// 3. The seller moves it to 4 PM: the window is cut at the seller's 5 PM end (1 hour).
const t16 = await iso(at(3, "16:00"));
const m2 = await book(SELLER2, oA.id, t16);
const tA2 = await times(oA.id);
ok(!m2?.error && sameInstant(tA2?.pickup_slot_start, t16) && hours(tA2) === 1, `seller's move to 4 PM: window cut at 5 PM (${short(m2)} ${short(tA2)})`);
const nB = await lastNote(BUYER);
ok(/^Pickup is \w{3} \d{1,2}\/\d{1,2}, 4–5 PM\.$/.test(nB ?? ""), `the buyer's notice says the window (${short(nB)})`);

// 4. A door order with no checkout time: the buyer books 10 AM: chosen time 30 minutes; the notice keeps its words.
ok(Array.isArray(await hold(2, BUYER2, 1500)), "fixture: item 2 held for buyer 2");
await checkout(BUYER2, "pickup_home", null);
const oB = await openOrder(BUYER2);
await pay(oB, "pi_move_b");
const t10 = await iso(at(2, "10:00"));
const m3 = await book(BUYER2, oB.id, t10);
const tB = await times(oB.id);
ok(!m3?.error && sameInstant(tB?.pickup_slot_start, t10) && hours(tB) === 0.5, `door booking: chosen time = 30 minutes (${short(m3)} ${short(tB)})`);
const nC = await lastNote(SELLER2);
ok(/^Pickup is \w{3} \w{3} \d{1,2} at 10:00 AM\.$/.test(nC ?? ""), `a door notice keeps its words (${short(nC)})`);

// 5. The seller's free-typed move outside every window (8 PM): 30 minutes, never NULL.
const t20 = await iso(at(3, "20:00"));
const m4 = await book(SELLER2, oB.id, t20);
const tB2 = await times(oB.id);
ok(!m4?.error && sameInstant(tB2?.pickup_slot_start, t20) && hours(tB2) === 0.5, `a move outside the hours keeps 30 minutes (${short(m4)} ${short(tB2)})`);

// 6. Grants unchanged: members may call it, anon may not.
const acl = one(await svc(`SELECT has_function_privilege('authenticated', 'public.declutter_book_pickup(uuid, timestamptz)', 'EXECUTE')
  AND NOT has_function_privilege('anon', 'public.declutter_book_pickup(uuid, timestamptz)', 'EXECUTE')`));
ok(acl === true, `grants: authenticated yes, anon no (${acl})`);
// A stranger cannot move it.
const stranger = await book(BUYER3, oA.id, await iso(at(4, "11:00")));
ok(!!stranger?.error || refused(stranger), `a stranger is refused (${short(stranger)})`);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
