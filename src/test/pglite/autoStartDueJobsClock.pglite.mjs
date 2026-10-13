/**
 * Q1424 PGlite proof: auto_start_due_jobs starts a booked job AT its Central
 * start instant and not 1 ms before, never retro-starts one whose start is 7
 * days old or more, and reads date_needed + start_time as Central wall-clock,
 * on an ordinary day, at a Central midnight and on both 2026 DST days.
 *
 *   node src/test/pglite/autoStartDueJobsClock.pglite.mjs
 *   AUTO_START_AS_UTC=1 node src/test/pglite/autoStartDueJobsClock.pglite.mjs   # RED: the start read as UTC
 *
 * pglite is not a dependency (CLAUDE.md): it is loaded from ~/.lh-pglite. The
 * function is the NEWEST CREATE across supabase/migrations, its clock reads
 * pointed at a fixed instant by ./lib/fixedClock.mjs. The sweep_* functions are
 * proven by the sweep*Clock probes (src/test/sweepClockProofs.test.ts); this
 * cron is not named sweep_*, so the 2026-10-06 time inventory carried it as
 * unproven (it had one case, 10 minutes past a start, in groupCrewReminders).
 * Registered in src/test/clockFunctionsProven.test.ts.
 */
import os from "node:os";
import { installClock, newestFunction, onFixedClock, setClock } from "./lib/fixedClock.mjs";

const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);

let failures = 0;
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
  if (!ok) failures++;
};

const db = new PGlite();
const q = async (sql, params) => (await db.query(sql, params)).rows;
await installClock(db);
await db.exec(`
SET TIME ZONE 'UTC';
CREATE TYPE public.job_status AS ENUM ('open','accepted','in_progress','completed','cancelled','disputed','pending_approval','revision_requested');
CREATE TABLE public.jobs (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), status public.job_status,
  helper_id uuid, helper_confirmed_at timestamptz, is_group_job boolean DEFAULT false,
  is_flexible_schedule boolean DEFAULT false, date_needed date, start_time time(3));
CREATE TABLE public.group_job_helpers (job_id uuid, helper_id uuid, helper_confirmed_at timestamptz);
CREATE FUNCTION public.log_cron_defect(text, text, text, jsonb) RETURNS void LANGUAGE sql AS $f$ SELECT $f$;
`);

const { file, stmt } = newestFunction("auto_start_due_jobs");
let fixed = onFixedClock(stmt);
check(`auto_start_due_jobs: every clock read is on the fixed clock (${file})`, !/\bnow\s*\(\s*\)/i.test(fixed) && /_probe_now\(\)/.test(fixed));
if (process.env.AUTO_START_AS_UTC) {
  console.log("AUTO_START_AS_UTC=1: the start is read as UTC (expect FAILs)");
  fixed = fixed.replaceAll("AT TIME ZONE 'America/Chicago'", "AT TIME ZONE 'UTC'");
}
for (let i = 0; i < 3; i++) await db.exec(fixed); // replay-safe: applies 3x

const HELPR = "00000000-0000-0000-0000-0000000000a1";
const MIN = 60_000, HOUR = 60 * MIN, DAY = 24 * HOUR;
const iso = (ms) => new Date(ms).toISOString();
const CENTRAL = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Chicago", year: "numeric", month: "2-digit", day: "2-digit",
  hour: "2-digit", minute: "2-digit", second: "2-digit", fractionalSecondDigits: 3, hourCycle: "h23" });
/** The Central wall-clock date and time of `ms`, checked to read back as that same instant. */
async function central(ms) {
  const p = Object.fromEntries(CENTRAL.formatToParts(new Date(ms)).map((x) => [x.type, x.value]));
  const date = `${p.year}-${p.month}-${p.day}`, time = `${p.hour}:${p.minute}:${p.second}.${p.fractionalSecond}`;
  const back = (await q(`SELECT ($1::date + $2::time(3)) AT TIME ZONE 'America/Chicago' AS t`, [date, time]))[0].t;
  if (new Date(back).getTime() !== ms) throw new Error(`${iso(ms)} is not one Central wall-clock time`);
  return { date, time };
}

/** Is a booked single job starting at `startMs` started by a run at `nowMs`? */
async function startsAt(startMs, nowMs, over = {}) {
  await db.exec(`DELETE FROM public.jobs; DELETE FROM public.group_job_helpers;`);
  const { date, time } = await central(startMs);
  await q(`INSERT INTO public.jobs (status, helper_id, helper_confirmed_at, date_needed, start_time, is_flexible_schedule)
           VALUES ('accepted', $1, $2, $3::date, $4::time(3), $5)`,
    [over.helper ?? HELPR, over.confirmed === false ? null : iso(startMs - 2 * DAY), date, over.noTime ? null : time, over.flexible ?? false]);
  if (over.noTime) {
    // A NULL start_time reads as Central midnight of date_needed.
    const midnight = (await q(`SELECT ($1::date + '00:00'::time) AT TIME ZONE 'America/Chicago' AS t`, [date]))[0].t;
    startMs = new Date(midnight).getTime();
  }
  await setClock(db, iso(nowMs));
  await db.exec(`SELECT public.auto_start_due_jobs()`);
  return (await q(`SELECT status FROM public.jobs`))[0].status === "in_progress";
}

// Start instants (UTC ms): an ordinary CDT morning, a Central midnight (UTC 05:00, already the next UTC day at 19:00 Central the night before),
// a CST morning after fall-back (2026-11-01) and a CDT morning after spring-forward (2026-03-08).
const STARTS = {
  "CDT 09:00 (2026-10-20)": Date.UTC(2026, 9, 20, 14, 0, 0),
  "Central midnight (2026-10-21 00:00 CDT)": Date.UTC(2026, 9, 21, 5, 0, 0),
  "fall-back day 09:00 CST (2026-11-01)": Date.UTC(2026, 10, 1, 15, 0, 0),
  "spring-forward day 09:00 CDT (2026-03-08)": Date.UTC(2026, 2, 8, 14, 0, 0),
};
for (const [label, s] of Object.entries(STARTS)) {
  check(`${label}: 1 ms before the start, not started`, !(await startsAt(s, s - 1)));
  check(`${label}: at the start instant, started`, await startsAt(s, s));
  check(`${label}: 1 ms after, started`, await startsAt(s, s + 1));
  check(`${label}: 7 days later (the backstop), not retro-started`, !(await startsAt(s, s + 7 * DAY)));
  check(`${label}: 1 ms inside the 7-day backstop, started`, await startsAt(s, s + 7 * DAY - 1));
}
{
  const s = Date.UTC(2026, 9, 20, 14, 0, 0);
  check("no start_time: due at Central midnight of date_needed, not before", !(await startsAt(s, Date.UTC(2026, 9, 20, 5, 0, 0) - 1, { noTime: true })));
  check("no start_time: started at Central midnight", await startsAt(s, Date.UTC(2026, 9, 20, 5, 0, 0), { noTime: true }));
  check("a flexible-schedule job never auto-starts", !(await startsAt(s, s + HOUR, { flexible: true })));
  check("an unconfirmed single booking never auto-starts", !(await startsAt(s, s + HOUR, { confirmed: false })));
}

console.log(failures ? `\n${failures} FAILED` : "\nALL PASS");
process.exitCode = failures ? 1 : 0;
