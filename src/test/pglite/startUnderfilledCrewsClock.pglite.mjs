/**
 * Q1424 PGlite proof: start_underfilled_crews starts a funded, partly-hired
 * crew at each of its three time edges, and not 1 ms before, on a fixed clock
 * (./lib/fixedClock.mjs, the newest CREATE of the function and its helpers):
 *   - the offer cutoff (Central start; no start time = the END of the Central
 *     day) is within 15 minutes:      cutoff <= now + 15 min
 *   - the listing's expires_at passed:  expires_at < now
 * checked on an ordinary CDT day and on both 2026 DST days. (Its third branch,
 * no expires_at and date_needed behind Central today, is implied by the first.)
 *
 *   node src/test/pglite/startUnderfilledCrewsClock.pglite.mjs
 *   UNDERFILLED_AS_UTC=1 node src/test/pglite/startUnderfilledCrewsClock.pglite.mjs   # RED: Central read as UTC
 *
 * pglite is loaded from ~/.lh-pglite (CLAUDE.md). Registered in
 * src/test/clockFunctionsProven.test.ts.
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
CREATE TABLE public.jobs (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), status public.job_status, customer_id uuid, title text DEFAULT 'crew',
  helpers_needed int DEFAULT 3, is_group_job boolean DEFAULT true, payment_status text DEFAULT 'escrow',
  date_needed date, start_time time(3), expires_at timestamptz);
CREATE TABLE public.group_job_helpers (job_id uuid, helper_id uuid, helper_confirmed_at timestamptz);
CREATE TABLE public.notifications (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid, job_id uuid, title text, message text, type text, link text);
CREATE FUNCTION public.log_cron_defect(text, text, text, jsonb) RETURNS void LANGUAGE sql AS $f$ SELECT $f$;
`);
for (const name of ["job_payment_is_funded", "job_offer_cutoff"]) await db.exec(newestFunction(name).stmt);
const { file, stmt } = newestFunction("start_underfilled_crews");
let fixed = onFixedClock(stmt);
check(`start_underfilled_crews: every clock read is on the fixed clock (${file})`, !/\bnow\s*\(\s*\)/i.test(fixed) && /_probe_now\(\)/.test(fixed));
if (process.env.UNDERFILLED_AS_UTC) {
  console.log("UNDERFILLED_AS_UTC=1: Central read as UTC (expect FAILs)");
  fixed = fixed.replaceAll("AT TIME ZONE 'America/Chicago'", "AT TIME ZONE 'UTC'");
  await db.exec(newestFunction("job_offer_cutoff").stmt.replaceAll("AT TIME ZONE 'America/Chicago'", "AT TIME ZONE 'UTC'"));
}
for (let i = 0; i < 3; i++) await db.exec(fixed); // replay-safe: applies 3x

const POSTER = "00000000-0000-0000-0000-0000000000b2";
const HELPR = "00000000-0000-0000-0000-0000000000a1";
const MIN = 60_000;
const iso = (ms) => new Date(ms).toISOString();

/** Does a funded crew with one confirmed Helpr start when the sweep runs at `nowMs`? */
async function starts(job, nowMs) {
  await db.exec(`DELETE FROM public.jobs; DELETE FROM public.group_job_helpers; DELETE FROM public.notifications;`);
  const [{ id }] = await q(`INSERT INTO public.jobs (status, customer_id, date_needed, start_time, expires_at)
                            VALUES ('open', $1, $2::date, $3::time(3), $4::timestamptz) RETURNING id`,
    [POSTER, job.date, job.time ?? null, job.expires ?? null]);
  await q(`INSERT INTO public.group_job_helpers VALUES ($1, $2, $3)`, [id, HELPR, iso(nowMs - 60 * MIN)]);
  await setClock(db, iso(nowMs));
  await db.exec(`SELECT public.start_underfilled_crews()`);
  return (await q(`SELECT status FROM public.jobs`))[0].status === "accepted";
}

// [label, date_needed, start_time, the Central start instant (UTC ms)]
const DAYS = [
  ["CDT day", "2026-10-20", "09:00:00", Date.UTC(2026, 9, 20, 14, 0, 0)],
  ["spring-forward day", "2026-03-08", "09:00:00", Date.UTC(2026, 2, 8, 14, 0, 0)],
  ["fall-back day", "2026-11-01", "09:00:00", Date.UTC(2026, 10, 1, 15, 0, 0)],
];
// A far-off expires_at so only the cutoff edge can start it.
const FAR = "2030-01-01T00:00:00Z";
for (const [label, date, time, start] of DAYS) {
  const edge = start - 15 * MIN;
  check(`${label}: 15 min before the Central start + 1 ms, not started`, !(await starts({ date, time, expires: FAR }, edge - 1)));
  check(`${label}: exactly 15 min before the Central start, started`, await starts({ date, time, expires: FAR }, edge));
}
{
  // No start time: the cutoff is the END of the Central day (the next Central midnight).
  const endOfDay = Date.UTC(2026, 9, 21, 5, 0, 0); // 2026-10-21 00:00 CDT
  check("no start time: 15 min before the end of the Central day + 1 ms, not started", !(await starts({ date: "2026-10-20", expires: FAR }, endOfDay - 15 * MIN - 1)));
  check("no start time: 15 min before the end of the Central day, started", await starts({ date: "2026-10-20", expires: FAR }, endOfDay - 15 * MIN));
}
{
  // The listing expired (start far away): strictly after expires_at.
  const exp = Date.UTC(2026, 9, 20, 18, 30, 0);
  const job = { date: "2026-12-01", time: "09:00:00", expires: iso(exp) };
  check("expires_at: at the instant, not started (strict <)", !(await starts(job, exp)));
  check("expires_at: 1 ms after, started", await starts(job, exp + 1));
}
// The third branch (no expires_at and date_needed behind Central today) is never
// the one that decides: a date behind today has an offer cutoff (its start, or
// the end of that day) already past, so the first branch has fired. Not probed.

console.log(failures ? `\n${failures} FAILED` : "\nALL PASS");
process.exitCode = failures ? 1 : 0;
