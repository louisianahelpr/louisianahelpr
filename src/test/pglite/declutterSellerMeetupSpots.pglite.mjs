#!/usr/bin/env node
/**
 * PGlite proof for 20261101194608_declutter_seller_meetup_spots (B110, owner 11-01 1:00 PM): a seller's own meet
 * spots (save / edit / remove, owner only, max 10, a public place in Louisiana, valid days and times); a buyer sees
 * and picks only THAT seller's spots (plus admin spots near); a meetup time keeps to the spot's days and times;
 * police spots are suggestions; members still cannot read the table.
 *
 *   node src/test/pglite/declutterSellerMeetupSpots.pglite.mjs                    # GREEN
 *   NEW_MIGRATION=skip node src/test/pglite/declutterSellerMeetupSpots.pglite.mjs # RED: without it
 *   MIGRATION_PATH=<planted copy> node ...                                        # RED on a planted defect
 */
import { readFileSync } from "node:fs";
import { buildHandoverWorld, MIG_DIR } from "../../../scripts/declutter/handoverPhotoWorld.mjs";

const NEW_FILE = "20261101194608_declutter_seller_meetup_spots.sql";
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
const { SELLER, SELLER2, BUYER, BUYER2 } = USERS;

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
    const r = await run(sql + "\n" + readFileSync(`${MIG_DIR}20261101195154_declutter_chosen_meetup_hours.sql`, "utf8"));
    ok(!r?.error, `the migration applies (run ${i + 1} of 3)${r?.error ? `: ${r.error}` : ""}`);
  }
}
const acl = one(await svc(`SELECT has_function_privilege('authenticated', 'public.declutter_save_my_meetup_spot(uuid, text, text, text, numeric, numeric, jsonb)', 'EXECUTE')
  AND NOT has_function_privilege('anon', 'public.declutter_save_my_meetup_spot(uuid, text, text, text, numeric, numeric, jsonb)', 'EXECUTE')
  AND has_function_privilege('authenticated', 'public.declutter_remove_my_meetup_spot(uuid)', 'EXECUTE')
  AND has_function_privilege('authenticated', 'public.declutter_meetup_spot_suggestions()', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'public.declutter_meetup_spot_near_lines(uuid, uuid[])', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'public.declutter_meetup_windows_ok(jsonb)', 'EXECUTE')
  AND has_function_privilege('authenticated', 'public.declutter_chosen_meetup_hours(uuid)', 'EXECUTE')
  AND NOT has_function_privilege('anon', 'public.declutter_chosen_meetup_hours(uuid)', 'EXECUTE')`));
ok(acl === true, `grants: the seller RPCs for signed-in members, not anon; the helpers service_role only (got ${short(acl)})`);


await svc(`INSERT INTO public.declutter_pickup_windows (seller_id, weekday, starts_local, ends_local)
  SELECT '${SELLER2}', d, '09:00', '17:00' FROM generate_series(0, 6) d ON CONFLICT DO NOTHING`);
const at = (days, hhmm) => `((now() AT TIME ZONE 'America/Chicago')::date + ${days} + time '${hhmm}') AT TIME ZONE 'America/Chicago'`;
const iso = async (expr) => one(await svc(`SELECT to_char((${expr}) AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')`));
const dowTomorrow = Number(one(await svc(`SELECT extract(dow FROM (now() AT TIME ZONE 'America/Chicago')::date + 1)::int`)));
const I = (n) => `efefefef-0000-0000-0000-${String(n).padStart(12, "0")}`;
const save = (uid, id, name, lat = 30.0, windows = null) => me(uid, `SELECT public.declutter_save_my_meetup_spot(${id ? `'${id}'` : "NULL"}, '${name}', '123 Main St, New Iberia, LA', 'New Iberia', ${lat}, -91.8${windows ? `, '${JSON.stringify(windows)}'::jsonb` : ""}) AS id`);
const idOf = (r) => (Array.isArray(r) ? r[0]?.id : null);

// 1. Save, validate, owner-only edit, the cap.
const win = [{ weekday: dowTomorrow, starts: "10:00", ends: "12:00" }];
const s1 = idOf(await save(SELLER2, null, "Walmart parking lot", 30.0, win));
ok(!!s1, "a seller saves a meet spot with its days and times");
ok(refused(await save(SELLER2, null, "Out of state", 40.5), /invalid_meetup_spot/), "a spot outside Louisiana is refused");
ok(refused(await save(SELLER2, null, "Bad time", 30.0, [{ weekday: 9, starts: "10:00", ends: "12:00" }]), /invalid_meetup_times/), "a bad day is refused");
ok(refused(await save(SELLER2, null, "Too short", 30.0, [{ weekday: 1, starts: "10:00", ends: "10:15" }]), /invalid_meetup_times/), "a time under 30 minutes is refused");
ok(refused(await save(BUYER, s1, "Hijack"), /meetup_spot_not_found/), "another member cannot edit the seller's spot");
ok(refused(await me(BUYER, `SELECT public.declutter_remove_my_meetup_spot('${s1}')`), /meetup_spot_not_found/), "  or remove it");
const mine = await me(SELLER2, `SELECT * FROM public.declutter_my_meetup_spots()`);
ok(Array.isArray(mine) && mine.length === 1 && mine[0].name === "Walmart parking lot", `the seller lists their own spots (${short(mine)})`);
ok(Array.isArray(await me(BUYER, `SELECT * FROM public.declutter_my_meetup_spots()`)) && (await me(BUYER, `SELECT * FROM public.declutter_my_meetup_spots()`)).length === 0, "  and nobody else's");
for (let k = 0; k < 9; k++) await save(SELLER, null, `Spot ${k}`);
ok(!!idOf(await save(SELLER, null, "Spot 9")), "a 10th spot saves");
ok(refused(await save(SELLER, null, "Spot 10"), /too_many_meetup_spots/), "an 11th is refused");
const otherSpot = idOf(await me(SELLER, `SELECT id FROM public.declutter_my_meetup_spots() LIMIT 1`));

// 2. The table stays closed to members.
const direct = await me(BUYER, `SELECT id FROM public.declutter_meetup_spots`);
ok(!Array.isArray(direct) || direct.length === 0, `members read no spot rows directly (${short(direct)})`);

// 3. Checkout: only this seller's spots; the time keeps to the spot's hours.
await run(liveItemSql({ id: I(1), seller: SELLER2, title: "Meet chair", price: 2000, floor: 100 }));
await svc(`UPDATE public.declutter_items SET status = 'reserved' WHERE id = '${I(1)}'`);
await svc(`INSERT INTO public.declutter_cart_items (item_id, buyer_id, seller_id, price_cents, source, status, checkout_by)
  VALUES ('${I(1)}', '${BUYER}', '${SELLER2}', 2000, 'buy', 'in_cart', now() + interval '30 minutes')`);
const near = await me(BUYER, `SELECT * FROM public.declutter_meetup_spots_near('${SELLER2}')`);
ok(Array.isArray(near) && near.some((x) => x.id === s1) && !near.some((x) => x.id === otherSpot),
  `the buyer sees this seller's spot (any distance) and not another seller's (${short(near)})`);
ok(refused(await me(BUYER, `SELECT public.declutter_set_meetup_spot('${SELLER2}', '${otherSpot}')`), /meetup_spot_unavailable/), "another seller's spot cannot be picked");
ok(Array.isArray(await me(BUYER, `SELECT public.declutter_set_meetup_spot('${SELLER2}', '${s1}')`)), "the seller's spot is picked");
const hours = one(await me(BUYER, `SELECT public.declutter_chosen_meetup_hours('${SELLER2}') AS h`));
ok(Array.isArray(hours) && hours.length === 1 && hours[0].starts === "10:00", `the buyer reads the chosen spot's days and times for the chips (${short(hours)})`);
const strangerHours = one(await me(BUYER2, `SELECT public.declutter_chosen_meetup_hours('${SELLER2}') AS h`));
ok(strangerHours === null, `  another buyer (no choice) reads none (${short(strangerHours)})`);
const outside = await me(BUYER, `SELECT * FROM public.declutter_start_checkout('${SELLER2}', 'meetup', '${await iso(at(1, "15:00"))}'::timestamptz)`);
ok(refused(outside, /invalid_slot/), `3 PM (inside the seller's pickup times, outside the spot's 10-12): refused (${short(outside)})`);
const inside = await me(BUYER, `SELECT * FROM public.declutter_start_checkout('${SELLER2}', 'meetup', '${await iso(at(1, "10:30"))}'::timestamptz)`);
ok(Array.isArray(inside) && inside[0]?.order_id, `10:30 AM at the spot: checkout opens (${short(inside)})`);
const frozen = (await svc(`SELECT spot_name FROM public.declutter_order_meetups WHERE order_id = '${inside?.[0]?.order_id}'`))?.[0];
ok(frozen?.spot_name === "Walmart parking lot", "the spot is frozen on the order");

// 4. Removed: no longer offered.
ok(Array.isArray(await me(SELLER2, `SELECT public.declutter_remove_my_meetup_spot('${s1}')`)), "the seller removes the spot");
const after = await me(BUYER, `SELECT * FROM public.declutter_meetup_spots_near('${SELLER2}')`);
ok(Array.isArray(after) && !after.some((x) => x.id === s1), "  and buyers no longer see it");

// 5. Suggestions: the admin police spots only.
await svc(`INSERT INTO public.declutter_meetup_spots (parish, name, address, lat, lng, kind) VALUES
  ('Iberia', 'Iberia Sheriff Safe Zone', '300 Iberia St, New Iberia, LA', 30.0, -91.8, 'police'),
  ('Iberia', 'Corner store', '1 Store Rd, New Iberia, LA', 30.0, -91.8, 'store')`);
const sug = await me(SELLER2, `SELECT * FROM public.declutter_meetup_spot_suggestions()`);
ok(Array.isArray(sug) && sug.some((x) => x.name === "Iberia Sheriff Safe Zone") && !sug.some((x) => x.name === "Corner store" || x.name === "Walmart parking lot"),
  `suggestions are the police spots only (${short(sug)})`);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
