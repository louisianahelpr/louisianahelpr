#!/usr/bin/env node
/**
 * PGlite proof for Q2408 "Any time this week" (20261104073000_jobs_date_window_end.sql).
 *
 *   npx tsx src/test/pglite/jobDateWindow.pglite.mjs [--skip]
 *
 * The migration verbatim (applied 3x for replay-safety) on a jobs table shaped like prod's for the columns these
 * triggers read, with the triggers created the way their own migrations create them. --skip applies only the column
 * and the CHECK (no trigger or function changes): the listing-window and clear-on-hire checks FAIL.
 *
 *   W1 an existing one-day row (NULL end) is untouched and still valid
 *   W2 the CHECK takes a window of 1..6 extra days and refuses +7, an end on/before the first day, and an end with no day
 *   W3 a new window job's listing stays up until the window's LAST day (not its first)
 *   W4 a new one-day job still closes at its own day
 *   W5 booking (status leaves open) clears the window
 *   W5b ...and re-derives the expiry from the booked day (a later reopen is a plain one-day job)
 *   W6 moving the day to the window's last day (a Helpr's pick at hire) clears the window instead of failing the CHECK,
 *      and the expiry is recomputed from the NEW day
 *   W7 setting a window on an open job (an edit) moves the expiry to the window's last day
 *   W8 a window can never be added to a booked job (schedule_locked)
 *   W9 the 2-hour notice reads the window's LAST day: a window whose first day starts now is taken; the same one-day
 *      job is still refused (job_start_too_soon)
 */
import { readFileSync } from "node:fs";
import os from "node:os";

const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const DIR = new URL("../../../supabase/migrations/", import.meta.url).pathname;
const MIGRATION = readFileSync(DIR + "20261104073000_jobs_date_window_end.sql", "utf8");
const SKIP = process.argv.includes("--skip");

let failures = 0;
let checks = 0;
const check = (name, ok, detail = "") => {
  checks++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
  if (!ok) failures++;
};

const db = new PGlite();
await db.exec(`
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated; END IF;
END $$;
CREATE TABLE public.profiles (user_id uuid PRIMARY KEY, is_seed boolean NOT NULL DEFAULT false);
CREATE TYPE public.job_status AS ENUM ('open','assigned','in_progress','completed','cancelled','expired');
CREATE TABLE public.jobs (
  id serial PRIMARY KEY, customer_id uuid, date_needed date, start_time time, status public.job_status NOT NULL DEFAULT 'open',
  expires_at timestamptz, parent_job_id uuid
);
CREATE FUNCTION public.is_server_context() RETURNS boolean LANGUAGE sql AS $$ SELECT false $$;
CREATE OR REPLACE FUNCTION public.job_expires_at_for_schedule(p_date_needed date, p_start_time time) RETURNS timestamptz
  LANGUAGE sql STABLE AS $$ SELECT CASE WHEN p_date_needed IS NULL THEN NULL
    ELSE (p_date_needed + COALESCE(p_start_time, time '23:59:59')) AT TIME ZONE 'America/Chicago' END; $$;
`);
// The two functions this migration redefines, at their current (pre-migration) definitions, with their triggers.
const fnFrom = (file, name) => {
  const t = readFileSync(DIR + file, "utf8");
  const start = t.lastIndexOf(`CREATE OR REPLACE FUNCTION public.${name}(`);
  const tag = t.slice(start).match(/AS\s+(\$[A-Za-z_]*\$)/)[1];
  const bodyStart = t.indexOf(tag, start) + tag.length;
  return t.slice(start, t.indexOf(tag, bodyStart) + tag.length) + ";";
};
await db.exec(fnFrom("20261008190546_job_start_two_hours_notice.sql", "refuse_short_notice_job"));
await db.exec(fnFrom("20260831201631_job_expiry_floor_and_reschedule_recompute.sql", "enforce_job_expiry_floor"));
await db.exec(`
CREATE TRIGGER trg_jobs_short_notice BEFORE INSERT ON public.jobs FOR EACH ROW EXECUTE FUNCTION public.refuse_short_notice_job();
CREATE TRIGGER trg_job_expiry_floor BEFORE INSERT OR UPDATE ON public.jobs FOR EACH ROW EXECUTE FUNCTION public.enforce_job_expiry_floor();
INSERT INTO public.profiles VALUES ('00000000-0000-4000-8000-000000000001', false);
INSERT INTO public.jobs (customer_id, date_needed, start_time) VALUES ('00000000-0000-4000-8000-000000000001', current_date + 3, '09:00');
`);

const migration = SKIP ? MIGRATION.slice(0, MIGRATION.indexOf("CREATE OR REPLACE FUNCTION public.clear_job_date_window")) : MIGRATION;
for (let i = 0; i < 3; i++) await db.exec(migration);

const ME = "'00000000-0000-4000-8000-000000000001'";
const q = async (sql) => (await db.query(sql)).rows;
const tries = async (sql) => { try { await db.exec(sql); return null; } catch (e) { return String(e.message); } };
const ct = (d, t) => `((current_date + ${d}) + time '${t}') AT TIME ZONE 'America/Chicago'`;

const [old] = await q(`SELECT date_window_end FROM public.jobs WHERE id = 1`);
check("W1 an existing one-day row keeps a NULL end", old.date_window_end === null);

const ins = (start, end, time = "NULL") =>
  `INSERT INTO public.jobs (customer_id, date_needed, start_time, date_window_end) VALUES (${ME}, ${start === null ? "NULL" : `current_date + ${start}`}, ${time}, ${end === null ? "NULL" : `current_date + ${end}`})`;
check("W2 +1 and +6 are windows", (await tries(ins(2, 3))) === null && (await tries(ins(2, 8))) === null);
const bad = [await tries(ins(2, 9)), await tries(ins(2, 2)), await tries(ins(2, 1)), await tries(`INSERT INTO public.jobs (customer_id, date_needed, date_window_end, parent_job_id) VALUES (${ME}, NULL, current_date + 4, gen_random_uuid())`)];
check("W2 +7, an end on/before the first day and an end with no day are refused", bad.every((m) => m && /jobs_date_window_end_in_a_week/.test(m)), bad.map((m) => (m ? "refused" : "taken")).join(","));

await db.exec(`DELETE FROM public.jobs WHERE id > 1`);
await db.exec(ins(2, 8));
const [w] = await q(`SELECT id, expires_at = ${ct(8, "23:59")} AS at_end, expires_at = ${ct(2, "23:59")} AS at_first FROM public.jobs WHERE date_window_end IS NOT NULL`);
check("W3 a window job's listing runs to the window's last day", w.at_end === true, `at_end=${w.at_end} at_first=${w.at_first}`);

await db.exec(ins(3, null, "'10:00'"));
const [one] = await q(`SELECT expires_at = ${ct(3, "10:00")} AS ok FROM public.jobs WHERE date_window_end IS NULL AND id > 1`);
check("W4 a one-day job still closes at its own start", one.ok === true);

await db.exec(`UPDATE public.jobs SET status = 'assigned' WHERE id = ${w.id}`);
const [booked] = await q(`SELECT date_window_end FROM public.jobs WHERE id = ${w.id}`);
check("W5 booking clears the window", booked.date_window_end === null);
const [bk] = await q(`SELECT expires_at = ${ct(2, "23:59:59")} AS ok FROM public.jobs WHERE id = ${w.id}`);
check("W5b booking re-derives the expiry from the booked day, so a reopen behaves as a one-day job", bk.ok === true);

await db.exec(ins(2, 8));
const [w2] = await q(`SELECT id FROM public.jobs WHERE date_window_end IS NOT NULL`);
const moved = await tries(`UPDATE public.jobs SET date_needed = current_date + 8, start_time = '14:00' WHERE id = ${w2.id}`);
const [m] = moved ? [{}] : await q(`SELECT date_window_end, expires_at = ${ct(8, "14:00")} AS ok FROM public.jobs WHERE id = ${w2.id}`);
check("W6 moving the day to the window's end clears the window (no CHECK failure) and re-derives the expiry", !moved && m.date_window_end === null && m.ok === true, moved ?? `end=${m.date_window_end} expiry_ok=${m.ok}`);

await db.exec(ins(4, null));
const [w3] = await q(`SELECT id FROM public.jobs WHERE date_needed = current_date + 4`);
await db.exec(`UPDATE public.jobs SET date_window_end = current_date + 9 WHERE id = ${w3.id}`);
const [e] = await q(`SELECT expires_at = ${ct(9, "23:59:59")} AS ok, expires_at FROM public.jobs WHERE id = ${w3.id}`);
check("W7 adding a window to an open job moves its expiry to the window's last day", e.ok === true, String(e.expires_at));

const [w5] = await q(`SELECT id FROM public.jobs WHERE status = 'assigned' LIMIT 1`);
const locked = await tries(`UPDATE public.jobs SET date_window_end = date_needed + 3 WHERE id = ${w5.id}`);
check("W8 a window cannot be added to a booked job", !!locked && /schedule_locked/.test(locked), locked ?? "taken");

const nowDay = "(now() AT TIME ZONE 'America/Chicago')::date";
const nowTime = "(now() AT TIME ZONE 'America/Chicago')::time";
const winNow = await tries(`INSERT INTO public.jobs (customer_id, date_needed, start_time, date_window_end) VALUES (${ME}, ${nowDay}, ${nowTime}, ${nowDay} + 3)`);
const oneNow = await tries(`INSERT INTO public.jobs (customer_id, date_needed, start_time) VALUES (${ME}, ${nowDay}, ${nowTime})`);
check("W9 the 2-hour notice reads the window's last day (a window starting now is taken; a one-day job starting now is refused)",
  winNow === null && !!oneNow && /job_start_too_soon/.test(oneNow), `window=${winNow ?? "taken"} oneday=${oneNow ?? "taken"}`);

console.log(`\n${checks - failures}/${checks} ${failures ? "FAIL" : "PASS"}${SKIP ? " (--skip)" : ""}`);
process.exit(failures ? 1 : 0);
