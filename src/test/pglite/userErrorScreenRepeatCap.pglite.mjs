#!/usr/bin/env node
/**
 * PGlite proof for 20260923092838_user_error_screen_repeat_cap_and_client_seed_tag
 * (docs/OPEN.md Q96, Q97) and 20260923094457_error_logs_client_identity_and_throttle
 * (Q106, Q98).
 *
 *   node src/test/pglite/userErrorScreenRepeatCap.pglite.mjs
 *   NEW_MIGRATION=skip node src/test/pglite/userErrorScreenRepeatCap.pglite.mjs       # RED: neither fix
 *   NEW_MIGRATION=skip-q106 node src/test/pglite/userErrorScreenRepeatCap.pglite.mjs  # RED: Q96/Q97 only
 *
 * pglite is not a dependency (CLAUDE.md): it is loaded from ~/.lh-pglite
 * (override with PGLITE_DIR). The fixture schema is the Q39 proof's
 * (userErrorScreenLedger.pglite.mjs).
 *
 * Applies the ledger chain + 20260923085642 (Q39), then the new migration 3x
 * (replay-safe), and proves:
 *   Q96 - one account hitting a KNOWN screen 30x in an hour bumps the item at
 *         most 5 times; every row is still in error_logs; a second account
 *         still bumps it (per account); varying an id in the screen does not
 *         evade it; guests share 20; the close rule still says "failing" while
 *         the capped account keeps hitting it; an hour later it bumps again.
 *   Q97 - a real (non-seed) account's client row tagged seed:"true" or with a
 *         '-seed' source is NOT hidden; a seed profile still is; server rows
 *         keep the tag (error_log_is_seed true).
 *   Q106 - an AUTHENTICATED insert with user_id NULL (or someone else's id) is
 *         stamped with the caller's auth.uid(), so its repeats are capped at 5
 *         (the account cap), not 20 (the guest cap), and spend no guest budget.
 *   Q98  - (fixture sizes, 2026-09-23) a client account's 70 inserts in a minute store 60 (one by one AND
 *         in one batch INSERT); guests together store 120; a back-dated
 *         created_at is re-stamped; server rows are never throttled.
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
const Q96 = "20260923092838_user_error_screen_repeat_cap_and_client_seed_tag.sql";
const Q106 = "20260923094457_error_logs_client_identity_and_throttle.sql";

let failures = 0;
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
  if (!ok) failures++;
};

const REAL = "aaaaaaaa-0000-0000-0000-000000000001";
const REAL2 = "aaaaaaaa-0000-0000-0000-000000000002";
const SEED = "bbbbbbbb-0000-0000-0000-000000000003";
const THR1 = "dddddddd-0000-0000-0000-000000000004";
const THR2 = "dddddddd-0000-0000-0000-000000000005";
const THR3 = "dddddddd-0000-0000-0000-000000000006";

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
CREATE INDEX idx_error_logs_user ON public.error_logs USING btree (user_id, created_at DESC);
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
INSERT INTO public.profiles VALUES ('${REAL}', false), ('${REAL2}', false), ('${SEED}', true),
  ('${THR1}', false), ('${THR2}', false), ('${THR3}', false);
`);
const q = async (sql, p) => (await db.query(sql, p)).rows;

for (const f of CHAIN) {
  try {
    await db.exec(mig(f));
  } catch (e) {
    check(`chain ${f}`, false, e.message);
  }
}
const MODE = process.env.NEW_MIGRATION ?? "";
const NEWS = MODE === "skip" ? [] : MODE === "skip-q106" ? [Q96] : [Q96, Q106];
if (MODE) console.log(`NEW_MIGRATION=${MODE}: running against a partly UNFIXED chain (expect FAILs)`);
for (const f of NEWS) {
  for (let i = 1; i <= 3; i++) {
    try {
      await db.exec(mig(f));
      check(`apply ${f.slice(0, 14)} pass #${i}`, true);
    } catch (e) {
      check(`apply ${f.slice(0, 14)} pass #${i}`, false, e.message);
    }
  }
}

// A client insert, as PostgREST makes it: a signed-in session is role
// `authenticated` with its JWT sub; a guest is role `anon` with none. `claim`
// is the user_id the request body carries (default: the caller's own id).
const asClient = async (sub, fn) => {
  await db.exec(`SET ROLE ${sub ? "authenticated" : "anon"}`);
  await db.query(`SELECT set_config('request.jwt.claim.sub', $1, false)`, [sub ?? ""]);
  try {
    return await fn();
  } finally {
    await db.exec(`RESET ROLE`);
    await db.query(`SELECT set_config('request.jwt.claim.sub', '', false)`);
  }
};
const ins = async (uid, tags, msg, claim = uid) =>
  asClient(uid, () =>
    db.query(`INSERT INTO public.error_logs (user_id, severity, message, tags) VALUES ($1, 'warning', $2, $3::jsonb)`,
      [claim, msg, JSON.stringify(tags)]));
const item = async (like) =>
  (await q(`SELECT id, count::int n, status, sample_ref FROM public.ops_alert_ledger
             WHERE source_kind = 'user-error-screen' AND title LIKE $1 AND NOT coalesce((sample_ref->>'overflow')::boolean, false)`, [like]))[0];
const rows = async (screenLike, uid) =>
  (await q(`SELECT count(*)::int n FROM public.error_logs
             WHERE tags->>'screen' LIKE $1 AND user_id IS NOT DISTINCT FROM $2::uuid`, [screenLike, uid]))[0].n;
const tag = (screen, extra = {}) => ({ source: "ErrorState", kind: "user-error-screen", screen, ...extra });
const cond = async (ref) =>
  (await q(`SELECT public.ops_alert_condition('user-error-screen', $1::jsonb, now(), false) c`, [JSON.stringify(ref)]))[0].c;

// ── Q96: repeats capped per account per fingerprint per hour ────────────────
for (let i = 0; i < 30; i++) await ins(REAL, tag("/loop"), "Error screen shown: looped");
let it = await item("/loop%");
check("Q96: one account, one screen, 30 hits in an hour -> ledger bumped at most 5 times", it?.n === 5, `count=${it?.n}`);
check("Q96: ... and all 30 rows are still stored in error_logs", (await rows("/loop", REAL)) === 30);
check("Q96: the item is open", it?.status === "open", it?.status);

await ins(REAL2, tag("/loop"), "Error screen shown: looped");
it = await item("/loop%");
check("Q96: a SECOND account hitting the same screen still bumps it (the cap is per account)", it?.n === 6, `count=${it?.n}`);

await db.exec(`UPDATE public.error_logs SET created_at = now() - interval '30 minutes' WHERE tags->>'screen' = '/loop'`);
await ins(REAL, tag("/loop"), "Error screen shown: looped");
check("Q96: the close rule still says FAILING while the capped account keeps hitting it", (await cond(it.sample_ref)) === true);
check("Q96: ... that capped hit did not bump", (await item("/loop%"))?.n === 6, `count=${(await item("/loop%"))?.n}`);

await db.exec(`UPDATE public.error_logs SET created_at = now() - interval '2 hours' WHERE tags->>'screen' = '/loop'`);
await ins(REAL, tag("/loop"), "Error screen shown: looped");
check("Q96: an hour later the same account bumps it again (a window, not a ban)", (await item("/loop%"))?.n === 7,
  `count=${(await item("/loop%"))?.n}`);

for (let i = 0; i < 12; i++) {
  await ins(REAL2, tag(`/user/cccccccc-0000-0000-0000-${String(i).padStart(12, "0")}`), "Error screen shown: profile");
}
it = await item("/user/<id>%");
check("Q96: varying the id in the screen is the same fingerprint, still capped at 5", it?.n === 5, `count=${it?.n}`);

for (let i = 0; i < 40; i++) await ins(null, tag("/guest", { source: "ErrorBoundary" }), "guest crash");
it = await item("/guest%");
check("Q96: guests (no account) share ONE budget of 20 per screen per hour", it?.n === 20, `count=${it?.n}`);
check("Q96: ... all 40 guest rows stored", (await rows("/guest", null)) === 40);

// ── Q97: a client's seed tag is not trusted ─────────────────────────────────
await ins(REAL, tag("/tagged", { seed: "true" }), "Error screen shown: tagged");
check("Q97: a real account's client row tagged seed:'true' still reaches the ledger", !!(await item("/tagged%")));
await ins(REAL, tag("/suffix", { source: "ErrorState-seed" }), "Error screen shown: suffix");
check("Q97: a real account's client row with a '-seed' source still reaches the ledger", !!(await item("/suffix%")));
await ins(null, tag("/guesttag", { seed: "true" }), "Error screen shown: guest tagged");
check("Q97: a guest's seed-tagged row is real (no profile says otherwise)", !!(await item("/guesttag%")));
await ins(SEED, tag("/seedprofile"), "Error screen shown: seed profile");
check("Q97: a seed PROFILE is still excluded (seed comes from profiles.is_seed)", !(await item("/seedprofile%")));
const [{ s1, s2, c1 }] = await q(`SELECT public.error_log_is_seed('{"seed":"true","origin":"server"}') s1,
  public.error_log_is_seed('{"source":"detect_stuck_payments-seed"}') s2,
  public.error_log_is_seed('{"seed":"true","origin":"client"}') c1`);
check("Q97: server rows keep the tag (seed:true / '-seed' source -> seed)", s1 === true && s2 === true, JSON.stringify({ s1, s2 }));
check("Q97: a client row's seed tag is ignored by error_log_is_seed", c1 === false, JSON.stringify({ c1 }));

// ── Q106: a signed-in client cannot log as a guest ──────────────────────────
for (let i = 0; i < 30; i++) await ins(THR3, tag("/q106"), "Error screen shown: q106", null);
check("Q106: an authenticated insert with user_id NULL is stored with the caller's id",
  (await rows("/q106", THR3)) === 30 && (await rows("/q106", null)) === 0,
  `mine=${await rows("/q106", THR3)} guest=${await rows("/q106", null)}`);
it = await item("/q106%");
check("Q106: ... so its repeats are capped at 5 (account cap), not 20 (guest cap)", it?.n === 5, `count=${it?.n}`);
check("Q106: ... and the ledger item is not marked as a guest's", it?.sample_ref?.signed_in === true, JSON.stringify(it?.sample_ref));
await ins(THR3, tag("/q106b"), "Error screen shown: q106b", REAL);
check("Q106: an authenticated insert claiming ANOTHER account's id is stamped with the caller's",
  (await rows("/q106b", THR3)) === 1 && (await rows("/q106b", REAL)) === 0);
await ins(null, tag("/q106c"), "Error screen shown: q106c");
check("Q106: a guest (anon) insert is still stored as a guest row", (await rows("/q106c", null)) === 1);

// ── Q98: client rows are throttled per minute; server rows are not ──────────
const clientRows = async (uid) =>
  (await q(`SELECT count(*)::int n FROM public.error_logs WHERE user_id IS NOT DISTINCT FROM $1::uuid
             AND tags->>'origin' = 'client' AND created_at > now() - interval '1 minute'`, [uid]))[0].n;
for (let i = 0; i < 70; i++) await ins(THR1, { source: "loop" }, `loop ${i}`);
check("Q98: one account's 70 client rows in a minute store only 60", (await clientRows(THR1)) === 60, `stored=${await clientRows(THR1)}`);

await asClient(THR2, () => db.query(`INSERT INTO public.error_logs (user_id, severity, message, tags)
  SELECT $1::uuid, 'warning', 'batch ' || g, '{"source":"batch"}'::jsonb FROM generate_series(1, 70) g`, [THR2]));
check("Q98: ... and a single 70-row batch INSERT stores only 60", (await clientRows(THR2)) === 60, `stored=${await clientRows(THR2)}`);

const guestBefore = await clientRows(null);
for (let i = 0; i < 130; i++) await ins(null, { source: "guest-loop" }, `guest ${i}`);
check("Q98: guests together store at most 120 client rows a minute", (await clientRows(null)) === 120,
  `before=${guestBefore} after=${await clientRows(null)}`);

await asClient(THR3, () => db.query(`INSERT INTO public.error_logs (user_id, message, tags, created_at)
  VALUES ($1, 'backdated', '{"source":"bd"}'::jsonb, '2000-01-01')`, [THR3]));
const [{ bd }] = await q(`SELECT (created_at > now() - interval '1 minute') bd FROM public.error_logs WHERE message = 'backdated'`);
check("Q98: a client cannot back-date created_at out of the window", bd === true);

for (let i = 0; i < 200; i++) {
  await db.query(`INSERT INTO public.error_logs (user_id, message, tags) VALUES ($1, 'server ' || $2, '{"source":"cron-http"}')`,
    [THR1, String(i)]);
  await db.query(`INSERT INTO public.error_logs (user_id, message, tags) VALUES (NULL, 'server ' || $1, '{"source":"cron-http"}')`,
    [String(i)]);
}
const [{ srv }] = await q(`SELECT count(*)::int srv FROM public.error_logs WHERE message LIKE 'server %' AND tags->>'origin' = 'server'`);
check("Q98: server rows are never throttled (400 of 400 stored, for a capped account and for NULL)", srv === 400, `stored=${srv}`);

// ── privileges ──────────────────────────────────────────────────────────────
for (const role of ["anon", "authenticated"]) {
  for (const fn of [
    "public.error_log_is_seed(jsonb)",
    "public.user_error_screen_is_real(uuid, jsonb)",
    "public.ops_alert_record_user_error_screen(uuid, uuid, text, jsonb, timestamptz)",
    ...(NEWS.includes(Q106) ? ["public.throttle_client_error_log()", "public.stamp_error_log_origin()"] : []),
  ]) {
    const [{ ok }] = await q(`SELECT has_function_privilege('${role}', '${fn}', 'EXECUTE') ok`);
    check(`${role} cannot execute ${fn}`, ok === false);
  }
}

console.log(failures ? `\n${failures} FAILED` : "\nALL PASS");
process.exit(failures ? 1 : 0);
