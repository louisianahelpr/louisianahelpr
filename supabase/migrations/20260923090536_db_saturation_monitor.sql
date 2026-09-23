-- Q53: see the database tipping over BEFORE it falls over, and stop one of
-- our own sweeps from costing 2.5 s every hour.
--
-- ── WHAT WAS MEASURED (prod, 2026-09-23 ~09:00Z) ──────────────────────────
-- 2026-09-22 08:00-15:00Z: 19-42 "canceling statement due to statement
--   timeout" per hour in postgres_logs (hourly counts from the logs API:
--   19, 42, 33, 39, 39, 34, 9), on catalog reads as trivial as
--   pg_timezone_names; a restart at 15:23:42Z ended it. ZERO statement
--   timeouts in postgres_logs from 16:00Z to 09:10Z the next day.
-- Since the restart (17.5 h): 2,031,130 statements (32 calls/s), 3,200 s of
--   execution (~51 ms of DB time per wall second). 51 of max_connections=60
--   are client backends, nearly all IDLE pools (PostgREST 20, Storage 14,
--   pgbouncer 8); 0 idle-in-transaction. Calls-weighted p95 of the per-
--   statement mean for authenticated/anon/service_role: 10.4 ms (p99 15.2).
-- Nothing in the database watched any of that. The outage was noticed by
--   uptime ("database: no answer") and 457 pg_cron "job startup timeout"s —
--   i.e. after it had already tipped over.
--
-- ── WHAT THIS ADDS ────────────────────────────────────────────────────────
-- 1. public.db_saturation_thresholds() — the numbers, in ONE place (the
--    scoreboard and the tests read the same ones). Each is set well below the
--    09-22 level or at a multiple of today's measured baseline:
--      conn_pct              90   client backends / max_connections (today 85)
--      active_conns          15   non-idle client backends (today 0-1)
--      longest_active_s     120   one statement running 2 min (authenticated
--                                 statement_timeout is 8 s; pg_dump excluded)
--      idle_in_xact           1   any session idle in a transaction > 5 min
--      exec_ms_per_s       1000   a full CPU-second of SQL per wall second,
--                                 over the 5-min window (today ~51)
--      p95_ms               100   calls-weighted p95 of per-statement mean,
--                                 app roles, over the window (today 10.4)
--      timeouts_per_hour      5   postgres_logs statement timeouts (09-22: 19-42)
-- 2. public.db_saturation_problems(signals jsonb) — pure judge: which
--    thresholds a set of signals crosses.
-- 3. public.check_db_saturation(p_log_timeouts, p_log_window_minutes) —
--    reads pg_stat_activity + pg_stat_statements, computes the window since
--    its previous run (calls/s, DB ms/s, p95), stores a sample in
--    public.db_saturation_samples (14 days kept), and on a problem writes an
--    error_logs row (one per source per UTC hour) that trg_error_logs_zz_ledger
--    turns into an ops_alert_ledger item:
--      source 'db-saturation'           — the in-database signals (pg_cron,
--                                         every 5 min)
--      source 'db-statement-timeouts'   — the postgres_logs count, which only
--                                         the Management API can read; the
--                                         hourly prod-errors workflow passes it
--                                         in (scripts/db-saturation-check.mjs)
-- 4. ops_alert_condition gains both sources: an item closes only when a
--    sample taken AFTER its last occurrence shows the signal clear. No newer
--    sample = NULL (cannot tell), never "cleared".
-- 5. sweep_silent_cron_failures: its streak query re-scanned the whole
--    `marked` CTE once per row, twice (2 correlated SubPlans x 2,381 rows):
--    EXPLAIN ANALYZE on prod 2,552 ms. Same rows, one GROUP BY: 20 ms, and
--    the per-job streak/latest_candidates output was compared old-vs-new on
--    prod's live cron_run_log (identical). Body otherwise verbatim from
--    pg_get_functiondef on prod.
-- 6. A 5-minute cron 'db-saturation-check' + its cron_work_expectations row.
--
-- HONEST LIMITS: pg_stat_statements does not record statements cancelled by
-- statement_timeout, so the in-database p95 cannot see them — that is what
-- the postgres_logs source is for. If the instance is starved hard enough
-- that pg_cron cannot start jobs (09-22), the 5-minute check dies with it;
-- the hourly workflow call then fails, which is a red run (nightly-issue-sync)
-- and uptime.yml's "database: no answer" still fire.
--
-- Replay-safe: IF NOT EXISTS / CREATE OR REPLACE / ON CONFLICT; cron.schedule
-- upserts by name. ops_alert_condition is 20260923085642's body verbatim
-- (the newest definition when this was written; it carries Q39's
-- 'user-error-screen' branch) plus the two new branches and their variables.

-- ── tables ─────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.db_saturation_samples (
  id                 bigserial PRIMARY KEY,
  sampled_at         timestamptz NOT NULL DEFAULT now(),
  origin             text NOT NULL DEFAULT 'cron',
  client_conns       int,
  max_conns          int,
  conn_pct           numeric,
  active_conns       int,
  longest_active_s   numeric,
  idle_in_xact       int,
  window_s           numeric,
  calls_per_s        numeric,
  exec_ms_per_s      numeric,
  p95_ms             numeric,
  window_app_calls   bigint,
  log_timeouts       int,
  log_window_minutes int,
  db_problems        text[] NOT NULL DEFAULT ARRAY[]::text[],
  log_problem        text
);
CREATE INDEX IF NOT EXISTS db_saturation_samples_at_idx ON public.db_saturation_samples (sampled_at DESC);
ALTER TABLE public.db_saturation_samples ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.db_saturation_samples FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.db_saturation_samples TO service_role;
DO $do$
BEGIN
  IF to_regclass('public.db_saturation_samples_id_seq') IS NOT NULL THEN
    REVOKE ALL ON SEQUENCE public.db_saturation_samples_id_seq FROM PUBLIC, anon, authenticated;
  END IF;
END
$do$;

-- The previous pg_stat_statements reading, so each run can compute a window.
CREATE TABLE IF NOT EXISTS public.db_saturation_state (
  id          int PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  sampled_at  timestamptz NOT NULL,
  total_calls numeric NOT NULL,
  total_ms    numeric NOT NULL,
  app_stats   jsonb NOT NULL DEFAULT '{}'::jsonb
);
ALTER TABLE public.db_saturation_state ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.db_saturation_state FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.db_saturation_state TO service_role;   -- server-only

-- ── 1. thresholds ──────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.db_saturation_thresholds()
RETURNS jsonb
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $fn$
  SELECT jsonb_build_object(
    'conn_pct',          90,
    'active_conns',      15,
    'longest_active_s',  120,
    'idle_in_xact',      1,
    'exec_ms_per_s',     1000,
    'p95_ms',            100,
    'p95_min_calls',     200,
    'timeouts_per_hour', 5)
$fn$;

-- ── 2. the judge (pure) ────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.db_saturation_problems(p jsonb)
RETURNS text[]
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public
AS $fn$
DECLARE
  t   jsonb := public.db_saturation_thresholds();
  out text[] := ARRAY[]::text[];
BEGIN
  IF (p ->> 'conn_pct')::numeric >= (t ->> 'conn_pct')::numeric THEN
    out := out || format('connections %s/%s (%s%%) >= %s%%', p ->> 'client_conns', p ->> 'max_conns', p ->> 'conn_pct', t ->> 'conn_pct');
  END IF;
  IF (p ->> 'active_conns')::numeric >= (t ->> 'active_conns')::numeric THEN
    out := out || format('%s active backends >= %s', p ->> 'active_conns', t ->> 'active_conns');
  END IF;
  IF (p ->> 'longest_active_s')::numeric >= (t ->> 'longest_active_s')::numeric THEN
    out := out || format('a statement has run %s s >= %s s', p ->> 'longest_active_s', t ->> 'longest_active_s');
  END IF;
  IF (p ->> 'idle_in_xact')::numeric >= (t ->> 'idle_in_xact')::numeric THEN
    out := out || format('%s session(s) idle in transaction > 5 min', p ->> 'idle_in_xact');
  END IF;
  IF (p ->> 'exec_ms_per_s')::numeric >= (t ->> 'exec_ms_per_s')::numeric THEN
    out := out || format('%s ms of SQL per second >= %s', p ->> 'exec_ms_per_s', t ->> 'exec_ms_per_s');
  END IF;
  IF (p ->> 'p95_ms')::numeric >= (t ->> 'p95_ms')::numeric
     AND coalesce((p ->> 'window_app_calls')::numeric, 0) >= (t ->> 'p95_min_calls')::numeric THEN
    out := out || format('app query p95 %s ms >= %s ms', p ->> 'p95_ms', t ->> 'p95_ms');
  END IF;
  RETURN out;
END;
$fn$;

-- ── 3. the check ───────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.check_db_saturation(
  p_log_timeouts       int DEFAULT NULL,
  p_log_window_minutes int DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  t            jsonb := public.db_saturation_thresholds();
  v_origin     text := CASE WHEN p_log_timeouts IS NULL THEN 'cron' ELSE 'workflow' END;
  v_max        int;
  v_client     int;
  v_active     int;
  v_longest    numeric;
  v_iix        int;
  v_pct        numeric;
  v_calls      numeric;
  v_ms         numeric;
  v_app        jsonb;
  v_prev       public.db_saturation_state%ROWTYPE;
  v_window_s   numeric;
  v_cps        numeric;
  v_mps        numeric;
  v_p95        numeric;
  v_wcalls     numeric;
  v_signals    jsonb;
  v_problems   text[];
  v_rate       numeric;
  v_log_prob   text;
BEGIN
  v_max := current_setting('max_connections')::int;
  SELECT count(*) FILTER (WHERE backend_type = 'client backend'),
         count(*) FILTER (WHERE backend_type = 'client backend' AND state IS DISTINCT FROM 'idle'
                            AND pid <> pg_backend_pid()),
         max(extract(epoch FROM now() - query_start)) FILTER (
               WHERE backend_type = 'client backend' AND state = 'active'
                 AND pid <> pg_backend_pid()
                 AND coalesce(application_name, '') NOT LIKE 'pg_dump%'),
         count(*) FILTER (WHERE backend_type = 'client backend'
                            AND state LIKE 'idle in transaction%'
                            AND state_change < now() - interval '5 minutes')
    INTO v_client, v_active, v_longest, v_iix
    FROM pg_stat_activity;
  v_pct := round(100.0 * v_client / nullif(v_max, 0), 1);
  v_longest := round(coalesce(v_longest, 0), 1);

  -- Window stats: only the 5-minute cron advances the window, so a workflow
  -- call in between cannot shrink it.
  IF v_origin = 'cron' AND to_regclass('extensions.pg_stat_statements') IS NOT NULL THEN
    EXECUTE $q$
      SELECT coalesce(sum(calls), 0), coalesce(sum(total_exec_time), 0)
        FROM extensions.pg_stat_statements $q$
      INTO v_calls, v_ms;
    EXECUTE $q$
      SELECT coalesce(jsonb_object_agg(k, jsonb_build_array(c, m)), '{}'::jsonb)
        FROM (SELECT s.queryid::text || ':' || s.userid::text AS k,
                     sum(s.calls) AS c, round(sum(s.total_exec_time)::numeric, 3) AS m
                FROM extensions.pg_stat_statements s
                JOIN pg_roles r ON r.oid = s.userid
               WHERE r.rolname IN ('authenticated', 'anon', 'service_role')
                 AND s.calls > 0
               GROUP BY s.queryid, s.userid) x $q$
      INTO v_app;

    SELECT * INTO v_prev FROM public.db_saturation_state WHERE id = 1;
    IF FOUND THEN
      v_window_s := extract(epoch FROM now() - v_prev.sampled_at);
      -- A counter that went DOWN is a stats reset: no window this time.
      IF v_window_s >= 60 AND v_calls >= v_prev.total_calls THEN
        v_cps := round((v_calls - v_prev.total_calls) / v_window_s, 2);
        v_mps := round((v_ms - v_prev.total_ms) / v_window_s, 1);
        WITH d AS (
          SELECT (cur.value ->> 0)::numeric - coalesce((prev.value ->> 0)::numeric, 0) AS dc,
                 (cur.value ->> 1)::numeric - coalesce((prev.value ->> 1)::numeric, 0) AS dm
            FROM jsonb_each(v_app) cur
            LEFT JOIN jsonb_each(v_prev.app_stats) prev ON prev.key = cur.key
        ), w AS (
          SELECT dm / dc AS mean_ms, dc,
                 sum(dc) OVER (ORDER BY dm / dc, dc) AS cum,
                 sum(dc) OVER () AS tot
            FROM d WHERE dc > 0 AND dm >= 0
        )
        SELECT round(min(mean_ms) FILTER (WHERE cum >= 0.95 * tot), 2), max(tot)
          INTO v_p95, v_wcalls
          FROM w;
      END IF;
    END IF;

    INSERT INTO public.db_saturation_state AS s (id, sampled_at, total_calls, total_ms, app_stats)
    VALUES (1, now(), v_calls, v_ms, v_app)
    ON CONFLICT (id) DO UPDATE SET sampled_at = EXCLUDED.sampled_at, total_calls = EXCLUDED.total_calls,
                                   total_ms = EXCLUDED.total_ms, app_stats = EXCLUDED.app_stats;
  END IF;

  v_signals := jsonb_build_object(
    'client_conns', v_client, 'max_conns', v_max, 'conn_pct', v_pct,
    'active_conns', v_active, 'longest_active_s', v_longest, 'idle_in_xact', v_iix,
    'window_s', round(v_window_s, 0), 'calls_per_s', v_cps, 'exec_ms_per_s', v_mps,
    'p95_ms', v_p95, 'window_app_calls', v_wcalls);
  v_problems := public.db_saturation_problems(v_signals);

  IF p_log_timeouts IS NOT NULL THEN
    v_rate := round(p_log_timeouts * 60.0 / greatest(coalesce(p_log_window_minutes, 60), 1), 1);
    IF v_rate >= (t ->> 'timeouts_per_hour')::numeric THEN
      v_log_prob := format('%s statement timeouts in the last %s min (%s/h >= %s/h)',
                           p_log_timeouts, coalesce(p_log_window_minutes, 60), v_rate, t ->> 'timeouts_per_hour');
    END IF;
  END IF;

  INSERT INTO public.db_saturation_samples
    (origin, client_conns, max_conns, conn_pct, active_conns, longest_active_s, idle_in_xact,
     window_s, calls_per_s, exec_ms_per_s, p95_ms, window_app_calls,
     log_timeouts, log_window_minutes, db_problems, log_problem)
  VALUES
    (v_origin, v_client, v_max, v_pct, v_active, v_longest, v_iix,
     round(v_window_s, 0), v_cps, v_mps, v_p95, v_wcalls,
     p_log_timeouts, CASE WHEN p_log_timeouts IS NOT NULL THEN coalesce(p_log_window_minutes, 60) END,
     v_problems, v_log_prob);

  DELETE FROM public.db_saturation_samples WHERE sampled_at < now() - interval '14 days';

  IF cardinality(v_problems) > 0 AND NOT EXISTS (
    SELECT 1 FROM public.error_logs e
     WHERE jsonb_typeof(e.tags) = 'object'
       AND e.tags ->> 'source' = 'db-saturation'
       AND e.created_at >= date_trunc('hour', now()))
  THEN
    INSERT INTO public.error_logs (severity, message, tags, context)
    VALUES ('error',
            'Database saturation — ' || array_to_string(v_problems, '; ') || '. See docs/OPEN.md Q53.',
            jsonb_build_object('source', 'db-saturation', 'area', 'database'),
            v_signals);
  END IF;

  IF v_log_prob IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.error_logs e
     WHERE jsonb_typeof(e.tags) = 'object'
       AND e.tags ->> 'source' = 'db-statement-timeouts'
       AND e.created_at >= date_trunc('hour', now()))
  THEN
    INSERT INTO public.error_logs (severity, message, tags, context)
    VALUES ('error',
            'Database statement timeouts — ' || v_log_prob || '. See docs/OPEN.md Q53.',
            jsonb_build_object('source', 'db-statement-timeouts', 'area', 'database'),
            v_signals || jsonb_build_object('log_timeouts', p_log_timeouts,
                                            'log_window_minutes', coalesce(p_log_window_minutes, 60)));
  END IF;

  RETURN v_signals || jsonb_build_object(
    'ok', cardinality(v_problems) = 0 AND v_log_prob IS NULL,
    'origin', v_origin, 'problems', to_jsonb(v_problems), 'log_problem', v_log_prob,
    'log_timeouts', p_log_timeouts, 'thresholds', t);
END;
$fn$;

REVOKE ALL ON FUNCTION public.db_saturation_thresholds() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.db_saturation_problems(jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.check_db_saturation(int, int) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.db_saturation_thresholds() TO service_role;
GRANT EXECUTE ON FUNCTION public.db_saturation_problems(jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.check_db_saturation(int, int) TO service_role;

-- ── 4. ledger close rules ──────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.ops_alert_condition(
  p_source     text,
  p_sample_ref jsonb,
  p_since      timestamptz,
  p_probe_only boolean DEFAULT false
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_job   text := p_sample_ref ->> 'job';
  v_dlq   text;
  v_depth bigint;
  v_probs text[];
  v_logp  text;
BEGIN
  IF p_source = 'detect_stuck_payments' THEN
    IF p_probe_only THEN RETURN true; END IF;
    -- The detector's own predicate for REAL jobs, minus its notification
    -- dedupe. Seed jobs are the '-seed' source's, which never reaches here.
    RETURN EXISTS (
      SELECT 1 FROM public.jobs j
       WHERE j.stripe_session_id IS NOT NULL
         AND j.payment_status = 'unpaid'
         AND j.created_at < now() - interval '10 minutes'
         AND j.created_at > now() - interval '24 hours'
         AND NOT (j.status = 'cancelled'
                  AND coalesce(j.cancelled_at, j.updated_at) > now() - interval '2 hours')
         AND NOT coalesce(j.is_seed, false)
         AND NOT EXISTS (SELECT 1 FROM public.profiles p
                          WHERE p.user_id = j.customer_id AND p.is_seed IS TRUE));

  ELSIF p_source = 'ops-digest-undelivered' THEN
    IF p_probe_only THEN RETURN true; END IF;
    IF to_regprocedure('public.check_ops_digest_delivery()') IS NULL THEN RETURN NULL; END IF;
    -- SIDE EFFECTS: this is not a pure question. When delivery is NOT ok,
    -- check_ops_digest_delivery() INSERTs an error_logs row (which feeds this
    -- ledger through trg_error_logs_zz_ledger) and POSTs to Slack via
    -- slack-ops-alert — at most once per UTC day (its own dedupe). So an hourly
    -- ops_alert_verify() can raise the day's digest alert itself. 'ok' is
    -- computed before that dedupe, so it is honest on a day already reported.
    RETURN NOT coalesce((public.check_ops_digest_delivery() ->> 'ok')::boolean, false);

  ELSIF p_source = 'push-tokens-empty' THEN
    IF p_probe_only THEN RETURN true; END IF;
    -- Q82. Still failing while no REAL user has a push token. Pure question:
    -- the daily cron owns the report, so re-asking here writes nothing.
    RETURN NOT EXISTS (
      SELECT 1 FROM public.push_tokens t
       WHERE NOT EXISTS (SELECT 1 FROM public.profiles p
                          WHERE p.user_id = t.user_id AND p.is_seed IS TRUE));

  ELSIF p_source = 'db-saturation' THEN
    IF p_probe_only THEN RETURN true; END IF;
    -- Q53. Judged by a 5-minute sample taken AFTER the last occurrence. None
    -- yet (or the cron has stopped) = cannot tell, never "cleared".
    SELECT s.db_problems INTO v_probs
      FROM public.db_saturation_samples s
     WHERE s.origin = 'cron' AND s.sampled_at > p_since
     ORDER BY s.sampled_at DESC LIMIT 1;
    IF NOT FOUND THEN RETURN NULL; END IF;
    RETURN cardinality(v_probs) > 0;

  ELSIF p_source = 'db-statement-timeouts' THEN
    IF p_probe_only THEN RETURN true; END IF;
    -- Q53. Judged by the next postgres_logs count the workflow passes in.
    SELECT s.log_problem INTO v_logp
      FROM public.db_saturation_samples s
     WHERE s.log_timeouts IS NOT NULL AND s.sampled_at > p_since
     ORDER BY s.sampled_at DESC LIMIT 1;
    IF NOT FOUND THEN RETURN NULL; END IF;
    RETURN v_logp IS NOT NULL;

  ELSIF p_source IN ('email-dlq-auth', 'email-dlq-transactional') THEN
    IF p_probe_only THEN RETURN true; END IF;
    v_dlq := CASE p_source WHEN 'email-dlq-auth' THEN 'auth_emails_dlq' ELSE 'transactional_emails_dlq' END;
    IF to_regclass('pgmq.q_' || v_dlq) IS NULL THEN RETURN NULL; END IF;
    -- Evidence per recipient, not queue depth (Q29): archiving a dead letter
    -- empties the queue without anyone receiving anything. Still failing while
    --   (a) a dead letter to a NON-seed recipient is still queued, or
    --   (b) an ARCHIVED one has no later 'sent' email_send_log row to that
    --       recipient for that template (label, else the source queue name —
    --       the name process-email-queue logs under).
    EXECUTE format(
      'SELECT count(*) FROM pgmq.%I m WHERE NOT public.is_seed_email(m.message ->> %L)',
      'q_' || v_dlq, 'to') INTO v_depth;
    IF v_depth > 0 THEN RETURN true; END IF;
    IF to_regclass('pgmq.a_' || v_dlq) IS NOT NULL THEN
      EXECUTE format(
        'SELECT count(*) FROM pgmq.%I a
          WHERE NOT public.is_seed_email(a.message ->> %L)
            AND NOT EXISTS (
              SELECT 1 FROM public.email_send_log s
               WHERE lower(s.recipient_email) = lower(a.message ->> %L)
                 AND s.status = %L
                 AND s.template_name = coalesce(a.message ->> %L, %L)
                 AND s.created_at > a.enqueued_at)',
        'a_' || v_dlq, 'to', 'to', 'sent', 'label', replace(v_dlq, '_dlq', '')) INTO v_depth;
      IF v_depth > 0 THEN RETURN true; END IF;
    END IF;
    RETURN false;

  ELSIF p_source IN ('cron-dead', 'cron-startup-timeout') AND v_job IS NOT NULL THEN
    IF p_probe_only THEN RETURN true; END IF;
    IF to_regclass('cron.job_run_details') IS NULL THEN RETURN NULL; END IF;
    -- Cleared only by a run that SUCCEEDED after the last report.
    RETURN NOT EXISTS (
      SELECT 1 FROM cron.job_run_details d
        JOIN cron.job c ON c.jobid = d.jobid
       WHERE c.jobname = v_job
         AND d.status = 'succeeded'
         AND d.start_time > p_since);

  ELSIF p_source = 'user-error-screen' THEN
    IF p_probe_only THEN RETURN true; END IF;
    -- Q39. Re-asks error_logs itself, not the ledger's last_seen: still failing
    -- while a REAL (non-seed) person was shown this screen+message in the last
    -- 24 hours. The overflow item ("new-screen cap reached") has no single
    -- screen, so it is still failing while ANY real user-error-screen row
    -- landed in the last 24 hours.
    IF coalesce((p_sample_ref ->> 'overflow')::boolean, false) THEN
      RETURN EXISTS (
        SELECT 1 FROM public.error_logs e
         WHERE e.created_at > now() - interval '24 hours'
           AND public.is_user_error_screen_row(e.tags)
           AND public.user_error_screen_is_real(e.user_id, e.tags));
    END IF;
    IF p_sample_ref ->> 'title_norm' IS NULL THEN RETURN NULL; END IF;
    RETURN EXISTS (
      SELECT 1 FROM public.error_logs e
       WHERE e.created_at > now() - interval '24 hours'
         AND public.is_user_error_screen_row(e.tags)
         AND public.user_error_screen_is_real(e.user_id, e.tags)
         AND public.ops_alert_normalise(public.user_error_screen_title(e.tags ->> 'screen', e.message))
             = p_sample_ref ->> 'title_norm');
  END IF;
  RETURN NULL;
END;
$fn$;

REVOKE ALL ON FUNCTION public.ops_alert_condition(text, jsonb, timestamptz, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ops_alert_condition(text, jsonb, timestamptz, boolean) TO service_role;

-- ── 5. sweep_silent_cron_failures: same answer, no quadratic scan ─────────
CREATE OR REPLACE FUNCTION public.sweep_silent_cron_failures()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_recorded int := 0;
  v_flagged  int := 0;
  v_names    text[] := ARRAY[]::text[];
  r          record;
BEGIN
  -- 3a. Ingest. Only rows whose body actually names its function are kept:
  -- without `fn` there is no trustworthy way to say which cron a body belongs
  -- to (see 20260828030000 -- proximity guessed wrong 3 times in 4), and a
  -- streak counted against the wrong cron is worse than no streak at all.
  -- Body is left empty here and parsed in the loop below: a cast inside this
  -- set-returning INSERT would abort the entire ingest on one truncated or
  -- non-JSON body.
  --
  -- SIX HOURS, not sixty minutes -- pg_net's own retention. See 20260902035753:
  -- an hourly sweep with an hourly window loses an hour of history permanently
  -- for every run it misses, and it missed one.
  INSERT INTO public.cron_run_log (jobname, status_code, body, response_id, occurred_at)
  SELECT substring(resp.content::text from '"fn"\s*:\s*"([a-zA-Z0-9_-]+)"'),
         resp.status_code,
         '{}'::jsonb,
         resp.id,
         resp.created
    FROM net._http_response resp
   WHERE resp.created > now() - interval '6 hours'
     AND resp.content::text ~ '"fn"\s*:\s*"'
  ON CONFLICT (response_id) DO NOTHING;

  GET DIAGNOSTICS v_recorded = ROW_COUNT;

  -- Fill in the parsed body separately so a malformed one cannot abort the
  -- whole INSERT above.
  FOR r IN
    SELECT l.id, resp.content::text AS raw
      FROM public.cron_run_log l
      JOIN net._http_response resp ON resp.id = l.response_id
     WHERE l.body = '{}'::jsonb
  LOOP
    BEGIN
      UPDATE public.cron_run_log SET body = r.raw::jsonb WHERE id = r.id;
    EXCEPTION WHEN OTHERS THEN
      -- Truncated or non-JSON content: leave the body empty. The row still
      -- records that the run happened.
      NULL;
    END;
  END LOOP;

  -- 3b. Detect. For each configured cron, walk its recent runs newest-first and
  -- count how many consecutive ones found candidates but dispositioned none.
  FOR r IN
    WITH runs AS (
      SELECT l.jobname, l.body,
             row_number() OVER (PARTITION BY l.jobname ORDER BY l.occurred_at DESC) AS rn,
             c.candidate_key, c.disposition_keys, c.min_streak, c.note
        FROM public.cron_run_log l
        JOIN public.cron_work_expectations c ON c.jobname = l.jobname
       WHERE l.occurred_at > now() - interval '30 days'
         AND c.candidate_key IS NOT NULL
         AND l.body ? c.candidate_key
         -- ADDED 20260903204415. `?` proves the KEY exists, not that its value
         -- is castable. An object, array, string or null here used to abort the
         -- entire function -- ingest included -- on the numeric cast below.
         AND jsonb_typeof(l.body -> c.candidate_key) = 'number'
    ),
    marked AS (
      SELECT r0.jobname, r0.rn, r0.min_streak, r0.note,
             (r0.body ->> r0.candidate_key)::numeric AS candidates,
             ((r0.body ->> r0.candidate_key)::numeric > 0
              AND (SELECT COALESCE(sum(
                     CASE WHEN jsonb_typeof(r0.body -> k) = 'number'
                          THEN (r0.body ->> k)::numeric
                          ELSE 0 END), 0)
                     FROM unnest(r0.disposition_keys) AS k) = 0) AS suspicious
        FROM runs r0
    ),
    -- The first (newest) NON-suspicious run per job, computed ONCE. It used to
    -- be a correlated subquery re-scanning `marked` for every row, twice
    -- (SELECT list and HAVING): 2,552 ms on prod 2026-09-23 vs 20 ms this way
    -- (Q53). Same streak: every row before that first clean run.
    firsts AS (
      SELECT m1.jobname,
             COALESCE(min(m1.rn) FILTER (WHERE NOT m1.suspicious), 2147483647) AS first_ok
        FROM marked m1
       GROUP BY m1.jobname
    )
    -- The streak is counted from the MOST RECENT run backwards: every row
    -- before the first non-suspicious one. Anchoring it there is what stops a
    -- cron that broke last week and has since recovered from paging today.
    SELECT m.jobname,
           m.min_streak,
           m.note,
           count(*) FILTER (WHERE m.rn < f.first_ok) AS streak,
           max(m.candidates) FILTER (WHERE m.rn = 1) AS latest_candidates
      FROM marked m
      JOIN firsts f ON f.jobname = m.jobname
     GROUP BY m.jobname, m.min_streak, m.note
    HAVING count(*) FILTER (WHERE m.rn < f.first_ok) >= m.min_streak
  LOOP
    -- Deduped on (job, day): a 5-minute cron must not write 288 identical rows.
    IF NOT EXISTS (
      SELECT 1 FROM public.error_logs e
       WHERE e.tags->>'source' = 'cron-silent'
         AND e.tags->>'job' = r.jobname
         AND e.created_at > date_trunc('day', now())
    ) THEN
      INSERT INTO public.error_logs (severity, message, tags, context)
      VALUES (
        'error',
        format('Silent cron: %s found work and did none of it for %s consecutive run(s)',
               r.jobname, r.streak),
        jsonb_build_object('source', 'cron-silent', 'area', 'cron', 'job', r.jobname),
        jsonb_build_object('streak', r.streak,
                           'latest_candidates', r.latest_candidates,
                           'why', r.note));
      v_flagged := v_flagged + 1;
      v_names := v_names || r.jobname;
    END IF;
  END LOOP;

  IF v_flagged > 0 THEN
    BEGIN
      PERFORM net.http_post(
        url := (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'supabase_url')
               || '/functions/v1/slack-ops-alert',
        headers := jsonb_build_object(
          'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'service_role_key'),
          'Content-Type', 'application/json'),
        body := jsonb_build_object(
          'title', format('%s cron(s) running green while doing nothing', v_flagged),
          'message', format('Affected: %s. These returned 2xx. See error_logs (tags.source = cron-silent).',
                            array_to_string(v_names, ', ')),
          'severity', 'error'));
    EXCEPTION WHEN OTHERS THEN
      NULL;
    END;
  END IF;

  RETURN jsonb_build_object('recorded', v_recorded,
                            'flagged',  v_flagged,
                            'jobs',     to_jsonb(v_names));
END;
$function$;

REVOKE ALL ON FUNCTION public.sweep_silent_cron_failures() FROM PUBLIC, anon, authenticated;

-- ── 6. schedule + liveness ─────────────────────────────────────────────────
DO $do$
BEGIN
  IF to_regclass('public.cron_work_expectations') IS NOT NULL THEN
    INSERT INTO public.cron_work_expectations (jobname, expected_max_gap, note)
    VALUES ('db-saturation-check', interval '20 minutes',
            'Q53: 5-minute database saturation check (connections, active backends, long statements, idle-in-transaction, SQL ms/s, app p95).')
    ON CONFLICT (jobname) DO UPDATE SET expected_max_gap = EXCLUDED.expected_max_gap;
  END IF;

  IF EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'cron') THEN
    PERFORM cron.schedule('db-saturation-check', '*/5 * * * *',
                          'SELECT public.check_db_saturation();');
  END IF;
END
$do$;
