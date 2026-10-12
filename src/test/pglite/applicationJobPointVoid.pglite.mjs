#!/usr/bin/env node
/**
 * PGlite proof for 20261012044309_application_job_point_voided_on_move (Q1502).
 *
 *   PGLITE_DIR=~/.lh-pglite node src/test/pglite/applicationJobPointVoid.pglite.mjs
 *
 * World: the newest definitions BEFORE the migration of is_server_context,
 * snapshot_application_job_point, fill_application_job_point_on_first_geocode
 * and jobs_location_clears_coords, with their triggers as prod has them.
 *
 * OLD STATE: the poster moves a job and the applicant's frozen point still
 * describes the old place. "OLD STATE RED".
 * NEW STATE (chain 3x): a move voids every snapshot on the job; an address
 * edit that clears the point and a geocode that re-fills it never re-point a
 * voided row (the ruler 20260907061408 closed stays closed); the poster cannot
 * un-void; a move inside the same 2dp cell voids nothing; a new applicant
 * snapshots the new point; a job's FIRST geocode still fills; the migration's
 * backfill voids a row already stale.
 */
import { PGlite, readMigration, newestFunctionSql, as, checker, USERS } from "./seriesWorld.mjs";

const MIG = "20261012044309_application_job_point_voided_on_move.sql";
const BEFORE = "20261012044309";
const { P, A, B, C } = USERS;
const { check, failures, fail } = checker();
const J1 = "d0000000-0000-0000-0000-000000000001";
const J2 = "d0000000-0000-0000-0000-000000000002";

function world() {
  const fns = [
    "is_server_context",
    "snapshot_application_job_point",
    "fill_application_job_point_on_first_geocode",
    "jobs_location_clears_coords",
  ].map((n) => newestFunctionSql(n, BEFORE).sql);
  return `
  create role anon; create role authenticated; create role service_role bypassrls;
  create schema auth;
  create function auth.uid() returns uuid language sql stable as
    $f$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $f$;
  create function auth.role() returns text language sql stable as
    $f$ select nullif(current_setting('request.jwt.claim.role', true), '') $f$;
  grant usage on schema auth, public to authenticated, anon, service_role;
  create table public.jobs (id uuid primary key, customer_id uuid, location text, latitude numeric, longitude numeric);
  create table public.applications (id uuid primary key default gen_random_uuid(), job_id uuid, helper_id uuid,
    status text default 'pending', job_latitude numeric, job_longitude numeric);
  grant select, insert, update on public.jobs, public.applications to authenticated;
  grant all on public.jobs, public.applications to service_role;
  ${fns.join("\n")}
  create trigger trg_snapshot_application_job_point before insert or update on public.applications
    for each row execute function public.snapshot_application_job_point();
  create trigger trg_fill_application_job_point after update of latitude, longitude on public.jobs
    for each row
    when (old.latitude is null and old.longitude is null and new.latitude is not null and new.longitude is not null)
    execute function public.fill_application_job_point_on_first_geocode();
  create trigger zzzzzz_jobs_location_clears_coords before update of location on public.jobs
    for each row execute function public.jobs_location_clears_coords();
  insert into public.jobs values ('${J1}', '${P}', '1 Main St', 30.4512, -91.1871), ('${J2}', '${P}', 'No pin yet', null, null);
  `;
}

const apply = (db, helper, job) => as(db, "authenticated", helper, `insert into public.applications (job_id, helper_id) values ('${job}', '${helper}')`);
const point = async (db, helper, job = J1) =>
  (await db.query(`select job_latitude::text lat, job_longitude::text lng ${db.__void ? ", job_point_void v" : ""}
                     from public.applications where job_id='${job}' and helper_id='${helper}'`)).rows[0];
const poster = (db, sql) => as(db, "authenticated", P, sql);

// ── OLD STATE ────────────────────────────────────────────────────────────────
{
  const db = new PGlite();
  await db.exec(world());
  await apply(db, A, J1);
  await poster(db, `update public.jobs set latitude = 30.9012, longitude = -91.5871 where id='${J1}'`);
  const p = await point(db, A);
  const red = p.lat === "30.45" && p.lng === "-91.19";
  console.log(`-- OLD STATE ${red ? "RED" : "NOT RED"}: after the job moved 30 miles, the applicant's point is still ${p.lat},${p.lng}`);
  if (!red) fail();
  await db.close();
}

// ── Backfill: a row already stale when the migration lands ───────────────────
{
  const db = new PGlite();
  await db.exec(world());
  await apply(db, A, J1);
  await apply(db, B, J2);
  await poster(db, `update public.jobs set latitude = 30.9012, longitude = -91.5871 where id='${J1}'`);
  const sql = readMigration(MIG);
  for (let i = 0; i < 3; i++) await db.exec(sql);
  db.__void = true;
  const a = await point(db, A);
  check("backfill: a snapshot that no longer matches its job is voided", a.lat === null && a.v === true, JSON.stringify(a));
  const b = await point(db, B, J2);
  check("backfill: a never-geocoded job's empty snapshot is left fillable", b.lat === null && b.v === false, JSON.stringify(b));
  await db.close();
}

// ── NEW STATE ────────────────────────────────────────────────────────────────
const db = new PGlite();
await db.exec(world());
const sql = readMigration(MIG);
for (let i = 0; i < 3; i++) await db.exec(sql);
db.__void = true;
check("migration applies 3x (replay-safe)", true);

await apply(db, A, J1);
await apply(db, B, J2);
let p = await point(db, A);
check("an applicant snapshots the job's rounded point", p.lat === "30.45" && p.lng === "-91.19" && p.v === false, JSON.stringify(p));

let r = await poster(db, `update public.jobs set latitude = 30.4549, longitude = -91.1949 where id='${J1}'`);
p = await point(db, A);
check("a move inside the same 2dp cell voids nothing", r.ok && p.lat === "30.45" && p.v === false, r.err ?? JSON.stringify(p));

r = await poster(db, `update public.jobs set latitude = 30.9012, longitude = -91.5871 where id='${J1}'`);
p = await point(db, A);
check("a move to another place voids the snapshot", r.ok && p.lat === null && p.lng === null && p.v === true, r.err ?? JSON.stringify(p));

await apply(db, C, J1);
p = await point(db, C);
check("a Helpr who applies after the move snapshots the new point", p.lat === "30.90" && p.lng === "-91.59" && p.v === false, JSON.stringify(p));

// The ruler: edit only the address (the BEFORE trigger clears the job's point,
// and a column-list trigger would not see that), then write a chosen point
// (NULL -> value, the first-geocode fill fires).
r = await poster(db, `update public.jobs set location = '2 Oak St' where id='${J1}'`);
const cleared = (await db.query(`select latitude from public.jobs where id='${J1}'`)).rows[0].latitude === null;
p = await point(db, C);
check("an address-only edit voids the snapshot", r.ok && cleared && p.lat === null && p.v === true, r.err ?? JSON.stringify(p));
r = await poster(db, `update public.jobs set latitude = 30.4600, longitude = -91.1900 where id='${J1}'`);
const pa = await point(db, A);
p = await point(db, C);
check("a chosen point after the edit never re-points a voided row", r.ok && pa.lat === null && p.lat === null && p.v === true, JSON.stringify([pa, p]));

r = await poster(db, `update public.applications set job_point_void = false, job_latitude = 30.46, job_longitude = -91.19 where job_id='${J1}' and helper_id='${A}'`);
p = await point(db, A);
check("the poster cannot un-void or write a point", r.ok && p.lat === null && p.v === true, r.err ?? JSON.stringify(p));
r = await as(db, "authenticated", A, `update public.applications set job_point_void = true where job_id='${J2}' and helper_id='${B}'`);
check("an end user cannot set the void flag", (await point(db, B, J2)).v === false, r.err);

r = await poster(db, `update public.jobs set latitude = 30.2200, longitude = -92.0100 where id='${J2}'`);
p = await point(db, B, J2);
check("a job's FIRST geocode still fills an applicant with no snapshot", r.ok && p.lat === "30.22" && p.lng === "-92.01" && p.v === false, r.err ?? JSON.stringify(p));

r = await as(db, "service_role", null, `update public.applications set job_point_void = false, job_latitude = 30.9, job_longitude = -91.59 where job_id='${J1}' and helper_id='${A}'`);
p = await point(db, A);
check("a server context may still repair a row", r.ok && p.lat === "30.9" && p.v === false, r.err ?? JSON.stringify(p));

await db.close();
console.log(failures() ? `\n${failures()} FAILED` : "\nALL PASS");
process.exit(failures() ? 1 : 0);
