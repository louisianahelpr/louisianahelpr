#!/usr/bin/env node
/**
 * PGlite proof for 20261031164337_declutter_door_pickup_uses_places (LEAD-PLACE-TIMES, owner 2026-10-31; lead's
 * decision 2: "door pickup uses places at checkout"): a door pickup (pickup_home) from a seller with saved pickup
 * places is at the place the buyer picked, as a porch pickup and a Helpr delivery already are. Checkout asks for the
 * pick, freezes the place and its hours on the order, and nothing about the money moves.
 *
 *   node src/test/pglite/declutterDoorPickupUsesPlaces.pglite.mjs                    # GREEN
 *   NEW_MIGRATION=skip node src/test/pglite/declutterDoorPickupUsesPlaces.pglite.mjs # RED: the chain without it
 *   MIGRATION_PATH=<planted copy> node ...                                           # RED on a planted defect
 *
 * World: scripts/declutter/handoverPhotoWorld.mjs, the bases the place-hours proof applies, then 20261031145652
 * (place hours: the order-keyed hours trigger, declutter_order_pickup_windows and declutter_book_pickup), each once;
 * this migration 3x. Both checkout functions' newest CREATE before it is 20261030164712 (measured on origin/main
 * 2026-10-31 with git grep over every migration).
 */
import { readFileSync } from "node:fs";
import { buildHandoverWorld, MIG_DIR } from "../../../scripts/declutter/handoverPhotoWorld.mjs";

const NEW_FILE = "20261031164337_declutter_door_pickup_uses_places.sql";
// The money review's fix (2026-10-31 #2): a porch order with no frozen place keeps to the seller's porch days.
const DAYS_FILE = "20261031171727_declutter_porch_days_without_places.sql";
const BASES = [
  "20261027211754_declutter_bundle_discount.sql",
  "20261028195840_declutter_pickup_window_reads.sql",
  "20261028200440_declutter_audit3_notices_and_empty_cart.sql",
  "20261028235247_declutter_handover_choices.sql",
  "20261028235709_declutter_handover_photos_at_the_address.sql",
  "20261029002010_declutter_handover_photos_live_only.sql",
  "20261029161347_declutter_porch_weekdays.sql",
  "20261029201542_declutter_porch_photo_not_before_the_day.sql",
  "20261030164712_declutter_porch_places.sql",
  "20261031145652_declutter_place_hours.sql",
];
const skip = process.env.NEW_MIGRATION === "skip";
if (skip) console.log("NEW_MIGRATION=skip: running WITHOUT the new migration (expect FAILs)");
const { svc, run, one, me, refused, liveItemSql, USERS } = await buildHandoverWorld();
const { SELLER, SELLER2, BUYER, BUYER2 } = USERS;

let pass = 0;
let fail = 0;
const ok = (cond, label) => { if (cond) pass++; else fail++; console.log(`${cond ? "PASS" : "FAIL"}  ${label}`); };
const short = (r) => JSON.stringify(r)?.slice(0, 260);
const hours = (ws) => (Array.isArray(ws) ? ws.map((w) => `${w.weekday} ${w.starts}-${w.ends}`).join(", ") : String(ws));

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
  const days = readFileSync(process.env.DAYS_PATH ?? `${MIG_DIR}${DAYS_FILE}`, "utf8");
  for (let i = 0; i < 3; i++) {
    const r = await run(days);
    ok(!r?.error, `the porch-days migration applies (run ${i + 1} of 3)${r?.error ? `: ${r.error}` : ""}`);
  }
}

// The seller's usual times (7 AM to 9 PM every day) and two places, each with its own hours on every day of the week.
await svc(`INSERT INTO public.declutter_pickup_windows (seller_id, weekday, starts_local, ends_local)
  SELECT '${SELLER2}', d, '07:00', '21:00' FROM generate_series(0, 6) d ON CONFLICT DO NOTHING`);
const HOME = { lat: 30.2, lng: -92.0 };
const CAMP = { lat: 29.95, lng: -90.07 };
const everyDay = (starts, ends) => [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({ weekday, starts, ends }));
const save = (label, addr, p, windows) => me(SELLER2,
  `SELECT public.declutter_save_porch_place(NULL, '${label}', '${addr}', 'New Iberia', ${p.lat}, ${p.lng}, NULL, '${JSON.stringify(windows)}'::jsonb) AS id`);
const save2 = (id, label, addr, p, windows) => me(SELLER2,
  `SELECT public.declutter_save_porch_place('${id}', '${label}', '${addr}', 'New Iberia', ${p.lat}, ${p.lng}, NULL, '${JSON.stringify(windows)}'::jsonb) AS id`);
const home = one(await save("Home", "12 Home Street, New Iberia", HOME, everyDay("09:00", "11:00")));
const camp = one(await save("Camp", "99 Camp Road, New Iberia", CAMP, everyDay("15:00", "17:00")));
ok(typeof home === "string" && typeof camp === "string", `fixture: the seller saves Home (9-11) and Camp (3-5)${typeof home === "string" ? "" : ` (got ${short(home)})`}`);

const I = (n) => `eeeeeeee-0000-0000-0000-${String(n).padStart(12, "0")}`;
const addToCart = async (n, seller, buyer, price) => {
  await run(liveItemSql({ id: I(n), seller, title: `Door pickup item ${n}`, price, floor: price === 0 ? 0 : 100 }));
  // A free item is claimed (declutter_claim_free), never bought (20261027170717).
  return me(buyer, price === 0 ? `SELECT public.declutter_claim_free('${I(n)}')` : `SELECT public.declutter_buy_now('${I(n)}', ${price})`);
};
const orders = async (buyer, seller) =>
  Number(one(await svc(`SELECT count(*) FROM public.declutter_orders WHERE buyer_id = '${buyer}' AND seller_id = '${seller}'`)));

// 1. A paid door pickup from a seller with places needs a pick, and makes no order without one.
await addToCart(1, SELLER2, BUYER, 1500);
const noPick = await me(BUYER, `SELECT * FROM public.declutter_start_checkout('${SELLER2}', 'pickup_home')`);
ok(refused(noPick, /porch_place_needed/), `door pickup checkout without a pick: porch_place_needed${refused(noPick, /porch_place_needed/) ? "" : ` (got ${short(noPick)})`}`);
ok(await orders(BUYER, SELLER2) === 0, "  and no order row exists");

// 2. With Camp picked: an order, Camp and its hours frozen on it, the money exactly a door pickup's.
await me(BUYER, `SELECT public.declutter_set_porch_place('${SELLER2}', '${camp}')`);
const P = (await me(BUYER, `SELECT * FROM public.declutter_start_checkout('${SELLER2}', 'pickup_home')`))?.[0];
ok(P?.order_id, `door pickup checkout at Camp opens an order${P?.order_id ? "" : ` (got ${short(P)})`}`);
const frozen = (await svc(`SELECT address, label, windows FROM public.declutter_order_porch_places WHERE order_id = '${P?.order_id}'`))?.[0];
ok(frozen?.address === "99 Camp Road, New Iberia" && frozen?.label === "Camp", `Camp is frozen on the order (${short(frozen)})`);
ok(hours(frozen?.windows) === hours(everyDay("15:00", "17:00")), `  with Camp's hours, 3 to 5 PM (${hours(frozen?.windows)?.slice(0, 40)})`);
const money = (await svc(`SELECT handover, items_cents, delivery_cents, total_cents, items_cents + premium_cents + tax_cents + delivery_cents AS parts
  FROM public.declutter_orders WHERE id = '${P?.order_id}'`))?.[0];
ok(money?.handover === "pickup_home" && money?.items_cents === 1500 && money?.delivery_cents === 0 && money?.total_cents === money?.parts
   && P?.total_cents === money?.total_cents,
  `the order is a plain door pickup: items 1500, no delivery, total = its parts (${short(money)})`);
// The same pick again hands back the same open order; a different pick opens a new one.
const again = (await me(BUYER, `SELECT * FROM public.declutter_start_checkout('${SELLER2}', 'pickup_home')`))?.[0];
ok(again?.order_id === P?.order_id, "the same place again reuses the open order");
await me(BUYER, `SELECT public.declutter_set_porch_place('${SELLER2}', '${home}')`);
const moved = (await me(BUYER, `SELECT * FROM public.declutter_start_checkout('${SELLER2}', 'pickup_home')`))?.[0];
ok(moved?.order_id && moved.order_id !== P?.order_id
   && one(await svc(`SELECT address FROM public.declutter_order_porch_places WHERE order_id = '${moved?.order_id}'`)) === "12 Home Street, New Iberia",
  "a different place opens a new order, frozen at Home");
await me(BUYER, `SELECT public.declutter_set_porch_place('${SELLER2}', '${camp}')`);
const C = (await me(BUYER, `SELECT * FROM public.declutter_start_checkout('${SELLER2}', 'pickup_home')`))?.[0];
await svc(`SELECT public.declutter_mark_order_paid('${C?.order_id}', 'pi_door_1', ${C?.total_cents}, now(), 150)`);
ok(one(await svc(`SELECT status FROM public.declutter_orders WHERE id = '${C?.order_id}'`)) === "paid", "fixture: the Camp order is paid");

// 3. After paying: the buyer is sent to Camp, and the pickup times are Camp's frozen hours.
const addr = (await me(BUYER, `SELECT * FROM public.declutter_item_address('${I(1)}')`))?.[0];
ok(addr?.pickup_address === "99 Camp Road, New Iberia" && Number(addr?.pickup_lat) === CAMP.lat,
  `declutter_item_address gives the paid buyer Camp, not the item's own address (${short(addr)})`);
const orderHours = await me(BUYER, `SELECT weekday, starts::text, ends::text FROM public.declutter_order_pickup_windows('${C?.order_id}')`);
ok(Array.isArray(orderHours) && orderHours.length === 7 && orderHours.every((r) => r.starts.startsWith("15:00") && r.ends.startsWith("17:00")),
  `the order's pickup times are Camp's 3-5, not the usual 7-9 (${short(orderHours)?.slice(0, 90)})`);
const at = (hhmm) => `((date_trunc('day', now() AT TIME ZONE 'America/Chicago') + make_interval(days => 2) + '${hhmm}'::time) AT TIME ZONE 'America/Chicago')`;
const outside = await me(BUYER, `SELECT public.declutter_book_pickup('${C?.order_id}', ${at("10:00")}) AS r`);
ok(refused(outside, /invalid_slot/), `10 AM (inside the usual hours, outside Camp's) is refused${refused(outside, /invalid_slot/) ? "" : ` (got ${short(outside)})`}`);
const inside = await me(BUYER, `SELECT public.declutter_book_pickup('${C?.order_id}', ${at("15:30")}) AS r`);
ok(one(inside)?.result === "booked", `3:30 PM (inside Camp's hours) books${Array.isArray(inside) ? "" : ` (got ${short(inside)})`}`);

// 4. A free door claim from the same seller: the same pick, frozen the same way, still nothing charged.
await addToCart(2, SELLER2, BUYER2, 0);
const freeNoPick = await me(BUYER2, `SELECT public.declutter_checkout_free('${SELLER2}', 'pickup_home') AS id`);
ok(refused(freeNoPick, /porch_place_needed/), `a free door claim without a pick: porch_place_needed${refused(freeNoPick, /porch_place_needed/) ? "" : ` (got ${short(freeNoPick)})`}`);
ok(await orders(BUYER2, SELLER2) === 0, "  and no order row exists");
await me(BUYER2, `SELECT public.declutter_set_porch_place('${SELLER2}', '${home}')`);
const F = one(await me(BUYER2, `SELECT public.declutter_checkout_free('${SELLER2}', 'pickup_home') AS id`));
const fRow = (await svc(`SELECT o.status, o.total_cents, pp.address, pp.windows FROM public.declutter_orders o
  LEFT JOIN public.declutter_order_porch_places pp ON pp.order_id = o.id WHERE o.id = '${F}'`))?.[0];
ok(fRow?.status === "paid" && fRow?.total_cents === 0 && fRow?.address === "12 Home Street, New Iberia"
   && hours(fRow?.windows) === hours(everyDay("09:00", "11:00")),
  `the free claim is set, $0, at Home with Home's hours (${short(fRow)})`);

// 5. A seller with no places: a door pickup exactly as before (no pick asked, nothing frozen, the usual times).
await svc(`INSERT INTO public.declutter_pickup_windows (seller_id, weekday, starts_local, ends_local)
  SELECT '${SELLER}', d, '08:00', '10:00' FROM generate_series(0, 6) d ON CONFLICT DO NOTHING`);
await addToCart(3, SELLER, BUYER2, 900);
const O = (await me(BUYER2, `SELECT * FROM public.declutter_start_checkout('${SELLER}', 'pickup_home')`))?.[0];
ok(O?.order_id, `no places: door pickup checkout as before${O?.order_id ? "" : ` (got ${short(O)})`}`);
ok(Number(one(await svc(`SELECT count(*) FROM public.declutter_order_porch_places WHERE order_id = '${O?.order_id}'`))) === 0, "  and nothing is frozen");
await addToCart(4, SELLER, BUYER, 0);
const F2 = one(await me(BUYER, `SELECT public.declutter_checkout_free('${SELLER}', 'pickup_home') AS id`));
ok(typeof F2 === "string", `no places: a free door claim as before${typeof F2 === "string" ? "" : ` (got ${short(F2)})`}`);

// 6. Review 2026-10-31 #2: a porch seller with NO places and porch days Saturday only (pickup times every day).
await svc(`INSERT INTO public.declutter_seller_porch_days (seller_id, weekdays) VALUES ('${SELLER}', ARRAY[6]::smallint[])
  ON CONFLICT (seller_id) DO UPDATE SET weekdays = EXCLUDED.weekdays`);
await addToCart(5, SELLER, BUYER, 1100);
const Pd = (await me(BUYER, `SELECT * FROM public.declutter_start_checkout('${SELLER}', 'porch')`))?.[0];
await svc(`SELECT public.declutter_mark_order_paid('${Pd?.order_id}', 'pi_door_2', ${Pd?.total_cents}, now(), 150)`);
ok(one(await svc(`SELECT status FROM public.declutter_orders WHERE id = '${Pd?.order_id}'`)) === "paid", `fixture: a porch order from a seller with no places is paid${Pd?.order_id ? "" : ` (got ${short(Pd)})`}`);
const porchHours = await me(BUYER, `SELECT weekday FROM public.declutter_order_pickup_windows('${Pd?.order_id}')`);
ok(Array.isArray(porchHours) && porchHours.length === 1 && Number(porchHours[0].weekday) === 6,
  `the porch order's times are Saturday's only, not every day's (${short(porchHours)})`);
const todayDow = Number(one(await svc(`SELECT extract(dow FROM now() AT TIME ZONE 'America/Chicago')::int`)));
const ahead = (d) => ((d - todayDow + 7) % 7) || 7;
const onDay = (d, hhmm) => `((date_trunc('day', now() AT TIME ZONE 'America/Chicago') + make_interval(days => ${ahead(d)}) + '${hhmm}'::time) AT TIME ZONE 'America/Chicago')`;
const tue = await me(BUYER, `SELECT public.declutter_book_pickup('${Pd?.order_id}', ${onDay(2, "08:30")}) AS r`);
ok(refused(tue, /invalid_slot/), `a Tuesday 8:30 (a pickup time, not a porch day) is refused${refused(tue, /invalid_slot/) ? "" : ` (got ${short(tue)})`}`);
// The next Saturday 8:30 within the 7-day deadline: today's when it is Saturday before 8:30, else the coming one (on a
// Saturday that is 7 days on, inside the deadline once it is 9:00; between 8:30 and 9:00 on a Saturday no Saturday slot
// fits the 7 days, so run it outside that half hour).
const nowMin = Number(one(await svc(`SELECT (extract(hour FROM now() AT TIME ZONE 'America/Chicago') * 60 + extract(minute FROM now() AT TIME ZONE 'America/Chicago'))::int`)));
const satAt = todayDow === 6 && nowMin < 8 * 60 + 30
  ? `((date_trunc('day', now() AT TIME ZONE 'America/Chicago') + '08:30'::time) AT TIME ZONE 'America/Chicago')`
  : onDay(6, "08:30");
const sat = await me(BUYER, `SELECT public.declutter_book_pickup('${Pd?.order_id}', ${satAt}) AS r`);
ok(one(sat)?.result === "booked", `a Saturday 8:30 (the porch day) books${Array.isArray(sat) ? "" : ` (got ${short(sat)})`}`);
// A door pickup from the same seller is not held to the porch days.
await addToCart(6, SELLER, BUYER2, 1000);
const Dd = (await me(BUYER2, `SELECT * FROM public.declutter_start_checkout('${SELLER}', 'pickup_home')`))?.[0];
await svc(`SELECT public.declutter_mark_order_paid('${Dd?.order_id}', 'pi_door_3', ${Dd?.total_cents}, now(), 150)`);
const doorHours = await me(BUYER2, `SELECT weekday FROM public.declutter_order_pickup_windows('${Dd?.order_id}')`);
ok(Array.isArray(doorHours) && doorHours.length === 7, `a door pickup from that seller keeps every day's times (${Array.isArray(doorHours) ? doorHours.length : short(doorHours)})`);
const doorTue = await me(BUYER2, `SELECT public.declutter_book_pickup('${Dd?.order_id}', ${onDay(2, "08:30")}) AS r`);
ok(one(doorTue)?.result === "booked", `  and books a Tuesday${Array.isArray(doorTue) ? "" : ` (got ${short(doorTue)})`}`);

// 7. Review (low): the place's hours are in the open-order reuse key; edited hours open a new order.
await addToCart(7, SELLER2, BUYER2, 1300);
await me(BUYER2, `SELECT public.declutter_set_porch_place('${SELLER2}', '${camp}')`);
const K1 = (await me(BUYER2, `SELECT * FROM public.declutter_start_checkout('${SELLER2}', 'pickup_home')`))?.[0];
await save2(camp, "Camp", "99 Camp Road, New Iberia", CAMP, everyDay("16:00", "18:00"));
const K2 = (await me(BUYER2, `SELECT * FROM public.declutter_start_checkout('${SELLER2}', 'pickup_home')`))?.[0];
ok(K1?.order_id && K2?.order_id && K1.order_id !== K2.order_id
   && hours(one(await svc(`SELECT windows FROM public.declutter_order_porch_places WHERE order_id = '${K2?.order_id}'`))) === hours(everyDay("16:00", "18:00")),
  `the seller edits Camp's hours: checkout opens a new order with the new hours (${short([K1?.order_id, K2?.order_id])})`);

// 8. Grants on the restated functions.
const acl = async (role, fn) => one(await svc(`SELECT has_function_privilege('${role}', 'public.${fn}', 'EXECUTE')`));
ok(await acl("anon", "declutter_start_checkout(uuid, text, timestamptz, text)") === false
   && await acl("anon", "declutter_checkout_free(uuid, text)") === false,
  "anon cannot call either checkout (REVOKE FROM PUBLIC, anon)");
ok(await acl("authenticated", "declutter_start_checkout(uuid, text, timestamptz, text)") === true
   && await acl("authenticated", "declutter_checkout_free(uuid, text)") === true,
  "members can");
ok(await acl("authenticated", "declutter_order_slot_in_windows(uuid, uuid, timestamptz)") === false
   && await acl("anon", "declutter_order_pickup_windows(uuid)") === false,
  "the slot helper stays internal; anon cannot read an order's times");

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
