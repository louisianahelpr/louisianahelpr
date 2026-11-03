/**
 * Q1424 PGlite proof: the two email roundups' windows, on a fixed clock (./lib/fixedClock.mjs, newest CREATE of each).
 * emailRoundups.pglite.mjs rewrites the stored last_emailed_at / last_emailed_day; this one moves the clock:
 *   send_application_roundups  last_emailed_at <= now - 3 h: a poster's next roundup exactly 3 h after the last one,
 *                              not 1 ms sooner; last_emailed_at stamped with the clock
 *   send_job_match_roundups    last_emailed_day < the Louisiana date of now: once a Louisiana day, flipping exactly at
 *                              Central midnight (CDT, CST, both 2026 DST Sundays), never at UTC midnight
 *
 *   node src/test/pglite/emailRoundupsClock.pglite.mjs
 *   ROUNDUP_APPS_STRICT=1 ...   # RED: the 3-hour edge made strict
 *   ROUNDUP_DAY_UTC=1 ...       # RED: the job-match day read in UTC
 *
 * net.http_post and vault.decrypted_secrets are stubbed (the send is send-notification-email's own proof).
 * pglite is loaded from ~/.lh-pglite (CLAUDE.md). Registered in src/test/clockFunctionsProven.test.ts.
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
CREATE ROLE service_role;
CREATE ROLE authenticated;
CREATE ROLE anon;
CREATE SCHEMA net;
CREATE SCHEMA vault;
CREATE TABLE vault.decrypted_secrets (name text, decrypted_secret text);
INSERT INTO vault.decrypted_secrets VALUES ('supabase_url', 'http://probe'), ('service_role_key', 'k');
CREATE TABLE public.sent (body jsonb);
CREATE FUNCTION net.http_post(url text, headers jsonb, body jsonb) RETURNS bigint LANGUAGE sql AS $$ INSERT INTO public.sent VALUES (body); SELECT 1::bigint $$;
CREATE TABLE public.application_email_state (user_id uuid PRIMARY KEY, waiting int, last_emailed_at timestamptz, updated_at timestamptz DEFAULT '2026-01-01');
CREATE TABLE public.job_match_email_state (user_id uuid PRIMARY KEY, waiting int, last_emailed_day date, updated_at timestamptz DEFAULT '2026-01-01');
`);
const apps = newestFunction("send_application_roundups");
const jobs = newestFunction("send_job_match_roundups");
let appsSql = onFixedClock(apps.stmt);
let jobsSql = onFixedClock(jobs.stmt);
check(`every clock read is on the fixed clock (${apps.file}, ${jobs.file})`,
  ![appsSql, jobsSql].some((s) => /\bnow\s*\(\s*\)/i.test(s)) && [appsSql, jobsSql].every((s) => /_probe_now\(\)/.test(s)));
let mutated = false;
if (process.env.ROUNDUP_APPS_STRICT) {
  console.log("ROUNDUP_APPS_STRICT=1 (expect FAILs)");
  const from = "s.last_emailed_at <= public._probe_now() - interval '3 hours'";
  check("ROUNDUP_APPS_STRICT: the text to change is there", appsSql.includes(from));
  appsSql = appsSql.replace(from, "s.last_emailed_at < public._probe_now() - interval '3 hours'");
  mutated = true;
}
if (process.env.ROUNDUP_DAY_UTC) {
  console.log("ROUNDUP_DAY_UTC=1 (expect FAILs)");
  const from = "(public._probe_now() AT TIME ZONE 'America/Chicago')::date";
  check("ROUNDUP_DAY_UTC: the text to change is there", jobsSql.includes(from));
  jobsSql = jobsSql.replace(from, "(public._probe_now() AT TIME ZONE 'UTC')::date");
  mutated = true;
}
check("the mutation (if any) applied", !mutated || appsSql !== onFixedClock(apps.stmt) || jobsSql !== onFixedClock(jobs.stmt));
// Replay-safe: applies 3x.
for (let i = 0; i < 3; i++) { await db.exec(appsSql); await db.exec(jobsSql); }

const U = "16161616-1616-4616-8616-161616161616";
const iso = (ms) => (ms == null ? null : new Date(ms).toISOString());
const H = 3_600_000;
const N = Date.UTC(2026, 6, 15, 20, 0, 0);

// 1. Applicant roundups: 3 hours apart.
for (const [label, last, want] of [["last roundup 3 h minus 1 ms ago: not yet", N - 3 * H + 1, 0], ["last roundup exactly 3 h ago: sent", N - 3 * H, 1]]) {
  await db.exec(`DELETE FROM public.sent; DELETE FROM public.application_email_state;`);
  await q(`INSERT INTO public.application_email_state (user_id, waiting, last_emailed_at) VALUES ($1, 2, $2)`, [U, iso(last)]);
  await setClock(db, iso(N));
  const n = (await q(`SELECT public.send_application_roundups() AS n`))[0].n;
  const [{ at, waiting }] = await q(`SELECT last_emailed_at::text at, waiting FROM public.application_email_state`);
  check(`applicants: ${label}`, n === want && (want ? at === "2026-07-15 20:00:00+00" && waiting === 0 : waiting === 2), JSON.stringify({ n, at, waiting }));
}
// 2. Job-match roundups: once a Louisiana day.
const midnights = [
  { name: "CDT", at: Date.UTC(2026, 6, 15, 5, 0, 0), prev: "2026-07-14" },
  { name: "CST", at: Date.UTC(2026, 0, 20, 6, 0, 0), prev: "2026-01-19" },
  { name: "spring-forward Sunday night", at: Date.UTC(2026, 2, 9, 5, 0, 0), prev: "2026-03-08" },
  { name: "fall-back Sunday night", at: Date.UTC(2026, 10, 2, 6, 0, 0), prev: "2026-11-01" },
];
for (const m of midnights) {
  for (const [label, now, want] of [["1 ms before Louisiana midnight: already sent today", m.at - 1, 0], ["at Louisiana midnight: a new day, sent", m.at, 1]]) {
    await db.exec(`DELETE FROM public.sent; DELETE FROM public.job_match_email_state;`);
    await q(`INSERT INTO public.job_match_email_state (user_id, waiting, last_emailed_day) VALUES ($1, 3, $2)`, [U, m.prev]);
    await setClock(db, iso(now));
    const n = (await q(`SELECT public.send_job_match_roundups() AS n`))[0].n;
    check(`job matches, ${m.name}, last sent ${m.prev}, ${label}`, n === want, String(n));
  }
}

console.log(failures ? `${failures} FAILED` : "ALL PASS");
process.exit(failures ? 1 : 0);
