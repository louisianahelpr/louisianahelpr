#!/usr/bin/env node
/**
 * PGlite proof for 20261028012406_helpr_vehicle_needs_a_car (Q2452; owner decision 2026-10-28:
 * a Helpr must have a car for ANY Declutter delivery).
 *
 *   node src/test/pglite/helprVehicleMatch.pglite.mjs                    # after (3x replay): all PASS
 *   NEW_MIGRATION=skip node src/test/pglite/helprVehicleMatch.pglite.mjs # before: RED
 *   MUTANT=<name> node src/test/pglite/helprVehicleMatch.pglite.mjs      # a planted defect: RED
 *   MIGRATION_PATH=<planted copy> node src/test/pglite/helprVehicleMatch.pglite.mjs
 *
 * The vehicle rule is the REAL helpr_task_vehicle_fits on the REAL helpr_vehicles, read by the
 * REAL newest definitions of all five paths a Helpr meets a delivery on:
 *   listed     helpr_tasks_open_near     (20261021181118)
 *   card       helpr_task_view           (20261027201327)
 *   offered    helpr_task_offer_online   (20261027203030, the Go online trigger)
 *   suggested  helpr_route_suggestions   (20261027200024, "On your way", on the real route planner 20261027194235)
 *   taken      helpr_task_accept         (this migration's restatement)
 * plus the real helpr_tasks / helpr_task_events / helpr_delivery_online tables, helpr_task_distance_m
 * and helpr_payout_round_down_cents. Stubbed, and said so (each always lets the vehicle rule decide):
 * require_feature, is_caller_banned, helpr_task_source_require_feature, helpr_task_assert_helpr,
 * helper_accept_block_reason, are_users_blocked, helpr_task_same_stripe_mode, helpr_task_lock,
 * helpr_task_source_held, helpr_task_source_slot_ok, helpr_task_log, helpr_task_source_event,
 * member_display_name, member_under_18, declutter_active_strike_count, helper_accept_missing,
 * feature_enabled_for_user, declutter_notify (records who was offered).
 *
 * pglite is not a dependency (CLAUDE.md): loaded from ~/.lh-pglite.
 */
import os from "node:os";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const MIG_DIR = fileURLToPath(new URL("../../../supabase/migrations/", import.meta.url));
const FILES = readdirSync(MIG_DIR).filter((f) => f.endsWith(".sql")).sort();
const THIS = "20261028012406_helpr_vehicle_needs_a_car.sql";
const BASE = "20261017055505_declutter_helpr_delivery.sql";
const ROUTE = "20261027194235_helpr_my_route.sql";
const ONLINE = "20261027203030_helpr_go_online_for_deliveries.sql";
const MUTANT = process.env.MUTANT ?? "";
const skip = process.env.NEW_MIGRATION === "skip";

/** The newest definition of public.<name> before `before` (any dollar tag). */
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
/** A CREATE TABLE statement, verbatim, from a migration. */
function table(file, name) {
  const src = readFileSync(MIG_DIR + file, "utf8");
  const start = src.indexOf(`CREATE TABLE IF NOT EXISTS public.${name} (`);
  if (start < 0) throw new Error(`${name} not in ${file}`);
  return src.slice(start, src.indexOf("\n);", start) + 3);
}

const MUTANTS = {
  // A Helpr with no car fits a small item again (the old rule).
  nocar: ["       AND v.has_car\n       AND (p_size = 'small'", "       AND (p_size = 'small'"],
  // A Helpr may drop the vehicle a held delivery needs.
  inuse: ["  IF EXISTS (SELECT 1 FROM public.helpr_tasks t\n              WHERE t.helpr_id = v_uid AND t.status IN ('accepted', 'picked_up')",
          "  IF false AND EXISTS (SELECT 1 FROM public.helpr_tasks t\n              WHERE t.helpr_id = v_uid AND t.status IN ('accepted', 'picked_up')"],
  // A Helpr with no car is told about a truck.
  carmsg: ["    IF NOT EXISTS (SELECT 1 FROM public.helpr_vehicles v WHERE v.user_id = v_uid AND v.has_car) THEN",
           "    IF false THEN"],
  // An existing truck owner loses every delivery (no backfill).
  backfill: ["UPDATE public.helpr_vehicles SET has_car = true WHERE has_truck AND NOT has_car;", ""],
  // Ticking the truck no longer means a car.
  truckcar: ["  p_has_car := p_has_car OR p_has_truck;\n", ""],
  // The old three-argument save forgets the Helpr's car.
  oldsave: ["    COALESCE((SELECT v.has_car FROM public.helpr_vehicles v WHERE v.user_id = v_uid), false) OR COALESCE(p_has_truck, false),",
            "    COALESCE(p_has_truck, false),"],
};
let mig = process.env.MIGRATION_PATH ? readFileSync(process.env.MIGRATION_PATH, "utf8") : readFileSync(MIG_DIR + THIS, "utf8");
if (MUTANT) {
  const m = MUTANTS[MUTANT];
  if (!m || !mig.includes(m[0])) throw new Error(`mutant ${MUTANT} did not apply`);
  mig = mig.replace(m[0], m[1]);
}

let failures = 0;
const check = (ok, name) => { console.log(`${ok ? "PASS" : "FAIL"}  ${name}`); if (!ok) failures++; };

const U = (n) => `11111111-0000-0000-0000-${String(n).padStart(12, "0")}`;
// NOCAR: no vehicle row. WALKER: saved a vehicle with no car. CARONLY: a car. TRUCK: a truck. TRUCK2: a truck and a second person.
// OLDTRUCK: a truck saved before this migration (has_car not yet a column). SELLER / BUYER: the parties.
const NOCAR = U(1), CARONLY = U(2), TRUCK = U(3), TRUCK2 = U(4), OLDTRUCK = U(5), SELLER = U(6), BUYER = U(7), WALKER = U(8);
const HELPRS = { NOCAR, WALKER, CARONLY, TRUCK, TRUCK2, OLDTRUCK };

const db = new PGlite();
await db.exec(`
  create role anon; create role authenticated; create role service_role;
  create schema auth;
  create table auth.users (id uuid primary key);
  create function auth.uid() returns uuid language sql stable as
    $f$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $f$;
  create schema storage;
  create table storage.objects (bucket_id text, name text);
  grant usage on schema auth, public, storage to anon, authenticated, service_role;
  create table public.profiles (user_id uuid primary key, full_name text, latitude double precision, longitude double precision,
    ban_status text default 'active', under_13_blocked_at timestamptz, is_seed boolean default false);
  create table public.offers (user_id uuid, title text);
  create function public.require_feature(p_key text) returns void language sql as $f$ select $f$;
  create function public.is_caller_banned() returns boolean language sql stable as $f$ select false $f$;
  create function public.helpr_task_source_require_feature(p_kind text) returns void language sql as $f$ select $f$;
  create function public.helpr_task_assert_helpr() returns uuid language plpgsql as $f$
  begin
    if auth.uid() is null then raise exception 'not_authenticated' using errcode = '42501'; end if;
    return auth.uid();
  end $f$;
  create function public.helper_accept_block_reason(p uuid) returns text language sql stable as $f$ select null::text $f$;
  create function public.are_users_blocked(p1 uuid, p2 uuid) returns boolean language sql stable as $f$ select false $f$;
  create function public.helpr_task_same_stripe_mode(p_a uuid, p_b uuid) returns boolean language sql stable as
    $f$ select p_a is not null and p_b is not null $f$;
  create function public.helpr_task_source_held(p_kind text, p_source uuid) returns boolean language sql stable as $f$ select false $f$;
  create function public.helpr_task_source_slot_ok(p_kind text, p_source uuid, p_start timestamptz) returns boolean language sql stable as
    $f$ select p_start > now() $f$;
  create function public.helpr_task_source_event(p_task uuid, p_event text, p_by text) returns void language sql as $f$ select $f$;
  create function public.member_display_name(p_full text, p_x text) returns text language sql stable as $f$ select 'Pat L.' $f$;
  create function public.member_under_18(p uuid) returns boolean language sql stable as $f$ select false $f$;
  create function public.declutter_active_strike_count(p uuid) returns int language sql stable as $f$ select 0 $f$;
  create function public.helper_accept_missing(p uuid) returns text[] language sql stable as $f$ select '{}'::text[] $f$;
  create function public.feature_enabled_for_user(p_key text, p_user_id uuid) returns boolean language sql stable as $f$ select true $f$;
  create function public.declutter_notify(p_user uuid, p_type text, p_title text, p_msg text, p_link text, p_actor uuid)
    returns void language sql as $f$ insert into public.offers values (p_user, p_msg) $f$;
  create table public.declutter_items (id uuid primary key, title text not null, porch_ok boolean not null default true, status text not null default 'sold');
  create table public.declutter_item_photos (item_id uuid, storage_path text, position smallint);
  create table public.declutter_cart_items (id uuid primary key, item_id uuid, order_id uuid);
`);
// The real tables (verbatim), as on prod before this migration.
await db.exec(table(BASE, "helpr_vehicles"));
await db.exec(table(BASE, "helpr_tasks"));
await db.exec(`ALTER TABLE public.helpr_tasks ADD COLUMN IF NOT EXISTS raised_cents integer NOT NULL DEFAULT 0;`);
await db.exec(table(BASE, "helpr_task_events"));
await db.exec(table(ONLINE, "helpr_delivery_online"));
await db.exec(`
  create function public.helpr_task_lock(p_task uuid) returns public.helpr_tasks language sql as
    $f$ select * from public.helpr_tasks where id = p_task for update $f$;
  create function public.helpr_task_log(p_task uuid, p_kind text, p_actor uuid, p_detail text) returns void language sql as
    $f$ insert into public.helpr_task_events (task_id, task_event, actor_id, detail) values (p_task, p_kind, p_actor, p_detail) $f$;
`);
// The real functions, newest definitions before this migration.
for (const fn of ["helpr_task_distance_m", "helpr_payout_round_down_cents", "helpr_task_vehicle_fits", "helpr_set_vehicle"]) await db.exec(newest(fn));
await db.exec(readFileSync(MIG_DIR + ROUTE, "utf8"));
for (const fn of ["helpr_tasks_open_near", "helpr_task_view", "helpr_route_cost", "helpr_route_suggestions", "helpr_task_accept", "helpr_task_offer_online"]) await db.exec(newest(fn));
await db.exec(`DROP TRIGGER IF EXISTS trg_helpr_tasks_offer_online ON public.helpr_tasks;
  CREATE TRIGGER trg_helpr_tasks_offer_online AFTER INSERT ON public.helpr_tasks FOR EACH ROW EXECUTE FUNCTION public.helpr_task_offer_online();`);

// Members, all in Mid City Baton Rouge.
const all = [...Object.values(HELPRS), SELLER, BUYER];
await db.exec(`insert into auth.users values ${all.map((u) => `('${u}')`).join(",")}`);
await db.exec(`insert into public.profiles (user_id, latitude, longitude) values ${all.map((u) => `('${u}', 30.45, -91.15)`).join(",")}`);
// OLDTRUCK saved a truck before this migration (the old table has no has_car column).
await db.exec(`insert into storage.objects values ('helpr-tasks', '${OLDTRUCK}/vehicle/t.jpg');
  insert into public.helpr_vehicles (user_id, has_truck, second_person, photo_path) values ('${OLDTRUCK}', true, false, '${OLDTRUCK}/vehicle/t.jpg');`);

if (!skip) for (let i = 0; i < 3; i++) await db.exec(mig); // replay-safe: applied three times

async function as(uid, sql, params = []) {
  await db.exec(`select set_config('request.jwt.claim.sub', '${uid ?? ""}', false)`);
  try {
    return { ok: true, rows: (await db.query(sql, params)).rows };
  } catch (e) {
    return { ok: false, code: String(e.message) };
  } finally {
    await db.exec(`select set_config('request.jwt.claim.sub', '', false)`);
  }
}
const truckPhoto = async (uid) => { await db.exec(`insert into storage.objects values ('helpr-tasks', '${uid}/vehicle/t.jpg')`); return `${uid}/vehicle/t.jpg`; };
const save4 = async (uid, car, truck, second, photo = null) =>
  as(uid, "select public.helpr_set_vehicle($1::boolean, $2::boolean, $3::boolean, $4::text) as r", [car, truck, second, photo]);
const save3 = async (uid, truck, second, photo = null) =>
  as(uid, "select public.helpr_set_vehicle($1::boolean, $2::boolean, $3::text) as r", [truck, second, photo]);
const vehicle = async (uid) => (await db.query(`select to_jsonb(v) j from public.helpr_vehicles v where user_id = $1`, [uid])).rows[0]?.j ?? null;

// Vehicles, saved through the RPC (the four-argument save is new: before it, use the old save).
if (!skip) {
  check((await save4(CARONLY, true, false, false)).ok, "[save] a car alone is saved");
  check((await save4(TRUCK, false, true, false, await truckPhoto(TRUCK))).ok, "[save] a truck, car box unticked, is saved");
  check((await save4(TRUCK2, true, true, true, await truckPhoto(TRUCK2))).ok, "[save] a truck and a second person are saved");
  check((await save4(WALKER, false, false, false)).ok && (await vehicle(WALKER))?.has_car === false, "[save] no car is saved as no car");
} else {
  await save3(WALKER, false, false);
  await save3(TRUCK, true, false, await truckPhoto(TRUCK));
  await save3(TRUCK2, true, true, await truckPhoto(TRUCK2));
}
check((await vehicle(TRUCK))?.has_car === true, "[save] ticking the truck means a car (has_car true)");
check((await vehicle(OLDTRUCK))?.has_car === true, "[backfill] a truck saved before this migration counts as a car");
const bad = await save4(NOCAR, false, false, true);
check(!bad.ok && /invalid_vehicle/.test(bad.code), `[save] a second person without a truck is refused (${bad.code ?? "ok"})`);
const nul = await save4(NOCAR, null, false, false);
check(!nul.ok && /invalid_vehicle/.test(nul.code), "[save] a NULL car answer is refused, never stored");

// Open deliveries near everyone: one of each size. Everyone is online, so each insert is an offer.
await db.exec(`insert into public.helpr_delivery_online (user_id, online_until, near_lat, near_lng)
  select u, now() + interval '4 hours', 30.45, -91.15 from unnest(array[${Object.values(HELPRS).map((u) => `'${u}'::uuid`).join(",")}]) u`);
let n = 0;
async function task(o) {
  const id = `aaaaaaaa-0000-0000-0000-${String(++n).padStart(12, "0")}`;
  await db.query(`insert into public.helpr_tasks (id, source_kind, source_id, status, size, title, pickup_area, dropoff_area,
      pickup_address, pickup_lat, pickup_lng, dropoff_address, dropoff_lat, dropoff_lng, trip_miles, pay_cents, fee_cents,
      customer_id, pickup_contact_id, helpr_id, open_until, latest_pickup_at, pickup_slot_start, accepted_at, picked_up_at, pickup_photo_path, dropoff_code)
    values ($1, 'declutter_delivery', $1, $2, $3, $4, 'Mid City', 'Shenandoah', '1 Seller St', $5, $6, '1 Buyer Ln', $7, $8, 6, 2500, 195,
      $9, $10, $11, now() + interval '2 days', now() + interval '5 days', $12, $13, $14, $15, '1234')`,
    [id, o.status ?? "open", o.size, o.title, o.plat ?? 30.4490, o.plng ?? -91.1490, o.dlat ?? 30.4020, o.dlng ?? -91.0520,
     BUYER, SELLER, o.helpr ?? null, o.slot ?? null, o.helpr ? new Date().toISOString() : null,
     o.status === "picked_up" ? new Date().toISOString() : null, o.status === "picked_up" ? `${o.helpr}/task/${id}/p.jpg` : null]);
  return id;
}
const SMALL = await task({ size: "small", title: "Lamp" });
const LARGE = await task({ size: "large", title: "Couch" });
const XL = await task({ size: "xl", title: "Piano" });
const NAME = { [SMALL]: "small", [LARGE]: "large", [XL]: "xl" };
// Who may carry what (owner 2026-10-28).
const FITS = { NOCAR: [], WALKER: [], CARONLY: ["small"], TRUCK: ["small", "large"], TRUCK2: ["small", "large", "xl"], OLDTRUCK: ["small", "large"] };
const same = (a, b) => [...a].sort().join(",") === [...b].sort().join(",");

// 1. Listed.
for (const [who, uid] of Object.entries(HELPRS)) {
  const r = await as(uid, "select task_id from public.helpr_tasks_open_near(30.45, -91.15, 50)");
  const got = r.ok ? r.rows.map((x) => NAME[x.task_id]).filter(Boolean) : [`error ${r.code}`];
  check(same(got, FITS[who]), `[listed] ${who} sees exactly ${FITS[who].join(", ") || "nothing"} (got ${got.join(", ") || "nothing"})`);
}
// 2. The card of an open delivery.
for (const [who, uid] of Object.entries(HELPRS)) {
  const got = [];
  for (const t of [SMALL, LARGE, XL]) { const r = await as(uid, "select public.helpr_task_view($1) as v", [t]); if (r.ok) got.push(NAME[t]); }
  check(same(got, FITS[who]), `[card] ${who} opens exactly ${FITS[who].join(", ") || "nothing"} (got ${got.join(", ") || "nothing"})`);
}
// 3. Offered (Go online): each insert above offered the task to whom?
const offers = (await db.query(`select user_id, count(*)::int n from public.offers group by 1`)).rows;
const byUser = Object.fromEntries(offers.map((x) => [x.user_id, x.n]));
for (const [who, uid] of Object.entries(HELPRS)) {
  check((byUser[uid] ?? 0) === FITS[who].length, `[offered] ${who} was offered ${FITS[who].length} of the 3 (got ${byUser[uid] ?? 0})`);
}
// 4. Suggested ("On your way"): each Helpr is carrying one small item along the same road.
for (const uid of Object.values(HELPRS)) {
  await task({ size: "small", title: `Carrying ${uid}`, status: "picked_up", helpr: uid, slot: new Date(Date.now() - 3_600_000).toISOString(),
    plat: 30.4500, plng: -91.1500, dlat: 30.4012, dlng: -91.0512 });
}
for (const [who, uid] of Object.entries(HELPRS)) {
  const r = await as(uid, "select public.helpr_route_suggestions(null) as r");
  const got = r.ok ? (r.rows[0].r.suggestions ?? []).map((s) => NAME[s.task_id]).filter(Boolean) : [`error ${r.code}`];
  check(same(got, FITS[who]), `[suggested] ${who} is suggested exactly ${FITS[who].join(", ") || "nothing"} (got ${got.join(", ") || "nothing"})`);
  const refusedWith = [];
  for (const t of [SMALL, LARGE, XL]) { const w = await as(uid, "select public.helpr_route_suggestions($1) as r", [t]); if (!w.ok && /task_not_found/.test(w.code)) refusedWith.push(NAME[t]); }
  const misfits = ["small", "large", "xl"].filter((s) => !FITS[who].includes(s));
  check(same(refusedWith, misfits), `[suggested] ${who}'s "with this one" refuses exactly ${misfits.join(", ") || "nothing"} (got ${refusedWith.join(", ") || "nothing"})`);
}
// 5. Taken: the server refuses a mismatch with a plain message.
const slot = new Date(Date.now() + 26 * 3_600_000).toISOString();
const take = (uid, t) => as(uid, "select public.helpr_task_accept($1, $2::timestamptz) as r", [t, slot]);
const t1 = await take(NOCAR, SMALL);
check(!t1.ok && /vehicle_needs_car/.test(t1.code), `[taken] no car: a small item is refused with "add your car" (${t1.code ?? "accepted"})`);
const t2 = await take(CARONLY, LARGE);
check(!t2.ok && /vehicle_too_small/.test(t2.code), `[taken] a car: a large item is refused, needs a truck (${t2.code ?? "accepted"})`);
const t3 = await take(TRUCK, XL);
check(!t3.ok && /vehicle_too_small/.test(t3.code), `[taken] a truck alone: extra large is refused (${t3.code ?? "accepted"})`);
const t4 = await take(TRUCK2, XL);
check(t4.ok, `[taken] a truck and a second person take extra large${t4.ok ? "" : ` (${t4.code})`}`);
const t5 = await take(CARONLY, SMALL);
check(t5.ok, `[taken] a car takes a small item${t5.ok ? "" : ` (${t5.code})`}`);

// Removing what a held delivery needs is refused; a change that still fits is saved.
const d1 = await save4(TRUCK2, true, true, false, `${TRUCK2}/vehicle/t.jpg`);
check(!d1.ok && /vehicle_in_use/.test(d1.code), `[in use] dropping the second person while holding extra large is refused (${d1.code ?? "saved"})`);
const d2 = await save4(CARONLY, false, false, false);
check(!d2.ok && /vehicle_in_use/.test(d2.code), `[in use] dropping the car while holding a small item is refused (${d2.code ?? "saved"})`);
const d3 = await save4(TRUCK, true, false, false);
check(d3.ok && (await vehicle(TRUCK))?.has_truck === false, "[in use] dropping the truck while carrying only a small item is saved");
const d4 = await save3(OLDTRUCK, false, false);
const v4 = await vehicle(OLDTRUCK);
check(d4.ok && v4?.has_truck === false && v4?.has_car === true,
  `[old app] the three-argument save unticks the truck and keeps the Helpr's car${d4.ok ? "" : ` (${d4.code})`}`);

console.log(failures ? `\n${failures} FAILED` : "\nALL PASS");
process.exit(failures ? 1 : 0);
