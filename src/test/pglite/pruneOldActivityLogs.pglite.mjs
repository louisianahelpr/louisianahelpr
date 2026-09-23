/**
 * PGlite proof for 20260923185658_prune_old_activity_logs (docs/OPEN.md Q224).
 *
 *   node src/test/pglite/pruneOldActivityLogs.pglite.mjs
 *
 * pglite is not a dependency (CLAUDE.md): it is loaded from ~/.lh-pglite
 * (override with PGLITE_DIR).
 *
 * OLD STATE, shown red: with no pruner, rows years old stay in all four
 * tables (nothing on the schedule touches them).
 *
 * AFTER: applies 3x (replay-safe); prune_old_activity_logs() deletes
 * job_views/profile_views past 90 days, notification_logs past 180 days and
 * login_history past 180 days EXCEPT each user's newest row; keeps everything
 * inside the windows; a second run deletes nothing (idempotent); the cron job,
 * its liveness expectation and its catch-up policy row exist exactly once, the
 * policy keeps every row it restated; anon/authenticated cannot execute it.
 */
import { readFileSync } from "node:fs";
import os from "node:os";

const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const MIGRATION = readFileSync(
  new URL("../../../supabase/migrations/20260923185658_prune_old_activity_logs.sql", import.meta.url).pathname,
  "utf8",
);

let failures = 0;
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
  if (!ok) failures++;
};

const U1 = "aaaaaaaa-0000-0000-0000-000000000001"; // active: recent + old logins
const U2 = "bbbbbbbb-0000-0000-0000-000000000002"; // dormant: only logins older than 180 days
const J = "cccccccc-0000-0000-0000-000000000003";

async function fresh() {
  const db = new PGlite();
  await db.exec(`
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated; END IF;
END $$;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO anon, authenticated;
CREATE TABLE public.job_views (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), job_id uuid NOT NULL,
  viewer_id uuid NOT NULL, first_viewed_at timestamptz NOT NULL DEFAULT now(), UNIQUE (job_id, viewer_id));
CREATE TABLE public.profile_views (id bigserial PRIMARY KEY, viewed_user_id uuid NOT NULL,
  viewer_user_id uuid NOT NULL, viewed_at timestamp NOT NULL DEFAULT LOCALTIMESTAMP);
CREATE TABLE public.notification_logs (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL,
  category text NOT NULL DEFAULT 'system', channel text NOT NULL DEFAULT 'email',
  created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE public.login_history (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL,
  ip_address text, created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE public.cron_catchup_policy (jobname text PRIMARY KEY, catch_up boolean NOT NULL,
  max_late interval NOT NULL, reason text NOT NULL, updated_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE public.cron_work_expectations (jobname text PRIMARY KEY, candidate_key text,
  disposition_keys text[] DEFAULT ARRAY[]::text[], min_streak int NOT NULL DEFAULT 2,
  note text NOT NULL DEFAULT '', expected_max_gap interval, registered_at timestamptz NOT NULL DEFAULT now());
CREATE SCHEMA cron;
CREATE TABLE cron.job (jobid bigserial, jobname text UNIQUE, schedule text, command text);
CREATE FUNCTION cron.schedule(p_name text, p_sched text, p_cmd text) RETURNS bigint LANGUAGE sql AS $$
  INSERT INTO cron.job (jobname, schedule, command) VALUES (p_name, p_sched, p_cmd)
  ON CONFLICT (jobname) DO UPDATE SET schedule = EXCLUDED.schedule, command = EXCLUDED.command
  RETURNING jobid $$;

INSERT INTO public.job_views (job_id, viewer_id, first_viewed_at) VALUES
  ('${J}', '${U1}', now() - interval '400 days'),
  (gen_random_uuid(), '${U1}', now() - interval '91 days'),
  (gen_random_uuid(), '${U1}', now() - interval '89 days'),
  (gen_random_uuid(), '${U2}', now() - interval '1 day');
INSERT INTO public.profile_views (viewed_user_id, viewer_user_id, viewed_at) VALUES
  ('${U1}', '${U2}', LOCALTIMESTAMP - interval '91 days'),
  ('${U1}', '${U2}', LOCALTIMESTAMP - interval '29 days'),
  ('${U1}', '${U2}', LOCALTIMESTAMP - interval '1 hour');
INSERT INTO public.notification_logs (user_id, created_at) VALUES
  ('${U1}', now() - interval '365 days'), ('${U1}', now() - interval '181 days'),
  ('${U1}', now() - interval '179 days'), ('${U1}', now() - interval '1 day');
INSERT INTO public.login_history (user_id, ip_address, created_at) VALUES
  ('${U1}', 'old-1', now() - interval '300 days'), ('${U1}', 'old-2', now() - interval '200 days'),
  ('${U1}', 'recent', now() - interval '10 days'),
  ('${U2}', 'dormant-old', now() - interval '400 days'), ('${U2}', 'dormant-newest', now() - interval '250 days');
`);
  return db;
}
const rows = async (db, sql) => (await db.query(sql)).rows;
const n = async (db, sql) => Number(Object.values((await rows(db, sql))[0])[0]);
const counts = async (db) => ({
  job_views: await n(db, "SELECT count(*) FROM public.job_views"),
  profile_views: await n(db, "SELECT count(*) FROM public.profile_views"),
  notification_logs: await n(db, "SELECT count(*) FROM public.notification_logs"),
  login_history: await n(db, "SELECT count(*) FROM public.login_history"),
});

// ── OLD STATE: nothing prunes ──────────────────────────────────────────────
{
  const db = await fresh();
  const before = await counts(db);
  const pruner = await n(db, "SELECT count(*) FROM pg_proc WHERE proname = 'prune_old_activity_logs'");
  const oldest = await n(db, "SELECT count(*) FROM public.login_history WHERE created_at < now() - interval '180 days'");
  console.log(`OLD STATE: rows=${JSON.stringify(before)}, pruner functions=${pruner}, login rows older than 180d=${oldest}`);
  check("old state is red: no pruner exists and 400-day-old rows stay", pruner === 0 && oldest === 4);
}

// ── AFTER ──────────────────────────────────────────────────────────────────
{
  const db = await fresh();
  for (let i = 1; i <= 3; i++) {
    try {
      await db.exec(MIGRATION);
      check(`apply pass #${i}`, true);
    } catch (e) {
      check(`apply pass #${i}`, false, e.message);
    }
  }
  const before = await counts(db);
  const result = (await rows(db, "SELECT public.prune_old_activity_logs() AS r"))[0].r;
  const after = await counts(db);
  console.log(`BEFORE ${JSON.stringify(before)}  RESULT ${JSON.stringify(result)}  AFTER ${JSON.stringify(after)}`);
  check("job_views: the 400d and 91d rows go, 89d and 1d stay", after.job_views === 2 && result.job_views === 2);
  check("profile_views: the 91d row goes, 29d (inside the 30d reader) and 1h stay", after.profile_views === 2 && result.profile_views === 1);
  check("notification_logs: 365d and 181d go, 179d and 1d stay", after.notification_logs === 2 && result.notification_logs === 2);
  check("login_history: 3 old rows go", result.login_history === 3 && after.login_history === 2);
  const logins = (await rows(db, "SELECT user_id, ip_address FROM public.login_history ORDER BY ip_address")).map((r) => r.ip_address);
  check("login_history: the active user keeps the recent row, the dormant user keeps ONLY their newest row",
    JSON.stringify(logins) === JSON.stringify(["dormant-newest", "recent"]), JSON.stringify(logins));
  const again = (await rows(db, "SELECT public.prune_old_activity_logs() AS r"))[0].r;
  check("second run deletes nothing (idempotent, so catch-up-safe)",
    Object.values(again).every((v) => v === 0), JSON.stringify(again));

  const jobs = await rows(db, "SELECT schedule, command FROM cron.job WHERE jobname = 'prune-old-activity-logs'");
  check("cron job registered exactly once, daily", jobs.length === 1 && jobs[0].schedule === "45 4 * * *" &&
    jobs[0].command === "SELECT public.prune_old_activity_logs();", JSON.stringify(jobs));
  const exp = await rows(db, "SELECT expected_max_gap::text AS g FROM public.cron_work_expectations WHERE jobname = 'prune-old-activity-logs'");
  check("liveness expectation registered (30h)", exp.length === 1 && exp[0].g === "30:00:00", JSON.stringify(exp));
  const pol = await rows(db, "SELECT catch_up FROM public.cron_catchup_policy WHERE jobname = 'prune-old-activity-logs'");
  check("catch-up policy row: catch_up = true", pol.length === 1 && pol[0].catch_up === true);
  const total = await n(db, "SELECT count(*) FROM public.cron_catchup_policy");
  const never = await rows(db, "SELECT catch_up FROM public.cron_catchup_policy WHERE jobname = 'charge-recurring-visits'");
  check("the restated policy keeps every earlier row (26 total) and money stays never-rerun",
    total === 26 && never[0]?.catch_up === false, `${total}`);

  const g = (await rows(db, `SELECT has_function_privilege('anon', 'public.prune_old_activity_logs()', 'EXECUTE') AS a,
                                    has_function_privilege('authenticated', 'public.prune_old_activity_logs()', 'EXECUTE') AS b`))[0];
  check("anon/authenticated cannot execute the pruner", g.a === false && g.b === false, JSON.stringify(g));
}

console.log(failures ? `\n${failures} FAILED` : "\nALL PASS");
process.exit(failures ? 1 : 0);
