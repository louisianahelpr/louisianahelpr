#!/usr/bin/env node
/**
 * PGlite proof for 20260923085642_user_error_screens_reach_the_ledger
 * (docs/OPEN.md Q39).
 *
 * BASELINE ONLY: this proves the Q39 behaviour as it stood BEFORE Q96/Q97
 * (20260923092838: repeat cap, client seed tag) and Q106/Q98 (20260923094457:
 * signed-in identity stamp, client insert throttle). It does not apply those
 * migrations. Current behaviour is covered by userErrorScreenRepeatCap.pglite.mjs.
 *
 *   node src/test/pglite/userErrorScreenLedger.pglite.mjs
 *
 * pglite is not a dependency (CLAUDE.md): it is loaded from ~/.lh-pglite
 * (override with PGLITE_DIR).
 *
 * Applies the whole ledger chain in order (043402, 050059, 052520, 055631),
 * then this migration 3x (replay-safe), and proves:
 *   - REAL user (non-seed profile) error screen -> ONE open item, source_kind
 *     'user-error-screen', verify sql_condition; a /user/<uuid> screen from a
 *     second real user lands on the SAME item (fingerprint strips ids).
 *   - SEED user -> no item. seed-tagged row -> no item. guest (NULL user) and
 *     a user with no profile row -> item (unknown is real).
 *   - server rows and client rows that are not error surfaces -> no item.
 *   - an old bundle's row (source ErrorState, no kind tag) still counts.
 *   - FLOOD (fixture sizes, 2026-09-23): 200 rows of one screen -> one item, count 200. One person hitting
 *     30 different screens -> at most 5 items + ONE overflow item. 40 guests
 *     on 40 different screens -> at most 20 new items + the overflow item.
 *   - inserted AS anon through RLS-less grants: the trigger still records (the
 *     definer path works) while anon cannot execute any new function.
 *   - close rule: condition TRUE while a real row is < 24h old, FALSE once the
 *     rows are older; ops_alert_verify() closes it; a new occurrence re-opens.
 *   - backfill runs once (72h window), not per replay.
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
];
// MIGRATION_PATH: run against a planted-defect copy to prove the checks can fail.
const MIGRATION = process.env.MIGRATION_PATH
  ? readFileSync(process.env.MIGRATION_PATH, "utf8")
  : mig("20260923085642_user_error_screens_reach_the_ledger.sql");

let failures = 0;
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
  if (!ok) failures++;
};

const REAL = "aaaaaaaa-0000-0000-0000-000000000001";
const REAL2 = "aaaaaaaa-0000-0000-0000-000000000002";
const SEED = "bbbbbbbb-0000-0000-0000-000000000003";
const NOPROFILE = "cccccccc-0000-0000-0000-000000000004";
const SPAMMER = "dddddddd-0000-0000-0000-000000000005";

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
-- Prod's origin stamp (stamp_error_log_origin), reduced to the part that matters here.
CREATE FUNCTION public.stamp_error_log_origin() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF current_user NOT IN ('anon', 'authenticated') THEN
    NEW.tags := jsonb_set(coalesce(NEW.tags, '{}'::jsonb), '{origin}', coalesce(NEW.tags->'origin', '"server"'), true);
  ELSE
    NEW.tags := jsonb_set(coalesce(NEW.tags, '{}'::jsonb), '{origin}', '"client"', true);
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER trg_error_logs_00_stamp_origin BEFORE INSERT ON public.error_logs
  FOR EACH ROW EXECUTE FUNCTION public.stamp_error_log_origin();
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
INSERT INTO public.profiles VALUES ('${REAL}', false), ('${REAL2}', false), ('${SEED}', true), ('${SPAMMER}', false);
-- History for the backfill: the owner-style occurrence 30h ago (client, real),
-- a seed one, and one 5 days ago (outside the window).
INSERT INTO public.error_logs (user_id, severity, message, tags, created_at) VALUES
 ('${REAL}', 'warning', 'Error screen shown: We couldn''t load your account.',
  '{"source":"ErrorState","screen":"/profile","title":"We couldn''t load your account.","origin":"client"}', now() - interval '30 hours'),
 ('${SEED}', 'warning', 'Error screen shown: We couldn''t load your account.',
  '{"source":"ErrorState","screen":"/profile","origin":"client"}', now() - interval '30 hours'),
 ('${REAL}', 'error', 'ancient crash', '{"source":"ErrorBoundary","screen":"/","origin":"client"}', now() - interval '5 days');
`);
const q = async (sql) => (await db.query(sql)).rows;

for (const f of CHAIN) {
  try {
    await db.exec(mig(f));
  } catch (e) {
    check(`chain ${f}`, false, e.message);
  }
}
for (let i = 1; i <= 3; i++) {
  try {
    await db.exec(MIGRATION);
    check(`apply pass #${i}`, true);
  } catch (e) {
    check(`apply pass #${i}`, false, e.message);
  }
}

const items = (extra = "") =>
  q(`SELECT id, title, count::int n, status, verify_kind, verify_ref, sample_ref, first_seen, last_seen
       FROM public.ops_alert_ledger WHERE source_kind = 'user-error-screen' ${extra} ORDER BY first_seen`);

// ── backfill ────────────────────────────────────────────────────────────────
let it = await items();
check("backfill: the real 30h-old /profile screen became ONE item (seed and 5-day-old rows did not), once across 3 applies",
  it.length === 1 && it[0].n === 1 && it[0].title.startsWith("/profile · error screen shown"), JSON.stringify(it.map((r) => [r.title, r.n])));
check("backfilled item verifies by sql_condition 'user-error-screen'",
  it[0]?.verify_kind === "sql_condition" && it[0]?.verify_ref === "user-error-screen", JSON.stringify(it[0]));
let [{ v }] = await q(`SELECT public.ops_alert_verify() v`);
it = await items();
check("close rule: last real occurrence 30h ago -> ops_alert_verify closes it", it[0]?.status === "closed", JSON.stringify({ v, s: it[0]?.status }));

const ins = (uid, tags, msg = "Error screen shown: We couldn't load this.") =>
  db.query(`INSERT INTO public.error_logs (user_id, severity, message, tags) VALUES ($1, 'warning', $2, $3::jsonb)`,
    [uid, msg, JSON.stringify(tags)]);

// ── real user -> item; new occurrence re-opens the closed one ──────────────
await ins(REAL, { source: "ErrorState", kind: "user-error-screen", screen: "/profile", origin: "client" },
  "Error screen shown: We couldn't load your account.");
it = await items();
check("real user: a new occurrence of the closed screen RE-OPENS it (count 2), no second item",
  it.length === 1 && it[0].status === "open" && it[0].n === 2, JSON.stringify(it.map((r) => [r.title, r.n, r.status])));

await ins(REAL, { source: "RouteErrorBoundary", kind: "user-error-screen", screen: `/user/${REAL2}`, origin: "client" }, "boom 1");
await ins(REAL2, { source: "RouteErrorBoundary", kind: "user-error-screen", screen: `/user/${REAL}`, origin: "client" }, "boom 2");
it = await items(`AND title LIKE '/user/%'`);
check("fingerprint = screen + message with ids/numbers stripped: two people, two uuids, one item",
  it.length === 1 && it[0].n === 2 && it[0].title === "/user/<id> · boom #", JSON.stringify(it.map((r) => [r.title, r.n])));

// ── seed / non-surface / server rows -> nothing ─────────────────────────────
const before = (await items()).length;
await ins(SEED, { source: "ErrorState", kind: "user-error-screen", screen: "/home", origin: "client" }, "seed screen");
await ins(REAL, { source: "ErrorState", kind: "user-error-screen", screen: "/home", seed: "true", origin: "client" }, "seed-tagged");
await ins(REAL, { source: "QueryCache", screen: "/home", origin: "client" }, "a failed request, not a screen");
await db.query(`INSERT INTO public.error_logs (severity, message, tags) VALUES ('error', 'server row', '{"source":"ErrorState","kind":"user-error-screen","screen":"/x"}')`);
check("seed user, seed-tagged row, non-surface client row, server row -> no new item",
  (await items()).length === before, `before=${before} after=${(await items()).length}`);

// ── unknown user is real ─────────────────────────────────────────────────────
await ins(null, { source: "ErrorBoundary", kind: "user-error-screen", screen: "/", origin: "client" }, "guest crash");
await ins(NOPROFILE, { source: "SectionBoundary", kind: "user-error-screen", screen: "/activity", origin: "client" }, "no profile crash");
// Old bundle (no kind tag) still counts.
await ins(REAL2, { source: "ErrorState", screen: "/messages", origin: "client" }, "Error screen shown: Couldn't load this conversation.");
// A surface that exists only with the kind tag (no legacy source name) counts;
// the same source without the tag does not.
await ins(REAL2, { source: "ChatTimeline", kind: "user-error-screen", screen: "/messages/thread", origin: "client" }, "Error screen shown: thread");
await ins(REAL2, { source: "ChatTimeline", screen: "/messages/untagged", origin: "client" }, "Error screen shown: untagged");
const t = (await items()).map((r) => r.title);
check("kind tag alone makes a row count (ChatTimeline)", t.includes("/messages/thread · error screen shown: thread"), JSON.stringify(t));
check("an untagged non-surface source does not", !t.some((x) => x.includes("untagged")), JSON.stringify(t));
check("guest (NULL user) -> item", t.includes("/ · guest crash"), JSON.stringify(t));
check("user with no profile row -> item", t.includes("/activity · no profile crash"), JSON.stringify(t));
check("old bundle row (source ErrorState, no kind) -> item", t.some((x) => x.startsWith("/messages ·")), JSON.stringify(t));

// ── flood: one screen 200x -> one item ──────────────────────────────────────
await db.exec(`INSERT INTO public.error_logs (user_id, severity, message, tags)
  SELECT '${REAL}', 'warning', 'Error screen shown: We couldn''t load jobs.',
         '{"source":"ErrorState","kind":"user-error-screen","screen":"/browse","origin":"client"}'::jsonb
    FROM generate_series(1, 200)`);
it = await items(`AND title LIKE '/browse%'`);
check("flood: one broken screen hit 200x is ONE item with count 200", it.length === 1 && it[0].n === 200, JSON.stringify(it.map((r) => [r.title, r.n])));

// ── one person, many different screens -> capped + overflow (2026-09-23) ──
// One row per statement, as a person moving screen to screen produces them (2026-09-23).
// (A single client flush that carries > 5 distinct screens goes to overflow
// whole: AFTER ROW triggers see the entire statement. Still an open alert.)
for (let g = 1; g <= 30; g++) {
  await ins(SPAMMER, { source: "ErrorState", kind: "user-error-screen", screen: `/spam${g}x`, origin: "client" }, `forged ${g}`);
}
let spam = await items(`AND title LIKE '/spam%'`);
let over = await items(`AND (sample_ref->>'overflow')::boolean`);
check("one person, 30 different screens in an hour -> at most 5 items of theirs", spam.length > 0 && spam.length <= 5, `items=${spam.length}`);
check("... and the rest land on ONE overflow item (still an open alert)", over.length === 1 && over[0].n >= 25 && over[0].status === "open",
  JSON.stringify(over.map((r) => [r.title, r.n])));

// ── many guests, many screens -> global cap ─────────────────────────────────
await db.exec(`INSERT INTO public.error_logs (user_id, severity, message, tags)
  SELECT NULL, 'warning', 'guest ' || g,
         jsonb_build_object('source','ErrorBoundary','kind','user-error-screen','screen','/g' || chr(97 + g % 26) || chr(97 + g / 26),'origin','client')
    FROM generate_series(1, 40) g`);
const lastHourNew = await q(`SELECT count(*)::int n FROM public.ops_alert_ledger WHERE source_kind='user-error-screen'
  AND first_seen > now() - interval '1 hour' AND NOT coalesce((sample_ref->>'overflow')::boolean, false)`);
over = await items(`AND (sample_ref->>'overflow')::boolean`);
check("global cap: no more than 20 new items opened in the hour", lastHourNew[0].n <= 20, JSON.stringify(lastHourNew));
check("global cap overflow still ONE item", over.length === 1, JSON.stringify(over.map((r) => [r.title, r.n])));

// ── anon inserts: trigger records via definer; anon cannot call anything ───
await db.exec(`SET ROLE anon`);
let anonErr = null;
try {
  await ins(null, { source: "ErrorBoundary", kind: "user-error-screen", screen: "/brand-new", origin: "server" }, "anon crash");
} catch (e) {
  anonErr = e.message;
}
await db.exec(`RESET ROLE`);
const anonRow = (await q(`SELECT id FROM public.error_logs WHERE message = 'anon crash'`))[0]?.id;
check("an anon insert still succeeds (the ledger never blocks error logging)", anonErr === null, anonErr ?? "");
// anon's claimed origin 'server' is overwritten to 'client' by the stamp; the item exists
// only because the definer path ran — but the global cap is full, so it lands on overflow.
over = await items(`AND (sample_ref->>'overflow')::boolean`);
check("anon's row reached the ledger through the trigger (overflow, since the global cap is full)",
  over.length === 1 && over[0].sample_ref.error_log_id === anonRow, JSON.stringify(over[0]?.sample_ref));
for (const role of ["anon", "authenticated"]) {
  for (const fn of [
    "public.is_user_error_screen_row(jsonb)",
    "public.user_error_screen_is_real(uuid, jsonb)",
    "public.user_error_screen_title(text, text)",
    "public.ops_alert_record_user_error_screen(uuid, uuid, text, jsonb, timestamptz)",
    "public.ops_alert_ledger_from_user_error_screen()",
    "public.ops_alert_condition(text, jsonb, timestamptz, boolean)",
  ]) {
    const [{ ok }] = await q(`SELECT has_function_privilege('${role}', '${fn}', 'EXECUTE') ok`);
    check(`${role} cannot execute ${fn}`, ok === false);
  }
  const [{ ok }] = await q(`SELECT has_table_privilege('${role}', 'public.ops_alert_ledger', 'INSERT') OR has_table_privilege('${role}', 'public.ops_alert_ledger', 'UPDATE') ok`);
  check(`${role} cannot INSERT/UPDATE ops_alert_ledger`, ok === false);
}

// ── close rule: 24h ──────────────────────────────────────────────────────────
const prof = (await items(`AND title LIKE '/profile%'`))[0];
const cond = async (ref) => (await db.query(`SELECT public.ops_alert_condition('user-error-screen', $1::jsonb, now(), false) c`, [JSON.stringify(ref)])).rows[0].c;
let c = await cond(prof.sample_ref);
check("condition TRUE while a real person saw it < 24h ago", c === true);
await db.exec(`UPDATE public.error_logs SET created_at = now() - interval '25 hours'
  WHERE tags->>'screen' = '/profile' AND user_id = '${REAL}'`);
c = await cond(prof.sample_ref);
check("condition FALSE once its newest real row is > 24h old", c === false);
// A SEED user still hitting it does not keep it open.
await ins(SEED, { source: "ErrorState", kind: "user-error-screen", screen: "/profile", origin: "client" },
  "Error screen shown: We couldn't load your account.");
c = await cond(prof.sample_ref);
check("a SEED user's fresh row does not keep it open", c === false);
await q(`SELECT public.ops_alert_verify()`);
const closed = (await items(`AND title LIKE '/profile%'`))[0];
check("ops_alert_verify closes it with evidence", closed.status === "closed", JSON.stringify(closed.status));
const other = (await items(`AND title LIKE '/browse%'`))[0];
check("... while a screen seen < 24h ago stays open", other.status === "open", other.status);
const [{ p }] = await q(`SELECT public.ops_alert_condition('user-error-screen', '{}'::jsonb, now(), true) p`);
const [{ u }] = await q(`SELECT public.ops_alert_condition('push-tokens-empty', '{}'::jsonb, now(), true) u`);
check("probe true; the verbatim body kept its other branches", p === true && u === true);

console.log(failures ? `\n${failures} FAILED` : "\nALL PASS");
process.exit(failures ? 1 : 0);
