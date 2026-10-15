#!/usr/bin/env node
/**
 * PGlite proof for 20261015014815_jobs_checkout_session_server_only (docs/OPEN.md Q1757).
 *
 *   node src/test/pglite/jobsCheckoutSessionServerOnly.pglite.mjs                    # AFTER: migration applied 3x
 *   NEW_MIGRATION=skip node src/test/pglite/jobsCheckoutSessionServerOnly.pglite.mjs # RED: the state on main
 *
 * pglite is not a dependency (CLAUDE.md): it is loaded from ~/.lh-pglite
 * (override with PGLITE_DIR).
 *
 * Fixture = the LIVE jobs trigger chain and policies
 * (scripts/probes/fixtures/dispute-table-door.live.sql), incl. "Admins can
 * update all jobs" and has_role over user_roles, with is_server_context and
 * enforce_poster_jobs_money_lock restated from their newest migrations. An
 * ADMIN is an authenticated user with an admin user_roles row. `SET ROLE
 * authenticated` is PostgREST with a user JWT; service_role is an edge function.
 */
import { readFileSync } from "node:fs";
import os from "node:os";

const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const read = (rel) => readFileSync(new URL(rel, import.meta.url).pathname, "utf8");
const LIVE = read("../../../scripts/probes/fixtures/dispute-table-door.live.sql");
const MIGDIR = "../../../supabase/migrations/";
const NEW = read(`${MIGDIR}20261015014815_jobs_checkout_session_server_only.sql`);
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
const ADMIN = "d3128db4-0000-4000-8000-000000000001";
const id = (n) => `10000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const FUNDED = id(1);
const OPEN = id(2);

const db = new PGlite();
await db.exec(LIVE);
await db.exec(`
CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.role', true), '') $$;
GRANT EXECUTE ON FUNCTION auth.role() TO anon, authenticated, service_role;
ALTER TABLE public.jobs ADD COLUMN IF NOT EXISTS helper_arrival_near_miss_at timestamptz,
  ADD COLUMN IF NOT EXISTS helper_arrival_near_miss_ft numeric,
  ADD COLUMN IF NOT EXISTS helper_arrival_verified_at timestamptz,
  ADD COLUMN IF NOT EXISTS helper_arrived_at timestamptz,
  ADD COLUMN IF NOT EXISTS materials_note text;
CREATE TABLE IF NOT EXISTS public.group_job_helpers (job_id uuid, helper_id uuid);
GRANT SELECT ON public.group_job_helpers TO authenticated, service_role;
`);
await db.exec(cut("20260915101102_null_uid_is_not_server.sql", "is_server_context") + ";");
await db.exec(cut("20261007032429_poster_cannot_rewrite_checkout_session.sql", "enforce_poster_jobs_money_lock"));
if (MODE !== "skip") for (let i = 0; i < 3; i++) await db.exec(NEW);

await db.exec(`
INSERT INTO public.profiles (user_id, idv_status, is_seed) VALUES ('${POSTER}', 'verified', false);
INSERT INTO public.user_roles (user_id, role) VALUES ('${ADMIN}', 'admin');
INSERT INTO public.jobs (id, customer_id, helper_id, title, description, category, location, parish, date_needed, start_time, status, payment_status, budget) VALUES
  ('${FUNDED}', '${POSTER}', NULL, 'Mow', 'x', 'other', '12 Oak', 'Orleans', current_date + 7, '09:00', 'open', 'escrow', 100),
  ('${OPEN}',   '${POSTER}', NULL, 'Mow', 'x', 'other', '12 Oak', 'Orleans', current_date + 7, '09:00', 'open', 'unpaid', 100);
UPDATE public.jobs SET stripe_session_id = 'cs_live_A' WHERE id IN ('${FUNDED}', '${OPEN}');
`);

async function as(who, sql) {
  await db.exec(`RESET ROLE; SELECT set_config('request.uid', '${who && who !== "service" ? who : ""}', false);`);
  await db.exec(`SELECT set_config('request.jwt.claim.role', '${who === "service" ? "service_role" : "authenticated"}', false)`);
  await db.exec(who === "service" ? "SET ROLE service_role" : "SET ROLE authenticated");
  try { const r = await db.query(sql); return { ok: true, rows: r.rows }; }
  catch (e) { return { ok: false, err: e.message }; }
  finally { await db.exec("RESET ROLE"); }
}
const session = async (job) => (await db.query(`SELECT stripe_session_id AS s FROM public.jobs WHERE id = '${job}'`)).rows[0].s;
const patch = (who, job, set) => as(who, `UPDATE public.jobs SET ${set} WHERE id = '${job}' RETURNING id`);
const landed = (r) => r.ok && r.rows.length === 1;
const REFUSED = /Only the server may change jobs\.stripe_session_id/;

{
  const r = await patch(ADMIN, FUNDED, `stripe_session_id = 'cs_test_swap'`);
  check("A-swap: an admin cannot point a funded live job at a cs_test_ session", !landed(r) && (await session(FUNDED)) === "cs_live_A" && REFUSED.test(r.err ?? ""), r.ok ? `landed (${await session(FUNDED)})` : r.err);
}
{
  const r = await patch(ADMIN, OPEN, `stripe_session_id = NULL`);
  check("A-clear: an admin cannot clear an open checkout", !landed(r) && (await session(OPEN)) === "cs_live_A" && REFUSED.test(r.err ?? ""), r.ok ? "landed" : r.err);
}
{
  const r = await patch(ADMIN, OPEN, `title = 'Mow the lawn', stripe_session_id = 'cs_live_A'`);
  check("A-noop: an admin's edit that rewrites the SAME session value still lands", landed(r), r.ok ? "" : r.err);
}
{
  const r = await patch(ADMIN, OPEN, `title = 'Mow the front lawn'`);
  check("A-title: an admin's ordinary edit still lands", landed(r), r.ok ? "" : r.err);
}
{
  const r = await patch(POSTER, OPEN, `stripe_session_id = 'cs_other'`);
  check("P-rewrite: the poster is still refused (Q1366)", !landed(r) && (await session(OPEN)) === "cs_live_A", r.ok ? "landed" : r.err);
}
{
  const r = await patch("service", OPEN, `stripe_session_id = 'cs_live_B'`);
  check("S-stamp: create-payment's service-role stamp lands", landed(r) && (await session(OPEN)) === "cs_live_B", r.ok ? "" : r.err);
  const c = await patch("service", OPEN, `stripe_session_id = NULL`);
  check("S-clear: stripe-webhook's service-role clear lands", landed(c) && (await session(OPEN)) === null, c.ok ? "" : c.err);
}
{
  await db.exec("RESET ROLE");
  await db.exec(`SELECT set_config('request.uid', '', false); SELECT set_config('request.jwt.claim.role', '', false);`);
  await db.exec(`UPDATE public.jobs SET stripe_session_id = 'cs_live_C' WHERE id = '${OPEN}'`);
  check("D-owner: a migration / cron (postgres, no JWT) write lands", (await session(OPEN)) === "cs_live_C");
}
const trig = await db.query(`SELECT count(*)::int AS n FROM pg_trigger WHERE tgname = 'trg_jobs_checkout_session_server_only'`);
check("exactly one trigger after 3x replay", MODE === "skip" ? true : trig.rows[0].n === 1, String(trig.rows[0].n));

console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
