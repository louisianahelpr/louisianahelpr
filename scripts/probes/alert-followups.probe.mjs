// Probe: 20260914192035 (cron coverage from cron.job; client rows cannot page),
// in real Postgres. NOT a vitest test (pglite is not a dependency), so run by
// hand:
//
//   mkdir -p ~/.lh-pglite-probe && cd ~/.lh-pglite-probe && npm i @electric-sql/pglite
//   node scripts/probes/alert-followups.probe.mjs
//
// Every check is shown RED on the PREVIOUS functions (20260914183932) and
// GREEN on the new ones, in the same database, on the same rows.
//
// 1. The migration applies verbatim three times (replay safety).
// 2. A scheduled, active cron with no cron_work_expectations row:
//    PREV sweep_dead_crons sees nothing; NEW reports it 'unmonitored', once a
//    day, in the one roll-up.
// 3. A browser (role anon / authenticated) inserting
//    tags.source='rls-escalation-refused', or severity='fatal':
//    PREV notify_slack_on_error_log posts it to #ops-alerts; NEW does not, and
//    the row is still stored with its claim recorded.
// 4. Server paths (service_role, and a SECURITY DEFINER function running as
//    its owner) still page.
//
// pg_cron cannot be installed in PGlite, so the `pg_extension` guard is
// replaced with `false` in the probe copy and `cron.*`, `net.*`, `vault.*` are
// stand-in tables. Nothing else in the function bodies changes.
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
const NEW = readFileSync(mig("20260914192035_alert_followups_support_cron_coverage_client_origin.sql"), "utf8");
const PREV = readFileSync(mig("20260914183932_alerts_critical_only_and_outage_aware_cron_liveness.sql"), "utf8");

const grabFn = (sql, name, tag = "$fn$") => {
  const i = sql.indexOf(`CREATE OR REPLACE FUNCTION public.${name}()`);
  if (i < 0) throw new Error(`${name} not found`);
  const end = sql.indexOf(`${tag};`, i + 1);
  return sql.slice(i, end + tag.length + 1);
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
  CREATE ROLE anon LOGIN; CREATE ROLE authenticated LOGIN; CREATE ROLE service_role LOGIN;
  CREATE TABLE public.error_logs (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    severity text NOT NULL DEFAULT 'error' CHECK ((severity = ANY (ARRAY['info'::text, 'warning'::text, 'error'::text, 'fatal'::text]))),
    message text NOT NULL, stack text, context jsonb NOT NULL DEFAULT '{}'::jsonb,
    tags jsonb NOT NULL DEFAULT '{}'::jsonb, url text, user_agent text, user_id uuid,
    created_at timestamptz NOT NULL DEFAULT now());
  GRANT INSERT, SELECT ON public.error_logs TO anon, authenticated, service_role;
  -- RLS ON, or every SET ROLE insert below would pass on the raw GRANT alone
  -- and the policy this migration rewrites would never be evaluated once.
  -- (Policies on an RLS-off table are created happily and are inert.)
  ALTER TABLE public.error_logs ENABLE ROW LEVEL SECURITY;
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
  GRANT USAGE ON SCHEMA net TO anon, authenticated, service_role;
  GRANT INSERT ON net.calls TO anon, authenticated, service_role;
  GRANT USAGE, SELECT ON SEQUENCE net.calls_id_seq TO anon, authenticated, service_role;
  CREATE TABLE net._http_response (id bigint, status_code int, content text, created timestamptz DEFAULT now());
  CREATE FUNCTION net.http_post(url text, headers jsonb, body jsonb) RETURNS bigint
    LANGUAGE sql AS $$ INSERT INTO net.calls (body) VALUES (body) RETURNING id::bigint $$;
  -- auth.uid() stand-in, settable per test the way PostgREST sets it, so the
  -- policy's user_id = auth.uid() branch is exercised and not dead code.
  CREATE SCHEMA auth;
  GRANT USAGE ON SCHEMA auth TO anon, authenticated, service_role;
  CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS
    $$ SELECT NULLIF(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
`);

// The digest watcher is called at the end of sweep_dead_crons; it lives in the
// previous migration and is unchanged here.
await db.exec(PREV);
await db.exec(unguard(grabFn(PREV, "check_ops_digest_delivery")));
await db.exec(unguard(grabFn(PREV, "sweep_dead_crons")).replace("public.sweep_dead_crons()", "public.prev_sweep_dead_crons()"));
await db.exec(grabFn(PREV, "notify_slack_on_error_log", "$$").replace("public.notify_slack_on_error_log()", "public.prev_notify_slack_on_error_log()"));

// ── 1. Replay safety ────────────────────────────────────────────────────────
for (let i = 1; i <= 3; i++) {
  try { await db.exec(NEW); ok(`migration applies verbatim (pass ${i})`, true); }
  catch (e) { ok(`migration applies verbatim (pass ${i})`, false, e.message); }
}
await db.exec(unguard(grabFn(NEW, "sweep_dead_crons")));

ok("the two missing expectations are registered",
  (await q(`SELECT count(*)::int n FROM public.cron_work_expectations
             WHERE jobname IN ('extend-boosts-hourly','prune-cron-run-details')
               AND expected_max_gap IS NOT NULL`))[0].n === 2);
ok("…hourly job gets 3 h, daily job gets 30 h",
  (await q(`SELECT expected_max_gap::text g FROM public.cron_work_expectations WHERE jobname='extend-boosts-hourly'`))[0].g === "03:00:00" &&
  (await q(`SELECT expected_max_gap::text g FROM public.cron_work_expectations WHERE jobname='prune-cron-run-details'`))[0].g === "30:00:00");

// ── 2. A cron nobody registered ─────────────────────────────────────────────
async function resetCron() {
  await db.exec(`TRUNCATE public.error_logs, cron.job_run_details, net.calls; DELETE FROM cron.job; DELETE FROM public.cron_work_expectations;
    INSERT INTO cron.job (jobname, schedule) VALUES
      ('process-email-queue','3-58/5 * * * *'),
      ('a-brand-new-cron','0 * * * *');
    INSERT INTO public.cron_work_expectations (jobname, expected_max_gap) VALUES ('process-email-queue','1 hour');
    INSERT INTO cron.job_run_details
      SELECT j.jobid, 'succeeded', t, t + interval '1 second'
        FROM cron.job j, generate_series(now() - interval '2 days', now() - interval '1 minute', interval '5 minutes') t;`);
}
await resetCron();
const prevCov = (await q(`SELECT public.prev_sweep_dead_crons() r`))[0].r;
ok("RED (prev): a scheduled, active, healthy-but-unregistered cron is invisible",
  prevCov.flagged === 0 && !JSON.stringify(prevCov.jobs).includes("a-brand-new-cron"), JSON.stringify(prevCov));
await db.exec(`TRUNCATE public.error_logs, net.calls`);
const newCov = (await q(`SELECT public.sweep_dead_crons() r`))[0].r;
ok("GREEN (new): it is reported as unmonitored",
  newCov.jobs.includes("a-brand-new-cron"), JSON.stringify(newCov));
ok("…with the verdict on the row, in the same roll-up",
  (await q(`SELECT count(*)::int n FROM public.error_logs WHERE tags->>'verdict'='unmonitored' AND tags->>'job'='a-brand-new-cron'`))[0].n === 1 &&
  (await q(`SELECT count(*)::int n FROM net.calls`))[0].n === 1);
const again = (await q(`SELECT public.sweep_dead_crons() r`))[0].r;
ok("…at most once a day", again.flagged === 0, JSON.stringify(again));
// A registered job is not reported, and an INACTIVE unregistered job is not
// either (nothing is expected of a job that is switched off).
await db.exec(`TRUNCATE public.error_logs, net.calls;
  INSERT INTO public.cron_work_expectations (jobname, expected_max_gap) VALUES ('a-brand-new-cron','3 hours');
  INSERT INTO cron.job (jobname, schedule, active) VALUES ('retired-cron','0 5 * * *', false)`);
const covered = (await q(`SELECT public.sweep_dead_crons() r`))[0].r;
ok("GREEN (new): once registered it is quiet, and a disabled job is not nagged about",
  covered.flagged === 0, JSON.stringify(covered));

// ── 3. Forged alerts from a browser ─────────────────────────────────────────
const asRole = (role, sql) => db.exec(`SET ROLE ${role}; ${sql}; RESET ROLE;`);
const posts = async () => (await q(`SELECT count(*)::int n FROM net.calls`))[0].n;

// RED: the previous trigger, on the previous rule.
await db.exec(`TRUNCATE public.error_logs, net.calls;
  DROP TRIGGER IF EXISTS trg_error_logs_slack ON public.error_logs;
  DROP TRIGGER IF EXISTS trg_error_logs_00_stamp_origin ON public.error_logs;
  CREATE TRIGGER trg_error_logs_slack AFTER INSERT ON public.error_logs
    FOR EACH ROW EXECUTE FUNCTION public.prev_notify_slack_on_error_log();`);
await asRole("authenticated", `INSERT INTO public.error_logs (severity, message, tags)
  VALUES ('warning','Refused a non-admin write to the profiles billing columns','{"source":"rls-escalation-refused"}')`);
ok("RED (prev): a browser can page #ops-alerts by naming a security source", (await posts()) === 1,
  JSON.stringify(await q(`SELECT severity, message, tags FROM public.error_logs`)));
// Guard the guard: with the stamp detached, the row must arrive unstamped, or
// the RED above is measuring the wrong thing.
ok("…(the RED really ran without the new stamp)",
  (await q(`SELECT count(*)::int n FROM public.error_logs WHERE tags ? 'origin'`))[0].n === 0);
await db.exec(`TRUNCATE public.error_logs, net.calls`);
// No JWT at all (the publishable-key case): request.jwt.claims is empty, so
// the previous role check learned nothing and let a 'fatal' through.
await asRole("anon", `INSERT INTO public.error_logs (severity, message, tags)
  VALUES ('fatal','TypeError: x is not a function','{"source":"window.onerror"}')`);
ok("RED (prev): a browser 'fatal' with no JWT claims pages too", (await posts()) === 1);

// GREEN: the new pair of triggers.
await db.exec(`TRUNCATE public.error_logs, net.calls;
  DROP TRIGGER IF EXISTS trg_error_logs_slack ON public.error_logs;
  CREATE TRIGGER trg_error_logs_00_stamp_origin BEFORE INSERT ON public.error_logs
    FOR EACH ROW EXECUTE FUNCTION public.stamp_error_log_origin();
  CREATE TRIGGER trg_error_logs_slack AFTER INSERT ON public.error_logs
    FOR EACH ROW EXECUTE FUNCTION public.notify_slack_on_error_log();`);
await asRole("authenticated", `INSERT INTO public.error_logs (severity, message, tags)
  VALUES ('warning','Refused a non-admin write to the profiles billing columns','{"source":"rls-escalation-refused"}')`);
ok("GREEN (new): the same forged security row posts nothing", (await posts()) === 0);
const forged = (await q(`SELECT tags FROM public.error_logs WHERE message LIKE 'Refused a non-admin%'`))[0].tags;
ok("…the row is still logged, with the claim recorded",
  forged.origin === "client" && forged.source === "client-error" && forged.claimed_source === "rls-escalation-refused",
  JSON.stringify(forged));
await asRole("anon", `INSERT INTO public.error_logs (severity, message, tags)
  VALUES ('fatal','TypeError: x is not a function','{"source":"window.onerror"}')`);
ok("GREEN (new): a browser 'fatal' posts nothing", (await posts()) === 0);
const clientFatal = (await q(`SELECT severity, tags FROM public.error_logs WHERE message LIKE 'TypeError%'`))[0];
ok("…stored as an error, its claim kept for the digest",
  clientFatal.severity === "error" && clientFatal.tags.claimed_severity === "fatal" && clientFatal.tags.source === "window.onerror",
  JSON.stringify(clientFatal));
await asRole("anon", `INSERT INTO public.error_logs (severity, message, tags)
  VALUES ('error','ordinary client error','{"source":"BroadcastBanner.load","origin":"server"}')`);
const spoofed = (await q(`SELECT tags FROM public.error_logs WHERE message = 'ordinary client error'`))[0].tags;
ok("GREEN (new): a client cannot stamp itself 'server'", spoofed.origin === "client", JSON.stringify(spoofed));
ok("…and ordinary client logging is untouched", spoofed.source === "BroadcastBanner.load");

await asRole("anon", `INSERT INTO public.error_logs (severity, message, tags)
  VALUES ('error','tags sent as an array','["window.onerror"]')`);
const oddTags = (await q(`SELECT tags FROM public.error_logs WHERE message = 'tags sent as an array'`))[0]?.tags ?? {};
ok("GREEN (new): tags that are not an object are kept, not dropped",
  oddTags.origin === "client" && JSON.stringify(oddTags.claimed_tags) === '["window.onerror"]', JSON.stringify(oddTags));

// ── 3b. The rewritten INSERT policy, with RLS actually on ───────────────────
// The policy went from PUBLIC to `TO anon, authenticated, service_role`. That
// is the one change in this migration that could lock a real browser out of
// error logging, so it is asserted directly rather than assumed.
const ME = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";
const asUser = (role, uid, sql) => db.exec(
  `SET ROLE ${role}; SELECT set_config('request.jwt.claim.sub', '${uid}', false); ${sql}; RESET ROLE;`);
await db.exec(`TRUNCATE public.error_logs, net.calls`);
let anonOk = true;
try { await asRole("anon", `INSERT INTO public.error_logs (message) VALUES ('logged out, no user')`); }
catch (e) { anonOk = false; console.log(`      (${e.message})`); }
ok("GREEN: a logged-out browser can still log an error (user_id NULL)", anonOk);
let ownOk = true;
try { await asUser("authenticated", ME, `INSERT INTO public.error_logs (message, user_id) VALUES ('my own error', '${ME}')`); }
catch (e) { ownOk = false; console.log(`      (${e.message})`); }
ok("GREEN: a signed-in user can log an error against their own id", ownOk);
let othersRefused = "";
try { await asUser("authenticated", ME, `INSERT INTO public.error_logs (message, user_id) VALUES ('not mine', '${OTHER}')`); }
catch (e) { othersRefused = e.code ?? e.message; }
ok("GREEN: …and cannot write one against somebody else's id", /42501|row-level security/.test(String(othersRefused)), String(othersRefused));
await db.exec(`RESET ROLE; SELECT set_config('request.jwt.claim.sub', '', false)`);

// ── 4. Server paths still page ──────────────────────────────────────────────
await db.exec(`TRUNCATE public.error_logs, net.calls`);
await asRole("service_role", `INSERT INTO public.error_logs (severity, message, tags)
  VALUES ('error','detect_stuck_payments: job 1 stuck','{"source":"detect_stuck_payments"}')`);
ok("GREEN: an edge function (service_role) money alert still pages", (await posts()) === 1);
await db.exec(`TRUNCATE public.error_logs, net.calls;
  CREATE OR REPLACE FUNCTION public.fake_prevent_self_escalation() RETURNS void
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $d$
  BEGIN
    INSERT INTO public.error_logs (severity, message, tags)
    VALUES ('warning','Refused a non-admin write to the profiles billing columns',
            jsonb_build_object('source','rls-escalation-refused','area','security'));
  END; $d$;
  GRANT EXECUTE ON FUNCTION public.fake_prevent_self_escalation() TO authenticated;`);
await asRole("authenticated", `SELECT public.fake_prevent_self_escalation()`);
ok("GREEN: the real security refusal (SECURITY DEFINER, inside a user request) still pages",
  (await posts()) === 1, JSON.stringify(await q(`SELECT tags FROM public.error_logs`)));
await db.exec(`TRUNCATE public.error_logs, net.calls`);
await db.exec(`INSERT INTO public.error_logs (severity, message, tags) VALUES ('fatal','server fatal','{"source":"some-cron"}')`);
ok("GREEN: a server-written fatal still pages", (await posts()) === 1);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
