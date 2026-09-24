/**
 * PGlite proof for 20260924082754_cron_raised_verdict (CJ-004).
 *
 *   node src/test/pglite/cronRaisedVerdict.pglite.mjs
 *   BEFORE=1 node src/test/pglite/cronRaisedVerdict.pglite.mjs   # the live body before it: RED
 *
 * pglite is not a dependency (CLAUDE.md): it is loaded from ~/.lh-pglite.
 * BEFORE reads the pre-migration body out of the migration itself (the three
 * CJ-004 edits reverted), so the RED run is the definition that was live.
 *
 * Proves: applies 3x; a job that raised its own error once between successes
 * is flagged 'raised' with the message; a lost connection or startup timeout
 * alone is NOT (the fleet sweep owns those); a raise older than 24h is not; a
 * second sweep the same day files nothing twice; 3-in-a-row still says
 * 'erroring'; anon/authenticated cannot execute it.
 */
import { readFileSync } from "node:fs";
import os from "node:os";

const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
let MIGRATION = readFileSync(
  new URL("../../../supabase/migrations/20260924082754_cron_raised_verdict.sql", import.meta.url).pathname, "utf8");
if (process.env.BEFORE) {
  MIGRATION = MIGRATION
    .replace(/,\n\s*-- CJ-004:[\s\S]*?AS raised_msg\n/, "\n")
    .replace("             l.raised_msg,\n", "")
    .replace("               WHEN l.raised_msg IS NOT NULL THEN 'raised'\n", "")
    .replace("             NULL::text        AS raised_msg,\n", "")
    .replaceAll("r.raised_msg", "NULL::text");
}
// pg_cron cannot be installed in PGlite; the function's own "is pg_cron here"
// probe is pointed at a stand-in table instead.
MIGRATION = MIGRATION.replace("FROM pg_extension WHERE extname = 'pg_cron'", "FROM public._ext WHERE extname = 'pg_cron'");

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

// Every job runs hourly and has a liveness expectation, so only failure verdicts can fire.
const jobs = ["once-raised", "conn-lost", "startup-to", "old-raise", "three-bad", "healthy"];
for (const [i, j] of jobs.entries()) {
  await q(`INSERT INTO cron.job VALUES ($1, $2, true)`, [i + 1, j]);
  await q(`INSERT INTO public.cron_work_expectations (jobname, expected_max_gap) VALUES ($1, interval '2 hours')`, [j]);
  for (let h = 1; h <= 30; h++)
    await q(`INSERT INTO cron.job_run_details (jobid, status, return_message, start_time, end_time)
             VALUES ($1, 'succeeded', '1 row', now() - make_interval(hours => $2), now() - make_interval(hours => $2) + interval '1 second')`, [i + 1, h]);
}
const fail = (job, hoursAgo, msg) =>
  q(`UPDATE cron.job_run_details SET status='failed', return_message=$3
      WHERE jobid=(SELECT jobid FROM cron.job WHERE jobname=$1)
        AND start_time = (SELECT start_time FROM cron.job_run_details d JOIN cron.job j USING (jobid)
                          WHERE j.jobname=$1 ORDER BY start_time DESC OFFSET $2 - 1 LIMIT 1)`, [job, hoursAgo, msg]);
await fail("once-raised", 5, "ERROR:  canceling statement due to statement timeout");
await fail("conn-lost", 5, "connection failed");
await fail("startup-to", 5, "job startup timeout");
await fail("old-raise", 26, "ERROR:  division by zero");
for (const h of [1, 2, 3]) await fail("three-bad", h, "ERROR:  relation does not exist");

for (let i = 0; i < 3; i++) await db.exec(MIGRATION);
check("applies 3x", true);

await q(`SELECT public.sweep_dead_crons()`);
const verdicts = Object.fromEntries(
  (await q(`SELECT tags->>'job' j, tags->>'verdict' v, message m FROM error_logs WHERE tags->>'source'='cron-dead'`))
    .map((r) => [r.j, r]));
check("a job that raised once between successes is flagged 'raised'", verdicts["once-raised"]?.v === "raised",
  JSON.stringify(verdicts["once-raised"] ?? null));
check("...and the page carries the error", /statement timeout/.test(verdicts["once-raised"]?.m ?? ""));
check("a lost connection alone is not 'raised'", !verdicts["conn-lost"]);
check("a startup timeout alone is not 'raised'", !verdicts["startup-to"]);
check("a raise older than 24h is not flagged", !verdicts["old-raise"]);
check("three failures in a row still say 'erroring'", verdicts["three-bad"]?.v === "erroring");
check("a healthy job is not flagged", !verdicts["healthy"]);
check("Slack was paged", (await q(`SELECT 1 FROM net.posts`)).length === 1);

const before = (await q(`SELECT count(*)::int n FROM error_logs`))[0].n;
await q(`SELECT public.sweep_dead_crons()`);
check("a second sweep the same day files nothing twice", (await q(`SELECT count(*)::int n FROM error_logs`))[0].n === before);

const acl = (await q(`SELECT has_function_privilege('anon','public.sweep_dead_crons()','EXECUTE') a,
                             has_function_privilege('authenticated','public.sweep_dead_crons()','EXECUTE') b`))[0];
check("anon/authenticated cannot execute it", !acl.a && !acl.b);

console.log(failures ? `\n${failures} FAIL` : "\nALL PASS");
process.exit(failures ? 1 : 0);
