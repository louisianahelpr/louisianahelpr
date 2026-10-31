#!/usr/bin/env node
/**
 * PGlite proof for the Helpr delivery half of 20261031145652_declutter_place_hours (LEAD-PLACE-TIMES review,
 * 2026-10-31): a Helpr delivery whose buyer picked a pickup place uses that place's hours, frozen on the order
 * (declutter_order_porch_places.windows), for both the times a Helpr sees (helpr_task_pickup_windows) and the
 * pickup time a Helpr may set (declutter_delivery_slot_ok, called by helpr_task_source_slot_ok). An order with no
 * frozen hours keeps the seller's usual times, as before.
 *
 *   node src/test/pglite/helprPlaceHours.pglite.mjs                    # GREEN
 *   NEW_MIGRATION=skip node src/test/pglite/helprPlaceHours.pglite.mjs # RED: the newest definitions on main
 *
 * A stub world (as helprOpenCountAndWindowsHideBackedOut.pglite.mjs): only the columns these functions read.
 * Every function comes from its newest CREATE (any dollar-quote tag).
 */
import os from "node:os";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const MIG_DIR = fileURLToPath(new URL("../../../supabase/migrations/", import.meta.url));
const FILES = readdirSync(MIG_DIR).filter((f) => f.endsWith(".sql")).sort();
const THIS = "20261031145652_declutter_place_hours.sql";
const SKIP = process.env.NEW_MIGRATION === "skip";

/** The newest CREATE of `name` in the migrations up to `upTo` (inclusive), or strictly before THIS when skipping. */
function newest(name, { upTo = THIS, before = false } = {}) {
  for (let i = FILES.length - 1; i >= 0; i--) {
    if (FILES[i] > upTo || (before && FILES[i] >= upTo)) continue;
    const src = readFileSync(MIG_DIR + FILES[i], "utf8");
    const start = src.lastIndexOf(`CREATE OR REPLACE FUNCTION public.${name}(`);
    if (start < 0) continue;
    const tag = /AS\s+(\$[A-Za-z_]*\$)/.exec(src.slice(start))[1];
    const open = src.indexOf(tag, start);
    return { file: FILES[i], sql: src.slice(start, src.indexOf(tag, open + tag.length) + tag.length) + ";" };
  }
  throw new Error(`${name}: no definition up to ${upTo}`);
}

let pass = 0;
let fail = 0;
const check = (ok, name) => { console.log(`${ok ? "PASS" : "FAIL"}  ${name}`); if (ok) pass++; else fail++; };

const HELPR = "11111111-1111-1111-1111-111111111111";
const SELLER = "33333333-3333-3333-3333-333333333333";
const BUYER = "44444444-4444-4444-4444-444444444444";
const T_PLACE = "a0000000-0000-0000-0000-000000000001";
const T_USUAL = "a0000000-0000-0000-0000-000000000002";
const O_PLACE = "b0000000-0000-0000-0000-000000000001";
const O_USUAL = "b0000000-0000-0000-0000-000000000002";

const db = new PGlite();
await db.exec(`
  CREATE ROLE authenticated; CREATE ROLE anon; CREATE ROLE service_role;
  CREATE TABLE public.helpr_tasks (
    id uuid PRIMARY KEY, source_kind text, source_id uuid, status text, size text,
    open_until timestamptz, latest_pickup_at timestamptz, customer_id uuid, pickup_contact_id uuid,
    -- b83 (20261031134217): helpr_task_source_held reads the seller no-show report's clock.
    seller_no_show_reported_at timestamptz, seller_no_show_answered_at timestamptz, seller_no_show_settled_at timestamptz);
  CREATE TABLE public.helpr_task_events (id bigserial PRIMARY KEY, task_id uuid, task_event text, actor_id uuid);
  CREATE TABLE public.declutter_problems (id bigserial PRIMARY KEY, order_id uuid, status text);
  CREATE TABLE public.declutter_orders (id uuid PRIMARY KEY, seller_id uuid, paid_at timestamptz, status text, handover text);
  CREATE TABLE public.declutter_pickup_windows (seller_id uuid, weekday smallint, starts_local time, ends_local time);
  CREATE TABLE public.declutter_order_porch_places (order_id uuid PRIMARY KEY, windows jsonb);
  CREATE FUNCTION public.helpr_task_source_require_feature(text) RETURNS void LANGUAGE sql AS $$ SELECT $$;
  CREATE FUNCTION public.helpr_task_assert_helpr() RETURNS uuid LANGUAGE sql AS $$ SELECT current_setting('test.uid')::uuid $$;
  CREATE FUNCTION public.helpr_task_vehicle_fits(uuid, text) RETURNS boolean LANGUAGE sql AS $$ SELECT true $$;
  CREATE FUNCTION public.are_users_blocked(uuid, uuid) RETURNS boolean LANGUAGE sql AS $$ SELECT false $$;
  CREATE FUNCTION public.helpr_task_same_stripe_mode(uuid, uuid) RETURNS boolean LANGUAGE sql AS $$ SELECT true $$;
`);
for (const fn of ["helpr_task_source_held", "declutter_slot_in_windows"]) await db.exec(newest(fn, { upTo: THIS, before: true }).sql);

// The seller's usual times: every day 7 AM to 9 PM. The place order froze Sat 9-12 only.
await db.exec(`
  INSERT INTO public.declutter_pickup_windows SELECT '${SELLER}', d, '07:00', '21:00' FROM generate_series(0, 6) d;
  INSERT INTO public.declutter_orders VALUES ('${O_PLACE}', '${SELLER}', now(), 'paid', 'delivery'), ('${O_USUAL}', '${SELLER}', now(), 'paid', 'delivery');
  INSERT INTO public.declutter_order_porch_places VALUES ('${O_PLACE}', '[{"weekday":6,"starts":"09:00","ends":"12:00"}]');
  INSERT INTO public.helpr_tasks VALUES
    ('${T_PLACE}', 'declutter_delivery', '${O_PLACE}', 'open', 'small', now() + interval '2 days', now() + interval '7 days', '${BUYER}', '${SELLER}'),
    ('${T_USUAL}', 'declutter_delivery', '${O_USUAL}', 'open', 'small', now() + interval '2 days', now() + interval '7 days', '${BUYER}', '${SELLER}');
`);

const fns = ["declutter_delivery_slot_ok", "helpr_task_pickup_windows"];
if (SKIP) {
  for (const fn of fns) { const d = newest(fn, { before: true }); await db.exec(d.sql); console.log(`before: ${fn} from ${d.file}`); }
} else {
  for (const fn of ["declutter_order_slot_in_windows", ...fns]) {
    const d = newest(fn);
    check(d.file === THIS, `${fn}: its newest CREATE is in ${THIS} (got ${d.file})`);
    for (let i = 0; i < 3; i++) await db.exec(d.sql);
  }
  console.log(`after: ${THIS}, applied 3x`);
}

await db.exec(`SET test.uid = '${HELPR}'`);
const seen = async (t) => (await db.query(`SELECT weekday, starts::text, ends::text FROM public.helpr_task_pickup_windows('${t}')`)).rows
  .map((r) => `${r.weekday} ${r.starts.slice(0, 5)}-${r.ends.slice(0, 5)}`).join(", ");
const placeSeen = await seen(T_PLACE);
check(placeSeen === "6 09:00-12:00", `a Helpr sees the place's frozen hours, not the usual 7-9 (got ${placeSeen})`);
const usualSeen = await seen(T_USUAL);
check(usualSeen.split(", ").length === 7 && usualSeen.startsWith("0 07:00-21:00"), `no frozen hours: the usual times, as before (got ${usualSeen.slice(0, 40)})`);

// The next Saturday, 1-7 days ahead (inside the 7-day deadline when it is 6 or fewer days away).
const dow = Number((await db.query(`SELECT extract(dow FROM now() AT TIME ZONE 'America/Chicago')::int AS d`)).rows[0].d);
const ahead = ((6 - dow + 7) % 7) || 7;
const sat = (hhmm) => `((date_trunc('day', now() AT TIME ZONE 'America/Chicago') + make_interval(days => ${ahead}) + '${hhmm}'::time) AT TIME ZONE 'America/Chicago')`;
const slotOk = async (o, at) => (await db.query(`SELECT public.declutter_delivery_slot_ok('${o}', ${at}) AS ok`)).rows[0].ok;
if (ahead <= 6) {
  check(await slotOk(O_PLACE, sat("10:00")) === true, "a Helpr pickup at 10 AM Saturday (inside the place's hours) is allowed");
  check(await slotOk(O_PLACE, sat("18:00")) === false, "a Helpr pickup at 6 PM Saturday (inside the usual 7-9, outside the place's hours) is refused");
  check(await slotOk(O_USUAL, sat("18:00")) === true, "no frozen hours: 6 PM Saturday is inside the usual times, as before");
} else {
  // Today is Saturday: next Saturday is past the 7-day deadline, so test tomorrow (Sunday), a day the place is closed.
  const sun = `((date_trunc('day', now() AT TIME ZONE 'America/Chicago') + interval '1 day' + '10:00'::time) AT TIME ZONE 'America/Chicago')`;
  check(await slotOk(O_PLACE, sun) === false, "a Helpr pickup on Sunday (a day the place is closed) is refused");
  check(await slotOk(O_USUAL, sun) === true, "no frozen hours: Sunday 10 AM is inside the usual times, as before");
}

// Grants are proven on the whole migration in declutterPlaceHours.pglite.mjs (this stub runs only the bodies).

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
