#!/usr/bin/env node
/**
 * PGlite proof for 20261012070813_job_address_rederives_zip_and_parish.sql
 * (docs/OPEN.md Q1503): a job's parish and zip_code follow its address.
 *
 *   npx tsx src/test/pglite/jobAddressRederivesPlace.pglite.mjs
 *
 * World: seriesWorld.mjs (the real jobs trigger chain, the Helpr column
 * whitelist included) + the real poster lock and contact scan, then the
 * agreed-change migration (20261007113957) verbatim, the real
 * get_parish_for_city and a slice of louisiana_zip_parishes. The migration
 * under test then runs verbatim, 3x (replay-safe).
 *
 * OLD STATE (migration left out): the poster's edit of an open job's address
 * keeps the old parish and ZIP. "OLD STATE RED".
 *
 *   A1 poster edits an open job to a new Louisiana address: ZIP and parish follow
 *   A2 an address with no ZIP: ZIP cleared, parish from the city
 *   A3 an out-of-state ZIP: that ZIP, no parish (never the old one)
 *   A4 an edit that leaves the address alone keeps ZIP and parish
 *   A5 an agreed change of a booked job's address (applied as the Helpr): ZIP
 *      and parish follow, and the Helpr's whitelist does not refuse it
 *   A7 account deletion's redaction (location NULL) keeps ZIP and parish (the
 *      earnings export groups tax by parish)
 *   A6 the trigger function is nobody's to call, SECURITY DEFINER, pinned
 *      search_path, and sorts after every other BEFORE UPDATE trigger on jobs
 */
import { PGlite, readMigration, baseSchema, newestFunctionSql, as, checker, USERS } from "./seriesWorld.mjs";

const THIS = "20261012070813_job_address_rederives_zip_and_parish.sql";
const DETAIL = "20261007113957_booked_job_detail_change_request.sql";
const MIGRATION = readMigration(THIS);
const { P, A } = USERS;
const { check, failures, fail } = checker();
const J = (n) => `e0000000-0000-0000-0000-0000000000${String(n).padStart(2, "0")}`;

const EXTRA = `
  alter table public.jobs add column materials_note text, add column zip_code text, add column scope_video_url text,
    add column category_x text, add column poster_completed_at timestamptz, add column helper_arrived_at timestamptz;
  ${newestFunctionSql("contact_leak_reason", DETAIL).sql}
  ${newestFunctionSql("reject_contact_leak_in_job", DETAIL).sql}
  ${newestFunctionSql("enforce_poster_jobs_money_lock", DETAIL).sql}
  create trigger trg_reject_contact_leak_in_job before insert or update on public.jobs
    for each row execute function public.reject_contact_leak_in_job();
  create trigger trg_poster_jobs_money_lock before update on public.jobs
    for each row execute function public.enforce_poster_jobs_money_lock();
  ${readMigration(DETAIL)}
  create table if not exists public.louisiana_zip_parishes (zip_code text primary key, parish text not null, city text);
  insert into public.louisiana_zip_parishes values
    ('70801', 'East Baton Rouge', 'Baton Rouge'), ('70802', 'East Baton Rouge', 'Baton Rouge'),
    ('70501', 'Lafayette', 'Lafayette'), ('70112', 'Orleans', 'New Orleans'), ('70121', 'Jefferson', 'New Orleans');
  ${newestFunctionSql("get_parish_for_city", THIS).sql}
`;

const SEED = `
  insert into public.jobs (id, title, description, location, zip_code, parish, customer_id, helper_id, status, date_needed, start_time, helper_confirmed_at, is_group_job, latitude, longitude)
  values ('${J(1)}', 'Wash car', 'Outside', '8 Elm St, Baton Rouge, LA 70801', '70801', 'East Baton Rouge', '${P}', null, 'open', current_date + 5, '09:00', null, false, 30.45, -91.18),
         ('${J(2)}', 'Mow', 'Front', '7 Elm St, Baton Rouge, LA 70801', '70801', 'East Baton Rouge', '${P}', null, 'open', current_date + 5, '09:00', null, false, 30.45, -91.18),
         ('${J(3)}', 'Rake', 'Leaves', '6 Elm St, Baton Rouge, LA 70801', '70801', 'East Baton Rouge', '${P}', null, 'open', current_date + 5, '09:00', null, false, 30.45, -91.18),
         ('${J(4)}', 'Paint', 'Fence', '5 Elm St, Baton Rouge, LA 70801', '70801', 'East Baton Rouge', '${P}', null, 'open', current_date + 5, '09:00', null, false, 30.45, -91.18),
         ('${J(5)}', 'Haul', 'Boxes', '4 Elm St, Baton Rouge, LA 70801', '70801', 'East Baton Rouge', '${P}', '${A}', 'accepted', current_date + 5, '09:00', now(), false, 30.45, -91.18);
`;
const place = async (db, id) => (await db.query(`select location, zip_code, parish from public.jobs where id='${id}'`)).rows[0];
const posterEdit = (db, id, set) => as(db, "authenticated", P, `update public.jobs set ${set} where id='${id}'`);

// ── OLD STATE ────────────────────────────────────────────────────────────────
{
  const db = new PGlite();
  await db.exec(baseSchema(DETAIL));
  await db.exec(EXTRA);
  await db.exec(SEED);
  const r = await posterEdit(db, J(1), `location = '1 Main St, Lafayette, LA 70501', latitude = 30.22, longitude = -92.02`);
  const p = await place(db, J(1));
  const red = r.ok && p.parish === "East Baton Rouge" && p.zip_code === "70801";
  console.log(`-- OLD STATE ${red ? "RED" : "NOT RED"}: an open job moved to Lafayette still reads ${JSON.stringify(p)}${r.ok ? "" : ` (edit refused: ${r.err})`}`);
  if (!red) fail();
  await db.close();
}

// ── NEW STATE ────────────────────────────────────────────────────────────────
const db = new PGlite();
await db.exec(baseSchema(DETAIL));
await db.exec(EXTRA);
let applied = 0;
for (let i = 0; i < 3; i++) {
  try {
    await db.exec(MIGRATION);
    applied++;
  } catch (e) {
    check(`migration applies (run ${i + 1})`, false, e.message);
  }
}
check("the migration applies 3x (replay-safe)", applied === 3);
await db.exec(SEED);

let r = await posterEdit(db, J(1), `location = '1 Main St, Lafayette, LA 70501', latitude = 30.22, longitude = -92.02`);
let p = await place(db, J(1));
check("A1 an open job moved to a new Louisiana address takes its ZIP and parish", r.ok && p.zip_code === "70501" && p.parish === "Lafayette", r.err ?? JSON.stringify(p));

r = await posterEdit(db, J(2), `location = '9 Canal St, New Orleans, LA'`);
p = await place(db, J(2));
check("A2 no ZIP in the new address: ZIP cleared; an ambiguous city (New Orleans spans two parishes) gives no parish, never the old one",
  r.ok && p.zip_code === null && p.parish === null, r.err ?? JSON.stringify(p));
r = await posterEdit(db, J(2), `location = '2 Third St, Lafayette'`);
p = await place(db, J(2));
check("A2 ...and an unambiguous city gives its parish", r.ok && p.zip_code === null && p.parish === "Lafayette", r.err ?? JSON.stringify(p));

r = await posterEdit(db, J(3), `location = '500 Main St, Houston, TX 77002'`);
p = await place(db, J(3));
check("A3 an out-of-state ZIP: that ZIP, no parish", r.ok && p.zip_code === "77002" && p.parish === null, r.err ?? JSON.stringify(p));

r = await posterEdit(db, J(4), `title = 'Paint the fence', location = '5 Elm St, Baton Rouge, LA 70801'`);
p = await place(db, J(4));
check("A4 an edit that leaves the address alone keeps ZIP and parish", r.ok && p.zip_code === "70801" && p.parish === "East Baton Rouge", r.err ?? JSON.stringify(p));
r = await posterEdit(db, J(4), `location = '5 Elm St, Baton Rouge, LA 70802-1234'`);
p = await place(db, J(4));
check("A4 a ZIP+4 reads as its five-digit ZIP", r.ok && p.zip_code === "70802" && p.parish === "East Baton Rouge", r.err ?? JSON.stringify(p));

r = await as(db, "authenticated", P, `select public.request_job_detail_change('${J(5)}', '{"location":"1 Main St, Lafayette, LA 70501","latitude":30.22,"longitude":-92.02}'::jsonb) as v`);
const req = r.rows?.[0]?.v?.request_id;
check("A5 the poster asks to move the booked job", r.ok && !!req, r.err ?? JSON.stringify(r.rows?.[0]?.v));
r = await as(db, "authenticated", A, `select public.respond_job_detail_change('${req}', true) as v`);
p = await place(db, J(5));
check("A5 the Helpr's accept applies it (their whitelist does not refuse the derived columns)", r.ok && r.rows[0].v.status === "accepted", r.err ?? JSON.stringify(r.rows?.[0]?.v));
check("A5 ...and the booked job's ZIP and parish follow the agreed address", p.location === "1 Main St, Lafayette, LA 70501" && p.zip_code === "70501" && p.parish === "Lafayette", JSON.stringify(p));

r = await as(db, "service_role", null, `update public.jobs set location = null where id='${J(4)}'`);
p = await place(db, J(4));
check("A7 a redacted address (account deletion) keeps ZIP and parish", r.ok && p.location === null && p.zip_code === "70802" && p.parish === "East Baton Rouge", r.err ?? JSON.stringify(p));

const g = (await db.query(`select has_function_privilege('anon','public.jobs_location_rederives_place()','EXECUTE') a,
  has_function_privilege('authenticated','public.jobs_location_rederives_place()','EXECUTE') u,
  p.prosecdef d, array_to_string(p.proconfig, ',') cfg
  from pg_proc p where p.oid = 'public.jobs_location_rederives_place()'::regprocedure`)).rows[0];
check("A6 nobody can call the trigger function; SECURITY DEFINER; pinned search_path", !g.a && !g.u && g.d && /search_path=public, pg_temp/.test(g.cfg), JSON.stringify(g));
const last = (await db.query(`select tgname from pg_trigger where tgrelid = 'public.jobs'::regclass and not tgisinternal
  and (tgtype & 2) = 2 and (tgtype & 16) = 16 order by tgname desc limit 1`)).rows[0]?.tgname;
check("A6 it is the last BEFORE UPDATE trigger on jobs", last === "zzzzzz_jobs_location_rederives_place", last);

await db.close();
console.log(failures() ? `\n${failures()} FAILED` : "\nALL PASS");
process.exit(failures() ? 1 : 0);
