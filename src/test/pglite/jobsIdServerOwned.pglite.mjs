#!/usr/bin/env node
/**
 * PGlite proof for 20261004191544_jobs_id_server_owned (docs/OPEN.md Q1253).
 *
 *   node src/test/pglite/jobsIdServerOwned.pglite.mjs                    # AFTER: migration applied 3x
 *   NEW_MIGRATION=skip node src/test/pglite/jobsIdServerOwned.pglite.mjs # RED: the state on main
 *
 * pglite is not a dependency (CLAUDE.md): it is loaded from ~/.lh-pglite
 * (override with PGLITE_DIR).
 *
 * Fixture = the LIVE jobs trigger chain and policies
 * (scripts/probes/fixtures/dispute-table-door.live.sql), with
 * enforce_jobs_insert_column_lock replaced by its newest definition on main
 * (20261004165404, md5 = live). `SET ROLE authenticated` is PostgREST with a
 * user JWT (auth.uid() = the poster); `SET ROLE service_role` is an edge
 * function.
 */
import { readFileSync } from "node:fs";
import os from "node:os";

const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const read = (rel) => readFileSync(new URL(rel, import.meta.url).pathname, "utf8");
const LIVE = read("../../../scripts/probes/fixtures/dispute-table-door.live.sql");
const MIGDIR = "../../../supabase/migrations/";
const NEW = read(`${MIGDIR}20261004191544_jobs_id_server_owned.sql`);
const MODE = process.env.NEW_MIGRATION ?? "";
if (MODE) console.log(`NEW_MIGRATION=${MODE}: running against the state on main (expect FAILs)`);

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
const CHOSEN = "deadbeef-0000-4000-8000-000000000001";
const CHOSEN_SVC = "deadbeef-0000-4000-8000-000000000002";

const db = new PGlite();
await db.exec(LIVE);
await db.exec(`
CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.role', true), '') $$;
GRANT EXECUTE ON FUNCTION auth.role() TO anon, authenticated, service_role;
ALTER TABLE public.jobs ALTER COLUMN created_at SET DEFAULT now();
-- Live default (information_schema.columns, 2026-10-04); the 09-14 fixture omits it.
ALTER TABLE public.jobs ALTER COLUMN id SET DEFAULT gen_random_uuid();
ALTER TABLE public.jobs ADD COLUMN IF NOT EXISTS helper_arrival_near_miss_at timestamptz,
  ADD COLUMN IF NOT EXISTS helper_arrival_near_miss_ft numeric,
  ADD COLUMN IF NOT EXISTS recurring_helper_id uuid,
  ADD COLUMN IF NOT EXISTS helper_arrival_verified_at timestamptz,
  ADD COLUMN IF NOT EXISTS helper_arrived_at timestamptz,
  ADD COLUMN IF NOT EXISTS helper_on_the_way_at timestamptz;
`);
await db.exec(cut("20260915101102_null_uid_is_not_server.sql", "is_server_context") + ";");
await db.exec(cut("20261004165404_booked_job_place_and_details_locked.sql", "enforce_jobs_insert_column_lock"));
if (MODE !== "skip") for (let i = 0; i < 3; i++) await db.exec(NEW);
await db.exec(`INSERT INTO public.profiles (user_id, idv_status, is_seed) VALUES ('${POSTER}', 'verified', false);`);

async function as(who, sql) {
  await db.exec(`RESET ROLE; SELECT set_config('request.uid', '${who && who !== "service" ? who : ""}', false);`);
  await db.exec(`SELECT set_config('request.jwt.claim.role', '${who === "service" ? "service_role" : "authenticated"}', false)`);
  await db.exec(who === "service" ? "SET ROLE service_role" : "SET ROLE authenticated");
  try { const r = await db.query(sql); return { ok: true, rows: r.rows }; }
  catch (e) { return { ok: false, err: e.message }; }
  finally { await db.exec("RESET ROLE"); }
}
const exists = async (id) => (await db.query(`SELECT count(*)::int n FROM public.jobs WHERE id = '${id}'`)).rows[0].n === 1;
const cols = (id) => `${id ? "id, " : ""}customer_id, title, status, budget`;
const vals = (id) => `${id ? `'${id}', ` : ""}'${POSTER}', 'new', 'open', 50`;

{
  const r = await as(POSTER, `INSERT INTO public.jobs (${cols(CHOSEN)}) VALUES (${vals(CHOSEN)}) RETURNING id`);
  check("R1 a poster's chosen id is replaced by a server id", r.ok && r.rows[0].id !== CHOSEN && !(await exists(CHOSEN)), r.ok ? `got ${r.rows[0].id}` : r.err);
  const again = await as(POSTER, `INSERT INTO public.jobs (${cols(CHOSEN)}) VALUES (${vals(CHOSEN)}) RETURNING id`);
  check("R2 ...so the same chosen id twice is two fresh rows, never that id", again.ok && again.rows[0].id !== CHOSEN && again.rows[0].id !== r.rows?.[0]?.id, again.ok ? `got ${again.rows[0].id}` : again.err);
}
{
  const h = await as(POSTER, `INSERT INTO public.jobs (${cols()}) VALUES (${vals()}) RETURNING id`);
  check("L1 an honest post (no id, as the app sends) still lands and reads its id back", h.ok && /^[0-9a-f-]{36}$/.test(h.rows[0].id), h.ok ? h.rows[0].id : h.err);
  const s = await as("service", `INSERT INTO public.jobs (${cols(CHOSEN_SVC)}) VALUES (${vals(CHOSEN_SVC)}) RETURNING id`);
  check("L2 a server insert (service_role) keeps the id it sets", s.ok && s.rows[0].id === CHOSEN_SVC, s.ok ? s.rows[0].id : s.err);
}

console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
