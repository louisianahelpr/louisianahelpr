#!/usr/bin/env node
/**
 * PGlite proof for 20261031145652_declutter_place_hours (LEAD-PLACE-TIMES, owner 2026-10-31): every pickup place has
 * its own days AND hours; places saved before get the seller's usual times copied on (nobody loses theirs); the
 * order freezes the chosen place's hours; the buyer's pickup time must sit inside them.
 *
 *   node src/test/pglite/declutterPlaceHours.pglite.mjs                    # GREEN
 *   NEW_MIGRATION=skip node src/test/pglite/declutterPlaceHours.pglite.mjs # RED: the chain on main without it
 *   MIGRATION_PATH=<planted copy> node ...                                 # RED on a planted defect
 *
 * World: scripts/declutter/handoverPhotoWorld.mjs, the bases the porch-places proof applies, then 20261030164712
 * (porch places, the newest CREATE of every function this migration restates except declutter_book_pickup, whose
 * newest is 20261015042253 in the world, and declutter_order_pickup_windows, 20261028195840), each once; places are
 * saved through the OLD 7-argument RPC, then this migration 3x.
 */
import { readFileSync } from "node:fs";
import { buildHandoverWorld, MIG_DIR } from "../../../scripts/declutter/handoverPhotoWorld.mjs";

const NEW_FILE = "20261031145652_declutter_place_hours.sql";
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

// Prod's column (20261021142959, whose triggers need tables this world lacks): only the column the item read uses.
await svc(`ALTER TABLE public.declutter_items ADD COLUMN IF NOT EXISTS seller_hidden boolean NOT NULL DEFAULT false`);
for (const f of BASES) {
  const r = await run(readFileSync(`${MIG_DIR}${f}`, "utf8"));
  ok(!r?.error, `base ${f} applies${r?.error ? `: ${r.error}` : ""}`);
}

// The owner's usual times: 7 AM to 9 PM every day. Two places saved the OLD way (days only), before this migration.
await svc(`INSERT INTO public.declutter_pickup_windows (seller_id, weekday, starts_local, ends_local)
  SELECT '${SELLER2}', d, '07:00', '21:00' FROM generate_series(0, 6) d ON CONFLICT DO NOTHING`);
const HOME = { lat: 30.2, lng: -92.0 };
const CAMP = { lat: 29.95, lng: -90.07 };
const oldSave = (uid, label, addr, area, p, days) => me(uid,
  `SELECT public.declutter_save_porch_place(NULL, '${label}', '${addr}', '${area}', ${p.lat}, ${p.lng}, ARRAY[${days.join(",")}]::smallint[]) AS id`);
const home = one(await oldSave(SELLER2, "Home", "12 Home Street, New Iberia", "New Iberia", HOME, [1, 3]));
const camp = one(await oldSave(SELLER2, "Camp", "99 Camp Road, New Iberia", "New Iberia", CAMP, [6]));
ok(typeof home === "string" && typeof camp === "string", "fixture: two places saved with days only, before the migration");

if (!skip) {
  const sql = readFileSync(process.env.MIGRATION_PATH ?? `${MIG_DIR}${NEW_FILE}`, "utf8");
  for (let i = 0; i < 3; i++) {
    const r = await run(sql);
    ok(!r?.error, `the migration applies (run ${i + 1} of 3)${r?.error ? `: ${r.error}` : ""}`);
  }
}

// 1. Backfill: the places that had no hours got the usual times, on their own days.
const stored = await svc(`SELECT label, windows FROM public.declutter_porch_places WHERE seller_id = '${SELLER2}' ORDER BY position`);
const homeStored = Array.isArray(stored) ? stored.find((r) => r.label === "Home")?.windows : undefined;
ok(hours(homeStored) === "1 07:00-21:00, 3 07:00-21:00", `Home now stores Mon and Wed, 7 AM to 9 PM (${hours(homeStored)})`);

// 2. The seller reads their places with hours.
const mine = await me(SELLER2, `SELECT label, weekdays, windows FROM public.declutter_my_porch_places()`);
ok(Array.isArray(mine) && mine.length === 2 && hours(mine[1]?.windows) === "6 07:00-21:00",
  `declutter_my_porch_places returns each place's hours (${short(mine)})`);

// 3. Save with hours: the hours decide the days.
const newSave = (uid, id, label, addr, p, windows) => me(uid,
  `SELECT public.declutter_save_porch_place('${id}', '${label}', '${addr}', 'New Iberia', ${p.lat}, ${p.lng}, NULL, '${JSON.stringify(windows)}'::jsonb) AS id`);
const campHours = [{ weekday: 6, starts: "09:00", ends: "12:00" }, { weekday: 0, starts: "13:00", ends: "15:00" }];
const saved = await newSave(SELLER2, camp, "Camp", "99 Camp Road, New Iberia", CAMP, campHours);
ok(one(saved) === camp, `the seller saves Camp with Sat 9-12 and Sun 1-3${one(saved) === camp ? "" : ` (got ${short(saved)})`}`);
const campRow = (await svc(`SELECT weekdays, windows FROM public.declutter_porch_places WHERE id = '${camp}'`))?.[0];
ok(JSON.stringify(campRow?.weekdays) === "[0,6]" && hours(campRow?.windows) === "0 13:00-15:00, 6 09:00-12:00",
  `  its days follow its hours (${short(campRow)})`);
const bad = await newSave(SELLER2, camp, "Camp", "99 Camp Road, New Iberia", CAMP, [{ weekday: 6, starts: "12:00", ends: "09:00" }]);
ok(refused(bad, /invalid_place_hours/), `an end before the start is refused: invalid_place_hours${refused(bad, /invalid_place_hours/) ? "" : ` (got ${short(bad)})`}`);
ok(refused(await newSave(SELLER2, camp, "Camp", "99 Camp Road, New Iberia", CAMP, [{ weekday: 9, starts: "09:00", ends: "12:00" }]), /invalid_place_hours/),
  "  and a weekday outside 0-6");
ok(refused(await svc(`UPDATE public.declutter_porch_places SET windows = '[{"weekday":1,"starts":"10:00","ends":"10:10"}]' WHERE id = '${home}'`), /windows_ok|check constraint/),
  "the table refuses badly formed hours itself (CHECK)");

// 4. An older app build saving days only keeps the place's own hours on the days it keeps.
await me(SELLER2, `SELECT public.declutter_save_porch_place('${home}', 'Home', '12 Home Street, New Iberia', 'New Iberia', ${HOME.lat}, ${HOME.lng}, ARRAY[1,2]::smallint[])`);
const homeAfter = one(await svc(`SELECT windows FROM public.declutter_porch_places WHERE id = '${home}'`));
ok(hours(homeAfter) === "1 07:00-21:00, 2 07:00-21:00", `days-only save: Mon kept, Tue gets the usual hours (${hours(homeAfter)})`);

// 5. The item page and the buyer's cart view show each place's days and hours, never an address.
const I = (n) => `dddddddd-0000-0000-0000-${String(n).padStart(12, "0")}`;
await run(liveItemSql({ id: I(1), seller: SELLER2, title: "Place hours item", price: 1500, floor: 100 }));
const itemPlaces = await me(BUYER, `SELECT * FROM public.declutter_item_pickup_places('${I(1)}')`);
ok(Array.isArray(itemPlaces) && itemPlaces.length === 2 && itemPlaces.every((r) => !("address" in r) && !("lat" in r))
   && hours(itemPlaces[1]?.windows) === "0 13:00-15:00, 6 09:00-12:00",
  `the item page reads both places with their hours, no address (${short(itemPlaces)})`);
// Review 2026-10-31: an out seller's places are never shown to anyone else (as declutter_seller_porch_places).
await svc(`INSERT INTO public.declutter_seller_flags (user_id, business_like) VALUES ('${SELLER2}', true)
  ON CONFLICT (user_id) DO UPDATE SET business_like = true`);
const outPlaces = await me(BUYER, `SELECT * FROM public.declutter_item_pickup_places('${I(1)}')`);
ok(Array.isArray(outPlaces) && outPlaces.length === 0, `an out seller's places are not shown to a buyer (${short(outPlaces)})`);
const ownWhileOut = await me(SELLER2, `SELECT * FROM public.declutter_item_pickup_places('${I(1)}')`);
ok(Array.isArray(ownWhileOut) && ownWhileOut.length === 2, `the seller still sees their own places (${short(ownWhileOut)?.slice(0, 80)})`);
await svc(`UPDATE public.declutter_seller_flags SET business_like = false WHERE user_id = '${SELLER2}'`);
await me(BUYER, `SELECT public.declutter_buy_now('${I(1)}', 1500)`);
const seen = await me(BUYER, `SELECT * FROM public.declutter_seller_porch_places('${SELLER2}')`);
ok(Array.isArray(seen) && seen.length === 2 && seen.every((r) => !("address" in r)) && hours(seen[0]?.windows) === "1 07:00-21:00, 2 07:00-21:00",
  `the buyer's cart view has each place's hours (${short(seen)})`);

// 6. Checkout at Camp freezes Camp's hours; the seller editing them later never moves the sale.
await me(BUYER, `SELECT public.declutter_set_porch_place('${SELLER2}', '${camp}')`);
const P = (await me(BUYER, `SELECT * FROM public.declutter_start_checkout('${SELLER2}', 'porch')`))?.[0];
ok(P?.order_id, `porch checkout at Camp opens an order${P?.order_id ? "" : ` (got ${short(P)})`}`);
await svc(`SELECT public.declutter_mark_order_paid('${P?.order_id}', 'pi_hours_1', ${P?.total_cents}, now(), 150)`);
const frozen = one(await svc(`SELECT windows FROM public.declutter_order_porch_places WHERE order_id = '${P?.order_id}'`));
ok(hours(frozen) === "0 13:00-15:00, 6 09:00-12:00", `the order froze Camp's hours (${hours(frozen)})`);
await newSave(SELLER2, camp, "Camp", "99 Camp Road, New Iberia", CAMP, [{ weekday: 6, starts: "17:00", ends: "20:00" }]);
const orderHours = await me(BUYER, `SELECT weekday, starts::text, ends::text FROM public.declutter_order_pickup_windows('${P?.order_id}')`);
ok(Array.isArray(orderHours) && orderHours.map((r) => `${r.weekday} ${r.starts.slice(0, 5)}-${r.ends.slice(0, 5)}`).join(", ") === "0 13:00-15:00, 6 09:00-12:00",
  `the order's pickup times are the frozen place hours, not the edit nor the usual 7-9 (${short(orderHours)})`);

// 7. The buyer's time must sit inside the frozen hours. Within the 7-day deadline: the next Sat or Sun 1-6 days ahead.
const todayDow = Number(one(await svc(`SELECT extract(dow FROM now() AT TIME ZONE 'America/Chicago')::int`)));
const ahead = (d) => ((d - todayDow + 7) % 7) || 7;
const day = ahead(0) <= 6 ? 0 : 6; // Sunday 1-3 PM, else Saturday 9-12 (Camp's frozen hours)
const at = (hhmm) => `((date_trunc('day', now() AT TIME ZONE 'America/Chicago') + make_interval(days => ${ahead(day)}) + '${hhmm}'::time) AT TIME ZONE 'America/Chicago')`;
const [outT, inT] = day === 0 ? ["17:00", "13:30"] : ["18:00", "10:00"];
const late = await me(BUYER, `SELECT public.declutter_book_pickup('${P?.order_id}', ${at(outT)}) AS r`);
ok(refused(late, /invalid_slot/), `day ${day} ${outT} (inside the usual 7-9, outside Camp's hours) is refused${refused(late, /invalid_slot/) ? "" : ` (got ${short(late)})`}`);
const inside = await me(BUYER, `SELECT public.declutter_book_pickup('${P?.order_id}', ${at(inT)}) AS r`);
ok(one(inside)?.result === "booked", `day ${day} ${inT} (inside Camp's hours) books${Array.isArray(inside) ? "" : ` (got ${short(inside)})`}`);

// 8. A seller with no places: exactly as before (the usual times).
await svc(`INSERT INTO public.declutter_pickup_windows (seller_id, weekday, starts_local, ends_local)
  SELECT '${SELLER}', d, '08:00', '10:00' FROM generate_series(0, 6) d ON CONFLICT DO NOTHING`);
await run(liveItemSql({ id: I(2), seller: SELLER, title: "Old way item", price: 900, floor: 100 }));
await me(BUYER2, `SELECT public.declutter_buy_now('${I(2)}', 900)`);
const O = (await me(BUYER2, `SELECT * FROM public.declutter_start_checkout('${SELLER}', 'pickup_home')`))?.[0];
await svc(`SELECT public.declutter_mark_order_paid('${O?.order_id}', 'pi_hours_2', ${O?.total_cents}, now(), 150)`);
const oldHours = await me(BUYER2, `SELECT weekday, starts::text FROM public.declutter_order_pickup_windows('${O?.order_id}')`);
ok(Array.isArray(oldHours) && oldHours.length === 7 && oldHours.every((r) => r.starts.startsWith("08:00")), `no places: the usual times, as before (${short(oldHours)?.slice(0, 80)})`);

// 9. Grants.
const acl = async (role, fn) => one(await svc(`SELECT has_function_privilege('${role}', 'public.${fn}', 'EXECUTE')`));
ok(await acl("authenticated", "declutter_place_windows_fill(jsonb, uuid, smallint[])") === false
   && await acl("authenticated", "declutter_order_slot_in_windows(uuid, uuid, timestamptz)") === false
   && await acl("authenticated", "declutter_delivery_slot_ok(uuid, timestamptz)") === false,
  "the fill and slot helpers are internal");
let anonNone = true;
for (const fn of ["declutter_save_porch_place(uuid, text, text, text, numeric, numeric, smallint[], jsonb)", "declutter_my_porch_places()",
  "declutter_seller_porch_places(uuid)", "declutter_item_pickup_places(uuid)", "declutter_order_pickup_windows(uuid)", "declutter_book_pickup(uuid, timestamptz)",
  "helpr_task_pickup_windows(uuid)"]) {
  if (await acl("anon", fn) !== false) anonNone = false;
}
ok(anonNone, "anon cannot call any of them (REVOKE FROM PUBLIC, anon)");
ok(one(await svc(`SELECT count(*)::int FROM pg_proc WHERE proname = 'declutter_save_porch_place'`)) === 1, "one save function, no ambiguous overload");

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
