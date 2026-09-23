#!/usr/bin/env node
/**
 * PGlite proof for 20260923043402_ops_alert_ledger.
 *
 *   node src/test/pglite/opsAlertLedger.pglite.mjs            # apply 3x (replay-safety) + checks
 *
 * pglite is not a dependency (CLAUDE.md):
 *   mkdir -p ~/.lh-pglite-probe && cd ~/.lh-pglite-probe && npm i @electric-sql/pglite
 *
 * Proves: fingerprint dedupe with ids stripped; client rows never reach it;
 * ops-alert rows are left to the transport; a closed item re-opens on a new
 * occurrence but not on an older one; ops_alert_close refuses a re-run that
 * began before the last occurrence; ops_alert_verify closes only when the
 * condition is re-asked and false (stuck payment cleared) and keeps it open
 * while true; anon/authenticated cannot execute any of it; a non-admin reads
 * zero rows and an admin reads them; the backfill runs once, not per replay.
 *
 * Follow-up 20260923050059: status codes split fingerprints while ids, amounts,
 * timestamps and signs do not; v1 rows are re-keyed (merged, open wins);
 * check_ops_digest_delivery is ok:false without its expectation row; the new
 * pending table and functions are closed to anon/authenticated even under
 * Supabase's default privileges.
 */
const PGLITE_DIR = process.env.PGLITE_DIR ?? `${process.env.HOME}/.lh-pglite-probe`;
let PGlite;
try {
  ({ PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`));
} catch {
  console.error(`Could not load pglite from ${PGLITE_DIR} (npm i @electric-sql/pglite there).`);
  process.exit(2);
}
import { readFileSync } from "node:fs";

const mig = (f) => readFileSync(new URL(`../../../supabase/migrations/${f}`, import.meta.url).pathname, "utf8");
const MIGRATION = mig("20260923043402_ops_alert_ledger.sql");
// Review follow-up: bounded lock wait + pending queue, normalisation v2 (keeps
// status codes), re-key of existing rows, digest check without its row.
// Concurrency needs two backends: scripts/probes/ops-alert-ledger-concurrency.embedded-pg.mjs.
const FOLLOWUP = mig("20260923050059_ops_alert_ledger_never_blocks_and_keeps_status_codes.sql");

let failures = 0;
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
  if (!ok) failures++;
};

const ADMIN = "aaaaaaaa-0000-0000-0000-000000000001";
const USER = "bbbbbbbb-0000-0000-0000-000000000002";

const SETUP = `
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role; END IF;
END $$;
CREATE SCHEMA IF NOT EXISTS auth;
CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS
  $$ SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
GRANT USAGE ON SCHEMA auth TO anon, authenticated, service_role;
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname='app_role') THEN
  CREATE TYPE public.app_role AS ENUM ('admin','customer','helper');
END IF; END $$;
CREATE TABLE IF NOT EXISTS public.user_roles (user_id uuid, role public.app_role);
CREATE OR REPLACE FUNCTION public.has_role(_uid uuid, _role public.app_role) RETURNS boolean
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS
  $$ SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _uid AND role = _role) $$;
CREATE TABLE IF NOT EXISTS public.error_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  severity text, message text, url text, stack text, user_id uuid,
  tags jsonb, context jsonb, created_at timestamptz DEFAULT now());
CREATE TABLE IF NOT EXISTS public.jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  stripe_session_id text, payment_status text, created_at timestamptz DEFAULT now());
CREATE TABLE IF NOT EXISTS public.cron_work_expectations (jobname text PRIMARY KEY, registered_at timestamptz);
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO anon, authenticated, service_role;
-- Supabase's default privileges: every NEW table/function is granted to anon + authenticated.
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO anon, authenticated, service_role;
`;

const db = new PGlite();
await db.exec(SETUP);
await db.exec(`INSERT INTO public.user_roles VALUES ('${ADMIN}', 'admin');`);
// Pre-existing history for the backfill: two server rows (one fingerprint),
// one client row, one ops-alert transport row, one ops-digest receipt.
await db.exec(`
INSERT INTO public.error_logs (severity, message, tags, created_at) VALUES
 ('error','Stuck payment detected — webhook noop', '{"source":"detect_stuck_payments","origin":"server"}', now() - interval '2 hours'),
 ('error','Stuck payment detected — webhook noop', '{"source":"detect_stuck_payments","origin":"server"}', now() - interval '1 hour'),
 ('error','Forged page', '{"source":"detect_stuck_payments","origin":"client"}', now() - interval '1 hour'),
 ('error','Ban review needed — Some Name has cancelled 3 jobs', '{"source":"ops-alert","kind":"custom","origin":"server"}', now() - interval '1 hour'),
 ('info','Daily ops digest enqueued (94 events)', '{"source":"ops-digest","origin":"server"}', now() - interval '1 hour'),
 ('error','ancient', '{"source":"old","origin":"server"}', now() - interval '5 days');
INSERT INTO public.jobs (stripe_session_id, payment_status, created_at) VALUES ('cs_test_1','unpaid', now() - interval '1 hour');
`);

const q = async (sql) => (await db.query(sql)).rows;

// Apply the ledger, then write rows the way prod did BEFORE the follow-up, so
// the follow-up's re-key runs over real v1 fingerprints.
await db.exec(MIGRATION);
await db.exec(`
INSERT INTO public.error_logs (severity, message, tags, created_at) VALUES
 ('error','Cron HTTP failure: marketing-publish returned 500 (1 defect(s) reported)', '{"source":"cron-http","origin":"server"}', now() - interval '20 minutes'),
 ('error','Cron HTTP failure: marketing-publish returned 404 (2 defect(s) reported)', '{"source":"cron-http","origin":"server"}', now() - interval '10 minutes'),
 ('warning','Cron HTTP timeout: void-cancelled-payments returned Timeout of 5000 ms reached. Total time: 5000.327000 ms (TCP/SSL handshake time: -0.040000 ms)', '{"source":"cron-http","origin":"server"}', now() - interval '20 minutes'),
 ('warning','Cron HTTP timeout: void-cancelled-payments returned Timeout of 5000 ms reached. Total time: 5002.613000 ms (TCP/SSL handshake time: 62.012000 ms)', '{"source":"cron-http","origin":"server"}', now() - interval '10 minutes');`);
const v1 = await q(`SELECT title, count FROM public.ops_alert_ledger WHERE source='cron-http' ORDER BY title`);
check("v1 (before follow-up): 500 and 404 were ONE item; +/- timeouts were TWO",
  v1.length === 3 && v1.some((r) => /returned # \(/.test(r.title) && Number(r.count) === 2), JSON.stringify(v1));
// One of the timeout pair was verified closed: on merge, open must win.
await db.exec(`UPDATE public.ops_alert_ledger SET status='closed', closed_at=now(), closed_evidence='test: verified closed' WHERE title LIKE '%handshake time: -#%'`);

for (let i = 1; i <= 3; i++) {
  try {
    await db.exec(FOLLOWUP);
    if (i < 3) await db.exec(MIGRATION);
    check(`apply ledger + follow-up in order, pass #${i}`, true);
  } catch (e) {
    check(`apply pass #${i}`, false, e.message);
  }
}

// Re-key of existing rows
let rk = await q(`SELECT title, count, status FROM public.ops_alert_ledger WHERE source='cron-http' ORDER BY title`);
const to = rk.filter((r) => r.title.startsWith("cron http timeout"));
check("re-key: the two v1 timeout items (sign differed) merge into one, count 2, open wins",
  to.length === 1 && to[0].status === "open" && Number(to[0].count) === 2, JSON.stringify(rk));
check("re-key: the v1 500/404 item takes its latest sample's code (404), count kept",
  rk.some((r) => r.title === "cron http failure: marketing-publish returned 404 (# defect(s) reported)" && Number(r.count) === 2), JSON.stringify(rk));
await db.exec(`INSERT INTO public.error_logs (severity, message, tags) VALUES
 ('error','Cron HTTP failure: marketing-publish returned 500 (7 defect(s) reported)', '{"source":"cron-http","origin":"server"}')`);
rk = await q(`SELECT title, count FROM public.ops_alert_ledger WHERE source='cron-http' AND title LIKE 'cron http failure%' ORDER BY title`);
check("after the follow-up a 500 is its own item next to the 404", rk.length === 2 &&
  rk.some((r) => r.title.includes("returned 500") && Number(r.count) === 1), JSON.stringify(rk));
await db.exec(`DELETE FROM public.ops_alert_ledger WHERE source='cron-http'`);

// Fingerprint regression: status codes split, ids/amounts/timestamps do not.
const same = async (a, b) => (await q(`SELECT public.ops_alert_normalise('${a}') = public.ops_alert_normalise('${b}') AS same,
  public.ops_alert_normalise('${a}') AS na, public.ops_alert_normalise('${b}') AS nb`))[0];
for (const [a, b] of [
  ["Cron HTTP failure: x returned 500 (1 defect(s) reported)", "Cron HTTP failure: x returned 404 (1 defect(s) reported)"],
  ["Stripe API status 402", "Stripe API status 429"],
  ["Resend responded HTTP 503", "Resend responded HTTP 502"],
  ["upstream status: 500", "upstream status: 503"],
  ["sync-v2 failed", "sync-v3 failed"],
]) {
  const r = await same(a, b);
  check(`DIFFERENT fingerprints: "${a}" vs "${b}"`, r.same === false, `${r.na} | ${r.nb}`);
}
for (const [a, b] of [
  ["Transfer failed: $22.00 to helpr for job dd9e4db7-2173-428c-b612-bc02f4def187", "Transfer failed: $1,340.50 to helpr for job e7e09075-a8c6-44b0-9c11-4ee42b8849ea"],
  ["Stuck payment on job 376ed4ab after 20:24:35.503876", "Stuck payment on job 5eed0a10 after 01:02:03.000001"],
  ["Cron weekly-helper-report never fired since 2026-09-01 03:29:18.996385+00 (tolerance 8 days)", "Cron weekly-helper-report never fired since 2026-09-12 11:00:00+00 (tolerance 9 days)"],
  ["handshake time: -0.040000 ms", "handshake time: 62.012000 ms"],
  ["50 message(s) in the dlq", "1 message(s) in the dlq"],
  ["Timeout of 5000 ms", "Timeout of 5001 ms"],
  ["pi_3AbCdEf123456 failed for x@y.com", "pi_9ZyXwV654321 failed for a@b.org"],
]) {
  const r = await same(a, b);
  check(`SAME fingerprint: "${a}" vs "${b}"`, r.same === true, `${r.na} | ${r.nb}`);
}

// Digest check: a missing expectation row is NOT ok (false-clear risk).
let dg = await q(`SELECT public.check_ops_digest_delivery() AS r`);
check("check_ops_digest_delivery: no ops-daily-digest expectation row -> ok:false", dg[0].r.ok === false, JSON.stringify(dg[0].r));
await db.exec(`DELETE FROM public.error_logs WHERE tags->>'source' = 'ops-digest-undelivered';
  DELETE FROM public.ops_alert_ledger WHERE source = 'ops-digest-undelivered';
  INSERT INTO public.cron_work_expectations VALUES ('ops-daily-digest', now() - interval '1 hour');`);
dg = await q(`SELECT public.check_ops_digest_delivery() AS r`);
check("check_ops_digest_delivery: row present, inside grace -> ok:true", dg[0].r.ok === true, JSON.stringify(dg[0].r));

// Backfill
let rows = await q(`SELECT source_kind, source, title, count, verify_kind FROM public.ops_alert_ledger ORDER BY source`);
check("backfill: one item per fingerprint, 72h window, client + ops-digest skipped",
  rows.length === 2, JSON.stringify(rows));
const stuck = rows.find((r) => r.source === "detect_stuck_payments");
check("backfill: counts once despite 3 applies", Number(stuck?.count) === 2, `count=${stuck?.count}`);
check("detect_stuck_payments gets the sql_condition verify hook", stuck?.verify_kind === "sql_condition");
const ops = rows.find((r) => r.source === "ops-alert:custom");
check("backfilled ops-alert row is keyed on its title", ops?.title === "ban review needed" && ops?.source_kind === "edge_slack", JSON.stringify(ops));

// Normalisation
rows = await q(`SELECT public.ops_alert_normalise('Job 5eed0a10-0000-4000-8000-000000000004 stuck; pi_3AbCdEf123456 for x@y.com took 105h (dispute 9756a585)') AS n`);
check("normalise strips uuid / stripe id / email / hex / numbers",
  rows[0].n === "job <id> stuck; <id> for <email> took #h (dispute <id>)", rows[0].n);
rows = await q(`SELECT public.ops_alert_normalise('decade facade') AS n`);
check("normalise leaves hex-letter words without digits", rows[0].n === "decade facade", rows[0].n);

// Live trigger
await db.exec(`INSERT INTO public.error_logs (severity, message, tags) VALUES
  ('warning','Cron HTTP timeout: arrival-confirm-reminder returned Timeout of 5000 ms', '{"source":"cron-http","origin":"server"}'),
  ('warning','Cron HTTP timeout: arrival-confirm-reminder returned Timeout of 5001 ms', '{"source":"cron-http","origin":"server"}'),
  ('error','client thing', '{"source":"cron-http","origin":"client"}'),
  ('error','via transport', '{"source":"ops-alert","origin":"server"}');`);
rows = await q(`SELECT count, verify_kind FROM public.ops_alert_ledger WHERE source = 'cron-http'`);
check("trigger: two ids-differ rows -> one item count 2, manual verify", rows.length === 1 && Number(rows[0].count) === 2 && rows[0].verify_kind === "manual", JSON.stringify(rows));
rows = await q(`SELECT count(*)::int n FROM public.ops_alert_ledger WHERE title IN ('client thing','via transport')`);
check("trigger: client-origin and ops-alert rows are not ledgered here", rows[0].n === 0);

// verify: still failing
rows = await q(`SELECT public.ops_alert_verify() AS r`);
rows = await q(`SELECT status, verify_note FROM public.ops_alert_ledger WHERE source='detect_stuck_payments'`);
check("verify keeps a still-true condition open", rows[0].status === "open" && /still failing/.test(rows[0].verify_note ?? ""), JSON.stringify(rows[0]));

// clear the condition, verify closes
await db.exec(`UPDATE public.jobs SET payment_status = 'escrow'`);
await q(`SELECT public.ops_alert_verify()`);
rows = await q(`SELECT status, closed_evidence FROM public.ops_alert_ledger WHERE source='detect_stuck_payments'`);
check("verify closes when re-asked and false, with evidence", rows[0].status === "closed" && /cleared/.test(rows[0].closed_evidence ?? ""), JSON.stringify(rows[0]));

// An OLDER occurrence (late sync) does not reopen; a new one does.
await q(`SELECT public.ops_alert_record('error_logs','detect_stuck_payments','Stuck payment detected','error',NULL,'{}'::jsonb,NULL,NULL, now() - interval '3 hours')`);
rows = await q(`SELECT status FROM public.ops_alert_ledger WHERE source='detect_stuck_payments'`);
check("an occurrence older than the close does not reopen", rows[0].status === "closed");
await new Promise((r) => setTimeout(r, 20));
await db.exec(`INSERT INTO public.error_logs (severity, message, tags) VALUES ('error','Stuck payment detected — webhook noop', '{"source":"detect_stuck_payments","origin":"server"}')`);
rows = await q(`SELECT status, reopen_count, closed_at FROM public.ops_alert_ledger WHERE source='detect_stuck_payments'`);
check("a new occurrence reopens a closed item", rows[0].status === "open" && rows[0].reopen_count === 1 && rows[0].closed_at === null, JSON.stringify(rows[0]));

// ops_alert_close
const id = (await q(`SELECT id FROM public.ops_alert_ledger WHERE source='cron-http'`))[0].id;
rows = await q(`SELECT public.ops_alert_close('${id}', 'reran sweep_cron_http_failures', now() - interval '1 day') AS ok`);
check("close refuses a re-run that started before the last occurrence", rows[0].ok === false);
let threw = false;
try { await q(`SELECT public.ops_alert_close('${id}', 'x', now())`); } catch { threw = true; }
check("close refuses empty evidence", threw);
await new Promise((r) => setTimeout(r, 20));
rows = await q(`SELECT public.ops_alert_close('${id}', 'reran sweep_cron_http_failures: ok', clock_timestamp()) AS ok`);
check("close accepts a re-run after the last occurrence", rows[0].ok === true);

// companions: a SQL Slack summary closes only when its error_logs items do.
await db.exec(`INSERT INTO public.error_logs (severity, message, tags) VALUES
  ('error','Cron auto-expire-jobs is firing but its last 3 runs all failed', '{"source":"cron-dead","origin":"server","job":"auto-expire-jobs"}');`);
await q(`SELECT public.ops_alert_record('sql_slack','slack-ops-alert:custom','3 cron(s) need attention','critical')`);
await q(`SELECT public.ops_alert_record('edge_slack','ops-alert:custom','New member joined','info', NULL, '{}'::jsonb, NULL, NULL, now() - interval '2 days')`);
rows = await q(`SELECT verify_kind FROM public.ops_alert_ledger WHERE source='slack-ops-alert:custom'`);
check("a Slack summary gets the companions verify hook", rows[0].verify_kind === "companions");
rows = await q(`SELECT verify_kind FROM public.ops_alert_ledger WHERE source='cron-dead'`);
check("cron-dead with a job gets sql_condition", rows[0].verify_kind === "sql_condition");
await q(`SELECT public.ops_alert_verify()`);
rows = await q(`SELECT status FROM public.ops_alert_ledger WHERE source='slack-ops-alert:custom'`);
check("summary stays open while a companion is open", rows[0].status === "open");
await db.exec(`UPDATE public.ops_alert_ledger SET status='closed', closed_at=now(), closed_evidence='test: companion closed' WHERE source_kind='error_logs' AND status<>'closed'`);
await q(`SELECT public.ops_alert_verify()`);
rows = await q(`SELECT status, closed_evidence FROM public.ops_alert_ledger WHERE source='slack-ops-alert:custom'`);
check("summary closes once every companion is closed", rows[0].status === "closed", JSON.stringify(rows[0]));
rows = await q(`SELECT status FROM public.ops_alert_ledger WHERE source='ops-alert:custom' AND title='new member joined'`);
check("a Slack alert with no companions stays open for a person", rows[0].status === "open");

// Privileges
for (const role of ["anon", "authenticated"]) {
  for (const fn of ["ops_alert_record(text,text,text,text,text,jsonb,text,text,timestamptz)", "ops_alert_verify()", "ops_alert_close(uuid,text,timestamptz)", "ops_alert_condition(text,jsonb,timestamptz,boolean)", "ops_alert_mark_fixed(uuid,text)", "ops_alert_normalise(text)", "ops_alert_ledger_from_error_log()", "ops_alert_apply(text,text,text,text,text,jsonb,text,text,timestamptz)", "ops_alert_fold_pending()"]) {
    rows = await q(`SELECT has_function_privilege('${role}', 'public.${fn}', 'EXECUTE') AS x`);
    check(`${role} cannot execute ${fn.split("(")[0]}`, rows[0].x === false);
  }
  for (const priv of ["INSERT", "UPDATE", "DELETE"]) {
    rows = await q(`SELECT has_table_privilege('${role}', 'public.ops_alert_ledger', '${priv}') AS x`);
    check(`${role} has no ${priv} on the ledger`, rows[0].x === false);
  }
  for (const priv of ["SELECT", "INSERT", "UPDATE", "DELETE"]) {
    rows = await q(`SELECT has_table_privilege('${role}', 'public.ops_alert_pending', '${priv}') AS x`);
    check(`${role} has no ${priv} on ops_alert_pending (despite default privileges)`, rows[0].x === false);
  }
}
rows = await q(`SELECT has_table_privilege('anon', 'public.ops_alert_ledger', 'SELECT') AS x`);
check("anon has no SELECT on the ledger", rows[0].x === false);

// RLS read
await db.exec(`SET ROLE authenticated; SET request.jwt.claim.sub = '${USER}';`);
rows = await q(`SELECT count(*)::int n FROM public.ops_alert_ledger`);
check("non-admin reads zero rows", rows[0].n === 0, `n=${rows[0].n}`);
await db.exec(`SET request.jwt.claim.sub = '${ADMIN}';`);
rows = await q(`SELECT count(*)::int n FROM public.ops_alert_ledger`);
check("admin reads the ledger", rows[0].n >= 3, `n=${rows[0].n}`);
await db.exec(`RESET ROLE;`);

console.log(failures ? `\n${failures} FAILED` : "\nALL PASS");
process.exit(failures ? 1 : 0);
