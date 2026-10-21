#!/usr/bin/env node
/**
 * PGlite proof for 20261021015146_quote_booked_job_locks_crew_shape.sql (lh-authz-rls review 2026-10-21).
 *
 *   node src/test/pglite/quoteBookedCrewShapeLocked.pglite.mjs [--before]
 *
 * --before loads the PREVIOUS definition (20261015091114_job_quotes.sql) instead: the crew-shape checks
 * must FAIL (the gap). Without it the new migration is applied 3x (replay) and every check must PASS.
 * jobs is cut down to the columns the lock compares; is_server_context() reads a session setting.
 */
import { readFileSync } from "node:fs";
import os from "node:os";

const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const DIR = new URL("../../../supabase/migrations/", import.meta.url).pathname;
const BEFORE = process.argv.includes("--before");

/** The lock's function + trigger statements from a migration (from CREATE OR REPLACE FUNCTION to the trigger). */
function lockBlock(file) {
  const sql = readFileSync(DIR + file, "utf8");
  const start = sql.lastIndexOf("CREATE OR REPLACE FUNCTION public.lock_quote_booked_job_terms()");
  const trig = sql.indexOf("FOR EACH ROW EXECUTE FUNCTION public.lock_quote_booked_job_terms();", start);
  return sql.slice(start, trig + "FOR EACH ROW EXECUTE FUNCTION public.lock_quote_booked_job_terms();".length);
}

const db = new PGlite();
await db.exec(`
  CREATE ROLE anon; CREATE ROLE authenticated;
  CREATE TABLE public.jobs (
    id uuid PRIMARY KEY, budget numeric, title text, description text, category text, date_needed date,
    start_time time, estimated_hours numeric, location text, latitude numeric, longitude numeric,
    helpers_needed int NOT NULL DEFAULT 1, is_group_job boolean NOT NULL DEFAULT false,
    is_urgent boolean NOT NULL DEFAULT false, helper_id uuid);
  CREATE TABLE public.job_quote_requests (id uuid PRIMARY KEY, job_id uuid, status text);
  CREATE FUNCTION public.is_server_context() RETURNS boolean LANGUAGE sql AS
    $$ SELECT coalesce(current_setting('test.server', true), '') = 'on' $$;
  INSERT INTO public.jobs (id, budget, title) VALUES
    ('00000000-0000-4000-8000-000000000001', 220, 'quote booked, unpaid, nobody hired'),
    ('00000000-0000-4000-8000-000000000002', 220, 'an ordinary job'),
    ('00000000-0000-4000-8000-000000000003', 220, 'quote booked, Helpr hired');
  UPDATE public.jobs SET helper_id = '00000000-0000-4000-8000-0000000000aa' WHERE id = '00000000-0000-4000-8000-000000000003';
  INSERT INTO public.job_quote_requests VALUES
    ('00000000-0000-4000-8000-0000000000b1', '00000000-0000-4000-8000-000000000001', 'agreed'),
    ('00000000-0000-4000-8000-0000000000b3', '00000000-0000-4000-8000-000000000003', 'agreed');
`);

// After: the WHOLE new migration file, verbatim, 3x (replay). Before: only the old lock block (the old file
// creates the whole quotes feature, which this cut-down schema does not carry).
const block = BEFORE ? lockBlock("20261015091114_job_quotes.sql") : readFileSync(DIR + "20261021015146_quote_booked_job_locks_crew_shape.sql", "utf8");
const times = BEFORE ? 1 : 3;
for (let i = 0; i < times; i++) await db.exec(block);

const refused = async (sql) => {
  try { await db.exec(sql); return false; } catch (e) { return /quote_terms_locked/.test(String(e.message)); }
};
const checks = [];
const check = (name, ok) => { checks.push([name, ok]); console.log(`${ok ? "PASS" : "FAIL"}  ${name}`); };

check("crew conversion refused on a quote-booked, unpaid, unhired job",
  await refused(`UPDATE public.jobs SET is_group_job = true, helpers_needed = 4 WHERE id = '00000000-0000-4000-8000-000000000001'`));
check("helpers_needed alone refused there",
  await refused(`UPDATE public.jobs SET helpers_needed = 2 WHERE id = '00000000-0000-4000-8000-000000000001'`));
check("is_urgent refused there",
  await refused(`UPDATE public.jobs SET is_urgent = true WHERE id = '00000000-0000-4000-8000-000000000001'`));
check("the price still refused there (unchanged)",
  await refused(`UPDATE public.jobs SET budget = 100 WHERE id = '00000000-0000-4000-8000-000000000001'`));
check("an ordinary job's crew shape still edits",
  !(await refused(`UPDATE public.jobs SET is_group_job = true, helpers_needed = 3 WHERE id = '00000000-0000-4000-8000-000000000002'`)));
check("after a hire the quote lock steps aside (the hire-time locks govern)",
  !(await refused(`UPDATE public.jobs SET helpers_needed = 2 WHERE id = '00000000-0000-4000-8000-000000000003'`)));
await db.exec(`SET test.server = 'on'`);
check("server context passes",
  !(await refused(`UPDATE public.jobs SET helpers_needed = 5 WHERE id = '00000000-0000-4000-8000-000000000001'`)));
await db.exec(`RESET test.server`);

const fails = checks.filter(([, ok]) => !ok).length;
console.log(BEFORE ? `before: ${fails} of ${checks.length} failed (the crew-shape gap must show)` : `after: ${checks.length - fails}/${checks.length} pass (3x applied)`);
process.exit(BEFORE ? (fails >= 3 ? 0 : 1) : fails === 0 ? 0 : 1);
