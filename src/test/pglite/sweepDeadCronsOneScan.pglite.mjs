/**
 * PGlite proof for 20260925140304_sweep_dead_crons_one_scan (Q105(4)).
 *
 *   node src/test/pglite/sweepDeadCronsOneScan.pglite.mjs
 *
 * pglite is not a dependency (CLAUDE.md): it is loaded from ~/.lh-pglite.
 *
 * Proves: the new body applies 3x; on ONE fixture that reaches every verdict
 * (healthy, raised, lost connection, startup timeout, a raise older than 24h,
 * erroring, 2 of 3 failed, still running, dead, never-ran, unscheduled,
 * inactive, unmonitored), the previous body (20260924082754) and the new body
 * file the same error_logs rows (job, verdict, message, context) and return
 * the same result; a second sweep the same day files nothing twice; anon and
 * authenticated cannot execute it.
 */
import { readFileSync } from "node:fs";
import os from "node:os";

const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const read = (f) => readFileSync(new URL(`../../../supabase/migrations/${f}`, import.meta.url).pathname, "utf8")
  // pg_cron cannot be installed in PGlite; the function's own "is pg_cron
  // here" probe is pointed at a stand-in table instead.
  .replace("FROM pg_extension WHERE extname = 'pg_cron'", "FROM public._ext WHERE extname = 'pg_cron'");
const OLD = read("20260924082754_cron_raised_verdict.sql");
const NEW = read("20260925140304_sweep_dead_crons_one_scan.sql");

let failures = 0;
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
  if (!ok) failures++;
};

const db = new PGlite();
const q = async (sql, params) => (await db.query(sql, params)).rows;

await db.exec(`
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated; END IF;
END $$;
GRANT USAGE ON SCHEMA public TO anon, authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO anon, authenticated;
CREATE TABLE public._ext (extname text); INSERT INTO public._ext VALUES ('pg_cron');
CREATE TABLE public.error_logs (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), severity text,
  message text, tags jsonb, context jsonb, created_at timestamptz DEFAULT now());
CREATE TABLE public.cron_work_expectations (jobname text PRIMARY KEY, expected_max_gap interval,
  registered_at timestamptz DEFAULT now() - interval '30 days');
CREATE SCHEMA vault; CREATE TABLE vault.decrypted_secrets (name text, decrypted_secret text);
CREATE SCHEMA net; CREATE TABLE net.posts (body jsonb);
CREATE FUNCTION net.http_post(url text, headers jsonb, body jsonb) RETURNS bigint
  LANGUAGE sql AS $f$ INSERT INTO net.posts VALUES (body) RETURNING 1::bigint $f$;
CREATE FUNCTION public.check_ops_digest_delivery() RETURNS jsonb LANGUAGE sql AS $f$ SELECT '{"ok":true}'::jsonb $f$;
CREATE SCHEMA cron;
CREATE TABLE cron.job (jobid bigint PRIMARY KEY, jobname text, active boolean DEFAULT true);
CREATE TABLE cron.job_run_details (runid bigserial, jobid bigint, status text, return_message text,
  start_time timestamptz, end_time timestamptz);
`);

// Hourly jobs with 30 hours of successful runs, 2-hour tolerance.
const hourly = ["healthy", "once-raised", "conn-lost", "startup-to", "old-raise", "three-bad",
  "two-of-three", "running-now", "dead", "inactive"];
let id = 0;
const jobId = {};
for (const j of hourly) {
  jobId[j] = ++id;
  await q(`INSERT INTO cron.job VALUES ($1, $2, $3)`, [id, j, j !== "inactive"]);
  await q(`INSERT INTO public.cron_work_expectations (jobname, expected_max_gap) VALUES ($1, interval '2 hours')`, [j]);
  const from = j === "dead" ? 5 : 1; // "dead" last ran 5 hours ago
  for (let h = from; h <= 30; h++)
    await q(`INSERT INTO cron.job_run_details (jobid, status, return_message, start_time, end_time)
             VALUES ($1, 'succeeded', '1 row', now() - make_interval(hours => $2),
                     now() - make_interval(hours => $2) + interval '1 second')`, [id, h]);
}
// Registered long ago, scheduled, never ran.
jobId["never-ran"] = ++id;
await q(`INSERT INTO cron.job VALUES ($1, 'never-ran', true)`, [id]);
await q(`INSERT INTO public.cron_work_expectations (jobname, expected_max_gap) VALUES ('never-ran', interval '2 hours')`);
// Expected, but no cron.job row.
await q(`INSERT INTO public.cron_work_expectations (jobname, expected_max_gap) VALUES ('unscheduled', interval '2 hours')`);
// Scheduled, no expectation.
await q(`INSERT INTO cron.job VALUES ($1, 'unmonitored', true)`, [++id]);

const fail = (job, hoursAgo, msg) =>
  q(`UPDATE cron.job_run_details SET status='failed', return_message=$3
      WHERE jobid=$1 AND start_time = (SELECT start_time FROM cron.job_run_details
                                        WHERE jobid=$1 ORDER BY start_time DESC OFFSET $2 - 1 LIMIT 1)`,
    [jobId[job], hoursAgo, msg]);
await fail("once-raised", 5, "ERROR:  canceling statement due to statement timeout");
await fail("once-raised", 9, "ERROR:  an older raise the page must not quote");
await fail("conn-lost", 5, "connection failed");
await fail("startup-to", 5, "job startup timeout");
await fail("old-raise", 26, "ERROR:  division by zero");
for (const h of [1, 2, 3]) await fail("three-bad", h, "ERROR:  relation does not exist");
for (const h of [1, 3]) await fail("two-of-three", h, "connection failed");
// A run in flight (no end_time) newest: the last-3 window skips it.
await q(`INSERT INTO cron.job_run_details (jobid, status, start_time) VALUES ($1, 'running', now())`, [jobId["running-now"]]);
for (const h of [2, 3, 4]) await fail("running-now", h, "connection failed");

const sweep = async () => {
  const ret = (await q(`SELECT public.sweep_dead_crons() r`))[0].r;
  const rows = await q(`SELECT tags->>'job' j, tags->>'verdict' v, message m, context c
                          FROM error_logs WHERE tags->>'source'='cron-dead' ORDER BY 1`);
  const posts = await q(`SELECT body FROM net.posts`);
  return { ret, rows, posts };
};
const reset = () => db.exec(`DELETE FROM error_logs; DELETE FROM net.posts;`);

await db.exec(OLD);
const before = await sweep();
await reset();

for (let i = 0; i < 3; i++) await db.exec(NEW);
check("applies 3x", true);
const after = await sweep();

const verdicts = Object.fromEntries(after.rows.map((r) => [r.j, r.v]));
const expected = {
  "once-raised": "raised", "three-bad": "erroring",
  // its newest run is still in flight; the 3 finished before it all failed
  "running-now": "erroring", dead: "dead", "never-ran": "never-ran",
  unscheduled: "unscheduled", inactive: "inactive", unmonitored: "unmonitored",
};
check("every verdict is reached on the fixture", JSON.stringify(verdicts) === JSON.stringify(
  Object.fromEntries(Object.entries(expected).sort(([a], [b]) => a.localeCompare(b)))), JSON.stringify(verdicts));
check("the raise quoted is the newest one",
  /statement timeout/.test(after.rows.find((r) => r.j === "once-raised")?.m ?? ""));
check("old body and new body file the same rows",
  JSON.stringify(before.rows) === JSON.stringify(after.rows),
  `${before.rows.length} vs ${after.rows.length}`);
check("...and return the same result", JSON.stringify(before.ret) === JSON.stringify(after.ret));
check("...and page Slack the same way", JSON.stringify(before.posts) === JSON.stringify(after.posts));

const n = (await q(`SELECT count(*)::int n FROM error_logs`))[0].n;
await q(`SELECT public.sweep_dead_crons()`);
check("a second sweep the same day files nothing twice", (await q(`SELECT count(*)::int n FROM error_logs`))[0].n === n);

const acl = (await q(`SELECT has_function_privilege('anon','public.sweep_dead_crons()','EXECUTE') a,
                             has_function_privilege('authenticated','public.sweep_dead_crons()','EXECUTE') b`))[0];
check("anon/authenticated cannot execute it", !acl.a && !acl.b);

console.log(failures ? `\n${failures} FAIL` : "\nALL PASS");
process.exit(failures ? 1 : 0);
