#!/usr/bin/env node
/**
 * PGlite proof for 20261027194235_helpr_my_route ("My route": every stop of a Helpr's deliveries in
 * one order; owner request 2026-10-27).
 *
 *   node src/test/pglite/helprMyRoute.pglite.mjs                       # after (3x replay)
 *   MUTANT=<name> node src/test/pglite/helprMyRoute.pglite.mjs         # a planted defect: must FAIL
 *
 * World: a helpr_tasks table with the columns the functions read (the real table's shape, minus
 * money and photo columns they never touch), the REAL helpr_task_distance_m (newest definition),
 * and minimal declutter_items / item_photos / cart_items. Stubbed, and said so:
 * helpr_task_source_require_feature (a table of members the 'declutter' switch is off for).
 */
import os from "node:os";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const MIG_DIR = fileURLToPath(new URL("../../../supabase/migrations/", import.meta.url));
const FILES = readdirSync(MIG_DIR).filter((f) => f.endsWith(".sql")).sort();
const THIS = "20261027194235_helpr_my_route.sql";
const MUTANT = process.env.MUTANT ?? "";

/** The newest CREATE of `name` in a migration before `before` (any dollar-quote tag). */
function newest(name, before = THIS) {
  for (let i = FILES.length - 1; i >= 0; i--) {
    if (FILES[i] >= before) continue;
    const src = readFileSync(MIG_DIR + FILES[i], "utf8");
    const start = src.lastIndexOf(`CREATE OR REPLACE FUNCTION public.${name}(`);
    if (start < 0) continue;
    const tag = /AS\s+(\$[A-Za-z_]*\$)/.exec(src.slice(start))[1];
    const open = src.indexOf(tag, start);
    return src.slice(start, src.indexOf(tag, open + tag.length) + tag.length) + ";";
  }
  throw new Error(`${name}: no definition before ${before}`);
}

// Planted defects (each must turn a check red).
const MUTANTS = {
  // A drop-off is free before its own pickup.
  precedence: ["CONTINUE WHEN v_s->>'kind' = 'dropoff' AND EXISTS (", "CONTINUE WHEN false AND EXISTS ("],
  // The booked pickup time is ignored.
  slot: ["         > (v_fixed->>'slot')::timestamptz + interval '30 minutes' THEN", "         > 'infinity'::timestamptz THEN"],
  // The drop-off address shows before "Picked up".
  address: ["                      WHEN t.status = 'picked_up' THEN t.dropoff_address END,", "                      ELSE t.dropoff_address END,"],
  // The drop-off's exact point orders the route before it is the Helpr's to read.
  rounded: ["      'lat', CASE WHEN t.status = 'picked_up' THEN t.dropoff_lat ELSE round(t.dropoff_lat, 2) END,", "      'lat', t.dropoff_lat,"],
  // Another Helpr's deliveries join the route.
  owner: ["            WHERE x.helpr_id = v_uid AND x.status IN ('accepted', 'picked_up')", "            WHERE x.status IN ('accepted', 'picked_up')"],
  // The member switch is not checked.
  feature: ["  PERFORM public.helpr_task_source_require_feature('declutter_delivery');\n  IF p_lat", "  IF p_lat"],
};
let mig = readFileSync(MIG_DIR + THIS, "utf8");
if (MUTANT) {
  const m = MUTANTS[MUTANT];
  if (!m || !mig.includes(m[0])) throw new Error(`mutant ${MUTANT} did not apply`);
  mig = mig.replace(m[0], m[1]);
}

let failures = 0;
const check = (ok, name) => { console.log(`${ok ? "PASS" : "FAIL"}  ${name}`); if (!ok) failures++; };

const H1 = "11111111-1111-1111-1111-111111111111";
const H2 = "22222222-2222-2222-2222-222222222222";
const OFF = "33333333-3333-3333-3333-333333333333";
const SELLER = "44444444-4444-4444-4444-444444444444";

const db = new PGlite();
await db.exec(`
  create role anon; create role authenticated; create role service_role;
  create schema auth;
  create function auth.uid() returns uuid language sql stable as
    $f$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $f$;
  grant usage on schema auth, public to anon, authenticated, service_role;
  create table public.helpr_tasks (
    id uuid primary key, source_kind text not null default 'declutter_delivery', source_id uuid not null,
    status text not null, size text not null default 'small', title text not null,
    pickup_area text not null, dropoff_area text not null,
    pickup_address text not null, pickup_lat numeric not null, pickup_lng numeric not null,
    dropoff_address text not null, dropoff_lat numeric not null, dropoff_lng numeric not null,
    pay_cents integer not null default 2000, fee_cents integer not null default 170,
    helpr_id uuid, pickup_slot_start timestamptz);
  create table public.switch_off (user_id uuid primary key);
  insert into public.switch_off values ('${OFF}');
  create function public.helpr_task_source_require_feature(p_kind text) returns void language plpgsql as $f$
  begin
    if exists (select 1 from public.switch_off where user_id = auth.uid()) then
      raise exception 'feature_disabled' using errcode = '42501';
    end if;
  end $f$;
  create table public.declutter_items (id uuid primary key, title text not null, porch_ok boolean not null default true, status text not null default 'sold');
  create table public.declutter_item_photos (item_id uuid, storage_path text, position smallint);
  create table public.declutter_cart_items (id uuid primary key, item_id uuid, order_id uuid);
`);
await db.exec(newest("helpr_task_distance_m"));
for (let i = 0; i < 3; i++) await db.exec(mig); // replay-safe: applied three times

// Baton Rouge-ish points. Slots are relative to now so the proof never ages.
const now = Date.now();
const iso = (mins) => new Date(now + mins * 60_000).toISOString();
const T = (n) => `aaaaaaaa-0000-0000-0000-00000000000${n}`;
const O = (n) => `bbbbbbbb-0000-0000-0000-00000000000${n}`;
await db.exec(`
  insert into public.helpr_tasks (id, source_id, status, title, pickup_area, dropoff_area, pickup_address, pickup_lat, pickup_lng,
                                  dropoff_address, dropoff_lat, dropoff_lng, helpr_id, pickup_slot_start) values
    -- H1: one in hand (picked up), one taken (pickup booked in 90 minutes).
    ('${T(1)}', '${O(1)}', 'picked_up', 'Oak dresser', 'Mid City', 'Shenandoah', '1 Seller St', 30.4500, -91.1500,
     '11 Buyer Ln', 30.401234, -91.051234, '${H1}', '${iso(-60)}'),
    ('${T(2)}', '${O(2)}', 'accepted', 'Blue lamp, Side table', 'Garden District', 'Prairieville', '2 Seller St', 30.4400, -91.1700,
     '22 Buyer Ln', 30.314999, -90.984999, '${H1}', '${iso(90)}'),
    -- H2's, never H1's.
    ('${T(3)}', '${O(3)}', 'accepted', 'Rocking chair', 'Zachary', 'Denham Springs', '3 Seller St', 30.6500, -91.1500,
     '33 Buyer Ln', 30.4800, -90.9500, '${H2}', '${iso(120)}'),
    -- H1's finished one: not a stop.
    ('${T(4)}', '${O(4)}', 'delivered', 'Mirror', 'Mid City', 'Shenandoah', '4 Seller St', 30.45, -91.15,
     '44 Buyer Ln', 30.40, -91.05, '${H1}', '${iso(-300)}');
  insert into public.declutter_items values ('${T(5)}', 'Blue lamp', true), ('${T(6)}', 'Side table', false), ('${T(7)}', 'Oak dresser', true);
  insert into public.declutter_item_photos values ('${T(5)}', '${SELLER}/declutter/${T(5)}/a.jpg', 0),
    ('${T(5)}', '${SELLER}/declutter/${T(5)}/b.jpg', 1), ('${T(7)}', '${SELLER}/declutter/${T(7)}/c.jpg', 0);
  insert into public.declutter_cart_items values ('${T(8)}', '${T(5)}', '${O(2)}'), ('${T(9)}', '${T(6)}', '${O(2)}'), ('cccccccc-0000-0000-0000-000000000001', '${T(7)}', '${O(1)}');
`);

async function as(uid, sql) {
  await db.exec(`select set_config('request.jwt.claim.sub', '${uid ?? ""}', false)`);
  try {
    const r = await db.query(sql);
    return { ok: true, rows: r.rows };
  } catch (e) {
    return { ok: false, code: String(e.message) };
  }
}

// --- helpr_my_route for H1, standing near T1's drop-off.
const r1 = await as(H1, "select public.helpr_my_route(30.41, -91.06) as r");
check(r1.ok, `[route] H1 reads their route${r1.ok ? "" : ` (${r1.code})`}`);
const route = r1.ok ? r1.rows[0].r : { stops: [] };
const stops = route.stops ?? [];
const keys = stops.map((s) => `${s.task_id.slice(-1)}:${s.kind}`);
check(stops.length === 3, `[route] three stops: T1 drop-off, T2 pickup, T2 drop-off (got ${keys.join(", ")})`);
check(stops.every((s) => s.task_id === T(1) || s.task_id === T(2)), "[owner] only H1's own deliveries in hand; H2's and the delivered one never appear");
const at = (k) => keys.indexOf(k);
check(at("2:pickup") >= 0 && at("2:pickup") < at("2:dropoff"), "[precedence] T2 is picked up before it is dropped off");
check(stops.map((s) => s.seq).join() === "1,2,3", "[route] stops are numbered in order");
const t1drop = stops.find((s) => s.task_id === T(1) && s.kind === "dropoff");
const t2pick = stops.find((s) => s.task_id === T(2) && s.kind === "pickup");
const t2drop = stops.find((s) => s.task_id === T(2) && s.kind === "dropoff");
check(t1drop?.address === "11 Buyer Ln" && Number(t1drop?.lat) === 30.401234, "[reveal] a picked-up delivery's drop-off address and point are shown");
check(t2pick?.address === "2 Seller St" && t2pick?.place === "door", "[reveal] a taken delivery's pickup address is shown; one item may not be left out, so it is the door");
check(t2drop && t2drop.address === null && t2drop.lat === null && t2drop.lng === null, "[address] a taken (not picked up) delivery's drop-off has NO address and NO point");
const text = JSON.stringify(route);
check(!text.includes("22 Buyer Ln") && !text.includes("30.314999") && !text.includes("90.984999"), "[address] the drop-off's exact address and point are nowhere in the answer");
const expectLeg = await db.query(`select round(public.helpr_route_leg_miles(30.4400, -91.1700, 30.31, -90.98), 1)::float8 as m,
                                         round(public.helpr_route_leg_miles(30.4400, -91.1700, 30.314999, -90.984999), 1)::float8 as exact`);
check(Number(t2drop?.leg_miles) === expectLeg.rows[0].m && expectLeg.rows[0].m !== expectLeg.rows[0].exact,
  `[rounded] the leg to an unshown drop-off is measured to its ~1 km point (${t2drop?.leg_miles} = ${expectLeg.rows[0].m}, exact would be ${expectLeg.rows[0].exact})`);
check(t2pick?.slot_start && new Date(t2pick.slot_end) - new Date(t2pick.slot_start) === 30 * 60_000, "[window] the pickup carries its booked 30-minute time");
check(new Date(t2pick?.arrive_at) >= new Date(t2pick?.slot_start), "[window] the plan never reaches a booked pickup before its time (it waits)");
check(t2pick?.items?.length === 2 && t2pick.items[0].photo_path?.endsWith("/a.jpg") && t2pick.items[1].photo_path === null,
  "[items] the pickup lists its items with each one's first listing photo");
check(t1drop?.place === "door", "[place] a drop-off is the buyer's door");
const moneyKeys = stops.flatMap((s) => Object.keys(s)).filter((k) => /pay|fee|cents|price/.test(k));
check(moneyKeys.length === 0, `[money] no pay, fee or price field on a stop (${moneyKeys.join(",") || "none"})`);
check(typeof route.miles === "number" && route.miles > 0 && route.drive_minutes > 0, "[route] total road miles and drive minutes");

// --- The drop-off's ~1 km cell is all an unshown drop-off gives away (lh-authz-rls review #2):
// moving it inside its cell changes no byte of the answer.
await db.exec(`update public.helpr_tasks set dropoff_lat = 30.305001, dropoff_lng = -90.975001 where id = '${T(2)}'`);
const moved = await as(H1, "select public.helpr_my_route(30.41, -91.06) as r");
// Times run from now() and wait for booked pickups, so compare each stop's time from the stop before it
// (a drop-off's arrival is the only time an unshown drop-off's point can move).
const shape = (r) => JSON.stringify({ ...r, finish_at: null, stops: r.stops.map((x, i) => ({ ...x,
  arrive_at: i > 0 && x.kind === "dropoff" ? new Date(x.arrive_at) - new Date(r.stops[i - 1].arrive_at) : null })) });
check(moved.ok && shape(moved.rows[0].r) === shape(route), "[rounded] moving the unshown drop-off inside its ~1 km cell changes nothing in the answer");
await db.exec(`update public.helpr_tasks set dropoff_lat = 30.314999, dropoff_lng = -90.984999 where id = '${T(2)}'`);
// An item an admin removed keeps its title and loses its photo.
await db.exec(`update public.declutter_items set status = 'removed' where id = '${T(5)}'`);
const rem = await as(H1, "select public.helpr_my_route(30.41, -91.06) as r");
const remItems = rem.ok ? rem.rows[0].r.stops.find((x) => x.kind === "pickup")?.items : null;
check(remItems?.[0]?.title === "Blue lamp" && remItems?.[0]?.photo_path === null, "[items] a removed item's photo is not shown");
await db.exec(`update public.declutter_items set status = 'sold' where id = '${T(5)}'`);
const definers = await db.query(`select proname, prosecdef from pg_proc where proname in ('helpr_task_items', 'helpr_my_route') order by 1`);
check(definers.rows.map((r) => `${r.proname}:${r.prosecdef}`).join() === "helpr_my_route:true,helpr_task_items:false",
  "[grants] helpr_task_items has no definer rights of its own; helpr_my_route is the only door");

// --- refusals and grants.
const off = await as(OFF, "select public.helpr_my_route(null, null) as r");
check(!off.ok && off.code === "feature_disabled", "[feature] a member the switch is off for is refused (feature_disabled)");
const anon = await as(null, "select public.helpr_my_route(null, null) as r");
check(!anon.ok && anon.code === "not_authenticated", "[auth] no session is refused");
const bad = await as(H1, "select public.helpr_my_route(91, 0) as r");
check(!bad.ok && bad.code === "invalid_location", "[input] an impossible location is refused");
const empty = await as(H2, "select public.helpr_my_route(null, null) as r");
check(empty.ok && empty.rows[0].r.stops.length === 2, "[route] with no location the route still orders (H2: pickup then drop-off)");
const acl = await db.query(`select p.proname, coalesce(p.proacl::text, '') as a from pg_proc p
  where p.proname in ('helpr_my_route', 'helpr_route_plan', 'helpr_route_leg_miles', 'helpr_task_items') order by 1`);
const aclOf = Object.fromEntries(acl.rows.map((r) => [r.proname, r.a]));
check(/authenticated=X/.test(aclOf.helpr_my_route) && !/anon=X/.test(aclOf.helpr_my_route) && !/(^|,)=X/.test(aclOf.helpr_my_route),
  `[grants] helpr_my_route: authenticated yes, anon and PUBLIC no (${aclOf.helpr_my_route})`);
for (const fn of ["helpr_route_plan", "helpr_route_leg_miles", "helpr_task_items"]) {
  check(/service_role=X/.test(aclOf[fn]) && !/authenticated=X|anon=X|(^|,)=X/.test(aclOf[fn]), `[grants] ${fn}: service_role only (${aclOf[fn]})`);
}

// --- helpr_route_plan on its own: a booked pickup is kept even when a nearer stop beckons.
// The Helpr is at A; a carried drop-off D is 20 road-ish miles away; a pickup P 1 mile away is booked NOW.
const plan = await db.query(`select public.helpr_route_plan($1::jsonb, 30.45, -91.15, now()) as p`, [JSON.stringify([
  { key: "d", task: "x", kind: "dropoff", lat: 30.45, lng: -91.48 },
  { key: "p", task: "y", kind: "pickup", lat: 30.46, lng: -91.15, slot: iso(5) },
  { key: "q", task: "y", kind: "dropoff", lat: 30.47, lng: -91.15 },
])]);
const order = plan.rows[0].p.stops.map((s) => s.key).join(",");
check(order.startsWith("p"), `[slot] a far drop-off waits; the booked pickup comes first (${order})`);
check(plan.rows[0].p.stops.every((s) => s.late === false), "[slot] and no stop is late");
// Property: on random inputs, every drop-off follows its pickup and every stop is visited once.
let bad2 = 0;
for (let n = 0; n < 150; n++) {
  const st = [];
  const k = 1 + (n % 4);
  for (let j = 0; j < k; j++) {
    const lat = 30.3 + Math.random() * 0.4; const lng = -91.3 + Math.random() * 0.4;
    if (Math.random() < 0.7) st.push({ key: `p${j}`, task: `t${j}`, kind: "pickup", lat, lng, slot: Math.random() < 0.5 ? iso(Math.floor(Math.random() * 300)) : null });
    st.push({ key: `d${j}`, task: `t${j}`, kind: "dropoff", lat: lat + 0.05, lng: lng - 0.05 });
  }
  const p = (await db.query(`select public.helpr_route_plan($1::jsonb, null, null, now()) as p`, [JSON.stringify(st)])).rows[0].p;
  const seq = p.stops.map((s) => s.key);
  const once = seq.length === st.length && new Set(seq).size === st.length;
  const prec = st.filter((s) => s.kind === "pickup").every((s) => seq.indexOf(s.key) < seq.indexOf(`d${s.key.slice(1)}`));
  if (!once || !prec) bad2++;
}
check(bad2 === 0, `[precedence] 150 random plans: every stop once, every drop-off after its pickup (${bad2} bad)`);

console.log(failures === 0 ? `\nALL PASS${MUTANT ? ` (MUTANT=${MUTANT}: expected FAIL)` : " (3x replay)"}` : `\n${failures} FAIL${MUTANT ? ` (MUTANT=${MUTANT})` : ""}`);
process.exit(failures === 0 ? 0 : 1);
