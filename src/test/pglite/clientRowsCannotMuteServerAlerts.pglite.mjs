#!/usr/bin/env node
/**
 * PGlite proof for 20261004004835_client_rows_cannot_mute_server_alerts
 * (docs/OPEN.md Q1159): a row an anon/authenticated client writes to
 * public.error_logs must not suppress a SERVER page or a SERVER once-a-day
 * report, however it is tagged.
 *
 *   node src/test/pglite/clientRowsCannotMuteServerAlerts.pglite.mjs
 *   NEW_MIGRATION=skip node src/test/pglite/clientRowsCannotMuteServerAlerts.pglite.mjs   # RED: the chain before the fix
 *   MUTATE=no-origin-filter node src/test/pglite/clientRowsCannotMuteServerAlerts.pglite.mjs
 *       # RED: the fix applied but notify_slack_on_error_log's predicate removed
 *
 * pglite is not a dependency (CLAUDE.md): loaded from ~/.lh-pglite (override
 * with PGLITE_DIR). Functions are loaded VERBATIM from the migrations: the
 * "before" bodies from the migrations that last defined them, the "after"
 * bodies from the new migration (applied 3x for replay-safety).
 *
 * Proves, through the real client path (role anon / authenticated, the live
 * anyone_can_insert_errors policy, the real stamp_error_log_origin):
 *   A. notify_slack_on_error_log: a forged row tagged with a server source
 *      (any severity window) no longer stops that source's first server row
 *      from paging; the server throttle still holds for server rows; a client
 *      row itself never pages; a different severity/source is unaffected.
 *   B. check_push_token_health (the once-a-day shape shared by sweep_dead_crons,
 *      sweep_silent_cron_failures, check_db_saturation, ...): a forged
 *      'push-tokens-empty' row no longer suppresses the server's daily report;
 *      the server dedupe still holds for a second run.
 *   C. A pre-stamp row (no tags.origin at all) still counts as a server row, so
 *      all-time dedupes do not forget history.
 */
import { readFileSync } from "node:fs";
import os from "node:os";

const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const mig = (f) => readFileSync(new URL(`../../../supabase/migrations/${f}`, import.meta.url).pathname, "utf8");

const STAMP = "20260923094457_error_logs_client_identity_and_throttle.sql";
const SEED = "20260923052520_seed_alerts_go_to_the_digest.sql";
const PUSH = "20260923055631_push_token_health_monitor.sql";
const FIX = "20261004004835_client_rows_cannot_mute_server_alerts.sql";

/** The last CREATE [OR REPLACE] FUNCTION public.<name> statement in a migration, verbatim. */
function fn(file, name) {
  const sql = mig(file);
  const re = new RegExp(`CREATE\\s+(?:OR\\s+REPLACE\\s+)?FUNCTION\\s+public\\.${name}\\s*\\(`, "gi");
  let last;
  for (const m of sql.matchAll(re)) last = m;
  if (!last) throw new Error(`${name} not found in ${file}`);
  const rest = sql.slice(last.index);
  const tag = rest.match(/\bAS\s+(\$[A-Za-z_0-9]*\$)/);
  const close = rest.indexOf(tag[1], tag.index + tag[0].length);
  return rest.slice(0, rest.indexOf(";", close + tag[1].length) + 1);
}

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
CREATE SCHEMA auth;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS
  $$ SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
GRANT USAGE ON SCHEMA auth TO anon, authenticated, service_role;
CREATE TABLE public.profiles (user_id uuid PRIMARY KEY, is_seed boolean);
CREATE TABLE public.error_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  severity text DEFAULT 'error', message text, url text, stack text, user_id uuid, user_agent text,
  tags jsonb NOT NULL DEFAULT '{}'::jsonb, context jsonb DEFAULT '{}'::jsonb, created_at timestamptz DEFAULT now());
-- RLS and the insert policy exactly as live (pg_policies).
ALTER TABLE public.error_logs ENABLE ROW LEVEL SECURITY;
CREATE POLICY anyone_can_insert_errors ON public.error_logs AS PERMISSIVE FOR INSERT
  TO anon, authenticated, service_role
  WITH CHECK (((user_id IS NULL) OR (user_id = ( SELECT auth.uid() AS uid))));
CREATE TABLE public.push_tokens (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL, token text NOT NULL,
  platform text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE public.analytics_events (id uuid DEFAULT gen_random_uuid(), user_id uuid, event text, platform text, created_at timestamptz DEFAULT now());
CREATE TABLE public.notification_logs (id uuid DEFAULT gen_random_uuid(), user_id uuid, channel text, status text, error_message text, created_at timestamptz DEFAULT now());
-- check_db_saturation declares a public.db_saturation_state%ROWTYPE, so the table must exist to CREATE it.
CREATE TABLE public.db_saturation_state (id int);
-- Slack transport: vault secrets and net.http_post, recording every post.
CREATE SCHEMA vault; CREATE TABLE vault.decrypted_secrets (name text, decrypted_secret text);
INSERT INTO vault.decrypted_secrets VALUES ('supabase_url', 'https://x.test'), ('service_role_key', 'k');
CREATE SCHEMA net; CREATE TABLE net.calls (body jsonb);
CREATE FUNCTION net.http_post(url text, headers jsonb, body jsonb) RETURNS bigint LANGUAGE plpgsql AS
  $$ BEGIN INSERT INTO net.calls VALUES (body); RETURN 1; END $$;
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO anon, authenticated, service_role;
`);
const q = async (sql, p) => (await db.query(sql, p)).rows;

// The chain BEFORE the fix: each function as its last pre-fix migration left it.
await db.exec(fn(STAMP, "stamp_error_log_origin"));
await db.exec(fn(SEED, "error_log_is_seed"));
await db.exec(fn(SEED, "notify_slack_on_error_log"));
await db.exec(fn(PUSH, "check_push_token_health"));
await db.exec(`
CREATE TRIGGER trg_error_logs_00_stamp_origin BEFORE INSERT ON public.error_logs
  FOR EACH ROW EXECUTE FUNCTION public.stamp_error_log_origin();
CREATE TRIGGER trg_error_logs_slack AFTER INSERT ON public.error_logs
  FOR EACH ROW EXECUTE FUNCTION public.notify_slack_on_error_log();
`);

const MODE = process.env.NEW_MIGRATION ?? "";
if (MODE) console.log(`NEW_MIGRATION=${MODE}: running against the UNFIXED chain (expect FAILs)`);
if (MODE !== "skip") {
  // The fix migration redefines its functions (15 on 2026-10-04). CREATE FUNCTION does not resolve table
  // names until run (except the one %ROWTYPE stubbed above), so the file applies as-is.
  for (let i = 1; i <= 3; i++) {
    try {
      let sql = mig(FIX);
      if (process.env.MUTATE === "no-origin-filter") {
        const a = sql.indexOf("CREATE OR REPLACE FUNCTION public.notify_slack_on_error_log");
        const b = sql.indexOf("$function$;", a);
        const body = sql.slice(a, b);
        const cut = body.replace("coalesce(e.tags ->> 'origin', '') <> 'client' AND ", "");
        if (cut === body) throw new Error("MUTATE: predicate not found in notify_slack_on_error_log");
        sql = sql.slice(0, a) + cut + sql.slice(b);
      }
      await db.exec(sql);
      check(`apply fix pass #${i}`, true);
    } catch (e) {
      check(`apply fix pass #${i}`, false, e.message);
    }
  }
  if (process.env.MUTATE) console.log(`MUTATE=${process.env.MUTATE} (expect FAILs)`);
}

// A client insert as PostgREST makes it: anon (no JWT), or authenticated with a sub.
const asClient = async (sub, f) => {
  await db.exec(`SET ROLE ${sub ? "authenticated" : "anon"}`);
  await db.query(`SELECT set_config('request.jwt.claim.sub', $1, false)`, [sub ?? ""]);
  try {
    return await f();
  } finally {
    await db.exec(`RESET ROLE`);
    await db.query(`SELECT set_config('request.jwt.claim.sub', '', false)`);
  }
};
const clientRow = (sub, severity, tags, msg = "forged") =>
  asClient(sub, () =>
    db.query(`INSERT INTO public.error_logs (user_id, severity, message, tags) VALUES ($1, $2, $3, $4::jsonb)`,
      [sub, severity, msg, JSON.stringify(tags)]));
const serverRow = (severity, tags, msg = "real server failure") =>
  db.query(`INSERT INTO public.error_logs (severity, message, tags) VALUES ($1, $2, $3::jsonb)`, [severity, msg, JSON.stringify(tags)]);
const pages = async (like) =>
  (await q(`SELECT count(*)::int n FROM net.calls WHERE body->>'title' LIKE $1`, [like]))[0].n;
const USER = "aaaaaaaa-0000-0000-0000-000000000001";

// ── A. the per-source Slack throttle ────────────────────────────────────────
// Control: no forgery, the server row pages.
await serverRow("error", { source: "weekly-report", area: "reports" });
check("A0 control: a server 'error' row pages", (await pages("[ERROR/weekly-report]%")) === 1, `pages=${await pages("[ERROR/weekly-report]%")}`);

// Forged first (anon), real server row second, on a different server source, per severity window.
for (const [sev, src] of [["error", "payout-sweeper"], ["warning", "email-relay"], ["info", "digest-builder"], ["error", "cron-dead"]]) {
  await clientRow(null, sev, { source: src, area: "forged" });
  await serverRow(sev, { source: src, area: "real" });
  const n = await pages(`[${sev.toUpperCase()}/${src}]%`);
  check(`A1 anon forges a '${sev}' row for server source ${src}: the server row STILL pages`, n === 1, `pages=${n}`);
}
// Same as a signed-in account.
await clientRow(USER, "error", { source: "stripe-reconcile" });
await serverRow("error", { source: "stripe-reconcile" });
check("A2 an authenticated client's forged row does not mute it either", (await pages("[ERROR/stripe-reconcile]%")) === 1,
  `pages=${await pages("[ERROR/stripe-reconcile]%")}`);

// The server throttle itself still works for server rows.
await serverRow("error", { source: "weekly-report" }, "second one in the hour");
check("A3 a second SERVER row of the same source+severity in the window still does not re-page", (await pages("[ERROR/weekly-report]%")) === 1,
  `pages=${await pages("[ERROR/weekly-report]%")}`);
// A client row never pages.
const before = (await q(`SELECT count(*)::int n FROM net.calls`))[0].n;
await clientRow(null, "error", { source: "brand-new-source" });
check("A4 a client row never pages", (await q(`SELECT count(*)::int n FROM net.calls`))[0].n === before);
// Forged client rows are still stored (client logging unchanged).
check("A5 forged client rows are still stored", (await q(`SELECT count(*)::int n FROM public.error_logs WHERE tags->>'origin' = 'client'`))[0].n >= 6);

// ── C. a pre-stamp row (no origin) still counts as a server row ─────────────
await db.exec(`INSERT INTO public.error_logs (severity, message, tags, created_at)
               VALUES ('error', 'legacy', '{"source":"legacy-source"}'::jsonb, now() - interval '1 minute')`);
const legacyNoOrigin = (await q(`SELECT (tags ? 'origin') AS has FROM public.error_logs WHERE message = 'legacy'`))[0];
// The BEFORE trigger stamps every insert; remove the stamp to model a pre-stamp row.
await db.exec(`UPDATE public.error_logs SET tags = tags - 'origin' WHERE message = 'legacy'`);
const beforeLegacy = (await q(`SELECT count(*)::int n FROM net.calls`))[0].n;
await serverRow("error", { source: "legacy-source" }, "after a pre-stamp row");
check("C a pre-stamp row (no origin) still throttles the server: no new page", (await q(`SELECT count(*)::int n FROM net.calls`))[0].n === beforeLegacy,
  `stamped on insert: ${legacyNoOrigin?.has}`);

// ── B. the once-a-day server report (push-tokens-empty) ─────────────────────
await clientRow(null, "error", { source: "push-tokens-empty", area: "push" }, "forged daily report");
await db.query(`SELECT public.check_push_token_health()`);
const srv = async () => (await q(`SELECT count(*)::int n FROM public.error_logs WHERE tags->>'source' = 'push-tokens-empty' AND tags->>'origin' = 'server'`))[0].n;
check("B1 a forged 'push-tokens-empty' client row does not suppress the server's daily report", (await srv()) === 1, `server rows=${await srv()}`);
await db.query(`SELECT public.check_push_token_health()`);
check("B2 the server's own once-a-day dedupe still holds", (await srv()) === 1, `server rows=${await srv()}`);

console.log(failures ? `\n${failures} FAILED` : "\nALL PASSED");
process.exit(failures ? 1 : 0);
