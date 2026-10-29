#!/usr/bin/env node
/**
 * PGlite proof for 20261029002010_declutter_handover_photos_live_only (anti-lying #2, owner 2026-10-28: "handover
 * photos come from the camera at that moment, and are timestamped server-side; uploads older than a few minutes are
 * refused"). Every handover photo RPC refuses a photo whose storage object was uploaded more than 10 minutes before
 * the step (storage.objects.created_at, the storage server's own clock) with photo_too_old; a fresh one goes through.
 * Covered: the porch photo (seller and buyer), the seller's door photo, the seller-delivery photo, and the Helpr's
 * pickup, drop-off and seller-away photos (through helpr_task_photo_ok). A photo-less "Picked up" is unchanged.
 *
 *   node src/test/pglite/declutterHandoverPhotosLive.pglite.mjs                    # GREEN
 *   NEW_MIGRATION=skip node src/test/pglite/declutterHandoverPhotosLive.pglite.mjs # RED: the chain without it
 *   MIGRATION_PATH=<planted copy> node ...                                         # RED on a planted defect
 *
 * World: scripts/declutter/handoverPhotoWorld.mjs, then 20261028235709 (photos at the address) once.
 */
import { readFileSync } from "node:fs";
import { buildHandoverWorld, MIG_DIR } from "../../../scripts/declutter/handoverPhotoWorld.mjs";

const NEW_FILE = "20261029002010_declutter_handover_photos_live_only.sql";
const AT_ADDRESS_FILE = "20261028235709_declutter_handover_photos_at_the_address.sql";
const skip = process.env.NEW_MIGRATION === "skip";
if (skip) console.log("NEW_MIGRATION=skip: running WITHOUT the new migration (expect FAILs)");
const { svc, run, one, me, refused, liveItemSql, USERS } = await buildHandoverWorld();
const { SELLER, SELLER2, BUYER, BUYER2, BUYER3 } = USERS;

let pass = 0;
let fail = 0;
const ok = (cond, label) => { if (cond) pass++; else fail++; console.log(`${cond ? "PASS" : "FAIL"}  ${label}`); };

{
  const r = await run(readFileSync(`${MIG_DIR}${AT_ADDRESS_FILE}`, "utf8"));
  ok(!r?.error, `the photos-at-the-address migration (this one's base) applies${r?.error ? `: ${r.error}` : ""}`);
}
if (!skip) {
  const sql = readFileSync(process.env.MIGRATION_PATH ?? `${MIG_DIR}${NEW_FILE}`, "utf8");
  for (let i = 0; i < 3; i++) {
    const r = await run(sql);
    ok(!r?.error, `the migration applies (run ${i + 1} of 3)${r?.error ? `: ${r.error}` : ""}`);
  }
}

const PICKUP = { lat: 30.451234, lng: -91.154321 };
const DROPOFF = { lat: 30.496234, lng: -91.154321 };
const pt = (p) => `${p.lat}, ${p.lng}`;
const I = (n) => `aaaaaaaa-0000-0000-0000-${String(n).padStart(12, "0")}`;
const status = async (id) => one(await svc(`SELECT status FROM public.declutter_orders WHERE id = '${id}'`));
// A photo object uploaded `agoMin` minutes ago, by the storage server's clock.
const photo = async (bucket, path, agoMin) => {
  await svc(`INSERT INTO storage.objects (bucket_id, name, created_at) VALUES ('${bucket}', '${path}', now() - interval '${agoMin} minutes')`);
  return path;
};
const hp = (uid, orderId, name, agoMin) => photo("declutter-handover", `${uid}/declutter/handover/${orderId}/${name}.jpg`, agoMin);
await svc(`INSERT INTO public.declutter_pickup_windows (seller_id, weekday, starts_local, ends_local)
  SELECT s, d, '00:00', '23:59' FROM unnest(ARRAY['${SELLER}', '${SELLER2}']::uuid[]) s, generate_series(0, 6) d ON CONFLICT DO NOTHING`);
async function paidOrder(n, buyer, seller, price, how) {
  await run(liveItemSql({ id: I(n), seller, title: `Live photo item ${n}`, price, floor: Math.min(price, 100) }));
  await me(buyer, `SELECT public.declutter_buy_now('${I(n)}', ${price})`);
  const o = (await me(buyer, `SELECT * FROM public.declutter_start_checkout('${seller}', '${how}')`))?.[0];
  await svc(`SELECT public.declutter_mark_order_paid('${o?.order_id}', 'pi_live_${n}', ${o?.total_cents}, now(), 150)`);
  return o ?? {};
}
const TOO_OLD = /photo_too_old/;

// 1. The porch: both sides' photos are live.
{
  const P = await paidOrder(1, BUYER, SELLER2, 1200, "porch");
  const today = one(await svc(`SELECT (now() AT TIME ZONE 'America/Chicago')::date::text`));
  await me(BUYER, `SELECT public.declutter_book_porch_day('${P.order_id}', '${today}'::date)`);
  ok(P.order_id && await status(P.order_id) === "paid", "fixture: a paid, booked porch order");
  const old = await hp(SELLER2, P.order_id, "old", 11);
  ok(refused(await me(SELLER2, `SELECT public.declutter_porch_photo('${P.order_id}', '${old}', ${pt(PICKUP)})`), TOO_OLD),
    "the seller's porch photo uploaded 11 minutes ago: photo_too_old");
  ok(!one(await svc(`SELECT set_out_photo_path FROM public.declutter_handovers WHERE order_id = '${P.order_id}'`)), "  and it is not saved");
  const nine = await hp(SELLER2, P.order_id, "nine", 9);
  ok(one(await me(SELLER2, `SELECT public.declutter_porch_photo('${P.order_id}', '${nine}', ${pt(PICKUP)}) AS r`))?.result === "set_out",
    "one uploaded 9 minutes ago is taken (inside the 10 minutes)");
  const bOld = await hp(BUYER, P.order_id, "b-old", 30);
  ok(refused(await me(BUYER, `SELECT public.declutter_porch_photo('${P.order_id}', '${bOld}', ${pt(PICKUP)})`), TOO_OLD),
    "the buyer's porch pickup photo uploaded 30 minutes ago: photo_too_old");
  ok(await status(P.order_id) === "paid", "  and the seller is not paid on it");
  const bNow = await hp(BUYER, P.order_id, "b-now", 0);
  ok(one(await me(BUYER, `SELECT public.declutter_porch_photo('${P.order_id}', '${bNow}', ${pt(PICKUP)}) AS r`))?.result === "picked_up",
    "a fresh one: picked up");
}

// 2. The seller's door photo; a photo-less "Picked up" is unchanged.
{
  const D = await paidOrder(2, BUYER2, SELLER2, 1500, "pickup_home");
  await me(BUYER2, `SELECT public.declutter_book_pickup('${D.order_id}', now() + interval '1 day')`);
  await svc(`UPDATE public.declutter_bookings SET slot_start = now() - interval '5 minutes', slot_end = now() + interval '25 minutes' WHERE order_id = '${D.order_id}'`);
  const old = await hp(SELLER2, D.order_id, "door-old", 60 * 24);
  ok(refused(await me(SELLER2, `SELECT public.declutter_seller_picked_up('${D.order_id}', '${old}', ${pt(PICKUP)})`), TOO_OLD),
    "the seller's door photo uploaded a day ago: photo_too_old");
  ok(await status(D.order_id) === "paid", "  and the sale is not handed over");
  const r = await me(SELLER2, `SELECT public.declutter_seller_picked_up('${D.order_id}', NULL)`);
  ok(Array.isArray(r) && await status(D.order_id) === "handed_over", `"Picked up" with no photo is unchanged${Array.isArray(r) ? "" : `: ${r?.error}`}`);
}

// 3. The seller-delivery photo.
{
  await me(SELLER, `SELECT public.declutter_set_seller_delivery(true, 2000, 10)`);
  const windows = JSON.stringify([0, 1, 2, 3, 4, 5, 6].map((d) => ({ weekday: d, starts: "09:00", ends: "17:00" })));
  await me(SELLER, `SELECT public.declutter_set_delivery_schedule('${windows}'::jsonb, ARRAY[]::date[])`);
  await run(liveItemSql({ id: I(3), seller: SELLER, title: "Delivered item", price: 5000, floor: 100 }));
  await me(BUYER3, `SELECT public.declutter_buy_now('${I(3)}', 5000)`);
  await svc(`SELECT public.declutter_set_delivery_dropoff('${BUYER3}', '${SELLER}', '500 Drop Rd, Baton Rouge, LA 70805', 'North Baton Rouge', ${pt(DROPOFF)})`);
  const slot = one(await me(BUYER3, `SELECT public.declutter_seller_delivery_offer('${SELLER}')`))?.slots?.[0];
  const S = (await me(BUYER3, `SELECT * FROM public.declutter_start_checkout('${SELLER}', 'seller_delivery', '${slot}', 'leave')`))?.[0];
  await svc(`SELECT public.declutter_mark_order_paid('${S?.order_id}', 'pi_live_sd', ${S?.total_cents}, now(), 150)`);
  await svc(`UPDATE public.declutter_seller_deliveries SET slot_start = now() - interval '2 hours', slot_end = now() - interval '1 hour' WHERE order_id = '${S?.order_id}'`);
  ok(!!S?.order_id && await status(S.order_id) === "paid", "fixture: a paid seller delivery past its time");
  const old = await hp(SELLER, S?.order_id, "left-old", 15);
  ok(refused(await me(SELLER, `SELECT public.declutter_seller_delivered('${S?.order_id}', '${old}', ${pt(DROPOFF)})`), TOO_OLD),
    "the \"left at your door\" photo uploaded 15 minutes ago: photo_too_old");
  const fresh = await hp(SELLER, S?.order_id, "left-now", 1);
  ok(one(await me(SELLER, `SELECT public.declutter_seller_delivered('${S?.order_id}', '${fresh}', ${pt(DROPOFF)}) AS r`))?.result === "delivered",
    "a photo from a minute ago: delivered");
}

// 4. The Helpr's task photos (helpr_task_photo_ok): pickup, drop-off, seller away.
{
  const O = await paidOrder(4, BUYER, SELLER2, 2000, "pickup_home");
  const T = I(500);
  await run(`SET session_replication_role = replica;
    INSERT INTO public.helpr_tasks (id, source_kind, source_id, status, size, title, pickup_area, dropoff_area, pickup_address, pickup_lat, pickup_lng,
      dropoff_address, dropoff_lat, dropoff_lng, trip_miles, pay_cents, fee_cents, open_until, latest_pickup_at, dropoff_code, helpr_id,
      pickup_slot_start, customer_id, pickup_contact_id, accepted_at)
    VALUES ('${T}', 'declutter_delivery', '${O.order_id}', 'accepted', 'small', 'Live chair', 'Mid-City', 'North BR', '1 A St', ${pt(PICKUP)},
      '2 B St', ${pt(DROPOFF)}, 3, 1500, 150, now() + interval '1 day', now() + interval '2 days', '1234', '${BUYER2}',
      now() - interval '30 minutes', '${BUYER}', '${SELLER2}', now() - interval '1 hour');
    SET session_replication_role = origin;`);
  const tp = (name, ago) => photo("helpr-tasks", `${BUYER2}/task/${T}/${name}.jpg`, ago);
  const away = await tp("away-old", 20);
  ok(refused(await me(BUYER2, `SELECT public.helpr_task_pickup_no_show('${T}', '${away}', ${pt(PICKUP)})`), TOO_OLD),
    "the Helpr's \"seller not there\" photo uploaded 20 minutes ago: photo_too_old");
  const pOld = await tp("pick-old", 12);
  ok(refused(await me(BUYER2, `SELECT public.helpr_task_picked_up('${T}', '${pOld}', ${pt(PICKUP)})`), TOO_OLD),
    "the Helpr's pickup photo uploaded 12 minutes ago: photo_too_old");
  ok(one(await svc(`SELECT status FROM public.helpr_tasks WHERE id = '${T}'`)) === "accepted", "  and the task is not picked up");
  ok(refused(await me(BUYER2, `SELECT public.helpr_task_picked_up('${T}', '${BUYER2}/task/${T}/never.jpg', ${pt(PICKUP)})`), /photo_not_uploaded/),
    "a photo that was never uploaded: photo_not_uploaded (unchanged)");
  const pNow = await tp("pick-now", 0);
  const pr = await me(BUYER2, `SELECT public.helpr_task_picked_up('${T}', '${pNow}', ${pt(PICKUP)}) AS r`);
  ok(one(pr)?.result === "picked_up", `a fresh pickup photo: picked up${Array.isArray(pr) ? "" : `: ${pr?.error}`}`);
  const dOld = await tp("drop-old", 45);
  ok(refused(await me(BUYER2, `SELECT public.helpr_task_delivered('${T}', '${dOld}', ${pt(DROPOFF)}, NULL)`), TOO_OLD),
    "the Helpr's drop-off photo uploaded 45 minutes ago: photo_too_old");
  const dNow = await tp("drop-now", 2);
  const dr = await me(BUYER2, `SELECT public.helpr_task_delivered('${T}', '${dNow}', ${pt(DROPOFF)}, NULL) AS r`);
  ok(one(dr)?.result === "delivered", `a drop-off photo from 2 minutes ago: delivered${Array.isArray(dr) ? "" : `: ${dr?.error}`}`);
}

// 5. The freshness check is internal; grants unchanged.
const acl = async (s, role) => one(await svc(`SELECT has_function_privilege('${role}', '${s}', 'EXECUTE')`));
ok(await acl("public.handover_photo_is_fresh(text, text)", "authenticated") === false && await acl("public.handover_photo_is_fresh(text, text)", "anon") === false,
  "members cannot call handover_photo_is_fresh directly");
ok(await acl("public.helpr_task_photo_ok(uuid, uuid, text)", "authenticated") === false, "nor helpr_task_photo_ok (unchanged)");
for (const s of ["public.declutter_seller_picked_up(uuid, text, numeric, numeric)", "public.declutter_seller_delivered(uuid, text, numeric, numeric)",
  "public.declutter_porch_photo(uuid, text, numeric, numeric)"]) {
  ok(await acl(s, "anon") === false && await acl(s, "authenticated") === true, `${s}: anon revoked, members granted`);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
