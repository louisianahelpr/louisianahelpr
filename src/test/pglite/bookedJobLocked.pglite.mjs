#!/usr/bin/env node
/**
 * PGlite proof for 20261004165404_booked_job_place_and_details_locked
 * (docs/OPEN.md Q1204: place and details locked once a Helpr is booked;
 *  Q1189: jobs.created_at is server-owned).
 *
 *   node src/test/pglite/bookedJobLocked.pglite.mjs                    # AFTER: migration applied 3x
 *   NEW_MIGRATION=skip node src/test/pglite/bookedJobLocked.pglite.mjs # RED: the state on main
 *
 * pglite is not a dependency (CLAUDE.md): it is loaded from ~/.lh-pglite
 * (override with PGLITE_DIR).
 *
 * Fixture = the LIVE jobs trigger chain and policies
 * (scripts/probes/fixtures/dispute-table-door.live.sql), then the two
 * functions under test replaced by their EFFECTIVE definitions on main
 * (enforce_poster_jobs_money_lock from 20261003193541,
 * enforce_jobs_insert_column_lock from 20260924044812; neither is rewritten
 * by a later pg_get_functiondef migration, src/test/helpers/
 * effectiveFunctionDefs.ts). Roles are real: `SET ROLE authenticated` is
 * PostgREST with a user JWT (auth.uid() = the poster), `SET ROLE service_role`
 * is an edge function, and the trigger functions are SECURITY DEFINER owned
 * by the superuser, as on prod.
 */
import { readFileSync } from "node:fs";
import os from "node:os";

const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const read = (rel) => readFileSync(new URL(rel, import.meta.url).pathname, "utf8");
const LIVE = read("../../../scripts/probes/fixtures/dispute-table-door.live.sql");
const MIGDIR = "../../../supabase/migrations/";
const NEW = read(`${MIGDIR}20261004165404_booked_job_place_and_details_locked.sql`);
const MODE = process.env.NEW_MIGRATION ?? "";
if (MODE) console.log(`NEW_MIGRATION=${MODE}: running against the state on main (expect FAILs)`);

// The newest CREATE of one function inside one migration file.
function cut(file, name) {
  const sql = read(MIGDIR + file);
  const m = [...sql.matchAll(new RegExp(`CREATE\\s+(?:OR\\s+REPLACE\\s+)?FUNCTION\\s+public\\.${name}\\s*\\(`, "gi"))].at(-1);
  const open = /\bAS\s+(\$\w*\$)/i.exec(sql.slice(m.index));
  const bodyStart = m.index + open.index + open[0].length;
  const close = sql.indexOf(open[1], bodyStart);
  return sql.slice(m.index, sql.indexOf(";", close) + 1);
}

let failures = 0;
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
  if (!ok) failures++;
};

const POSTER = "71c56dfb-b326-4010-b960-b18dd3966e7f";
const HELPER = "437de07d-1bd7-46c8-a451-6b46aa3bcad5";
const id = (n) => `10000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const BOOKED = id(1); // helper_id set, unpaid
const FUNDED = id(2); // helper_id set, funded (escrow)
const CREW = id(3); // helper_id NULL, one crew roster row names a Helpr
const OPEN = id(4); // nobody booked
const OPEN2 = id(5); // nobody booked (photo proof off)
const NOPROOF = id(6); // booked, require_photo_proof already false

const db = new PGlite();
await db.exec(LIVE);
await db.exec(`
CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.role', true), '') $$;
GRANT EXECUTE ON FUNCTION auth.role() TO anon, authenticated, service_role;
ALTER TABLE public.jobs ALTER COLUMN created_at SET DEFAULT now();
-- Columns the insert lock resets that the 2026-09-14 fixture predates.
ALTER TABLE public.jobs ADD COLUMN IF NOT EXISTS helper_arrival_near_miss_at timestamptz,
  ADD COLUMN IF NOT EXISTS helper_arrival_near_miss_ft numeric,
  ADD COLUMN IF NOT EXISTS recurring_helper_id uuid,
  ADD COLUMN IF NOT EXISTS helper_arrival_verified_at timestamptz,
  ADD COLUMN IF NOT EXISTS helper_arrived_at timestamptz,
  ADD COLUMN IF NOT EXISTS helper_on_the_way_at timestamptz;
CREATE TABLE public.group_job_helpers (job_id uuid, helper_id uuid);
GRANT SELECT ON public.group_job_helpers TO authenticated, service_role;
`);
await db.exec(cut("20260915101102_null_uid_is_not_server.sql", "is_server_context") + ";");
await db.exec(cut("20261003193541_accept_completes_after_stripe_setup.sql", "enforce_poster_jobs_money_lock"));
await db.exec(cut("20260924044812_recurring_helper_rpc_only.sql", "enforce_jobs_insert_column_lock"));
if (MODE !== "skip") for (let i = 0; i < 3; i++) await db.exec(NEW);

const OLD_DAY = "2020-01-01T00:00:00Z";
await db.exec(`
INSERT INTO public.profiles (user_id, idv_status, is_seed) VALUES ('${POSTER}', 'verified', false);
INSERT INTO public.jobs (id, customer_id, helper_id, title, description, category, location, parish, zip_code, latitude, longitude,
                         special_requirements, photos, scope_video_url, estimated_hours, is_flexible_schedule, require_photo_proof,
                         date_needed, start_time, status, payment_status, budget, created_at) VALUES
  ('${BOOKED}',  '${POSTER}', '${HELPER}', 'Mow lawn', 'Front and back', 'other', '12 Oak St', 'Orleans', '70112', 29.95, -90.07,
                 'Gate code 1234', ARRAY['a.jpg'], 'v1.mp4', 2, false, true, current_date + 10, '09:00', 'accepted', 'unpaid', 100, '${OLD_DAY}'),
  ('${FUNDED}',  '${POSTER}', '${HELPER}', 'Mow lawn', 'Front and back', 'other', '12 Oak St', 'Orleans', '70112', 29.95, -90.07,
                 'Gate code 1234', ARRAY['a.jpg'], 'v1.mp4', 2, false, true, current_date + 10, '09:00', 'accepted', 'escrow', 100, '${OLD_DAY}'),
  ('${CREW}',    '${POSTER}', NULL,        'Mow lawn', 'Front and back', 'other', '12 Oak St', 'Orleans', '70112', 29.95, -90.07,
                 'Gate code 1234', ARRAY['a.jpg'], 'v1.mp4', 2, false, true, current_date + 10, '09:00', 'open', 'unpaid', 100, '${OLD_DAY}'),
  ('${OPEN}',    '${POSTER}', NULL,        'Mow lawn', 'Front and back', 'other', '12 Oak St', 'Orleans', '70112', 29.95, -90.07,
                 'Gate code 1234', ARRAY['a.jpg'], 'v1.mp4', 2, false, true, current_date + 10, '09:00', 'open', 'unpaid', 100, '${OLD_DAY}'),
  ('${OPEN2}',   '${POSTER}', NULL,        'Mow lawn', 'Front and back', 'other', '12 Oak St', 'Orleans', '70112', 29.95, -90.07,
                 'Gate code 1234', ARRAY['a.jpg'], 'v1.mp4', 2, false, false, current_date + 10, '09:00', 'open', 'unpaid', 100, '${OLD_DAY}'),
  ('${NOPROOF}', '${POSTER}', '${HELPER}', 'Mow lawn', 'Front and back', 'other', '12 Oak St', 'Orleans', '70112', 29.95, -90.07,
                 'Gate code 1234', ARRAY['a.jpg'], 'v1.mp4', 2, false, false, current_date + 10, '09:00', 'accepted', 'unpaid', 100, '${OLD_DAY}');
INSERT INTO public.group_job_helpers (job_id, helper_id) VALUES ('${CREW}', '${HELPER}');
`);

async function as(who, sql) {
  await db.exec(`RESET ROLE; SELECT set_config('request.uid', '${who && who !== "service" ? who : ""}', false);`);
  await db.exec(who === "service" ? "SET ROLE service_role" : who ? "SET ROLE authenticated" : "SET ROLE anon");
  try { const r = await db.query(sql); return { ok: true, rows: r.rows }; }
  catch (e) { return { ok: false, err: e.message }; }
  finally { await db.exec("RESET ROLE"); }
}
// Same, but several statements in one transaction (a transaction-local flag).
async function asTx(who, sql) {
  await db.exec(`RESET ROLE; SELECT set_config('request.uid', '${who}', false); SET ROLE authenticated;`);
  try { await db.exec(`BEGIN; ${sql}; COMMIT;`); return { ok: true }; }
  catch (e) { await db.exec("ROLLBACK").catch(() => {}); return { ok: false, err: e.message }; }
  finally { await db.exec("RESET ROLE"); }
}
const snap = async (job) => JSON.stringify((await db.query(`SELECT to_jsonb(j) AS r FROM public.jobs j WHERE id = '${job}'`)).rows[0].r);
// A PostgREST PATCH with .select("id").
const patch = (who, job, set) => as(who, `UPDATE public.jobs SET ${set} WHERE id = '${job}' RETURNING id`);
const landed = (r) => r.ok && r.rows.length === 1;
const refused = async (label, who, job, set, re) => {
  const before = await snap(job);
  const r = await patch(who, job, set);
  const after = await snap(job);
  check(label, !landed(r) && before === after && (!re || re.test(r.err ?? "")), r.ok ? `landed ${r.rows.length} row(s)` : r.err);
};
const lands = async (label, who, job, set) => {
  const before = await snap(job);
  const r = await patch(who, job, set);
  const after = await snap(job);
  check(label, landed(r) && before !== after, r.ok ? `${r.rows.length} row(s)` : r.err);
};

// Each locked column, with a value that differs from the seeded one.
const LOCKED = [
  ["location", `location = '99 Elm St'`],
  ["parish", `parish = 'Jefferson'`],
  ["zip_code", `zip_code = '70001'`],
  ["latitude", `latitude = 30.45`],
  ["longitude", `longitude = -91.15`],
  ["title", `title = 'Paint fence'`],
  ["description", `description = 'Something else entirely'`],
  ["category", `category = 'moving'`],
  ["special_requirements", `special_requirements = 'Bring your own ladder'`],
  ["photos", `photos = ARRAY['b.jpg']`],
  ["scope_video_url", `scope_video_url = 'v2.mp4'`],
  ["estimated_hours", `estimated_hours = 8`],
  ["is_flexible_schedule", `is_flexible_schedule = true`],
];
const MSG = /Posters may not change jobs\.(\w+) once a Helpr is booked/;
const MSG_MOVE = /Posters may not move jobs\./;

// ── Q1204: booked job — every locked column is refused (RED on main: all land) ──
for (const [col, set] of LOCKED) {
  const before = await snap(BOOKED);
  const r = await patch(POSTER, BOOKED, set);
  check(`R-${col}: poster PATCH on a booked job is refused`, !landed(r) && before === (await snap(BOOKED)) && MSG.exec(r.err ?? "")?.[1] === col, r.ok ? "landed" : r.err);
}
await refused("R-funded: a funded booked job refuses the place too", POSTER, FUNDED, `location = '99 Elm St'`, MSG);
await refused("R-crew: a crew job (no helper_id, roster row names a Helpr) refuses the title", POSTER, CREW, `title = 'Paint fence'`, MSG);
await refused("R-bundle: one locked column hidden in an otherwise ordinary edit", POSTER, BOOKED, `title = 'Mow lawn', description = 'Front and back', location = '99 Elm St'`, MSG);
await refused("R-proof-on: turning photo proof ON is refused once booked", POSTER, NOPROOF, `require_photo_proof = true`, /require_photo_proof once a Helpr is booked/);
await refused("R-date: the Q423 schedule lock still holds", POSTER, BOOKED, `date_needed = date_needed + 3`, MSG_MOVE);

// ── the same PATCH on an OPEN job lands ─────────────────────────────────────
for (const [col, set] of LOCKED) await lands(`O-${col}: the same PATCH on an open job lands`, POSTER, OPEN, set);
await lands("O-proof-on: photo proof on, on an open job", POSTER, OPEN2, `require_photo_proof = true`);
await lands("O-proof-off: photo proof off, on an open job", POSTER, OPEN, `require_photo_proof = false`);

// ── a server write passes on the booked job (geocoder, purge, ops) ──────────
for (const [col, set] of LOCKED) await lands(`S-${col}: service_role write on a booked job lands`, "service", BOOKED, set);

// ── legitimate poster writes on a booked job still land ─────────────────────
await lands("L1 poster turns photo proof OFF on a booked job (relaxes the gate)", POSTER, BOOKED, `require_photo_proof = false`);
{
  const before = await snap(FUNDED);
  const r = await patch(POSTER, FUNDED, `title = 'Mow lawn', description = 'Front and back', location = '12 Oak St', parish = 'Orleans', is_flexible_schedule = false, photos = ARRAY['a.jpg'], require_photo_proof = true`);
  check("L2 a save that rewrites every field to its stored value lands (no change)", landed(r) && before === (await snap(FUNDED)), r.ok ? "" : r.err);
}
await lands("L3 poster edits a non-locked column (budget) on an unfunded booked job", POSTER, BOOKED, `budget = 120`);
{
  // 20260927012809: the schedule change the Helpr asked for and the poster accepted.
  const ok = await asTx(POSTER, `SELECT set_config('app.schedule_change_rpc', '1', true); UPDATE public.jobs SET date_needed = date_needed + 2, start_time = '10:00' WHERE id = '${BOOKED}'`);
  check("L4 respond_job_schedule_change's date/time write still passes", ok.ok, ok.err);
  const flagged = await asTx(POSTER, `SELECT set_config('app.schedule_change_rpc', '1', true); UPDATE public.jobs SET location = '1 Hidden Way' WHERE id = '${BOOKED}'`);
  check("R-flag: the schedule-change flag does NOT unlock the place", !flagged.ok && MSG.test(flagged.err ?? ""), flagged.err ?? "landed");
}

// ── Q1189: created_at is server-owned ───────────────────────────────────────
const ins = (who, jid, extra = "") => as(who, `INSERT INTO public.jobs (id, customer_id, title, status, budget${extra ? ", created_at" : ""}) VALUES ('${jid}', '${POSTER}', 'new', 'open', 50${extra ? `, '${OLD_DAY}'` : ""}) RETURNING created_at`);
const fresh = (ts) => Math.abs(Date.now() - new Date(ts).getTime()) < 5 * 60 * 1000;
{
  const r = await ins(POSTER, id(20), "backdated");
  check("C1 poster INSERT with created_at 2020 is reset to now()", landed(r) && fresh(r.rows[0].created_at), r.ok ? String(r.rows[0]?.created_at) : r.err);
  const r2 = await ins(POSTER, id(21));
  check("C2 an honest poster INSERT still gets a fresh created_at", landed(r2) && fresh(r2.rows[0].created_at), r2.ok ? String(r2.rows[0]?.created_at) : r2.err);
  const r3 = await ins("service", id(22), "backdated");
  check("C3 a server INSERT (service_role) keeps the created_at it sets", landed(r3) && new Date(r3.rows[0].created_at).getUTCFullYear() === 2020, r3.ok ? String(r3.rows[0]?.created_at) : r3.err);
}
await refused("C4 poster PATCH of created_at on an open job is refused", POSTER, OPEN, `created_at = now() + interval '1 day'`, /Posters may not modify jobs\.created_at/);
await refused("C5 ... and on a booked job", POSTER, FUNDED, `created_at = '2019-01-01'`, /Posters may not modify jobs\.created_at/);
await lands("C6 service_role may still change created_at", "service", OPEN, `created_at = '2021-01-01'`);

console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
