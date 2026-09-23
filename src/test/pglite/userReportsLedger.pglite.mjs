#!/usr/bin/env node
/**
 * PGlite proof for 20260923171651_user_reports_reach_the_ledger (docs/OPEN.md Q64).
 *
 *   node src/test/pglite/userReportsLedger.pglite.mjs
 *   NEW_MIGRATION=skip node src/test/pglite/userReportsLedger.pglite.mjs   # RED: no routing
 *   MIGRATION_PATH=<planted copy> node src/test/pglite/userReportsLedger.pglite.mjs
 *
 * pglite is not a dependency (CLAUDE.md): loaded from ~/.lh-pglite (PGLITE_DIR).
 *
 * Applies the ledger chain + the Q39 migration, then the new one 3x
 * (replay-safe), and proves:
 *   - backfill: a still-open real report from before the migration becomes an
 *     item; a resolved one and a seed reporter's do not; once across 3 applies.
 *   - every reporting surface's row shape (ReportDialog job/message/user/review,
 *     SupportInline / contact-support 'support') opens a user-report item with
 *     the admin-queue link, the report id and a severity by kind.
 *   - dedupe: the same report twice (double-tap) and a second person reporting
 *     the same subject -> one item, count 2 / 3; ids in the subject stripped.
 *   - a seed reporter -> no item; a reporter with no profile, or NULL (deleted
 *     account) -> item (unknown is real).
 *   - close rule: TRUE while any matching report is pending/new/investigating;
 *     resolving ALL of them -> FALSE -> ops_alert_verify closes it; a new report
 *     re-opens it.
 *   - the Slack companion ('ops-alert:support_request') is re-pointed to
 *     sql_condition and closes once no user-report item is open.
 *   - a failing ledger never fails the report insert.
 *   - anon/authenticated cannot execute any new function.
 */
import { readFileSync } from "node:fs";
import os from "node:os";

const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const mig = (f) => readFileSync(new URL(`../../../supabase/migrations/${f}`, import.meta.url).pathname, "utf8");
const CHAIN = [
  "20260923043402_ops_alert_ledger.sql",
  "20260923050059_ops_alert_ledger_never_blocks_and_keeps_status_codes.sql",
  "20260923052520_seed_alerts_go_to_the_digest.sql",
  "20260923055631_push_token_health_monitor.sql",
  "20260923085642_user_error_screens_reach_the_ledger.sql",
];
const MIGRATION = process.env.MIGRATION_PATH
  ? readFileSync(process.env.MIGRATION_PATH, "utf8")
  : mig("20260923171651_user_reports_reach_the_ledger.sql");

let failures = 0;
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
  if (!ok) failures++;
};

const REAL = "aaaaaaaa-0000-0000-0000-000000000001";
const REAL2 = "aaaaaaaa-0000-0000-0000-000000000002";
const SEED = "bbbbbbbb-0000-0000-0000-000000000003";
const NOPROFILE = "cccccccc-0000-0000-0000-000000000004";
const TARGET = "eeeeeeee-0000-0000-0000-000000000009";

const db = new PGlite();
await db.exec(`
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role; END IF;
END $$;
CREATE SCHEMA IF NOT EXISTS auth;
CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS
  $$ SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
GRANT USAGE ON SCHEMA auth TO anon, authenticated, service_role;
CREATE TABLE auth.users (id uuid PRIMARY KEY, email text);
CREATE TYPE public.app_role AS ENUM ('admin','customer','helper');
CREATE TABLE public.user_roles (user_id uuid, role public.app_role);
CREATE OR REPLACE FUNCTION public.has_role(_uid uuid, _role public.app_role) RETURNS boolean
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS
  $$ SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _uid AND role = _role) $$;
CREATE TABLE public.profiles (user_id uuid PRIMARY KEY, is_seed boolean);
CREATE TABLE public.error_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  severity text DEFAULT 'error', message text, url text, stack text, user_id uuid, user_agent text,
  tags jsonb NOT NULL DEFAULT '{}'::jsonb, context jsonb DEFAULT '{}'::jsonb, created_at timestamptz DEFAULT now());
CREATE TABLE public.jobs (id uuid DEFAULT gen_random_uuid(), stripe_session_id text, payment_status text, status text,
  cancelled_at timestamptz, updated_at timestamptz, created_at timestamptz DEFAULT now(), is_seed boolean, customer_id uuid);
CREATE TABLE public.cron_work_expectations (jobname text PRIMARY KEY, candidate_key text,
  disposition_keys text[] DEFAULT ARRAY[]::text[], min_streak int NOT NULL DEFAULT 2,
  note text NOT NULL DEFAULT '', expected_max_gap interval, registered_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE public.push_tokens (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL, token text NOT NULL,
  platform text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), UNIQUE (user_id, token));
CREATE TABLE public.analytics_events (id uuid DEFAULT gen_random_uuid(), user_id uuid, event text, platform text, created_at timestamptz DEFAULT now());
CREATE TABLE public.notification_logs (id uuid DEFAULT gen_random_uuid(), user_id uuid, channel text, status text, error_message text, created_at timestamptz DEFAULT now());
CREATE TABLE public.email_send_log (recipient_email text, status text, template_name text, created_at timestamptz);
-- public.reports as prod has it (20260311003245 + 20260609160000 + 20260831182613).
CREATE TABLE public.reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reporter_id uuid,
  reported_type text NOT NULL CHECK (reported_type = ANY (ARRAY['job','message','user','support','review'])),
  reported_id uuid NOT NULL,
  reason text NOT NULL,
  description text,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','new','investigating','reviewed','resolved','dismissed')),
  assigned_to uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now());
CREATE SCHEMA cron;
CREATE TABLE cron.job (jobid bigserial, jobname text UNIQUE, schedule text, command text);
CREATE FUNCTION cron.schedule(p_name text, p_sched text, p_cmd text) RETURNS bigint LANGUAGE sql AS $$
  INSERT INTO cron.job (jobname, schedule, command) VALUES (p_name, p_sched, p_cmd)
  ON CONFLICT (jobname) DO UPDATE SET schedule = EXCLUDED.schedule, command = EXCLUDED.command
  RETURNING jobid $$;
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO anon, authenticated, service_role;
INSERT INTO public.profiles VALUES ('${REAL}', false), ('${REAL2}', false), ('${SEED}', true);
INSERT INTO public.profiles SELECT ('ffffffff-0000-0000-0000-' || lpad(g::text, 12, '0'))::uuid, false FROM generate_series(1, 40) g;
-- History for the backfill.
INSERT INTO public.reports (reporter_id, reported_type, reported_id, reason, description, status, created_at) VALUES
 ('${REAL}', 'support', '${REAL}', '[Issue Report] Old crash on post', 'it crashed', 'pending', now() - interval '3 days'),
 ('${REAL}', 'support', '${REAL}', '[Issue Report] Old fixed thing', 'fixed', 'resolved', now() - interval '3 days'),
 ('${SEED}', 'support', '${SEED}', '[Issue Report] Seed thing', 'seed', 'pending', now() - interval '3 days');
`);
const q = async (sql, p) => (await db.query(sql, p)).rows;

for (const f of CHAIN) {
  try { await db.exec(mig(f)); } catch (e) { check(`chain ${f}`, false, e.message); }
}
// The Slack companion item as it exists live before this migration.
await q(`SELECT public.ops_alert_record('edge_slack', 'ops-alert:support_request', 'Support: Issue Report', 'info', 'x', '{}'::jsonb, NULL, NULL, now() - interval '2 days')`);

if (process.env.NEW_MIGRATION !== "skip") {
  for (let i = 1; i <= 3; i++) {
    try { await db.exec(MIGRATION); check(`apply pass #${i}`, true); }
    catch (e) { check(`apply pass #${i}`, false, e.message); }
  }
}

const items = (extra = "") =>
  q(`SELECT id, title, severity, count::int n, status, verify_kind, verify_ref, sample_ref
       FROM public.ops_alert_ledger WHERE source_kind = 'user-report' ${extra} ORDER BY first_seen`).catch(() => []);

let it = await items();
check("backfill: the one still-open real report became ONE item (resolved + seed did not), once across 3 applies",
  it.length === 1 && it[0].n === 1 && it[0].title === "support [issue report] old crash on post", JSON.stringify(it.map((r) => [r.title, r.n])));

const report = (reporter, type, reason, desc = "details of the problem") =>
  q(`INSERT INTO public.reports (reporter_id, reported_type, reported_id, reason, description) VALUES ($1, $2, $3, $4, $5) RETURNING id`,
    [reporter, type, TARGET, reason, desc]).then((r) => r[0].id);

// ── every surface's row shape ───────────────────────────────────────────────
const shapes = [
  ["ReportDialog job", "job", "Unsafe or illegal work", "critical", "/admin?view=reports"],
  ["ReportDialog message", "message", "Spam or scam", "error", "/admin?view=reports"],
  ["ReportDialog user", "user", "Harassment or abuse", "critical", "/admin?view=reports"],
  ["ReportDialog review", "review", "Fake or dishonest review", "error", "/admin?view=reports"],
  ["SupportInline issue report", "support", "[Issue Report] Map will not load 3", "error", "/admin?view=support"],
  ["SupportInline admin message", "support", "[Admin Message] Where is my payout", "warning", "/admin?view=support"],
  ["SupportInline suggestion", "support", "[Suggestion] Dark mode please", "info", "/admin?view=support"],
];
// One reporter per shape: the per-reporter new-item cap (5/hour) is tested below.
const who = (n) => `ffffffff-0000-0000-0000-${String(n).padStart(12, "0")}`;
let shapeN = 30;
for (const [name, type, reason, sev, link] of shapes) {
  const id = await report(who(shapeN++), type, reason);
  const [row] = await q(`SELECT severity, verify_kind, verify_ref, sample_ref, status FROM public.ops_alert_ledger
                          WHERE source_kind='user-report' AND sample_ref->>'report_id' = $1`, [id]);
  check(`${name}: opens an item (severity ${sev}, link ${link}, sql_condition)`,
    row && row.severity === sev && row.sample_ref.link === link && row.verify_kind === "sql_condition"
      && row.verify_ref === "user-report" && row.status === "open",
    JSON.stringify(row));
}

// ── dedupe ─────────────────────────────────────────────────────────────────
await report(REAL, "support", "[Issue Report] Map will not load 3");       // double tap
await report(REAL2, "support", "[Issue Report] Map will not load 7");      // another person, different number
it = await items(`AND title LIKE 'support [issue report] map will not load%'`);
check("dedupe: double-tap + a second person on the same subject -> one item, count 3",
  it.length === 1 && it[0].n === 3, JSON.stringify(it.map((r) => [r.title, r.n])));

// ── seed / unknown ─────────────────────────────────────────────────────────
const before = (await items()).length;
await report(SEED, "support", "[Issue Report] seed only subject");
check("seed reporter -> no item", (await items()).length === before);
await report(NOPROFILE, "support", "[Issue Report] no profile subject");
await report(null, "user", "Threats or violence");
const titles = (await items()).map((r) => r.title);
check("reporter with no profile -> item", titles.includes("support [issue report] no profile subject"), JSON.stringify(titles));
check("NULL reporter (deleted account) -> item", titles.includes("report on user: threats or violence"), JSON.stringify(titles));

// ── close rule ─────────────────────────────────────────────────────────────
const cond = (title) =>
  q(`SELECT public.ops_alert_condition('user-report', jsonb_build_object('title_norm', $1::text), now()) c`, [title]).then((r) => r[0].c);
const MAP = "support [issue report] map will not load #";
check("close rule TRUE while the reports are pending", (await cond(MAP)) === true);
await q(`UPDATE public.reports SET status = 'investigating' WHERE reason LIKE '[Issue Report] Map will not load%' AND reporter_id = '${REAL2}'`);
await q(`UPDATE public.reports SET status = 'resolved' WHERE reason LIKE '[Issue Report] Map will not load%' AND reporter_id = '${REAL}'`);
check("close rule TRUE while ONE matching report is still investigating", (await cond(MAP)) === true);
await q(`UPDATE public.reports SET status = 'dismissed' WHERE reason LIKE '[Issue Report] Map will not load%'`);
check("close rule FALSE once every matching report is resolved/dismissed", (await cond(MAP)) === false);
await q(`SELECT public.ops_alert_verify()`);
it = await items(`AND title = '${MAP}'`);
check("ops_alert_verify closes it", it[0]?.status === "closed", JSON.stringify(it[0]));
await report(REAL, "support", "[Issue Report] Map will not load 9");
it = await items(`AND title = '${MAP}'`);
check("a new report re-opens it", it[0]?.status === "open" && it[0]?.n === 4, JSON.stringify(it[0]));

// ── flood cap (authz review M1) ─────────────────────────────────────────────
const overflow = () => q(`SELECT count::int n, status, severity FROM public.ops_alert_ledger
                           WHERE source_kind='user-report' AND (sample_ref->>'overflow')::boolean`).then((r) => r[0]);
const FLOODER = who(1);
const own = () => q(`SELECT count(*)::int n FROM public.ops_alert_ledger WHERE source_kind='user-report' AND sample_ref->>'reporter_id' = '${FLOODER}'`).then((r) => r[0].n);
for (const w of ["alpha", "bravo", "charlie", "delta", "echo", "foxtrot", "golf", "hotel"]) await report(FLOODER, "user", `threat ${w}`);
check("one reporter, 8 distinct reasons in an hour -> 5 own items", (await own()) === 5, String(await own()));
check("...and the other 3 counted on ONE overflow item", (await overflow())?.n === 3, JSON.stringify(await overflow()));
let reportsBefore = (await q(`SELECT count(*)::int n FROM public.reports WHERE reporter_id = '${FLOODER}'`))[0].n;
check("...while all 8 reports are still in the admin queue", reportsBefore === 8, String(reportsBefore));
await report(FLOODER, "user", "threat alpha");
check("an EXISTING item still counts past the cap", (await items(`AND title = 'report on user: threat alpha'`))[0]?.n === 2);
const newThisHour = async () => (await q(`SELECT count(*)::int n FROM public.ops_alert_ledger WHERE source_kind='user-report'
  AND first_seen > now() - interval '1 hour' AND NOT coalesce((sample_ref->>'overflow')::boolean, false)`))[0].n;
const beforeGlobal = await newThisHour();
for (let i = 2; i <= 22; i++) await report(who(i), "support", `[Issue Report] global ${String.fromCharCode(96 + i)}${String.fromCharCode(96 + i)}`);
check("global cap: at most 20 new items in the hour overall", (await newThisHour()) === 20, `before=${beforeGlobal} after=${await newThisHour()}`);
check("...the rest on the same overflow item", (await overflow())?.n === 3 + 21 - (20 - beforeGlobal), JSON.stringify(await overflow()));
const ovCond = () => q(`SELECT public.ops_alert_condition('user-report', '{"overflow":true}'::jsonb, now()) c`).then((r) => r[0].c);
check("overflow close rule TRUE while an open report has no item of its own", (await ovCond()) === true);

// ── Slack companion ───────────────────────────────────────────────────────
const companion = () => q(`SELECT verify_kind, status FROM public.ops_alert_ledger WHERE source = 'ops-alert:support_request'`).then((r) => r[0]);
check("Slack companion re-pointed to sql_condition", (await companion())?.verify_kind === "sql_condition", JSON.stringify(await companion()));
await q(`SELECT public.ops_alert_verify()`);
check("Slack companion stays open while user-report items are open", (await companion())?.status !== "closed", JSON.stringify(await companion()));
await q(`UPDATE public.reports SET status = 'resolved'`);
check("overflow close rule FALSE once those reports are resolved", (await ovCond()) === false);
await q(`SELECT public.ops_alert_verify()`);
const open = await items(`AND status <> 'closed'`);
check("resolving every report closes every user-report item", open.length === 0, JSON.stringify(open.map((r) => r.title)));
await q(`SELECT public.ops_alert_verify()`);
check("...and then the Slack companion closes", (await companion())?.status === "closed", JSON.stringify(await companion()));

// ── the ledger can never fail the report ───────────────────────────────────
await db.exec(`ALTER TABLE public.ops_alert_ledger RENAME TO ops_alert_ledger_gone`);
let insertOk = true;
try { await report(REAL, "job", "Spam or scam"); } catch { insertOk = false; }
check("a broken ledger does not fail the report insert", insertOk);
await db.exec(`ALTER TABLE public.ops_alert_ledger_gone RENAME TO ops_alert_ledger`);

// ── grants ─────────────────────────────────────────────────────────────────
const fns = ["user_report_title(text,text)", "user_report_severity(text,text)", "user_report_is_open(text)",
  "user_report_is_real(uuid)", "ops_alert_record_user_report(uuid)", "ops_alert_ledger_from_report()"];
for (const f of fns) {
  const [{ a, u }] = await q(`SELECT has_function_privilege('anon', 'public.${f}', 'EXECUTE') a,
                                     has_function_privilege('authenticated', 'public.${f}', 'EXECUTE') u`).catch(() => [{ a: null, u: null }]);
  check(`${f}: anon and authenticated cannot execute`, a === false && u === false, JSON.stringify({ a, u }));
}

console.log(failures ? `\n${failures} FAIL` : "\nALL PASS");
process.exit(failures ? 1 : 0);
