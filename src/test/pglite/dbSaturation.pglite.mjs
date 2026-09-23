/**
 * PGlite proof for 20260923090536_db_saturation_monitor (docs/OPEN.md Q53).
 *
 *   node src/test/pglite/dbSaturation.pglite.mjs
 *
 * pglite is not a dependency (CLAUDE.md): it is loaded from ~/.lh-pglite
 * (override with PGLITE_DIR). MIGRATION_FILE overrides the file under test
 * (used to prove this script red on a broken copy).
 *
 * Proves: applies 3x (replay-safe); the judge flags every threshold at the
 * threshold and nothing below it, and ignores a high p95 over too few calls;
 * a quiet database is ok:true and writes no error_logs; a statement-timeout
 * count at the threshold rate writes ONE 'db-statement-timeouts' row per hour
 * however often it runs, and none below the rate; ops_alert_condition for
 * both sources is NULL with no newer sample, true while the newest sample
 * after p_since fails, false once one passes, and a probe (true); an
 * unrelated source still returns NULL (the verbatim body kept its branches);
 * the rewritten sweep_silent_cron_failures gives the SAME streaks as the
 * 20260903204415 definition on a log with real streaks; the cron and its
 * liveness expectation are registered once; anon/authenticated can execute
 * none of the functions and read neither table, even under Supabase's
 * default privileges.
 */
import { readFileSync } from "node:fs";
import os from "node:os";

const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const MIG_DIR = new URL("../../../supabase/migrations/", import.meta.url).pathname;
const MIGRATION = readFileSync(process.env.MIGRATION_FILE ?? `${MIG_DIR}20260923090536_db_saturation_monitor.sql`, "utf8");
const OLD_SWEEP_FILE = readFileSync(`${MIG_DIR}20260903204415_guard_silent_cron_cast.sql`, "utf8");

let failures = 0;
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
  if (!ok) failures++;
};

const db = new PGlite();
await db.exec(`
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role; END IF;
END $$;
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO anon, authenticated, service_role;
CREATE TABLE public.error_logs (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), severity text,
  message text, tags jsonb, context jsonb, url text, created_at timestamptz DEFAULT now());
CREATE TABLE public.cron_work_expectations (jobname text PRIMARY KEY, candidate_key text,
  disposition_keys text[] DEFAULT ARRAY[]::text[], min_streak int NOT NULL DEFAULT 2,
  note text NOT NULL DEFAULT '', expected_max_gap interval, registered_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE public.cron_run_log (id bigserial PRIMARY KEY, jobname text, status_code int, body jsonb,
  response_id bigint UNIQUE, occurred_at timestamptz);
CREATE SCHEMA net;
CREATE TABLE net._http_response (id bigint PRIMARY KEY, status_code int, content text, created timestamptz DEFAULT now());
CREATE SCHEMA cron;
CREATE TABLE cron.job (jobid bigserial, jobname text UNIQUE, schedule text, command text);
CREATE FUNCTION cron.schedule(p_name text, p_sched text, p_cmd text) RETURNS bigint LANGUAGE sql AS $$
  INSERT INTO cron.job (jobname, schedule, command) VALUES (p_name, p_sched, p_cmd)
  ON CONFLICT (jobname) DO UPDATE SET schedule = EXCLUDED.schedule, command = EXCLUDED.command
  RETURNING jobid $$;
`);
const q = async (sql) => (await db.query(sql)).rows;

for (let i = 1; i <= 3; i++) {
  try {
    await db.exec(MIGRATION);
    check(`apply pass #${i}`, true);
  } catch (e) {
    check(`apply pass #${i}`, false, e.message);
  }
}

// ── the judge ──────────────────────────────────────────────────────────────
const [{ t }] = await q(`SELECT public.db_saturation_thresholds() t`);
// Pinned from OUTSIDE the function (a threshold read back from itself cannot
// fail): each is the migration header's number, below the 09-22 level.
const PINNED = { conn_pct: 90, active_conns: 15, longest_active_s: 120, idle_in_xact: 1, exec_ms_per_s: 1000,
  p95_ms: 100, p95_min_calls: 200, timeouts_per_hour: 5 };
check("thresholds are exactly the documented ones", JSON.stringify(Object.keys(PINNED).sort().map((k) => [k, t[k]]))
  === JSON.stringify(Object.keys(PINNED).sort().map((k) => [k, PINNED[k]])), JSON.stringify(t));
check("the quietest outage hour on 09-22 (19 timeouts) would have fired", 19 >= t.timeouts_per_hour);
const judge = async (signals) => (await q(`SELECT public.db_saturation_problems('${JSON.stringify(signals)}'::jsonb) p`))[0].p;
const quiet = { client_conns: 51, max_conns: 60, conn_pct: 85, active_conns: 1, longest_active_s: 0.2, idle_in_xact: 0,
  exec_ms_per_s: 51, p95_ms: 10.4, window_app_calls: 5000 };
check("today's measured levels (85% conns, 51 ms/s, p95 10.4) are NOT a problem", (await judge(quiet)).length === 0, JSON.stringify(await judge(quiet)));
const at = {
  conn_pct: t.conn_pct, active_conns: t.active_conns, longest_active_s: t.longest_active_s,
  idle_in_xact: t.idle_in_xact, exec_ms_per_s: t.exec_ms_per_s, p95_ms: t.p95_ms,
};
for (const [k, v] of Object.entries(at)) {
  const hit = await judge({ ...quiet, [k]: v });
  const miss = await judge({ ...quiet, [k]: v - (k === "idle_in_xact" ? 1 : 0.1) });
  check(`${k}: flagged at ${v}, not just below`, hit.length === 1 && miss.length === 0, JSON.stringify({ hit, miss }));
}
check("a high p95 over too few calls is not a problem",
  (await judge({ ...quiet, p95_ms: 5000, window_app_calls: t.p95_min_calls - 1 })).length === 0);
check("missing signals (no window yet) are not a problem",
  (await judge({ client_conns: 1, max_conns: 60, conn_pct: 1.7, active_conns: 0, longest_active_s: 0, idle_in_xact: 0 })).length === 0);

// ── the check ──────────────────────────────────────────────────────────────
const run = async (n = null, w = null) =>
  (await q(`SELECT public.check_db_saturation(${n === null ? "NULL" : n}, ${w === null ? "NULL" : w}) r`))[0].r;
let r = await run();
const logCount = async (src) => (await q(`SELECT count(*)::int n FROM public.error_logs WHERE tags->>'source' = '${src}'`))[0].n;
check("a quiet database: ok:true, origin cron, no error_logs row",
  r.ok === true && r.origin === "cron" && (await logCount("db-saturation")) === 0, JSON.stringify(r));
const [{ n: samples1 }] = await q(`SELECT count(*)::int n FROM public.db_saturation_samples`);
check("every run stores a sample", samples1 === 1, String(samples1));

const cond = async (src, since = "now() - interval '1 hour'", probe = false) =>
  (await q(`SELECT public.ops_alert_condition('${src}', '{}'::jsonb, ${since}, ${probe}) c`))[0].c;
check("db-statement-timeouts: no workflow sample yet -> NULL (cannot tell)", (await cond("db-statement-timeouts")) === null);

// Below the rate: 4 in 60 min.
r = await run(4, 60);
check("4 timeouts/60 min is below 5/h: no row", r.log_problem === null && (await logCount("db-statement-timeouts")) === 0, JSON.stringify(r));
check("condition false once a passing sample exists after p_since", (await cond("db-statement-timeouts")) === false);

// At the rate, from a 15-minute window: 2 in 15 min = 8/h.
r = await run(2, 15);
await run(9, 60);
await run(40, 60);
check("at/above 5/h: ok:false with a log problem", r.ok === false && /statement timeouts/.test(r.log_problem ?? ""), JSON.stringify(r));
check("three failing runs in one hour write ONE db-statement-timeouts row", (await logCount("db-statement-timeouts")) === 1);
const [row] = await q(`SELECT message, severity FROM public.error_logs WHERE tags->>'source' = 'db-statement-timeouts'`);
check("the row's ledger title is stable ('Database statement timeouts')",
  row.message.split(" — ")[0] === "Database statement timeouts" && row.severity === "error", row.message);
check("condition true while the newest sample after p_since fails", (await cond("db-statement-timeouts")) === true);
check("condition NULL when no sample is newer than the occurrence", (await cond("db-statement-timeouts", "now() + interval '1 minute'")) === null);
check("db-saturation probe is true; no cron sample newer than a future p_since -> NULL",
  (await cond("db-saturation", "now()", true)) === true && (await cond("db-saturation", "now() + interval '1 minute'")) === null);

// A failing cron sample (written directly: PGlite cannot be made to saturate).
await db.exec(`INSERT INTO public.db_saturation_samples (sampled_at, origin, db_problems)
               VALUES (now() + interval '2 minutes', 'cron', ARRAY['connections 58/60 (96.7%) >= 90%'])`);
check("db-saturation condition true while the newest cron sample fails", (await cond("db-saturation", "now()")) === true);
await db.exec(`INSERT INTO public.db_saturation_samples (sampled_at, origin, db_problems)
               VALUES (now() + interval '7 minutes', 'cron', ARRAY[]::text[])`);
check("db-saturation condition false once a newer cron sample is clean", (await cond("db-saturation", "now()")) === false);
check("an unrelated source still returns NULL", (await cond("some-unknown-source")) === null);

// Retention.
await db.exec(`INSERT INTO public.db_saturation_samples (sampled_at, origin) VALUES (now() - interval '15 days', 'cron')`);
await run();
const [{ n: old }] = await q(`SELECT count(*)::int n FROM public.db_saturation_samples WHERE sampled_at < now() - interval '14 days'`);
check("samples older than 14 days are pruned", old === 0);

// ── sweep_silent_cron_failures: same streaks as the old definition ─────────
const start = OLD_SWEEP_FILE.indexOf("CREATE OR REPLACE FUNCTION public.sweep_silent_cron_failures()");
const end = OLD_SWEEP_FILE.indexOf("$function$;", start) + "$function$;".length;
await db.exec(OLD_SWEEP_FILE.slice(start, end).replace("public.sweep_silent_cron_failures()", "public.sweep_silent_cron_failures_old()"));
await db.exec(`
INSERT INTO public.cron_work_expectations (jobname, candidate_key, disposition_keys, min_streak, note) VALUES
  ('job-broken',  'found', ARRAY['done','skipped'], 3, 'b'),
  ('job-healed',  'found', ARRAY['done'], 2, 'h'),
  ('job-short',   'found', ARRAY['done'], 5, 's'),
  ('job-never-ok','found', ARRAY['done'], 2, 'n');
-- newest first per job: broken = 4 suspicious then 1 ok; healed = ok newest;
-- short = 3 suspicious (< 5); never-ok = 3 suspicious, no clean run at all.
INSERT INTO public.cron_run_log (jobname, body, response_id, occurred_at)
SELECT j, b::jsonb, row_number() OVER (), now() - (i || ' minutes')::interval FROM (VALUES
  ('job-broken','{"found":2,"done":0}',1), ('job-broken','{"found":3,"done":0,"skipped":0}',2),
  ('job-broken','{"found":1,"done":0}',3), ('job-broken','{"found":9,"done":0}',4),
  ('job-broken','{"found":1,"done":1}',5), ('job-broken','{"found":4,"done":0}',6),
  ('job-healed','{"found":1,"done":1}',1), ('job-healed','{"found":2,"done":0}',2), ('job-healed','{"found":2,"done":0}',3),
  ('job-short','{"found":1,"done":0}',1), ('job-short','{"found":1,"done":0}',2), ('job-short','{"found":1,"done":0}',3),
  ('job-never-ok','{"found":1,"done":0}',1), ('job-never-ok','{"found":7,"done":"x"}',2), ('job-never-ok','{"found":1}',3)
) v(j, b, i);`);
const flagged = async (fn) => {
  await db.exec(`DELETE FROM public.error_logs WHERE tags->>'source' = 'cron-silent'`);
  await q(`SELECT public.${fn}()`);
  return (await q(`SELECT tags->>'job' j, context->>'streak' s, context->>'latest_candidates' c
                     FROM public.error_logs WHERE tags->>'source' = 'cron-silent' ORDER BY 1`));
};
const oldF = await flagged("sweep_silent_cron_failures_old");
const newF = await flagged("sweep_silent_cron_failures");
check("old sweep flags the real streaks (fixture is not vacuous)", oldF.length === 2, JSON.stringify(oldF));
check("new sweep flags exactly the same jobs, streaks and latest counts", JSON.stringify(newF) === JSON.stringify(oldF),
  JSON.stringify({ oldF, newF }));

// ── schedule + privileges ──────────────────────────────────────────────────
const cronRows = await q(`SELECT jobname, schedule FROM cron.job WHERE jobname = 'db-saturation-check'`);
check("cron registered once, every 5 min", cronRows.length === 1 && cronRows[0].schedule === "*/5 * * * *", JSON.stringify(cronRows));
const exp = await q(`SELECT expected_max_gap::text g FROM public.cron_work_expectations WHERE jobname = 'db-saturation-check'`);
check("liveness expectation registered (20 min)", exp.length === 1 && exp[0].g === "00:20:00", JSON.stringify(exp));
for (const role of ["anon", "authenticated"]) {
  for (const fn of ["public.check_db_saturation(int, int)", "public.db_saturation_problems(jsonb)", "public.db_saturation_thresholds()",
    "public.ops_alert_condition(text, jsonb, timestamptz, boolean)"]) {
    const [{ ok }] = await q(`SELECT has_function_privilege('${role}', '${fn}', 'EXECUTE') ok`);
    check(`${role} cannot execute ${fn}`, ok === false);
  }
  for (const tbl of ["public.db_saturation_samples", "public.db_saturation_state"]) {
    const [{ ok }] = await q(`SELECT has_table_privilege('${role}', '${tbl}', 'SELECT,INSERT,UPDATE,DELETE') ok`);
    check(`${role} has no access to ${tbl}`, ok === false);
  }
}

console.log(failures ? `\n${failures} FAILED` : "\nALL PASS");
process.exit(failures ? 1 : 0);
