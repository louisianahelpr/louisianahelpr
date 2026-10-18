#!/usr/bin/env node
/**
 * PGlite proof for 20261018024950_poster_fee_job_schedule_locked (Q1996 BEFORE
 * THE FLIP, lh-money-escrow review of slice 3a #2): a poster cannot turn a job
 * that carries the poster-fee stamp into a series, or a series into a one-off.
 *
 *   node src/test/pglite/posterFeeJobScheduleLocked.pglite.mjs                  # before (RED) + after, 3x apply
 *   NEW_MIGRATION=skip node src/test/pglite/posterFeeJobScheduleLocked.pglite.mjs  # before only
 *
 * pglite is not a dependency (CLAUDE.md); it is read from PGLITE_DIR
 * (default ~/.lh-pglite).
 *
 * Shape: a minimal public.jobs with the columns the trigger reads,
 * public.series_visit_holds, a job_has_crew stub, and the PREVIOUS definition
 * (20260927012806, which equals live pg_get_functiondef read 2026-10-18)
 * applied first, as on prod.
 *
 * RED-BEFORE (20260927012806 alone):
 *   R1  a poster PATCHes recurrence_days onto a stamped, unhired one-off and it lands.
 * AFTER:
 *   A1  that PATCH is refused 42501 (fee_locked).
 *   A2  clearing recurrence_days on a stamped series is refused 42501.
 *   A3  an unstamped (flat model) unhired one-off still becomes a series (unchanged).
 *   A4  a poster's other UPDATE on the stamped job still lands.
 *   A5  the service role (server) can still change it.
 *   A6  the hired-series lock still holds (unchanged).
 *   A7  the migration applies three times (replay-safe).
 */
const PGLITE_DIR = process.env.PGLITE_DIR ?? `${process.env.HOME}/.lh-pglite`;
let PGlite;
try {
  ({ PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`));
} catch {
  console.error(`Could not load pglite from ${PGLITE_DIR} (npm i @electric-sql/pglite there).`);
  process.exit(2);
}
import { readFileSync } from "node:fs";

const ROOT = new URL("../../../", import.meta.url).pathname;
function lockBlock(file) {
  const src = readFileSync(`${ROOT}supabase/migrations/${file}`, "utf8");
  const start = src.indexOf("CREATE OR REPLACE FUNCTION public.enforce_series_columns_client_lock()");
  const endMark = "FOR EACH ROW EXECUTE FUNCTION public.enforce_series_columns_client_lock();";
  const end = src.indexOf(endMark, start);
  if (start < 0 || end < 0) throw new Error(`no lock block in ${file}`);
  return src.slice(start, end + endMark.length);
}
const PREVIOUS = lockBlock("20260927012806_recurring_split_days.sql");
const MIGRATION = readFileSync(
  process.env.NEW_MIGRATION_FILE ?? `${ROOT}supabase/migrations/20261018024950_poster_fee_job_schedule_locked.sql`,
  "utf8",
);
const MODE = process.env.NEW_MIGRATION ?? "";
const POSTER = "11111111-1111-1111-1111-111111111111";
const HELPR = "22222222-2222-2222-2222-222222222222";

async function fresh() {
  const db = new PGlite();
  await db.exec(`
    CREATE ROLE anon NOLOGIN; CREATE ROLE authenticated NOLOGIN; CREATE ROLE service_role NOLOGIN BYPASSRLS;
    CREATE TABLE public.jobs (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      customer_id uuid, title text, status text DEFAULT 'open',
      helper_id uuid, recurring_helper_id uuid, parent_job_id uuid,
      recurrence_days integer[], recurrence_weeks integer, recurrence_end_date date,
      series_ended_on date, series_split_ok boolean DEFAULT false,
      date_needed date DEFAULT '2026-11-02', start_time time,
      payment_status text DEFAULT 'unpaid', poster_fee_flat_cents integer
    );
    CREATE TABLE public.series_visit_holds (parent_job_id uuid, visit_date date, helper_id uuid);
    CREATE FUNCTION public.job_has_crew(uuid) RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT false $$;
    GRANT ALL ON public.jobs, public.series_visit_holds TO authenticated, service_role;
    INSERT INTO public.jobs (customer_id, title, payment_status, poster_fee_flat_cents) VALUES
      ('${POSTER}', 'p_oneoff', 'escrow', 70),
      ('${POSTER}', 'flat_oneoff', 'escrow', NULL);
    INSERT INTO public.jobs (customer_id, title, payment_status, poster_fee_flat_cents, recurrence_days, recurrence_weeks) VALUES
      ('${POSTER}', 'p_series', 'escrow', 70, '{1,3}', 4);
    INSERT INTO public.jobs (customer_id, title, payment_status, helper_id, recurrence_days, recurrence_weeks) VALUES
      ('${POSTER}', 'hired_series', 'escrow', '${HELPR}', '{2}', 4);
  `);
  await db.exec(PREVIOUS);
  return db;
}
async function as(db, role, sql) {
  await db.exec(`SET ROLE ${role};`);
  try { return await db.query(sql); } finally { await db.exec(`RESET ROLE;`); }
}
const errCode = async (p) => {
  try { await p; return "ok"; } catch (e) { return e.code ?? String(e.message); }
};
let failures = 0;
const check = (name, cond, detail = "") => {
  console.log(`${cond ? "PASS" : "FAIL"} ${name}${detail ? `  (${detail})` : ""}`);
  if (!cond) failures++;
};
const days = async (db, title) =>
  (await db.query(`SELECT recurrence_days d FROM public.jobs WHERE title='${title}'`)).rows[0]?.d ?? null;

{
  const db = await fresh();
  const r1 = await errCode(as(db, "authenticated", `UPDATE public.jobs SET recurrence_days = '{1}' WHERE title='p_oneoff'`));
  check("R1 (before) a poster turns a stamped one-off into a series", r1 === "ok" && JSON.stringify(await days(db, "p_oneoff")) === "[1]", r1);
  await db.close();
}

if (MODE !== "skip") {
  const db = await fresh();
  for (let i = 0; i < 3; i++) await db.exec(MIGRATION);
  check("A7 the migration applies three times", true);

  const a1 = await errCode(as(db, "authenticated", `UPDATE public.jobs SET recurrence_days = '{1}' WHERE title='p_oneoff'`));
  check("A1 a stamped one-off cannot become a series (42501)", a1 === "42501" && (await days(db, "p_oneoff")) === null, a1);

  const a2 = await errCode(as(db, "authenticated", `UPDATE public.jobs SET recurrence_days = NULL WHERE title='p_series'`));
  check("A2 a stamped series cannot become a one-off (42501)", a2 === "42501", a2);

  const a3 = await errCode(as(db, "authenticated", `UPDATE public.jobs SET recurrence_days = '{4}' WHERE title='flat_oneoff'`));
  check("A3 an unstamped unhired one-off still becomes a series", a3 === "ok" && JSON.stringify(await days(db, "flat_oneoff")) === "[4]", a3);

  const a4 = await errCode(as(db, "authenticated", `UPDATE public.jobs SET title = 'p_oneoff' , start_time = '09:00' WHERE title='p_oneoff'`));
  check("A4 another UPDATE on the stamped job still lands", a4 === "ok", a4);

  const a5 = await errCode(as(db, "service_role", `UPDATE public.jobs SET recurrence_days = '{5}' WHERE title='p_oneoff'`));
  check("A5 the server can still change it", a5 === "ok" && JSON.stringify(await days(db, "p_oneoff")) === "[5]", a5);

  const a6 = await errCode(as(db, "authenticated", `UPDATE public.jobs SET recurrence_days = '{2,4}' WHERE title='hired_series'`));
  check("A6 the hired-series lock still holds (42501)", a6 === "42501", a6);
  await db.close();
}

console.log(failures ? `\n${failures} FAILED` : "\nALL PASS");
process.exit(failures ? 1 : 0);
