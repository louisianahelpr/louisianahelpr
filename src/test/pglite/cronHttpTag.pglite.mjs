/**
 * PGlite proof for 20260923162402_cron_http_request_ids (docs/OPEN.md Q174).
 *
 *   node src/test/pglite/cronHttpTag.pglite.mjs
 *   BEFORE=1 node src/test/pglite/cronHttpTag.pglite.mjs   # 20260828030000's sweep: RED
 *
 * pglite is not a dependency (CLAUDE.md): it is loaded from ~/.lh-pglite
 * (override with PGLITE_DIR).
 *
 * Stand-ins for pg_net (net.http_post returns a queue id, net._http_response
 * keyed by it), vault and pg_cron (cron.job, cron.schedule, cron.alter_job,
 * cron.job_run_details). The cron.job rows are the SHAPES the migrations leave
 * live: 20260831190419's format() command after 20260922222716's timeout
 * rewrite, a literal one, a command with two posts, one no migration lists,
 * and a SQL-only one. Proves: applies 3x and wraps each command exactly once,
 * byte for byte inside the wrapper; the unwrappable one is left alone; a
 * wrapped command run the way cron runs it AND the way run_missed_cron_catch_up
 * EXECUTEs it returns the request id and records the tag; a tagged 500 is
 * filed under its job ('request-id' attribution), a tagged timeout is a
 * warning, an UNTAGGED 500 (a manual probe) is NOT filed, two crons firing in
 * the same second are each filed under their own name, a re-run files nothing
 * twice; a failing tag insert still returns the id and logs 'cron-http-tag';
 * the prune keeps 2 days; prune job + liveness expectation registered once;
 * anon/authenticated can execute nothing and read nothing.
 */
import { readFileSync } from "node:fs";
import os from "node:os";

const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const mig = (f) => readFileSync(new URL(`../../../supabase/migrations/${f}`, import.meta.url).pathname, "utf8");
const BEFORE = !!process.env.BEFORE;
const OLD_SWEEP = mig("20260828030000_cron_watcher_exact_attribution.sql");
const MIGRATION = mig("20260923162402_cron_http_request_ids.sql");

let failures = 0;
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
  if (!ok) failures++;
};

const db = new PGlite();
const q = async (sql, params) => (await db.query(sql, params)).rows;
const one = async (sql, params) => (await q(sql, params))[0];

await db.exec(`
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role; END IF;
END $$;
GRANT USAGE ON SCHEMA public TO anon, authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO anon, authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated;
CREATE TABLE public.error_logs (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), severity text,
  message text, tags jsonb, context jsonb, created_at timestamptz DEFAULT now());
CREATE TABLE public.cron_work_expectations (jobname text PRIMARY KEY, candidate_key text,
  expected_max_gap interval, note text NOT NULL DEFAULT '');
CREATE SCHEMA vault;
CREATE TABLE vault.decrypted_secrets (name text, decrypted_secret text);
INSERT INTO vault.decrypted_secrets VALUES ('supabase_url', 'https://x.supabase.co'), ('service_role_key', 'k');
-- pg_net stand-in: same signature as pg_net 0.x; the id is the response's id.
CREATE SCHEMA net;
CREATE TABLE net.http_request_queue (id bigserial PRIMARY KEY, url text, body jsonb, headers jsonb, timeout_milliseconds int);
CREATE TABLE net._http_response (id bigint, status_code int, content_type text, headers jsonb,
  content text, timed_out boolean, error_msg text, created timestamptz NOT NULL DEFAULT now());
CREATE FUNCTION net.http_post(url text, body jsonb DEFAULT '{}'::jsonb, params jsonb DEFAULT '{}'::jsonb,
  headers jsonb DEFAULT '{}'::jsonb, timeout_milliseconds integer DEFAULT 5000) RETURNS bigint
  LANGUAGE sql AS $$ INSERT INTO net.http_request_queue (url, body, headers, timeout_milliseconds)
  VALUES (url, body, headers, timeout_milliseconds) RETURNING id $$;
-- pg_cron stand-in.
CREATE SCHEMA cron;
CREATE TABLE cron.job (jobid bigserial PRIMARY KEY, jobname text UNIQUE, schedule text, command text,
  active boolean DEFAULT true);
CREATE TABLE cron.job_run_details (runid bigserial, jobid bigint, status text, return_message text,
  start_time timestamptz, end_time timestamptz);
CREATE FUNCTION cron.schedule(p_name text, p_sched text, p_cmd text) RETURNS bigint LANGUAGE sql AS $$
  INSERT INTO cron.job (jobname, schedule, command) VALUES (p_name, p_sched, p_cmd)
  ON CONFLICT (jobname) DO UPDATE SET schedule = EXCLUDED.schedule, command = EXCLUDED.command
  RETURNING jobid $$;
CREATE FUNCTION cron.alter_job(job_id bigint, schedule text DEFAULT NULL, command text DEFAULT NULL,
  database text DEFAULT NULL, username text DEFAULT NULL, active boolean DEFAULT NULL) RETURNS void
  LANGUAGE sql AS $$ UPDATE cron.job SET schedule = coalesce(alter_job.schedule, cron.job.schedule),
  command = coalesce(alter_job.command, cron.job.command) WHERE jobid = job_id $$;
`);

// The live shapes. 20260831190419's format() output with 20260922222716's rewrite:
const fmt = (fn) => `
          SELECT net.http_post(timeout_milliseconds := 30000,
            url := (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'supabase_url' LIMIT 1)
                   || '/functions/v1/${fn}',
            headers := jsonb_build_object(
              'Content-Type', 'application/json',
              'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'service_role_key' LIMIT 1)
            ),
            body := '{}'::jsonb
          );
        `;
const LIVE = {
  "auto-release-payment": fmt("auto-release-payment"),
  "void-cancelled-payments": fmt("void-cancelled-payments"),
  "money-reconciliation": `SELECT net.http_post(timeout_milliseconds := 30000, url := 'https://x/functions/v1/money-reconciliation', body := '{"mode":"daily"}'::jsonb) AS request_id`,
  "two-posts": `SELECT net.http_post(url := 'a'), net.http_post(url := 'b');`,
  "made-on-dashboard": `SELECT net.http_post(url := 'https://x/functions/v1/extend-boosts');`,
  "sweep-cron-http-failures": `SELECT public.sweep_cron_http_failures();`,
};
for (const [name, cmd] of Object.entries(LIVE)) {
  await q(`SELECT cron.schedule($1, '0 * * * *', $2)`, [name, cmd]);
}

// ── apply ──────────────────────────────────────────────────────────────────
await db.exec(OLD_SWEEP);
if (!BEFORE) {
  for (let i = 0; i < 3; i++) {
    const res = await db.exec(MIGRATION);
    check(`migration applies (pass ${i + 1})`, Array.isArray(res));
  }
}
const cmd = async (name) => (await one(`SELECT command FROM cron.job WHERE jobname = $1`, [name]))?.command;

if (!BEFORE) {
  for (const name of ["auto-release-payment", "void-cancelled-payments", "money-reconciliation", "made-on-dashboard"]) {
    const c = await cmd(name);
    const body = LIVE[name].replace(/;\s*$/, "");
    const expected = `SELECT public.cron_http_tag(q.request_id, '${name}')\n  FROM (${body}\n) AS q(request_id);`;
    check(`${name}: wrapped exactly once, original command byte for byte inside`, c === expected,
      c === expected ? "" : JSON.stringify(c).slice(0, 160));
  }
  check("two-posts: left alone (more than one net.http_post)", (await cmd("two-posts")) === LIVE["two-posts"]);
  check("SQL-only job untouched", (await cmd("sweep-cron-http-failures")) === LIVE["sweep-cron-http-failures"]);
}

// ── fire the crons ──────────────────────────────────────────────────────────
// As pg_cron does (the command as-is) and as run_missed_cron_catch_up does
// (EXECUTE of the command with its trailing ';' stripped).
const r1 = await one(await cmd("auto-release-payment"));
const r2 = await one(await cmd("void-cancelled-payments"));
await db.exec(`DO $$ BEGIN EXECUTE regexp_replace((SELECT command FROM cron.job WHERE jobname = 'money-reconciliation'), ';\\s*$', ''); END $$;`);
const idRelease = Number(Object.values(r1)[0]);
const idVoid = Number(Object.values(r2)[0]);
const idMoney = Number((await one(`SELECT max(id) AS id FROM net.http_request_queue`)).id);
// A manual probe: a person calling net.http_post by hand.
const idProbe = Number((await one(`SELECT net.http_post(url := 'https://x/functions/v1/money-reconciliation?include_seed=1') AS id`)).id);

if (!BEFORE) {
  const tags = await q(`SELECT request_id::int AS id, jobname FROM public.cron_http_requests ORDER BY request_id`);
  check("each fired cron (incl. the catch-up EXECUTE path) recorded its own request id",
    JSON.stringify(tags) === JSON.stringify([
      { id: idRelease, jobname: "auto-release-payment" },
      { id: idVoid, jobname: "void-cancelled-payments" },
      { id: idMoney, jobname: "money-reconciliation" },
    ]), JSON.stringify(tags));
  check("the wrapped command still returns the request id", idRelease > 0 && idVoid === idRelease + 1);
}

// Responses: all in the same second, as 2026-08-28 found for crons sharing a minute.
await db.exec(`
INSERT INTO net._http_response (id, status_code, content, timed_out, error_msg, created) VALUES
  (${idRelease}, 500, '{"ok":false}', false, NULL, now() - interval '1 minute'),
  (${idVoid},    502, 'Bad gateway',  false, NULL, now() - interval '1 minute'),
  (${idMoney},   NULL, NULL,          true, 'Timeout of 30000 ms reached', now() - interval '1 minute'),
  (${idProbe},   500, '{"error":"boom"}', false, NULL, now() - interval '1 minute');
-- The old sweep's proximity guess needs run rows; give it the real ones.
INSERT INTO cron.job_run_details (jobid, status, start_time, end_time)
  SELECT jobid, 'succeeded', now() - interval '1 minute 2 seconds', now() - interval '1 minute'
    FROM cron.job WHERE jobname IN ('auto-release-payment', 'void-cancelled-payments', 'money-reconciliation');
`);

const sweep1 = (await one(`SELECT public.sweep_cron_http_failures() AS r`)).r;
const rows = await q(`SELECT severity, tags->>'job' AS job, context->>'response_id' AS rid,
  context->>'attribution' AS attribution FROM public.error_logs WHERE tags->>'source' = 'cron-http' ORDER BY rid`);
const byId = new Map(rows.map((r) => [Number(r.rid), r]));

check("an UNTAGGED 500 (manual probe) is NOT filed as a cron failure", !byId.has(idProbe),
  byId.has(idProbe) ? `filed as ${byId.get(idProbe).job} (${byId.get(idProbe).attribution})` : "");
check("a tagged 500 is filed under its own job, attribution request-id",
  byId.get(idRelease)?.job === "auto-release-payment" && byId.get(idRelease)?.attribution === "request-id" &&
  byId.get(idRelease)?.severity === "error", JSON.stringify(byId.get(idRelease)));
check("a second cron in the same second is filed under ITS name, not a coin flip",
  byId.get(idVoid)?.job === "void-cancelled-payments" && byId.get(idVoid)?.attribution === "request-id",
  JSON.stringify(byId.get(idVoid)));
check("a tagged timeout is a warning under its job",
  byId.get(idMoney)?.job === "money-reconciliation" && byId.get(idMoney)?.severity === "warning",
  JSON.stringify(byId.get(idMoney)));
check("sweep reports 3 logged, 2 errors", sweep1.logged === 3 && sweep1.errors === 2, JSON.stringify(sweep1));
const sweep2 = (await one(`SELECT public.sweep_cron_http_failures() AS r`)).r;
check("re-running files nothing twice", sweep2.logged === 0, JSON.stringify(sweep2));

if (!BEFORE) {
  // A body naming another function is flagged, never trusted over the tag.
  const idX = Number((await one(await cmd("made-on-dashboard"))).cron_http_tag);
  await q(`INSERT INTO net._http_response (id, status_code, content, timed_out) VALUES ($1, 500, '{"fn":"something-else"}', false)`, [idX]);
  await q(`SELECT public.sweep_cron_http_failures()`);
  const x = await one(`SELECT tags->>'job' AS job, context->>'attribution' AS a FROM public.error_logs WHERE context->>'response_id' = $1`, [String(idX)]);
  check("a body naming another function keeps the tag's job and says so",
    x?.job === "made-on-dashboard" && x?.a === "request-id (body names something-else)", JSON.stringify(x));

  // A failing tag insert must not fail the cron.
  await db.exec(`ALTER TABLE public.cron_http_requests ADD CONSTRAINT planted CHECK (jobname <> 'boom-job')`);
  const t = await one(`SELECT public.cron_http_tag(424242, 'boom-job') AS id`);
  const logged = await one(`SELECT count(*)::int AS n FROM public.error_logs WHERE tags->>'source' = 'cron-http-tag' AND tags->>'job' = 'boom-job'`);
  check("a failing tag insert still returns the id and logs cron-http-tag", Number(t.id) === 424242 && logged.n === 1,
    `${t.id} / ${logged.n}`);
  await db.exec(`ALTER TABLE public.cron_http_requests DROP CONSTRAINT planted`);
  check("a null request id records nothing", (await one(`SELECT public.cron_http_tag(NULL, 'x') AS id`)).id === null);

  // Prune.
  await db.exec(`INSERT INTO public.cron_http_requests VALUES (9001, 'old', now() - interval '3 days'), (9002, 'recent', now() - interval '1 day')`);
  await db.exec(`SELECT public.prune_cron_http_requests()`);
  const left = (await q(`SELECT request_id::int AS id FROM public.cron_http_requests WHERE request_id IN (9001, 9002)`)).map((r) => r.id);
  check("prune deletes rows older than 2 days, keeps newer", JSON.stringify(left) === "[9002]", JSON.stringify(left));
  const pj = await q(`SELECT schedule, command FROM cron.job WHERE jobname = 'prune-cron-http-requests'`);
  check("prune job scheduled once, hourly", pj.length === 1 && pj[0].schedule === "28 * * * *");
  const ex = await one(`SELECT expected_max_gap::text AS g FROM public.cron_work_expectations WHERE jobname = 'prune-cron-http-requests'`);
  check("prune job has a liveness expectation", ex?.g === "03:00:00", ex?.g);

  // Grants.
  for (const fn of ["public.cron_http_tag(bigint,text)", "public.sweep_cron_http_failures()", "public.prune_cron_http_requests()"]) {
    for (const role of ["anon", "authenticated"]) {
      const g = await one(`SELECT has_function_privilege($1, $2, 'EXECUTE') AS ok`, [role, fn]);
      check(`${role} cannot execute ${fn}`, g.ok === false);
    }
  }
  for (const role of ["anon", "authenticated"]) {
    const g = await one(`SELECT has_table_privilege($1, 'public.cron_http_requests', 'SELECT,INSERT,UPDATE,DELETE') AS ok`, [role]);
    check(`${role} cannot read or write cron_http_requests`, g.ok === false);
  }
}

console.log(failures ? `\n${failures} FAILED` : "\nALL PASS");
process.exit(failures ? 1 : 0);
