/**
 * PGlite proof for 20260923055631_push_token_health_monitor (docs/OPEN.md Q82).
 *
 *   node src/test/pglite/pushTokenHealth.pglite.mjs
 *
 * pglite is not a dependency (CLAUDE.md): it is loaded from ~/.lh-pglite
 * (override with PGLITE_DIR).
 *
 * Proves: applies 3x (replay-safe); with zero real tokens the check is
 * ok:false and writes exactly ONE error_logs row per UTC day however often it
 * runs; a SEED user's token does not clear it; a real user's token does;
 * ops_alert_condition('push-tokens-empty') is true/false in step and is a
 * probe (true) with p_probe_only; an unrelated source still returns NULL (the
 * verbatim body kept its other branches); the cron and its liveness
 * expectation are registered once; anon/authenticated cannot execute either
 * function even under Supabase's default privileges.
 */
import { readFileSync } from "node:fs";
import os from "node:os";

const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const MIGRATION = readFileSync(
  new URL("../../../supabase/migrations/20260923055631_push_token_health_monitor.sql", import.meta.url).pathname,
  "utf8",
);

let failures = 0;
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
  if (!ok) failures++;
};

const REAL = "aaaaaaaa-0000-0000-0000-000000000001";
const SEED = "bbbbbbbb-0000-0000-0000-000000000002";

const db = new PGlite();
await db.exec(`
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role; END IF;
END $$;
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO anon, authenticated, service_role;
CREATE TABLE public.profiles (user_id uuid PRIMARY KEY, is_seed boolean);
CREATE TABLE public.push_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL, token text NOT NULL,
  platform text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(), UNIQUE (user_id, token));
CREATE TABLE public.analytics_events (id uuid DEFAULT gen_random_uuid(), user_id uuid, event text,
  platform text, created_at timestamptz DEFAULT now());
CREATE TABLE public.notification_logs (id uuid DEFAULT gen_random_uuid(), user_id uuid, channel text,
  status text, error_message text, created_at timestamptz DEFAULT now());
CREATE TABLE public.error_logs (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), severity text,
  message text, tags jsonb, context jsonb, created_at timestamptz DEFAULT now());
CREATE TABLE public.jobs (id uuid, stripe_session_id text, payment_status text, status text,
  cancelled_at timestamptz, updated_at timestamptz, created_at timestamptz, is_seed boolean, customer_id uuid);
CREATE TABLE public.cron_work_expectations (jobname text PRIMARY KEY, candidate_key text,
  disposition_keys text[] DEFAULT ARRAY[]::text[], min_streak int NOT NULL DEFAULT 2,
  note text NOT NULL DEFAULT '', expected_max_gap interval, registered_at timestamptz NOT NULL DEFAULT now());
-- Minimal pg_cron stand-in: schedule upserts by name, as pg_cron does.
CREATE SCHEMA cron;
CREATE TABLE cron.job (jobid bigserial, jobname text UNIQUE, schedule text, command text);
CREATE FUNCTION cron.schedule(p_name text, p_sched text, p_cmd text) RETURNS bigint LANGUAGE sql AS $$
  INSERT INTO cron.job (jobname, schedule, command) VALUES (p_name, p_sched, p_cmd)
  ON CONFLICT (jobname) DO UPDATE SET schedule = EXCLUDED.schedule, command = EXCLUDED.command
  RETURNING jobid $$;
INSERT INTO public.profiles VALUES ('${REAL}', false), ('${SEED}', true);
INSERT INTO public.analytics_events (user_id, event, platform) VALUES ('${REAL}', 'x', 'ios');
INSERT INTO public.notification_logs (user_id, channel, status, error_message)
  SELECT '${REAL}', 'push', 'skipped', 'no_registered_devices' FROM generate_series(1, 5);
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

const cronRows = await q(`SELECT jobname, schedule FROM cron.job WHERE jobname = 'push-token-health'`);
check("cron registered once, by name", cronRows.length === 1, JSON.stringify(cronRows));
const exp = await q(`SELECT expected_max_gap::text g FROM public.cron_work_expectations WHERE jobname = 'push-token-health'`);
check("liveness expectation registered (30 h)", exp.length === 1 && exp[0].g === "30:00:00", JSON.stringify(exp));

const run = async () => (await q(`SELECT public.check_push_token_health() r`))[0].r;
let r = await run();
check("0 tokens -> ok:false", r.ok === false && r.tokens === 0, JSON.stringify(r));
check("reports the skipped-push count", r.skipped_no_device_7d === 5 && r.native_users_14d === 1, JSON.stringify(r));
await run();
await run();
let logs = await q(`SELECT count(*)::int n FROM public.error_logs WHERE tags->>'source' = 'push-tokens-empty'`);
check("three runs in one day write ONE error_logs row", logs[0].n === 1, JSON.stringify(logs));
let cond = await q(`SELECT public.ops_alert_condition('push-tokens-empty', '{}'::jsonb, now(), false) c,
                           public.ops_alert_condition('push-tokens-empty', '{}'::jsonb, now(), true) p,
                           public.ops_alert_condition('some-unknown-source', '{}'::jsonb, now(), false) u`);
check("condition true while empty; probe true; unknown source NULL",
  cond[0].c === true && cond[0].p === true && cond[0].u === null, JSON.stringify(cond));

await db.exec(`INSERT INTO public.push_tokens (user_id, token, platform) VALUES ('${SEED}', 'seedtok', 'ios')`);
r = await run();
cond = await q(`SELECT public.ops_alert_condition('push-tokens-empty', '{}'::jsonb, now(), false) c`);
check("a SEED user's token does not clear it", r.ok === false && cond[0].c === true, JSON.stringify({ r, cond }));

await db.exec(`INSERT INTO public.push_tokens (user_id, token, platform) VALUES ('${REAL}', 'realtok', 'ios')`);
r = await run();
cond = await q(`SELECT public.ops_alert_condition('push-tokens-empty', '{}'::jsonb, now(), false) c`);
check("a real user's token clears it (ok:true, condition false)",
  r.ok === true && r.tokens === 1 && r.registered_14d === 1 && cond[0].c === false, JSON.stringify({ r, cond }));

for (const role of ["anon", "authenticated"]) {
  for (const fn of ["public.check_push_token_health()", "public.ops_alert_condition(text, jsonb, timestamptz, boolean)"]) {
    const [{ ok }] = await q(`SELECT has_function_privilege('${role}', '${fn}', 'EXECUTE') ok`);
    check(`${role} cannot execute ${fn}`, ok === false);
  }
}

console.log(failures ? `\n${failures} FAILED` : "\nALL PASS");
process.exit(failures ? 1 : 0);
