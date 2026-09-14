// Probe: 20260914183932 (alerts critical-only, outage-aware cron liveness), in
// real Postgres. NOT a vitest test (pglite is not a dependency), so run by hand:
//
//   mkdir -p ~/.lh-pglite-probe && cd ~/.lh-pglite-probe && npm i @electric-sql/pglite
//   node scripts/probes/alerting.probe.mjs
//
// 1. Applies the migration VERBATIM three times (replay safety).
// 2. Replays the 2026-09-14 outage: scheduler silent for ~31 h, back 13 min
//    before sweep-dead-crons runs. The PREVIOUS sweep_dead_crons
//    (20260901030926) flags every hourly/daily job; the new one flags none,
//    and sweep_cron_blackouts reports the outage once (the old one: never).
// 3. A job that really stopped, with no outage, is still flagged.
// 4. Only server-written critical error_logs rows reach net.http_post.
// 5. The daily digest posts one kind='digest' body.
//
// pg_cron cannot be installed in PGlite, so the functions' `pg_extension`
// guard is replaced with `false` in the probe copy and `cron.*`, `net.*`,
// `vault.*` are stand-in tables. Nothing else in the function bodies changes.
const PGLITE_DIR = process.env.PGLITE_DIR ?? `${process.env.HOME}/.lh-pglite-probe`;
let PGlite;
try {
  ({ PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`));
} catch {
  console.error(`Could not load pglite from ${PGLITE_DIR} (npm i @electric-sql/pglite there).`);
  process.exit(2);
}
import { readFileSync } from "node:fs";

const mig = (f) => new URL(`../../supabase/migrations/${f}`, import.meta.url).pathname;
const NEW = readFileSync(mig("20260914183932_alerts_critical_only_and_outage_aware_cron_liveness.sql"), "utf8");
const OLD = readFileSync(mig("20260901030926_cron_liveness_from_job_run_details.sql"), "utf8");

const grabFn = (sql, name) => {
  const i = sql.indexOf(`CREATE OR REPLACE FUNCTION public.${name}()`);
  if (i < 0) throw new Error(`${name} not found`);
  const end = sql.indexOf("$fn$;", i);
  return sql.slice(i, end + 5);
};
const unguard = (sql) => sql.replaceAll("NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron')", "false");

const db = new PGlite();
let pass = 0, fail = 0;
const ok = (name, cond, extra = "") => {
  if (cond) { pass++; console.log(`  ok  ${name}`); }
  else { fail++; console.log(`FAIL  ${name} ${extra}`); }
};
const q = async (sql) => (await db.query(sql)).rows;

await db.exec(`
  CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
  CREATE TABLE public.error_logs (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    -- Verbatim from prod (pg_constraint error_logs_severity_check, read 2026-09-14).
    severity text NOT NULL DEFAULT 'error' CHECK ((severity = ANY (ARRAY['info'::text, 'warning'::text, 'error'::text, 'fatal'::text]))),
    message text NOT NULL, stack text, context jsonb NOT NULL DEFAULT '{}'::jsonb,
    tags jsonb NOT NULL DEFAULT '{}'::jsonb, url text, user_agent text, user_id uuid,
    created_at timestamptz NOT NULL DEFAULT now());
  CREATE TABLE public.cron_work_expectations (
    jobname text PRIMARY KEY, candidate_key text, disposition_keys text[] DEFAULT ARRAY[]::text[],
    min_streak int NOT NULL DEFAULT 2, note text NOT NULL DEFAULT '',
    expected_max_gap interval, registered_at timestamptz NOT NULL DEFAULT now() - interval '30 days');
  CREATE SCHEMA cron; CREATE SCHEMA net; CREATE SCHEMA vault;
  CREATE TABLE cron.job (jobid serial PRIMARY KEY, jobname text, schedule text, active boolean DEFAULT true);
  CREATE TABLE cron.job_run_details (jobid int, status text, start_time timestamptz, end_time timestamptz);
  CREATE TABLE vault.decrypted_secrets (name text, decrypted_secret text);
  INSERT INTO vault.decrypted_secrets VALUES ('supabase_url','https://x'),('service_role_key','k');
  CREATE TABLE net.calls (id serial, body jsonb);
  CREATE TABLE net._http_response (id bigint, status_code int, content text, created timestamptz DEFAULT now());
  CREATE FUNCTION net.http_post(url text, headers jsonb, body jsonb) RETURNS bigint
    LANGUAGE sql AS $$ INSERT INTO net.calls (body) VALUES (body) RETURNING id::bigint $$;
`);

// 1. Replay safety.
for (let i = 1; i <= 3; i++) {
  try { await db.exec(NEW); ok(`migration applies verbatim (pass ${i})`, true); }
  catch (e) { ok(`migration applies verbatim (pass ${i})`, false, e.message); }
}
await db.exec(unguard(grabFn(NEW, "sweep_dead_crons")));
await db.exec(unguard(grabFn(NEW, "sweep_cron_blackouts")));
await db.exec(unguard(grabFn(NEW, "send_ops_daily_digest")));
await db.exec(unguard(grabFn(NEW, "check_ops_digest_delivery")));
await db.exec(unguard(grabFn(OLD, "sweep_dead_crons")).replace("public.sweep_dead_crons()", "public.old_sweep_dead_crons()"));
const OLD_BLACKOUT = readFileSync(mig("20260902035753_cron_dispatch_visibility.sql"), "utf8");
await db.exec(unguard(grabFn(OLD_BLACKOUT, "sweep_cron_blackouts")).replace("public.sweep_cron_blackouts()", "public.old_sweep_cron_blackouts()"));

async function reset() {
  await db.exec(`TRUNCATE public.error_logs, cron.job_run_details, public.cron_work_expectations, net.calls; DELETE FROM cron.job;`);
  await db.exec(`
    INSERT INTO cron.job (jobname, schedule) VALUES
      ('process-email-queue','3-58/5 * * * *'), ('auto-expire-jobs','0 * * * *'),
      ('money-reconciliation','20 8 * * *'), ('sweep-no-show-alerts','12,27,42,57 * * * *');
    INSERT INTO public.cron_work_expectations (jobname, expected_max_gap) VALUES
      ('process-email-queue','1 hour'), ('auto-expire-jobs','3 hours'),
      ('money-reconciliation','30 hours'), ('sweep-no-show-alerts','1 hour');`);
}
const fire = (job, from, to, step) => db.exec(`
  INSERT INTO cron.job_run_details
  SELECT j.jobid, 'succeeded', t, t + interval '1 second'
    FROM cron.job j, generate_series(now() - interval '${from}', now() - interval '${to}', interval '${step}') t
   WHERE j.jobname = '${job}'`);

// 2. The 2026-09-14 outage: everything stops 31.5 h ago, resumes 13 min ago.
await reset();
await fire("process-email-queue", "6 days", "31 hours 30 minutes", "5 minutes");
await fire("auto-expire-jobs", "6 days", "31 hours 30 minutes", "1 hour");
await fire("money-reconciliation", "6 days", "40 hours", "1 day");
await fire("sweep-no-show-alerts", "6 days", "31 hours 30 minutes", "15 minutes");
await fire("process-email-queue", "13 minutes", "3 minutes", "5 minutes");
await fire("sweep-no-show-alerts", "13 minutes", "13 minutes", "15 minutes");

const oldRes = (await q(`SELECT public.old_sweep_dead_crons() r`))[0].r;
ok("OLD detector reproduces the false alarm (flags jobs after an outage)", oldRes.flagged >= 2, JSON.stringify(oldRes));
await db.exec(`TRUNCATE public.error_logs, net.calls`);
const newRes = (await q(`SELECT public.sweep_dead_crons() r`))[0].r;
ok("NEW detector flags nothing 13 min after recovery", newRes.flagged === 0, JSON.stringify(newRes));
ok("NEW detector knows when the scheduler resumed", newRes.scheduler_resumed_at !== null);

const oldBlack = (await q(`SELECT public.old_sweep_cron_blackouts() r`))[0].r;
ok("OLD blackout sweep never saw a >24 h outage", oldBlack.flagged === 0, JSON.stringify(oldBlack));
await db.exec(`TRUNCATE public.error_logs, net.calls`);
const b1 = (await q(`SELECT public.sweep_cron_blackouts() r`))[0].r;
const b2 = (await q(`SELECT public.sweep_cron_blackouts() r`))[0].r;
ok("NEW blackout sweep reports the outage", b1.flagged === 1 && b1.gap_minutes > 1800, JSON.stringify(b1));
ok("…exactly once", b2.flagged === 0, JSON.stringify(b2));
const calls = await q(`SELECT body FROM net.calls`);
ok("…as ONE critical Slack post", calls.length === 1 && calls[0].body.severity === "critical", JSON.stringify(calls));

// 3. No outage, a job that genuinely stopped 5 h ago: still flagged, one roll-up.
await reset();
await fire("process-email-queue", "2 days", "1 minute", "5 minutes");
await fire("sweep-no-show-alerts", "2 days", "1 minute", "15 minutes");
await fire("money-reconciliation", "2 days", "10 hours", "1 day");
await fire("auto-expire-jobs", "2 days", "5 hours", "1 hour");
const real = (await q(`SELECT public.sweep_dead_crons() r`))[0].r;
ok("a really dead job is still flagged", JSON.stringify(real.jobs) === '["auto-expire-jobs"]', JSON.stringify(real));
const rollup = await q(`SELECT body FROM net.calls`);
ok("one roll-up post, critical", rollup.length === 1 && rollup[0].body.severity === "critical", JSON.stringify(rollup));


// 3b. One quiet job never resets every clock (review item 4).
// PREV = this migration's first draft: a 15-minute "blackout" threshold and a
// resume anchor applied to every job. Rebuilt from the current body so the
// comparison isolates exactly those two choices.
const cur = unguard(grabFn(NEW, "sweep_dead_crons"));
const prev = cur
  .replace("public.sweep_dead_crons()", "public.prev_sweep_dead_crons()")
  .replace("interval '45 minutes'", "interval '15 minutes'")
  .replace(/CASE WHEN l\.registered_at >= v_gap_start - l\.expected_max_gap\s+THEN v_resumed_at END/, "v_resumed_at")
  .replace(/CASE WHEN l\.last_start >= v_gap_start - l\.expected_max_gap\s+THEN v_resumed_at END/, "v_resumed_at");
ok("PREV variant was actually rebuilt", prev !== cur && !prev.includes("v_gap_start - l.expected_max_gap"));
await db.exec(prev);

// A: process-email-queue died 5 h ago; the only other traffic is a 20-minute job.
await reset();
await db.exec(`INSERT INTO cron.job (jobname) VALUES ('every-20'); INSERT INTO public.cron_work_expectations VALUES ('every-20', NULL, '{}', 2, '', '1 hour', now() - interval '30 days')`);
await fire("process-email-queue", "2 days", "5 hours", "5 minutes");
await fire("every-20", "5 hours", "1 minute", "20 minutes");
await fire("auto-expire-jobs", "2 days", "30 minutes", "1 hour");
await fire("money-reconciliation", "2 days", "10 hours", "1 day");
await fire("sweep-no-show-alerts", "2 days", "5 hours", "15 minutes");
await db.exec(`DELETE FROM public.cron_work_expectations WHERE jobname = 'sweep-no-show-alerts'`);
const aPrev = (await q(`SELECT public.prev_sweep_dead_crons() r`))[0].r;
ok("RED (prev): 20-min gaps read as a blackout and hide a job dead 5 h", !aPrev.jobs.includes("process-email-queue"), JSON.stringify(aPrev));
await db.exec(`TRUNCATE public.error_logs, net.calls`);
const aNew = (await q(`SELECT public.sweep_dead_crons() r`))[0].r;
ok("GREEN (new): the dead job is flagged", aNew.jobs.includes("process-email-queue"), JSON.stringify(aNew));

// B: auto-expire-jobs was already dead (12 h) before a 2 h blackout that ended 30 min ago.
await reset();
await fire("process-email-queue", "2 days", "2 hours 30 minutes", "5 minutes");
await fire("process-email-queue", "30 minutes", "1 minute", "5 minutes");
await fire("sweep-no-show-alerts", "2 days", "2 hours 30 minutes", "15 minutes");
await fire("sweep-no-show-alerts", "30 minutes", "1 minute", "15 minutes");
await fire("money-reconciliation", "2 days", "10 hours", "1 day");
await fire("auto-expire-jobs", "2 days", "12 hours", "1 hour");
const bPrev = (await q(`SELECT public.prev_sweep_dead_crons() r`))[0].r;
ok("RED (prev): a blackout resets the clock of a job that was already dead", !bPrev.jobs.includes("auto-expire-jobs"), JSON.stringify(bPrev));
await db.exec(`TRUNCATE public.error_logs, net.calls`);
const bNew = (await q(`SELECT public.sweep_dead_crons() r`))[0].r;
ok("GREEN (new): the already-dead job is still flagged", bNew.jobs.includes("auto-expire-jobs"), JSON.stringify(bNew));
ok("GREEN (new): the healthy jobs got their post-blackout grace", !bNew.jobs.includes("process-email-queue") && !bNew.jobs.includes("sweep-no-show-alerts"), JSON.stringify(bNew));

// 4. Trigger (review item 1). error_logs.severity is CHECKed live to
// info/warning/error/fatal (error_logs_severity_check).
await db.exec(`TRUNCATE public.error_logs, net.calls`);
let critInsertFailed = false;
try { await db.exec(`INSERT INTO public.error_logs (severity, message) VALUES ('critical','x')`); }
catch { critInsertFailed = true; }
ok("RED (first draft): a 'critical' row cannot even be stored, so a severity='critical' filter never fires", critInsertFailed);
await db.exec(`INSERT INTO public.error_logs (severity, message, tags) VALUES ('error','e1','{"source":"cron-dead"}'), ('warning','w1','{}')`);
ok("error/warning rows from ordinary sources do not post", (await q(`SELECT count(*)::int n FROM net.calls`))[0].n === 0);
await db.exec(`INSERT INTO public.error_logs (severity, message, tags) VALUES ('error','slack-ops-alert: Slack rejected the post (ratelimited)','{"source":"slack-ops-alert"}')`);
ok("a ratelimited delivery failure does not post (loop closed)", (await q(`SELECT count(*)::int n FROM net.calls`))[0].n === 0);
await db.exec(`BEGIN; SELECT set_config('request.jwt.claims','{"role":"anon"}', true);
  INSERT INTO public.error_logs (severity, message) VALUES ('fatal','from a browser'); COMMIT;`);
ok("a client-written fatal does not post", (await q(`SELECT count(*)::int n FROM net.calls`))[0].n === 0);
await db.exec(`INSERT INTO public.error_logs (severity, message, tags) VALUES ('error','detect_stuck_payments: job 1 stuck','{"source":"detect_stuck_payments"}')`);
ok("GREEN: a server money-source error posts, as critical", (await q(`SELECT body FROM net.calls`)).map((r) => r.body.severity).join() === "critical");
await db.exec(`INSERT INTO public.error_logs (severity, message, tags) VALUES ('error','detect_stuck_payments: job 2 stuck','{"source":"detect_stuck_payments"}')`);
ok("…a second row from that source within 10 min is throttled", (await q(`SELECT count(*)::int n FROM net.calls`))[0].n === 1);
await db.exec(`INSERT INTO public.error_logs (severity, message, tags) VALUES ('fatal','server fatal','{"source":"some-server-job"}')`);
ok("GREEN: a server-written fatal posts", (await q(`SELECT count(*)::int n FROM net.calls`))[0].n === 2);
await db.exec(`BEGIN; SELECT set_config('request.jwt.claims','{"role":"authenticated"}', true);
  INSERT INTO public.error_logs (severity, message, tags) VALUES ('warning','Refused self-escalation','{"source":"rls-escalation-refused"}'); COMMIT;`);
ok("GREEN: a security refusal written inside a user request posts", (await q(`SELECT count(*)::int n FROM net.calls`))[0].n === 3);
const trgSql = NEW.slice(NEW.indexOf("CREATE OR REPLACE FUNCTION public.notify_slack_on_error_log()"));
const sqlSources = [...trgSql.slice(trgSql.indexOf("ARRAY["), trgSql.indexOf("];")).matchAll(/'([^']+)'/g)].map((m) => m[1]);
console.log(`  (trigger critical sources: ${sqlSources.join(", ")})`);

// 5. Digest.
await db.exec(`TRUNCATE net.calls`);
const d = (await q(`SELECT public.send_ops_daily_digest() r`))[0].r;
const dcalls = await q(`SELECT body FROM net.calls`);
ok("digest posts one kind=digest message", d.posted === true && dcalls.length === 1 && dcalls[0].body.kind === "digest", JSON.stringify(dcalls));
ok("digest counts the day's rows", /event\(s\) in 24h/.test(dcalls[0]?.body.title ?? "") && d.total >= 5, JSON.stringify(d));
await db.exec(`TRUNCATE public.error_logs, net.calls`);
await q(`SELECT public.send_ops_daily_digest()`);
ok("an empty day still posts a short all-quiet digest", /Nothing logged/.test((await q(`SELECT body FROM net.calls`))[0]?.body.message ?? ""));

// 6. Digest liveness (review item 5).
const check = async () => (await q(`SELECT public.check_ops_digest_delivery() r`))[0].r;
const pages = async () => (await q(`SELECT count(*)::int n FROM net.calls WHERE body->>'title' = 'Daily ops digest not delivered'`))[0].n;
await db.exec(`TRUNCATE public.error_logs, net.calls, net._http_response; DELETE FROM public.cron_work_expectations;
  INSERT INTO public.cron_work_expectations (jobname, expected_max_gap, registered_at) VALUES ('ops-daily-digest','30 hours', now() - interval '2 hours')`);
let c = await check();
ok("new digest (registered 2 h ago, never run) is in grace, no page", c.ok === true && (await pages()) === 0, JSON.stringify(c));
await db.exec(`UPDATE public.cron_work_expectations SET registered_at = now() - interval '31 hours'`);
c = await check();
ok("RED→page: no digest in 30 h pages critical", c.ok === false && (await pages()) === 1, JSON.stringify(c));
await check();
ok("…once per day", (await pages()) === 1);
// A digest that Slack refused (slack-ops-alert answers 200 {"ok":false}).
await db.exec(`TRUNCATE public.error_logs, net.calls`);
await db.exec(`INSERT INTO public.error_logs (severity, message, tags, context, created_at) VALUES
  ('info','Daily ops digest enqueued','{"source":"ops-digest"}','{"request_id": 77}', now() - interval '1 hour');
  INSERT INTO net._http_response (id, status_code, content) VALUES (77, 200, '{"ok": false, "error": "channel_not_found"}')`);
c = await check();
ok("an undelivered digest pages", c.ok === false && (await pages()) === 1, JSON.stringify(c));
await db.exec(`TRUNCATE public.error_logs, net.calls; UPDATE net._http_response SET content = '{"ok": true, "ts": "1.0"}' WHERE id = 77;
  INSERT INTO public.error_logs (severity, message, tags, context, created_at) VALUES
  ('info','Daily ops digest enqueued','{"source":"ops-digest"}','{"request_id": 77}', now() - interval '1 hour')`);
c = await check();
ok("GREEN: a delivered digest is ok, no page", c.ok === true && (await pages()) === 0, JSON.stringify(c));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
