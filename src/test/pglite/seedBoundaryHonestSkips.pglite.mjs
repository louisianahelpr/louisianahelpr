#!/usr/bin/env node
/**
 * PGlite proof for 20260923130621_seed_boundary_honest_skips_and_monitor
 * (docs/OPEN.md Q157 + Q160, review of Q137).
 *
 *   node src/test/pglite/seedBoundaryHonestSkips.pglite.mjs
 *   NEW_MIGRATION=skip node src/test/pglite/seedBoundaryHonestSkips.pglite.mjs   # RED: the Q137 state only
 *
 * pglite is not a dependency (CLAUDE.md): it is loaded from ~/.lh-pglite
 * (override with PGLITE_DIR).
 *
 * Fixture: the Q137 migration (20260923121354) applied verbatim over the live
 * shapes it touches (read from prod 2026-09-23 ~13:10Z): has_role and
 * notification_job_id_from_link are the live bodies; user_roles, error_logs,
 * notification_logs, notifications, jobs, profiles are the live columns used.
 * Stubs: notifications_fill_job_id (the live trigger's effect: job_id from the
 * link when absent), auth.uid() (reads request.jwt.claim.sub), cron.schedule
 * (records its calls). The new migration is then applied THREE times.
 *
 * Proves:
 *   Q157  the admin question answers exactly what the trigger does, for every
 *         (recipient, job) shape; non-admins and a NULL caller are refused;
 *         EXECUTE is granted to authenticated and not to anon / PUBLIC.
 *   Q160  a deliberate suppression is NOT an alert; a check that ERRORED (the
 *         trigger's fail-closed drop, and the email path's prefix) raises one
 *         error_logs row with source 'seed-boundary-check-failed', deduped
 *         until a newer failure; ops_alert_condition says "still failing"
 *         while such a row is < 24h old and "cleared" after; the hourly cron
 *         and its liveness expectation exist.
 */
import { readFileSync } from "node:fs";
import os from "node:os";

const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const mig = (f) => readFileSync(new URL(`../../../supabase/migrations/${f}`, import.meta.url).pathname, "utf8");
const Q137 = mig("20260923121354_seed_subject_never_notifies_real.sql");
const NEW = mig("20260923130621_seed_boundary_honest_skips_and_monitor.sql");
const MODE = process.env.NEW_MIGRATION ?? "";
if (MODE) console.log(`NEW_MIGRATION=${MODE}: running against the Q137-only state (expect FAILs)`);

let failures = 0;
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
  if (!ok) failures++;
};

const U = (n) => `22222222-0000-0000-0000-0000000000${String(n).padStart(2, "0")}`;
const ADMIN = U(1);
const MEMBER = U(2); // real, not an admin
const REAL = U(3); // real poster
const SEED = U(4); // seed account
const SEED_JOB = "33333333-0000-0000-0000-000000000001";
const REAL_JOB = "33333333-0000-0000-0000-000000000002";

const db = new PGlite();
await db.exec(`
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role; END IF;
END $$;
CREATE SCHEMA auth;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS
  $$ SELECT NULLIF(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
CREATE SCHEMA cron;
CREATE TABLE cron.calls (jobname text, schedule text, command text);
CREATE FUNCTION cron.schedule(jobname text, schedule text, command text) RETURNS bigint LANGUAGE sql AS
  $$ INSERT INTO cron.calls VALUES (jobname, schedule, command); SELECT 1::bigint $$;

CREATE TYPE public.app_role AS ENUM ('admin', 'moderator', 'user');
CREATE TABLE public.user_roles (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid, role public.app_role);
CREATE FUNCTION public.has_role(_user_id uuid, _role public.app_role) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER
  SET search_path TO 'public' AS $f$
  SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = _role)
$f$;
CREATE FUNCTION public.notification_job_id_from_link(p_link text) RETURNS uuid LANGUAGE sql IMMUTABLE PARALLEL SAFE
  SET search_path TO 'public', 'pg_temp' AS $f$
  SELECT NULLIF(COALESCE(
    (regexp_match(p_link, '[?&]job=([0-9a-fA-F-]{36})'))[1],
    (regexp_match(p_link, '[?&]jobId=([0-9a-fA-F-]{36})'))[1],
    (regexp_match(p_link, '[?&]quickApply=([0-9a-fA-F-]{36})'))[1],
    (regexp_match(p_link, '^/jobs/([0-9a-fA-F-]{36})'))[1]), '')::uuid
$f$;
CREATE TABLE public.profiles (user_id uuid PRIMARY KEY, is_seed boolean DEFAULT false);
CREATE TABLE public.jobs (id uuid PRIMARY KEY, customer_id uuid, is_seed boolean DEFAULT false);
CREATE TABLE public.notifications (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL, title text NOT NULL,
  message text NOT NULL, type text NOT NULL DEFAULT 'info', read boolean DEFAULT false, link text,
  created_at timestamptz NOT NULL DEFAULT now(), job_id uuid);
CREATE FUNCTION public.notifications_fill_job_id() RETURNS trigger LANGUAGE plpgsql AS $f$
BEGIN NEW.job_id := COALESCE(NEW.job_id, public.notification_job_id_from_link(NEW.link)); RETURN NEW; END $f$;
CREATE TRIGGER trg_notifications_fill_job_id BEFORE INSERT ON public.notifications
  FOR EACH ROW EXECUTE FUNCTION public.notifications_fill_job_id();
CREATE TABLE public.notification_logs (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL, recipient_email text,
  category text NOT NULL, channel text NOT NULL, status text NOT NULL, subject text, job_id uuid, error_message text,
  message_id text, created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE public.match_digest_queue (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL, job_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE public.error_logs (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid, severity text DEFAULT 'error',
  message text, stack text, url text, user_agent text, tags jsonb DEFAULT '{}'::jsonb, context jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz DEFAULT now());
CREATE TABLE public.cron_work_expectations (jobname text PRIMARY KEY, candidate_key text, disposition_keys text[],
  min_streak integer, note text, expected_max_gap interval, registered_at timestamptz DEFAULT now());

INSERT INTO public.profiles VALUES ('${ADMIN}', false), ('${MEMBER}', false), ('${REAL}', false), ('${SEED}', true);
INSERT INTO public.user_roles (user_id, role) VALUES ('${ADMIN}', 'admin');
INSERT INTO public.jobs VALUES ('${SEED_JOB}', '${REAL}', true), ('${REAL_JOB}', '${REAL}', false);
`);
await db.exec(Q137);

const q = async (sql, params = []) => (await db.query(sql, params)).rows;
const as = async (uid) => db.exec(`SELECT set_config('request.jwt.claim.sub', '${uid ?? ""}', false)`);

if (!MODE) {
  for (let i = 1; i <= 3; i++) {
    try {
      await db.exec(NEW);
      check(`new migration applies (pass ${i}/3)`, true);
    } catch (e) {
      check(`new migration applies (pass ${i}/3)`, false, e.message);
    }
  }
}
const has = async (name) => (await q(`SELECT to_regproc($1) IS NOT NULL AS x`, [`public.${name}`]))[0].x;

// ── Q157: the admin question equals the trigger's verdict ─────────────────
if (await has("admin_notification_crosses_seed_boundary")) {
  const cases = [
    { name: "seed job -> real poster", user: REAL, job: SEED_JOB, link: `/posts?job=${SEED_JOB}`, drop: true },
    { name: "seed job -> seed account", user: SEED, job: SEED_JOB, link: `/jobs?job=${SEED_JOB}`, drop: false },
    { name: "real job -> real poster", user: REAL, job: REAL_JOB, link: `/posts?job=${REAL_JOB}`, drop: false },
    { name: "seed job named only by the link", user: REAL, job: null, link: `/posts?job=${SEED_JOB}`, drop: true },
  ];
  await as(ADMIN);
  for (const c of cases) {
    const said = (await q(`SELECT public.admin_notification_crosses_seed_boundary($1, $2, $3) AS x`, [c.user, c.job, c.link]))[0].x;
    const before = (await q(`SELECT count(*)::int AS n FROM public.notifications`))[0].n;
    await q(`INSERT INTO public.notifications (user_id, job_id, title, message, link) VALUES ($1, $2, 't', 'm', $3)`, [c.user, c.job, c.link]);
    const landed = (await q(`SELECT count(*)::int AS n FROM public.notifications`))[0].n - before;
    check(`Q157 ${c.name}: admin question says ${c.drop}`, said === c.drop, `said ${said}`);
    check(`Q157 ${c.name}: the trigger agrees (row ${c.drop ? "dropped" : "kept"})`, landed === (c.drop ? 0 : 1), `landed ${landed}`);
  }
  for (const [who, uid] of [["a non-admin member", MEMBER], ["a NULL caller", null]]) {
    await as(uid);
    let code = null;
    try {
      await q(`SELECT public.admin_notification_crosses_seed_boundary($1, $2, $3)`, [REAL, SEED_JOB, null]);
    } catch (e) {
      code = e.code;
    }
    check(`Q157 ${who} is refused (42501)`, code === "42501", `code ${code}`);
  }
  await as(ADMIN);
  const acl = (await q(`SELECT proacl::text AS a FROM pg_proc WHERE proname = 'admin_notification_crosses_seed_boundary'`))[0].a ?? "";
  check("Q157 EXECUTE granted to authenticated", /authenticated=X/.test(acl), acl);
  check("Q157 no EXECUTE for anon or PUBLIC", !/(^|[{,])anon=X/.test(acl) && !/(^|[{,])=X/.test(acl), acl);
} else {
  check("Q157 admin_notification_crosses_seed_boundary exists", false, "absent");
}

// ── Q160: suppressed vs errored ───────────────────────────────────────────
if (await has("check_seed_boundary_failures")) {
  const errCount = async () =>
    (await q(`SELECT count(*)::int AS n FROM public.error_logs WHERE tags->>'source' = 'seed-boundary-check-failed'`))[0].n;
  const cond = async () =>
    (await q(`SELECT public.ops_alert_condition('seed-boundary-check-failed', '{}'::jsonb, now()) AS x`))[0].x;

  // The Q157 cases above wrote two deliberate suppressions.
  const suppressed = (await q(`SELECT count(*)::int AS n FROM public.notification_logs WHERE status = 'suppressed_seed'`))[0].n;
  check("Q160 fixture has deliberate suppressions", suppressed >= 2, `${suppressed}`);
  let r = (await q(`SELECT public.check_seed_boundary_failures() AS r`))[0].r;
  check("Q160 a deliberate suppression is not an alert", r.ok === true && (await errCount()) === 0, JSON.stringify(r));
  check("Q160 ledger condition: nothing failing", (await cond()) === false);

  // Make the boundary check itself raise: the trigger fails CLOSED and logs it.
  await db.exec(`ALTER FUNCTION public.notification_crosses_seed_boundary(uuid, uuid, text, uuid) RENAME TO ncsb_saved;
    CREATE FUNCTION public.notification_crosses_seed_boundary(a uuid, b uuid, c text, d uuid DEFAULT NULL) RETURNS boolean
      LANGUAGE plpgsql AS $f$ BEGIN RAISE EXCEPTION 'boom'; END $f$;`);
  await q(`INSERT INTO public.notifications (user_id, job_id, title, message, link) VALUES ($1, $2, 't', 'm', $3)`, [REAL, REAL_JOB, `/posts?job=${REAL_JOB}`]);
  const dropped = (await q(`SELECT count(*)::int AS n FROM public.notifications WHERE job_id = $1 AND title = 't' AND created_at > now() - interval '1 second'`, [REAL_JOB]))[0].n;
  const failRow = (await q(`SELECT error_message FROM public.notification_logs WHERE error_message LIKE 'seed boundary check failed%'`))[0];
  check("Q160 an errored check drops a REAL-to-REAL row (fail closed) and logs why", !!failRow, failRow?.error_message);
  void dropped;

  r = (await q(`SELECT public.check_seed_boundary_failures() AS r`))[0].r;
  check("Q160 an errored check raises one alert row", r.ok === false && (await errCount()) === 1, JSON.stringify(r));
  const e = (await q(`SELECT severity, tags FROM public.error_logs WHERE tags->>'source' = 'seed-boundary-check-failed'`))[0];
  check("Q160 alert row is severity error, source seed-boundary-check-failed", e?.severity === "error" && e?.tags?.area === "notifications", JSON.stringify(e));
  await q(`SELECT public.check_seed_boundary_failures()`);
  check("Q160 re-running with no NEW failure does not re-raise", (await errCount()) === 1);
  check("Q160 ledger condition: still failing", (await cond()) === true);
  check("Q160 ledger probe knows the source", (await q(`SELECT public.ops_alert_condition('seed-boundary-check-failed', '{}'::jsonb, now(), true) AS x`))[0].x === true);

  // The email path's prefix (send-notification-email logSkip) is the same class.
  await q(`INSERT INTO public.notification_logs (user_id, category, channel, status, error_message, created_at)
           VALUES ($1, 'system', 'email', 'failed', 'seed boundary check failed, not sent: PGRST202: missing', now() + interval '1 second')`, [REAL]);
  await q(`SELECT public.check_seed_boundary_failures()`);
  check("Q160 a newer failure (email path) re-raises", (await errCount()) === 2);

  // Restore the check; age the failures past 24h: the item can close.
  await db.exec(`DROP FUNCTION public.notification_crosses_seed_boundary(uuid, uuid, text, uuid);
    ALTER FUNCTION public.ncsb_saved(uuid, uuid, text, uuid) RENAME TO notification_crosses_seed_boundary;`);
  await q(`UPDATE public.notification_logs SET created_at = now() - interval '25 hours' WHERE error_message LIKE 'seed boundary check failed%'`);
  check("Q160 ledger condition: cleared once the failures stop", (await cond()) === false);
  r = (await q(`SELECT public.check_seed_boundary_failures() AS r`))[0].r;
  check("Q160 detector says ok once the failures stop", r.ok === true, JSON.stringify(r));

  const cronCalls = await q(`SELECT DISTINCT jobname, schedule, command FROM cron.calls WHERE jobname = 'seed-boundary-failures'`);
  check("Q160 hourly cron scheduled", cronCalls.length === 1 && cronCalls[0].schedule === "41 * * * *" && /check_seed_boundary_failures/.test(cronCalls[0].command), JSON.stringify(cronCalls));
  const exp = await q(`SELECT expected_max_gap::text AS g FROM public.cron_work_expectations WHERE jobname = 'seed-boundary-failures'`);
  check("Q160 cron liveness expectation registered", exp.length === 1, JSON.stringify(exp));
  const acl = (await q(`SELECT proacl::text AS a FROM pg_proc WHERE proname = 'check_seed_boundary_failures'`))[0].a ?? "";
  check("Q160 detector is service_role only", /service_role=X/.test(acl) && !/authenticated=X|anon=X|(^|[{,])=X/.test(acl), acl);
} else {
  check("Q160 check_seed_boundary_failures exists", false, "absent");
}

console.log(failures ? `\n${failures} FAILED` : "\nALL PASS");
process.exit(failures ? 1 : 0);
