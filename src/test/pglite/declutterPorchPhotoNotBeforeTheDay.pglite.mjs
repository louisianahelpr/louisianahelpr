#!/usr/bin/env node
/**
 * PGlite proof for 20261029201542_declutter_porch_photo_not_before_the_day (Declutter audit 1a #4, prod 2026-10-29):
 * the seller's porch photo was taken two days before the buyer's booked day, so the buyer was told to go early and
 * the payout clock started early. Now the SELLER's porch photo is refused with porch_day_not_yet while today in
 * Louisiana is before the booked day; on the day it is taken as before; the buyer's side is unchanged.
 *
 *   node src/test/pglite/declutterPorchPhotoNotBeforeTheDay.pglite.mjs                    # GREEN
 *   NEW_MIGRATION=skip node src/test/pglite/declutterPorchPhotoNotBeforeTheDay.pglite.mjs # RED: the chain without it
 *   MIGRATION_PATH=<planted copy> node ...                                                # RED on a planted defect
 *
 * World: scripts/declutter/handoverPhotoWorld.mjs, then 20261028235709 (photos at the address) and 20261029002010
 * (live camera only, this function's newest definition) once each; this migration 3x.
 */
import { readFileSync } from "node:fs";
import { buildHandoverWorld, MIG_DIR } from "../../../scripts/declutter/handoverPhotoWorld.mjs";

const NEW_FILE = "20261029201542_declutter_porch_photo_not_before_the_day.sql";
const BASES = ["20261028235709_declutter_handover_photos_at_the_address.sql", "20261029002010_declutter_handover_photos_live_only.sql"];
const skip = process.env.NEW_MIGRATION === "skip";
if (skip) console.log("NEW_MIGRATION=skip: running WITHOUT the new migration (expect FAILs)");
const { svc, run, one, me, refused, liveItemSql, USERS } = await buildHandoverWorld();
const { SELLER2, BUYER, BUYER2 } = USERS;

let pass = 0;
let fail = 0;
const ok = (cond, label) => { if (cond) pass++; else fail++; console.log(`${cond ? "PASS" : "FAIL"}  ${label}`); };

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

const PICKUP = { lat: 30.451234, lng: -91.154321 };
const pt = (p) => `${p.lat}, ${p.lng}`;
const I = (n) => `bbbbbbbb-0000-0000-0000-${String(n).padStart(12, "0")}`;
const photo = async (uid, orderId, name) => {
  const path = `${uid}/declutter/handover/${orderId}/${name}.jpg`;
  await svc(`INSERT INTO storage.objects (bucket_id, name, created_at) VALUES ('declutter-handover', '${path}', now())`);
  return path;
};
await svc(`INSERT INTO public.declutter_pickup_windows (seller_id, weekday, starts_local, ends_local)
  SELECT '${SELLER2}', d, '00:00', '23:59' FROM generate_series(0, 6) d ON CONFLICT DO NOTHING`);
async function paidPorchOrder(n, buyer) {
  await run(liveItemSql({ id: I(n), seller: SELLER2, title: `Porch day item ${n}`, price: 1200, floor: 100 }));
  await me(buyer, `SELECT public.declutter_buy_now('${I(n)}', 1200)`);
  const o = (await me(buyer, `SELECT * FROM public.declutter_start_checkout('${SELLER2}', 'porch')`))?.[0];
  await svc(`SELECT public.declutter_mark_order_paid('${o?.order_id}', 'pi_day_${n}', ${o?.total_cents}, now(), 150)`);
  return o ?? {};
}
const today = one(await svc(`SELECT (now() AT TIME ZONE 'America/Chicago')::date::text`));
const inTwoDays = one(await svc(`SELECT ((now() AT TIME ZONE 'America/Chicago')::date + 2)::text`));
const setOut = async (orderId) => one(await svc(`SELECT set_out_at IS NOT NULL FROM public.declutter_handovers WHERE order_id = '${orderId}'`));
const notices = async (uid) => Number(one(await svc(`SELECT count(*) FROM public.notifications WHERE user_id = '${uid}' AND title LIKE 'It''s on the porch%'`)));
const NOT_YET = /porch_day_not_yet/;

// 1. A porch DAY two days out: the seller's photo is refused today, taken on the day.
{
  const P = await paidPorchOrder(1, BUYER);
  const b = await me(BUYER, `SELECT public.declutter_book_porch_day('${P.order_id}', '${inTwoDays}'::date)`);
  ok(P.order_id && Array.isArray(b), `fixture: a paid porch order booked for ${inTwoDays}${Array.isArray(b) ? "" : `: ${b?.error}`}`);
  const before = await notices(BUYER);
  const early = await me(SELLER2, `SELECT public.declutter_porch_photo('${P.order_id}', '${await photo(SELLER2, P.order_id, "early")}', ${pt(PICKUP)})`);
  ok(refused(early, NOT_YET), `the seller's porch photo two days before the booked day: porch_day_not_yet${refused(early, NOT_YET) ? "" : ` (got ${JSON.stringify(early)?.slice(0, 160)})`}`);
  ok(!await setOut(P.order_id), "  and nothing is set out (the payout clock does not start)");
  ok(await notices(BUYER) === before, "  and the buyer is not told it's on the porch");
  // The day arrives (moved by the server, as the booking's own columns).
  await svc(`UPDATE public.declutter_bookings SET pickup_day = '${today}'::date, slot_start = ('${today}'::date)::timestamp AT TIME ZONE 'America/Chicago',
    slot_end = (('${today}'::date)::timestamp AT TIME ZONE 'America/Chicago') + interval '30 minutes' WHERE order_id = '${P.order_id}'`);
  const onDay = await me(SELLER2, `SELECT public.declutter_porch_photo('${P.order_id}', '${await photo(SELLER2, P.order_id, "onday")}', ${pt(PICKUP)}) AS r`);
  ok(one(onDay)?.result === "set_out", `on the booked day the seller's photo is taken: set_out${Array.isArray(onDay) ? "" : `: ${onDay?.error}`}`);
  ok(await notices(BUYER) === before + 1, "  and the buyer is told it's out");
  const pick = await me(BUYER, `SELECT public.declutter_porch_photo('${P.order_id}', '${await photo(BUYER, P.order_id, "pick")}', ${pt(PICKUP)}) AS r`);
  ok(one(pick)?.result === "picked_up", `the buyer's pickup photo is unchanged: picked_up${Array.isArray(pick) ? "" : `: ${pick?.error}`}`);
}

// 2. An older TIMED porch booking (no pickup_day): the Louisiana date of its slot is the day.
{
  const P = await paidPorchOrder(2, BUYER2);
  await me(BUYER2, `SELECT public.declutter_book_porch_day('${P.order_id}', '${inTwoDays}'::date)`);
  await svc(`UPDATE public.declutter_bookings SET pickup_day = NULL, porch_mode = NULL,
    slot_start = (('${inTwoDays}'::date)::timestamp AT TIME ZONE 'America/Chicago') + interval '10 hours',
    slot_end = (('${inTwoDays}'::date)::timestamp AT TIME ZONE 'America/Chicago') + interval '10 hours 30 minutes' WHERE order_id = '${P.order_id}'`);
  ok(one(await svc(`SELECT pickup_day IS NULL FROM public.declutter_bookings WHERE order_id = '${P.order_id}'`)) === true, "fixture: a timed booking with no porch day");
  const early = await me(SELLER2, `SELECT public.declutter_porch_photo('${P.order_id}', '${await photo(SELLER2, P.order_id, "t-early")}', ${pt(PICKUP)})`);
  ok(refused(early, NOT_YET), "a timed porch slot two days out: the seller's photo is porch_day_not_yet");
  ok(early?.code === "55000", `  as a state refusal (55000), so the app shows its own words (got ${early?.code})`);
  await svc(`UPDATE public.declutter_bookings SET slot_start = now() + interval '3 hours', slot_end = now() + interval '3 hours 30 minutes' WHERE order_id = '${P.order_id}'`);
  const sameDay = one(await svc(`SELECT ((now() + interval '3 hours') AT TIME ZONE 'America/Chicago')::date = (now() AT TIME ZONE 'America/Chicago')::date`));
  if (sameDay) {
    const r = await me(SELLER2, `SELECT public.declutter_porch_photo('${P.order_id}', '${await photo(SELLER2, P.order_id, "t-day")}', ${pt(PICKUP)}) AS r`);
    ok(one(r)?.result === "set_out", `the same Louisiana day, hours before the slot: set_out (putting it out that morning is fine)${Array.isArray(r) ? "" : `: ${r?.error}`}`);
  } else {
    console.log("SKIP  same-day timed case: now + 3 h crosses Louisiana midnight on this run");
  }
}

// 3. Grants unchanged.
const acl = async (s, role) => one(await svc(`SELECT has_function_privilege('${role}', '${s}', 'EXECUTE')`));
const sig = "public.declutter_porch_photo(uuid, text, numeric, numeric)";
ok(await acl(sig, "anon") === false && await acl(sig, "authenticated") === true, `${sig}: anon revoked, members granted`);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
