#!/usr/bin/env node
/**
 * PGlite proof for 20261029224749_declutter_porch_places (D-NEW14, owner-approved design 2026-10-29): a seller saves
 * up to 5 porch pickup places, each with its own weekdays; the buyer picks a place, then a day; only the chosen
 * address is shared after paying; the place is FROZEN on the order at checkout; Helpr delivery uses the chosen place.
 *
 *   node src/test/pglite/declutterPorchPlaces.pglite.mjs                    # GREEN
 *   NEW_MIGRATION=skip node src/test/pglite/declutterPorchPlaces.pglite.mjs # RED: the chain without it
 *   MIGRATION_PATH=<planted copy> node ...                                  # RED on a planted defect
 *
 * World: scripts/declutter/handoverPhotoWorld.mjs, then the newest definitions this migration restates, once each
 * (bundle discount, audit 3, handover choices, photos at the address, live photos, porch weekdays, porch photo not
 * before the day); this migration 3x.
 */
import { readFileSync } from "node:fs";
import { buildHandoverWorld, MIG_DIR } from "../../../scripts/declutter/handoverPhotoWorld.mjs";

const NEW_FILE = "20261029224749_declutter_porch_places.sql";
const BASES = [
  "20261027211754_declutter_bundle_discount.sql",
  "20261028200440_declutter_audit3_notices_and_empty_cart.sql",
  "20261028235247_declutter_handover_choices.sql",
  "20261028235709_declutter_handover_photos_at_the_address.sql",
  "20261029002010_declutter_handover_photos_live_only.sql",
  "20261029161347_declutter_porch_weekdays.sql",
  "20261029201542_declutter_porch_photo_not_before_the_day.sql",
];
const skip = process.env.NEW_MIGRATION === "skip";
if (skip) console.log("NEW_MIGRATION=skip: running WITHOUT the new migration (expect FAILs)");
const { svc, run, one, me, refused, liveItemSql, USERS } = await buildHandoverWorld();
const { SELLER2, BUYER, BUYER2, OUTSIDER } = USERS;

let pass = 0;
let fail = 0;
const ok = (cond, label) => { if (cond) pass++; else fail++; console.log(`${cond ? "PASS" : "FAIL"}  ${label}`); };
const short = (r) => JSON.stringify(r)?.slice(0, 200);

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

// The item's own address (declutter_item_private, from liveItemSql) and two porch places far from it and each other.
const ITEM_PT = { lat: 30.451234, lng: -91.154321 };
const HOME = { lat: 30.2, lng: -92.0 };
const CAMP = { lat: 29.95, lng: -90.07 };
const pt = (p) => `${p.lat}, ${p.lng}`;
const I = (n) => `cccccccc-0000-0000-0000-${String(n).padStart(12, "0")}`;
const photo = async (uid, orderId, name) => {
  const path = `${uid}/declutter/handover/${orderId}/${name}.jpg`;
  await svc(`INSERT INTO storage.objects (bucket_id, name, created_at) VALUES ('declutter-handover', '${path}', now())`);
  return path;
};
const today = one(await svc(`SELECT (now() AT TIME ZONE 'America/Chicago')::date::text`));
const todayDow = Number(one(await svc(`SELECT extract(dow FROM (now() AT TIME ZONE 'America/Chicago')::date)::int`)));
const otherDow = (todayDow + 1) % 7;
// Pickup times every day (the old rule would offer every day).
await svc(`INSERT INTO public.declutter_pickup_windows (seller_id, weekday, starts_local, ends_local)
  SELECT '${SELLER2}', d, '00:00', '23:59' FROM generate_series(0, 6) d ON CONFLICT DO NOTHING`);
const save = (uid, id, label, addr, area, p, days) => me(uid,
  `SELECT public.declutter_save_porch_place(${id ? `'${id}'` : "NULL"}, '${label}', '${addr}', '${area}', ${pt(p)}, ARRAY[${days.join(",")}]::smallint[]) AS id`);
const addToCart = async (n, buyer, price = 1200) => {
  await run(liveItemSql({ id: I(n), seller: SELLER2, title: `Porch place item ${n}`, price, floor: price === 0 ? 0 : 100 }));
  return me(buyer, `SELECT public.declutter_buy_now('${I(n)}', ${price})`);
};

// 1. The seller's places: save, cap of 5, own only, validation.
const home = one(await save(SELLER2, null, "Home", "12 Home Street, Lafayette", "Lafayette", HOME, [todayDow]));
const camp = one(await save(SELLER2, null, "Camp", "99 Camp Road, New Orleans", "New Orleans", CAMP, [otherDow]));
ok(typeof home === "string" && typeof camp === "string", `the seller saves two places${typeof home === "string" ? "" : `: ${short(home)}`}`);
const mine = await me(SELLER2, `SELECT * FROM public.declutter_my_porch_places()`);
ok(Array.isArray(mine) && mine.length === 2 && mine[0].address?.includes("Home Street"), `the seller reads their own places with addresses (${Array.isArray(mine) ? mine.length : short(mine)})`);
for (let k = 3; k <= 5; k++) await save(SELLER2, null, `Spot ${k}`, `${k} Spot Lane, Baton Rouge`, "Baton Rouge", ITEM_PT, [0, 6]);
const sixth = await save(SELLER2, null, "Spot 6", "6 Spot Lane, Baton Rouge", "Baton Rouge", ITEM_PT, [1]);
ok(refused(sixth, /porch_places_full/), `a 6th place is refused: porch_places_full${refused(sixth, /porch_places_full/) ? "" : ` (got ${short(sixth)})`}`);
ok(Number(one(await svc(`SELECT count(*) FROM public.declutter_porch_places WHERE seller_id = '${SELLER2}'`))) === 5, "  the seller has exactly 5");
const spot5 = one(await svc(`SELECT id FROM public.declutter_porch_places WHERE seller_id = '${SELLER2}' AND label = 'Spot 5'`));
ok(refused(await me(BUYER, `SELECT public.declutter_delete_porch_place('${spot5}')`), /porch_place_not_found/), "another member cannot delete the seller's place");
ok(refused(await save(BUYER, spot5, "Mine now", "1 Thief Way, Baton Rouge", "Baton Rouge", ITEM_PT, [1]), /porch_place_not_found/), "  or edit it");
ok(typeof one(await me(SELLER2, `SELECT public.declutter_delete_porch_place('${spot5}') AS id`)) === "string", "the seller deletes their own place");
ok(refused(await save(SELLER2, null, "Bad", "12 Home Street", "Lafayette", HOME, [7]), /invalid_porch_days/), "a weekday outside 0-6 is refused");
ok(refused(await save(SELLER2, null, "", "12 Home Street", "Lafayette", HOME, [1]), /invalid_porch_place/), "a place with no name is refused");
ok(refused(await me(OUTSIDER, `SELECT public.declutter_save_porch_place(NULL, 'X', '1 Long Street, Town', 'Town', 30, -91, ARRAY[1]::smallint[])`), /feature_disabled/),
  "an account without Declutter cannot save a place");
ok(refused(await me(SELLER2, `SELECT * FROM public.declutter_porch_places`), /permission denied/), "no direct table reads, even for the seller");
ok(refused(await me(SELLER2, `INSERT INTO public.declutter_porch_place_choices (buyer_id, seller_id, place_id) VALUES ('${SELLER2}', '${SELLER2}', '${home}')`), /permission denied/),
  "no direct writes to the choices");

// 2. The buyer sees label, area and days (never an address), picks a place, and checkout freezes it.
ok(Array.isArray(await me(BUYER, `SELECT * FROM public.declutter_seller_porch_places('${SELLER2}')`))
   && (await me(BUYER, `SELECT * FROM public.declutter_seller_porch_places('${SELLER2}')`)).length === 0,
  "with nothing in the cart, the buyer sees no places");
await addToCart(1, BUYER);
const seen = await me(BUYER, `SELECT * FROM public.declutter_seller_porch_places('${SELLER2}')`);
ok(Array.isArray(seen) && seen.length === 4 && seen.every((r) => !("address" in r) && !("lat" in r)) && seen[0].label === "Home",
  `with the seller's item in the cart, the buyer sees 4 places by label and area, no address (${short(seen)})`);
const noPick = await me(BUYER, `SELECT * FROM public.declutter_start_checkout('${SELLER2}', 'porch')`);
ok(refused(noPick, /porch_place_needed/), `porch checkout without a pick: porch_place_needed${refused(noPick, /porch_place_needed/) ? "" : ` (got ${short(noPick)})`}`);
ok(Number(one(await svc(`SELECT count(*) FROM public.declutter_orders WHERE buyer_id = '${BUYER}' AND seller_id = '${SELLER2}'`))) === 0,
  "  and no order row exists");
const otherSellers = one(await svc(`SELECT id FROM public.declutter_porch_places WHERE seller_id <> '${SELLER2}' LIMIT 1`));
void otherSellers;
ok(refused(await me(BUYER, `SELECT public.declutter_set_porch_place('${SELLER2}', gen_random_uuid())`), /porch_place_unavailable/), "a place that isn't the seller's is refused");
ok(one(await me(BUYER, `SELECT public.declutter_set_porch_place('${SELLER2}', '${home}') AS id`)) === home, "the buyer picks Home");
const co = (await me(BUYER, `SELECT * FROM public.declutter_start_checkout('${SELLER2}', 'porch')`))?.[0];
ok(co?.order_id, `porch checkout opens an order${co?.order_id ? "" : ""}`);
const frozen = (await svc(`SELECT * FROM public.declutter_order_porch_places WHERE order_id = '${co?.order_id}'`))?.[0];
ok(frozen?.address === "12 Home Street, Lafayette" && JSON.stringify(frozen?.weekdays) === JSON.stringify([todayDow]),
  `the place and its weekdays are frozen on the order (${short(frozen)})`);
// Before paying the buyer sees the label only; the seller sees the address.
const unpaid = (await me(BUYER, `SELECT * FROM public.declutter_order_place('${co?.order_id}')`))?.[0];
ok(unpaid?.label === "Home" && unpaid?.address == null && unpaid?.lat == null, `before paying, the buyer's order place has no address (${short(unpaid)})`);
ok(refused(await me(BUYER2, `SELECT * FROM public.declutter_order_place('${co?.order_id}')`), /item_not_found/), "a stranger cannot read the order's place");
// Same pick again: the same open order. A changed pick: a new order.
const again = (await me(BUYER, `SELECT * FROM public.declutter_start_checkout('${SELLER2}', 'porch')`))?.[0];
ok(again?.order_id === co?.order_id, "the same place again reuses the open order");
await me(BUYER, `SELECT public.declutter_set_porch_place('${SELLER2}', '${camp}')`);
const moved = (await me(BUYER, `SELECT * FROM public.declutter_start_checkout('${SELLER2}', 'porch')`))?.[0];
ok(moved?.order_id && moved.order_id !== co?.order_id, "a different place opens a new order (the old one superseded)");
ok(one(await svc(`SELECT address FROM public.declutter_order_porch_places WHERE order_id = '${moved?.order_id}'`)) === "99 Camp Road, New Orleans", "  frozen at Camp");
await me(BUYER, `SELECT public.declutter_set_porch_place('${SELLER2}', '${home}')`);
const P = (await me(BUYER, `SELECT * FROM public.declutter_start_checkout('${SELLER2}', 'porch')`))?.[0];
await svc(`SELECT public.declutter_mark_order_paid('${P?.order_id}', 'pi_place_1', ${P?.total_cents}, now(), 150)`);
ok(one(await svc(`SELECT status FROM public.declutter_orders WHERE id = '${P?.order_id}'`)) === "paid", "fixture: the Home order is paid");

// 3. The seller edits Home after the sale: the order keeps the frozen copy.
await save(SELLER2, home, "Home", "1 Moved Avenue, Lafayette", "Lafayette", CAMP, [otherDow]);
const paidPlace = (await me(BUYER, `SELECT * FROM public.declutter_order_place('${P?.order_id}')`))?.[0];
ok(paidPlace?.address === "12 Home Street, Lafayette", `after paying, the buyer gets the FROZEN address, not the edit (${short(paidPlace)})`);
const addr = (await me(BUYER, `SELECT * FROM public.declutter_item_address('${I(1)}')`))?.[0];
ok(addr?.pickup_address === "12 Home Street, Lafayette" && Number(addr?.pickup_lat) === HOME.lat,
  `declutter_item_address gives the paid buyer the chosen place, not the item's own address (${short(addr)})`);

// 4. Days: the frozen place's weekdays only.
const days = await me(BUYER, `SELECT d::text FROM public.declutter_porch_days('${P?.order_id}') d`);
const dows = Array.isArray(days) ? await Promise.all(days.map(async (r) => Number(one(await svc(`SELECT extract(dow FROM '${r.d}'::date)::int`))))) : [];
ok(Array.isArray(days) && days.length >= 1 && dows.every((w) => w === todayDow), `only the frozen place's weekday is offered (${dows.join(",")})`);
const tomorrow = one(await svc(`SELECT ((now() AT TIME ZONE 'America/Chicago')::date + 1)::text`));
ok(refused(await me(BUYER, `SELECT public.declutter_book_porch_day('${P?.order_id}', '${tomorrow}'::date)`), /invalid_day/),
  "a day that isn't the place's weekday is refused (even though the edited place and the pickup times allow it)");
const booked = await me(BUYER, `SELECT public.declutter_book_porch_day('${P?.order_id}', '${today}'::date) AS r`);
ok(one(booked)?.result === "booked", `today (the place's day) books${Array.isArray(booked) ? "" : `: ${booked?.error}`}`);

// 5. The porch photos are measured from the frozen place, not the item's address.
const atItem = await me(SELLER2, `SELECT public.declutter_porch_photo('${P?.order_id}', '${await photo(SELLER2, P?.order_id, "item")}', ${pt(ITEM_PT)})`);
ok(refused(atItem, /not_at_pickup/), `a photo at the item's own address is refused: not_at_pickup${refused(atItem, /not_at_pickup/) ? "" : ` (got ${short(atItem)})`}`);
const atHome = await me(SELLER2, `SELECT public.declutter_porch_photo('${P?.order_id}', '${await photo(SELLER2, P?.order_id, "home")}', ${pt(HOME)}) AS r`);
ok(one(atHome)?.result === "set_out", `a photo at the chosen place is taken${Array.isArray(atHome) ? "" : `: ${atHome?.error}`}`);

// 6. Helpr delivery picks up at the chosen place.
await addToCart(2, BUYER2, 2500);
await svc(`INSERT INTO public.declutter_delivery_dropoffs (buyer_id, seller_id, address, area_label, lat, lng, geocoded_at)
  VALUES ('${BUYER2}', '${SELLER2}', '5 Buyer Street, Lafayette', 'Lafayette', 30.21, -92.01, now())
  ON CONFLICT (buyer_id, seller_id) DO UPDATE SET geocoded_at = now()`);
const dNoPick = await me(BUYER2, `SELECT * FROM public.declutter_start_checkout('${SELLER2}', 'delivery')`);
ok(refused(dNoPick, /porch_place_needed/), `Helpr delivery without a pick: porch_place_needed${refused(dNoPick, /porch_place_needed/) ? "" : ` (got ${short(dNoPick)})`}`);
await me(BUYER2, `SELECT public.declutter_set_porch_place('${SELLER2}', '${camp}')`);
const D = (await me(BUYER2, `SELECT * FROM public.declutter_start_checkout('${SELLER2}', 'delivery')`))?.[0];
ok(D?.order_id, `Helpr delivery checkout opens an order${D?.order_id ? "" : ""}`);
await svc(`SELECT public.declutter_mark_order_paid('${D?.order_id}', 'pi_place_2', ${D?.total_cents}, now(), 150)`);
const task = (await svc(`SELECT t.pickup_address, t.pickup_area, t.pickup_lat FROM public.helpr_tasks t
  JOIN public.declutter_order_deliveries od ON od.task_id = t.id WHERE od.order_id = '${D?.order_id}'`))?.[0];
ok(task?.pickup_address === "99 Camp Road, New Orleans" && task?.pickup_area === "New Orleans",
  `the Helpr task picks up at the chosen place (${short(task)})`);

// 7. The seller's account going clears the address on the orders that stay.
await svc(`UPDATE public.declutter_order_porch_places SET seller_id = NULL WHERE order_id = '${P?.order_id}'`);
const scrubbed = (await svc(`SELECT address, lat, label FROM public.declutter_order_porch_places WHERE order_id = '${P?.order_id}'`))?.[0];
ok(scrubbed && scrubbed.address === null && scrubbed.lat === null && scrubbed.label === null, `seller gone: the frozen address is cleared (${short(scrubbed)})`);

// 8. A seller with no places: exactly as before (item address, pickup-time days).
const S1 = USERS.SELLER;
await run(liveItemSql({ id: I(9), seller: S1, title: "Old way item", price: 900, floor: 100 }));
await me(BUYER2, `SELECT public.declutter_buy_now('${I(9)}', 900)`);
const old = (await me(BUYER2, `SELECT * FROM public.declutter_start_checkout('${S1}', 'porch')`))?.[0];
ok(old?.order_id, `a seller with no places: porch checkout as before${old?.order_id ? "" : ""}`);
ok(Number(one(await svc(`SELECT count(*) FROM public.declutter_order_porch_places WHERE order_id = '${old?.order_id}'`))) === 0, "  and nothing is frozen");

// 9. Grants.
const acl = async (role, fn) => one(await svc(`SELECT has_function_privilege('${role}', 'public.${fn}', 'EXECUTE')`));
ok(await acl("authenticated", "declutter_order_pickup_points(uuid)") === false && await acl("authenticated", "declutter_order_is_porch_day(uuid, smallint)") === false,
  "the two helpers are internal");
let anonNone = true;
for (const fn of ["declutter_save_porch_place(uuid, text, text, text, numeric, numeric, smallint[])", "declutter_delete_porch_place(uuid)",
  "declutter_my_porch_places()", "declutter_seller_porch_places(uuid)", "declutter_set_porch_place(uuid, uuid)", "declutter_order_place(uuid)"]) {
  if (await acl("anon", fn) !== false) anonNone = false;
}
ok(anonNone, "anon cannot call any new RPC (REVOKE FROM PUBLIC, anon)");

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
