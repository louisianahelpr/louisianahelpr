#!/usr/bin/env node
/**
 * PGlite proof for 20261028235709_declutter_handover_photos_at_the_address (anti-lying #1, owner 2026-10-28:
 * "every handover photo is checked against the right address's location"). The seller's three handover photos
 * that had no location check now need the device's position within 200 m of the right place:
 *   - the porch "Left on porch" photo: the item's pickup point (as the buyer's porch "Picked up" already was);
 *   - the seller-delivery "Delivered" photo: the buyer's drop-off point;
 *   - the "Picked up" photo at the door (pickup point) or at a safe meeting spot (the spot frozen on the order).
 * The distance is stored, never the position. A seller "Picked up" with no photo is unchanged (the photo is optional).
 *
 *   node src/test/pglite/declutterHandoverPhotosAtAddress.pglite.mjs                    # GREEN
 *   NEW_MIGRATION=skip node src/test/pglite/declutterHandoverPhotosAtAddress.pglite.mjs # RED: the chain without it
 *   MIGRATION_PATH=<planted copy> node ...                                              # RED on a planted defect
 *
 * World: scripts/declutter/handoverPhotoWorld.mjs (every handover photo RPC at its newest definition).
 */
import { readFileSync } from "node:fs";
import { buildHandoverWorld, MIG_DIR } from "../../../scripts/declutter/handoverPhotoWorld.mjs";

const NEW_FILE = "20261028235709_declutter_handover_photos_at_the_address.sql";
const skip = process.env.NEW_MIGRATION === "skip";
if (skip) console.log("NEW_MIGRATION=skip: running WITHOUT the new migration (expect FAILs)");
const { svc, run, one, me, refused, liveItemSql, USERS } = await buildHandoverWorld();
const { SELLER, SELLER2, BUYER, BUYER2, BUYER3, ADMIN, OUTSIDER } = USERS;

let pass = 0;
let fail = 0;
const ok = (cond, label) => { if (cond) pass++; else fail++; console.log(`${cond ? "PASS" : "FAIL"}  ${label}`); };

if (!skip) {
  const sql = readFileSync(process.env.MIGRATION_PATH ?? `${MIG_DIR}${NEW_FILE}`, "utf8");
  for (let i = 0; i < 3; i++) {
    const r = await run(sql);
    ok(!r?.error, `the migration applies (run ${i + 1} of 3)${r?.error ? `: ${r.error}` : ""}`);
  }
}

// Places. Every fixture item's pickup point is the slice harness's (30.451234, -91.154321).
const PICKUP = { lat: 30.451234, lng: -91.154321 };
const NEAR_PICKUP = { lat: 30.4520, lng: -91.1550 }; // about 100 m away
const AWAY = { lat: 30.47, lng: -91.154321 }; // about 2 km away
const DROPOFF = { lat: 30.496234, lng: -91.154321 }; // the buyer's door for a seller delivery (about 5 km from the pickup)
const SPOT = { lat: 30.46, lng: -91.14 }; // the safe meeting spot
const pt = (p) => (p ? `${p.lat}, ${p.lng}` : "NULL, NULL");
const I = (n) => `99999999-0000-0000-0000-${String(n).padStart(12, "0")}`;
const status = async (id) => one(await svc(`SELECT status FROM public.declutter_orders WHERE id = '${id}'`));
const handover = async (id) => (await svc(`SELECT * FROM public.declutter_handovers WHERE order_id = '${id}'`))?.[0];
const photo = async (uid, orderId, name) => {
  const path = `${uid}/declutter/handover/${orderId}/${name}.jpg`;
  await svc(`INSERT INTO storage.objects (bucket_id, name) VALUES ('declutter-handover', '${path}')`);
  return path;
};
await svc(`INSERT INTO public.declutter_pickup_windows (seller_id, weekday, starts_local, ends_local)
  SELECT s, d, '00:00', '23:59' FROM unnest(ARRAY['${SELLER}', '${SELLER2}']::uuid[]) s, generate_series(0, 6) d ON CONFLICT DO NOTHING`);
async function paidOrder(n, buyer, seller, price, how) {
  await run(liveItemSql({ id: I(n), seller, title: `Handover photo item ${n}`, price, floor: Math.min(price, 100) }));
  await me(buyer, `SELECT public.declutter_buy_now('${I(n)}', ${price})`);
  const o = (await me(buyer, `SELECT * FROM public.declutter_start_checkout('${seller}', '${how}')`))?.[0];
  await svc(`SELECT public.declutter_mark_order_paid('${o?.order_id}', 'pi_hpa_${n}', ${o?.total_cents}, now(), 150)`);
  return o ?? {};
}
const pastSlot = (id) => svc(`UPDATE public.declutter_bookings SET slot_start = now() - interval '5 minutes', slot_end = now() + interval '25 minutes' WHERE order_id = '${id}'`);

// 1. The porch: the seller's "Left on porch" photo is taken at the pickup address, as the buyer's "Picked up" is.
{
  const P = await paidOrder(1, BUYER, SELLER2, 1200, "porch");
  ok(P.order_id && await status(P.order_id) === "paid", "fixture: a paid porch order");
  const today = one(await svc(`SELECT (now() AT TIME ZONE 'America/Chicago')::date::text`));
  await me(BUYER, `SELECT public.declutter_book_porch_day('${P.order_id}', '${today}'::date)`);
  const out = await photo(SELLER2, P.order_id, "out");
  const put = (p) => me(SELLER2, `SELECT public.declutter_porch_photo('${P.order_id}', '${out}', ${pt(p)}) AS r`);
  ok(refused(await put(null), /location_required/), "the seller's porch photo with no location: location_required");
  ok(refused(await put(AWAY), /not_at_pickup/), "the seller's porch photo 2 km from the pickup address: not_at_pickup");
  ok(!(await handover(P.order_id))?.set_out_photo_path, "  and nothing is saved: the buyer is not told it's out");
  const r = one(await put(NEAR_PICKUP));
  const h = await handover(P.order_id);
  ok(r?.result === "set_out" && h?.set_out_photo_path === out, `the seller's porch photo at the address is taken (${JSON.stringify(r)})`);
  ok(Number.isInteger(h?.set_out_distance_m) && h.set_out_distance_m > 0 && h.set_out_distance_m <= 200,
    `  its distance is stored, never the position (${h?.set_out_distance_m} m)`);
  // The buyer's side is unchanged.
  const got = await photo(BUYER, P.order_id, "got");
  ok(refused(await me(BUYER, `SELECT public.declutter_porch_photo('${P.order_id}', '${got}', ${pt(AWAY)})`), /not_at_pickup/),
    "the buyer's porch photo away from the address: not_at_pickup (unchanged)");
  ok(one(await me(BUYER, `SELECT public.declutter_porch_photo('${P.order_id}', '${got}', ${pt(PICKUP)}) AS r`))?.result === "picked_up",
    "the buyer's porch photo at the address: picked up (unchanged)");
}

// 2. A door pickup: the seller's optional "Picked up" photo is taken at the pickup address.
{
  const D = await paidOrder(2, BUYER2, SELLER2, 1500, "pickup_home");
  await me(BUYER2, `SELECT public.declutter_book_pickup('${D.order_id}', now() + interval '1 day')`);
  await pastSlot(D.order_id);
  const door = await photo(SELLER2, D.order_id, "door");
  ok(refused(await me(SELLER2, `SELECT public.declutter_seller_picked_up('${D.order_id}', '${door}')`), /location_required/),
    "the door photo sent the old way (no location): location_required");
  ok(refused(await me(SELLER2, `SELECT public.declutter_seller_picked_up('${D.order_id}', '${door}', ${pt(AWAY)})`), /not_at_pickup/),
    "the door photo 2 km from the pickup address: not_at_pickup");
  ok(await status(D.order_id) === "paid", "  and the sale is not handed over");
  const r = await me(SELLER2, `SELECT public.declutter_seller_picked_up('${D.order_id}', '${door}', ${pt(PICKUP)})`);
  const h = await handover(D.order_id);
  ok(Array.isArray(r) && await status(D.order_id) === "handed_over" && h?.picked_up_photo_path === door,
    `the door photo at the address hands it over${Array.isArray(r) ? "" : `: ${r?.error}`}`);
  ok(h?.picked_up_distance_m === 0, `  its distance is stored (${h?.picked_up_distance_m} m)`);
  // No photo: unchanged (the photo is optional, owner 2026-10-18).
  const N = await paidOrder(3, BUYER3, SELLER2, 900, "pickup_home");
  await me(BUYER3, `SELECT public.declutter_book_pickup('${N.order_id}', now() + interval '1 day')`);
  await pastSlot(N.order_id);
  const nr = await me(SELLER2, `SELECT public.declutter_seller_picked_up('${N.order_id}', NULL)`);
  ok(Array.isArray(nr) && await status(N.order_id) === "handed_over", `"Picked up" with no photo needs no location (unchanged)${Array.isArray(nr) ? "" : `: ${nr?.error}`}`);
}

// 3. A safe meeting spot: the seller's "Picked up" photo is taken at the spot, not at home.
{
  const spot = one(await me(ADMIN, `SELECT public.admin_declutter_save_meetup_spot(NULL, 'East Baton Rouge', 'BRPD Safe Exchange',
    '9000 Airline Hwy, Baton Rouge, LA', ${SPOT.lat}, ${SPOT.lng}, 'police', 'Lit lot', true) AS id`));
  await run(liveItemSql({ id: I(4), seller: SELLER2, title: "Meetup item", price: 2000, floor: 100 }));
  await me(BUYER, `SELECT public.declutter_buy_now('${I(4)}', 2000)`);
  await me(BUYER, `SELECT public.declutter_set_meetup_spot('${SELLER2}', '${spot}')`);
  const M = (await me(BUYER, `SELECT * FROM public.declutter_start_checkout('${SELLER2}', 'meetup')`))?.[0];
  await svc(`SELECT public.declutter_mark_order_paid('${M?.order_id}', 'pi_hpa_m', ${M?.total_cents}, now(), 150)`);
  ok(!!M?.order_id && await status(M.order_id) === "paid", "fixture: a paid meetup order");
  await me(BUYER, `SELECT public.declutter_book_pickup('${M?.order_id}', now() + interval '1 day')`);
  await pastSlot(M?.order_id);
  const meet = await photo(SELLER2, M?.order_id, "meet");
  ok(refused(await me(SELLER2, `SELECT public.declutter_seller_picked_up('${M?.order_id}', '${meet}', ${pt(PICKUP)})`), /not_at_meetup/),
    "the meetup photo taken at the seller's home (not the spot): not_at_meetup");
  ok(refused(await me(SELLER2, `SELECT public.declutter_seller_picked_up('${M?.order_id}', '${meet}', NULL, NULL)`), /location_required/),
    "the meetup photo with no location: location_required");
  const r = await me(SELLER2, `SELECT public.declutter_seller_picked_up('${M?.order_id}', '${meet}', ${pt(SPOT)})`);
  ok(Array.isArray(r) && await status(M?.order_id) === "handed_over", `the meetup photo at the spot hands it over${Array.isArray(r) ? "" : `: ${r?.error}`}`);
}

// 4. A seller delivery: the "Delivered" photo is taken at the buyer's drop-off point.
{
  await me(SELLER, `SELECT public.declutter_set_seller_delivery(true, 2000, 10)`);
  const windows = JSON.stringify([0, 1, 2, 3, 4, 5, 6].map((d) => ({ weekday: d, starts: "09:00", ends: "17:00" })));
  await me(SELLER, `SELECT public.declutter_set_delivery_schedule('${windows}'::jsonb, ARRAY[]::date[])`);
  await run(liveItemSql({ id: I(5), seller: SELLER, title: "Delivered item", price: 5000, floor: 100 }));
  await me(BUYER2, `SELECT public.declutter_buy_now('${I(5)}', 5000)`);
  await svc(`SELECT public.declutter_set_delivery_dropoff('${BUYER2}', '${SELLER}', '500 Drop Rd, Baton Rouge, LA 70805', 'North Baton Rouge', ${pt(DROPOFF)})`);
  const slot = one(await me(BUYER2, `SELECT public.declutter_seller_delivery_offer('${SELLER}')`))?.slots?.[0];
  const S = (await me(BUYER2, `SELECT * FROM public.declutter_start_checkout('${SELLER}', 'seller_delivery', '${slot}', 'leave')`))?.[0];
  await svc(`SELECT public.declutter_mark_order_paid('${S?.order_id}', 'pi_hpa_sd', ${S?.total_cents}, now(), 150)`);
  ok(!!S?.order_id && await status(S.order_id) === "paid", `fixture: a paid seller delivery (slot ${slot})`);
  await svc(`UPDATE public.declutter_seller_deliveries SET slot_start = now() - interval '2 hours', slot_end = now() - interval '1 hour' WHERE order_id = '${S?.order_id}'`);
  const left = await photo(SELLER, S?.order_id, "left");
  ok(refused(await me(SELLER, `SELECT public.declutter_seller_delivered('${S?.order_id}', '${left}')`), /location_required/),
    "the \"left at your door\" photo sent the old way (no location): location_required");
  ok(refused(await me(SELLER, `SELECT public.declutter_seller_delivered('${S?.order_id}', '${left}', ${pt(PICKUP)})`), /not_at_dropoff/),
    "the \"left at your door\" photo taken at the seller's own address: not_at_dropoff");
  ok(!(await svc(`SELECT delivered_at FROM public.declutter_seller_deliveries WHERE order_id = '${S?.order_id}'`))?.[0]?.delivered_at,
    "  and it is not marked delivered (the buyer is not told)");
  const r = one(await me(SELLER, `SELECT public.declutter_seller_delivered('${S?.order_id}', '${left}', ${pt(DROPOFF)}) AS r`));
  const h = await handover(S?.order_id);
  ok(r?.result === "delivered" && h?.set_out_photo_path === left && h?.set_out_distance_m === 0,
    `the photo at the buyer's door is taken, its distance stored (${JSON.stringify(r)}, ${h?.set_out_distance_m} m)`);
  ok(refused(await me(OUTSIDER, `SELECT public.declutter_seller_delivered('${S?.order_id}', '${left}', ${pt(DROPOFF)})`), /item_not_found/),
    "a stranger: item_not_found (unchanged)");
}

// 5. The old two-argument forms are gone (no unchecked way in); grants.
const sig = async (s) => one(await svc(`SELECT to_regprocedure('${s}') IS NOT NULL`));
ok(await sig("public.declutter_seller_picked_up(uuid, text)") === false && await sig("public.declutter_seller_delivered(uuid, text)") === false,
  "the two-argument declutter_seller_picked_up and declutter_seller_delivered are dropped");
const acl = async (s, role) => one(await svc(`SELECT has_function_privilege('${role}', '${s}', 'EXECUTE')`));
for (const s of ["public.declutter_seller_picked_up(uuid, text, numeric, numeric)", "public.declutter_seller_delivered(uuid, text, numeric, numeric)",
  "public.declutter_porch_photo(uuid, text, numeric, numeric)"]) {
  ok(await acl(s, "anon") === false && await acl(s, "authenticated") === true, `${s}: anon revoked, members granted`);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
