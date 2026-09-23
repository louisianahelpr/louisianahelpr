-- Q30 (+ the rest of Q4): a daily or weekly cron slot that is missed during an
-- outage is run ONCE when the database is back, if it is safe to run late;
-- otherwise it opens an ops ledger item. Nothing is lost silently.
--
-- ── WHY ────────────────────────────────────────────────────────────────────
-- 2026-09-22 (measured, cron.job_run_details): daily-match-digest 13:12,
-- sweep-daily-job-digest 14:00 and ops-daily-digest 14:40 UTC all failed with
-- "job startup timeout" during the DB outage (Q53). Their last success was
-- 2026-09-21. Nothing re-runs a missed slot, so the day was simply lost, and
-- ops alerting went ~38h without a digest. sweep_cron_startup_failures
-- (20260923050055) DETECTS failed runs; it never RECOVERS them.
--
-- ── WHAT THIS ADDS ─────────────────────────────────────────────────────────
--  cron_catchup_policy   one row per daily/weekly job (23 on 2026-09-23, read
--                        live from cron.job): may a missed slot be re-run late,
--                        how late, and WHY. Exact and two-way against the
--                        migrations' own cron inventory:
--                        src/test/cronCatchUpPolicy.test.ts.
--  cron_catchup_runs     one row per (job, slot) ever decided. The primary key
--                        is what makes "never the same slot twice" true.
--  cron_catchup_last_slot(schedule, at)
--                        the most recent scheduled time <= at for a DAILY
--                        ('M H * * *') or WEEKLY ('M H * * D') schedule, and
--                        its period. Anything else returns no row: a job that
--                        runs every few minutes or hours heals itself on its
--                        next run.
--  run_missed_cron_catch_up()   every 10 minutes (cron 'cron-missed-slot-catch-up').
--
-- ── A SLOT IS MISSED WHEN ──────────────────────────────────────────────────
--   its most recent scheduled time is at least 10 minutes old and less than
--   one period old (only ever the LATEST slot: an older one was superseded by
--   a later regular run), no run of the job has SUCCEEDED or is still RUNNING
--   since one minute before it, and the job provably existed at that slot (it
--   has an earlier run, or a failed run at that slot).
--
-- ── WHAT HAPPENS ───────────────────────────────────────────────────────────
--   policy catch_up, within max_late, DB healthy
--       -> the job's own cron.job command is EXECUTEd once, now; error_logs
--          'warning' (source 'cron-caught-up') -> an ops ledger item that
--          closes when the job's next REGULAR run succeeds.
--   policy catch_up, DB not healthy yet
--       -> nothing recorded; asked again in 10 minutes (until max_late).
--   policy catch_up, past max_late            -> 'alerted_too_late'
--   policy NOT catch_up (money, destructive)  -> 'alerted_unsafe'
--   no policy row (a new daily cron)          -> 'alerted_unclassified'
--   a job owned by another role or database   -> 'alerted_unsafe'
--   the catch-up itself raised                -> 'catch_up_failed'
--   Every alert is error_logs 'error' (source 'cron-missed-slot') -> a
--   manual ops ledger item: a person decides what the lost slot needs.
--
--   "Healthy": in the last 15 minutes at least one cron run succeeded and
--   fewer than 3 failed (the floor sweep_cron_startup_failures pages at).
--
-- ── NEVER WAITS ────────────────────────────────────────────────────────────
--   One instance at a time via pg_try_advisory_xact_lock (a second tick
--   returns 'busy' at once); row locks bounded by lock_timeout 200ms; the
--   error_logs write goes through the already-bounded ledger trigger
--   (src/test/errorLogTriggersNeverWait.test.ts). At most 3 catch-ups a tick.
--
-- ── WHY RUNNING THE COMMAND IS "ONCE" ──────────────────────────────────────
--   A failed cron run (startup timeout, lost connection) rolled back, and
--   pg_net only queues an HTTP request on commit, so the missed slot did
--   NOTHING. The claim row is inserted in the same transaction as the
--   command, before it; a failing command rolls back only its own
--   sub-block, so the claim stays and the slot is never tried again.
--
-- Replay-safe: IF NOT EXISTS, CREATE OR REPLACE, ON CONFLICT, cron.schedule
-- upserts by name, and every cron.* reference is guarded. ops_alert_condition
-- is the 20260923130621 body verbatim (md5 of prosrc
-- 99a0998dccc2dda3edf9c154769408ff, equal to prod on 2026-09-23) with
-- 'cron-caught-up' added to the cron-dead close rule.

-- ── 1. tables ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.cron_catchup_policy (
  jobname    text PRIMARY KEY,
  catch_up   boolean NOT NULL,
  max_late   interval NOT NULL,
  reason     text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT cron_catchup_policy_reason_chk CHECK (length(reason) >= 20),
  CONSTRAINT cron_catchup_policy_max_late_chk CHECK (max_late > interval '0' AND max_late < interval '7 days')
);

CREATE TABLE IF NOT EXISTS public.cron_catchup_runs (
  jobname    text NOT NULL,
  slot       timestamptz NOT NULL,
  action     text NOT NULL,
  decided_at timestamptz NOT NULL DEFAULT now(),
  detail     text,
  PRIMARY KEY (jobname, slot),
  CONSTRAINT cron_catchup_runs_action_chk CHECK (action IN
    ('caught_up', 'catch_up_failed', 'alerted_unsafe', 'alerted_unclassified', 'alerted_too_late'))
);

ALTER TABLE public.cron_catchup_policy ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cron_catchup_runs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.cron_catchup_policy FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.cron_catchup_runs FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.cron_catchup_policy TO service_role;
GRANT ALL ON TABLE public.cron_catchup_runs TO service_role;

COMMENT ON TABLE public.cron_catchup_policy IS
  'Q30: may a missed daily/weekly cron slot be re-run late (catch_up), how late (max_late), and why. Read by run_missed_cron_catch_up(). Exact and two-way with the migrations'' cron inventory: src/test/cronCatchUpPolicy.test.ts.';
COMMENT ON TABLE public.cron_catchup_runs IS
  'Q30: one row per (job, missed slot) ever decided by run_missed_cron_catch_up(); the primary key is the never-twice guarantee. Server-only.';

-- ── 2. the policy: every daily/weekly job, catch-up-safe or not, and why ───
-- Measured 2026-09-23 from cron.job (schedule 'M H * * *' / 'M H * * D').
INSERT INTO public.cron_catchup_policy (jobname, catch_up, max_late, reason) VALUES
  ('ops-daily-digest',                true,  interval '20 hours', 'Slack digest of the last 24h of ops alerts; writes only its own delivery receipt. A late digest is the Q30 case itself: 09-22 went 38h with none.'),
  ('sweep-daily-job-digest',          true,  interval '6 hours',  'In-app "New jobs in <parish>" digest; its own NOT EXISTS skips anyone digested in the last 23h, so it cannot double-send. Capped at 6h because a late run shifts the next day''s by that 23h dedupe.'),
  ('daily-match-digest',              true,  interval '20 hours', 'Drains the match-digest queue and deletes what it sent (idempotent within a day, per its header), so a late run sends only what is still queued.'),
  ('push-token-health',               true,  interval '20 hours', 'Monitor (Q82): counts push tokens and writes at most one error_logs row per UTC day. Read-only otherwise.'),
  ('marketing-token-health',          true,  interval '20 hours', 'Monitor: checks the Meta token and that the publish queue drains; reads and alerts only.'),
  ('money-reconciliation',            true,  interval '20 hours', 'STRICTLY READ-ONLY by design (header of supabase/functions/money-reconciliation/index.ts): selects and Stripe paymentIntents.retrieve only. Reports money drift, never moves money.'),
  ('detect-suspicious-user-patterns', true,  interval '20 hours', 'Inserts a fraud_flags row only when no unresolved flag of that type exists for the user; its windows are relative to now(). Re-running is idempotent.'),
  ('sweep-old-email-send-log',        true,  interval '20 hours', 'Age-based TTL delete: a late run deletes exactly what the next run would. Idempotent.'),
  ('sweep-old-notifications',         true,  interval '20 hours', 'Age-based TTL delete of old notifications. Idempotent.'),
  ('sweep-old-error-logs',            true,  interval '20 hours', 'Age-based TTL delete of old error_logs. Idempotent.'),
  ('prune-cron-run-details',          true,  interval '20 hours', 'Deletes cron.job_run_details older than 7 days; the catch-up reads only the latest slot. Idempotent.'),
  ('prune-cron-run-log',              true,  interval '20 hours', 'Age-based prune of cron_run_log. Idempotent.'),
  ('prune-edge-rate-limit-log',       true,  interval '20 hours', 'Age-based prune of the edge rate-limit log. Idempotent.'),
  ('cleanup-notifications',           true,  interval '20 hours', 'Deletes READ notifications older than 30 days (age-based). Idempotent.'),
  ('stalled-completion-reminder',     true,  interval '6 hours',  'User nudge with its own per-job ledger (first_sent_at / second_sent_at / escalated_at, upsert ignoreDuplicates): a stage is never sent twice. 6h cap keeps it inside daytime.'),
  ('expiring-jobs-push',              true,  interval '6 hours',  'User push with its own expiring_notif_sent flag (per its header): never notifies a job twice. 6h cap keeps it inside daytime and before the jobs expire.'),
  ('review-nag-cron',                 true,  interval '6 hours',  'User nudge with its own dedupe count per user and job inside WINDOW_HOURS, failing closed (unreadable count = already nagged). 6h cap keeps it inside daytime.'),
  ('engagement-automations',          true,  interval '6 hours',  'Lifecycle emails spaced by last_drip_at / last_approval_email_at, which it stamps on send: a late run cannot send a step twice. 6h cap keeps it inside daytime.'),
  ('charge-recurring-visits',         false, interval '1 hour',   'CHARGES CARDS for recurring visits. Money is never auto-rerun: a person checks what the missed day should have charged.'),
  ('expire-subscriptions',            false, interval '1 hour',   'Ends paid entitlements (one-time passes, lapsed tiers). Changes what a paying user has; a person decides.'),
  ('subscription-reconciliation',     false, interval '1 hour',   'REPAIRS tier state from Stripe (its header: "why this one repairs"). An automated entitlement writer is not re-run blind; a person decides.'),
  ('cleanup-abandoned-accounts',      false, interval '1 hour',   'DELETES accounts. Destructive; never re-run automatically.'),
  ('weekly-helper-report',            false, interval '1 hour',   'Weekly earnings email to every Helpr with no send-dedupe of its own (none in supabase/functions/weekly-helper-report). A person decides whether a late weekly email is wanted.')
ON CONFLICT (jobname) DO UPDATE
  SET catch_up = EXCLUDED.catch_up, max_late = EXCLUDED.max_late,
      reason = EXCLUDED.reason, updated_at = now();

-- ── 3. slot arithmetic (pg_cron here runs in GMT; checked at run time) ─────
CREATE OR REPLACE FUNCTION public.cron_catchup_last_slot(p_schedule text, p_at timestamptz)
RETURNS TABLE (slot timestamptz, period interval)
LANGUAGE plpgsql
STABLE
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  m      text[];
  v_min  int;
  v_hour int;
  v_dow  int;
  v_day  timestamp := date_trunc('day', p_at AT TIME ZONE 'UTC');
  v_slot timestamp;
BEGIN
  m := regexp_match(coalesce(p_schedule, ''), '^\s*(\d{1,2})\s+(\d{1,2})\s+\*\s+\*\s+(\*|\d)\s*$');
  IF m IS NULL THEN RETURN; END IF;
  v_min := m[1]::int; v_hour := m[2]::int;
  IF v_min > 59 OR v_hour > 23 THEN RETURN; END IF;
  v_slot := v_day + make_interval(hours => v_hour, mins => v_min);
  IF m[3] = '*' THEN
    IF v_slot > p_at AT TIME ZONE 'UTC' THEN v_slot := v_slot - interval '1 day'; END IF;
    slot := v_slot AT TIME ZONE 'UTC'; period := interval '1 day';
  ELSE
    v_dow := m[3]::int % 7;
    v_slot := v_slot - make_interval(days => ((extract(dow FROM v_day)::int - v_dow + 7) % 7));
    IF v_slot > p_at AT TIME ZONE 'UTC' THEN v_slot := v_slot - interval '7 days'; END IF;
    slot := v_slot AT TIME ZONE 'UTC'; period := interval '7 days';
  END IF;
  RETURN NEXT;
END;
$fn$;

REVOKE ALL ON FUNCTION public.cron_catchup_last_slot(text, timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cron_catchup_last_slot(text, timestamptz) TO service_role;

-- ── 4. the catch-up ────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.run_missed_cron_catch_up()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_grace    CONSTANT interval := interval '10 minutes';
  v_max_runs CONSTANT int := 3;
  v_tz       text := coalesce(current_setting('cron.timezone', true), 'GMT');
  v_failed   int;
  v_ok       int;
  v_healthy  boolean;
  v_ran      int := 0;
  v_waiting  int := 0;
  v_claimed  int;
  v_action   text;
  v_detail   text;
  v_decided  jsonb := '[]'::jsonb;
  r          record;
BEGIN
  IF to_regclass('cron.job') IS NULL OR to_regclass('cron.job_run_details') IS NULL THEN
    RETURN jsonb_build_object('checked', false, 'reason', 'pg_cron not present');
  END IF;
  -- Slot arithmetic is UTC. A different pg_cron timezone would make every
  -- slot wrong, so do nothing rather than re-run at the wrong time.
  IF v_tz NOT IN ('GMT', 'UTC', 'Etc/UTC', 'Etc/GMT') THEN
    RETURN jsonb_build_object('checked', false, 'reason', 'cron.timezone is ' || v_tz || ', not UTC');
  END IF;
  -- One instance at a time, and never queue behind another.
  IF NOT pg_try_advisory_xact_lock(hashtext('public.run_missed_cron_catch_up')) THEN
    RETURN jsonb_build_object('checked', true, 'busy', true);
  END IF;
  PERFORM set_config('lock_timeout', '200ms', true);

  SELECT count(*) FILTER (WHERE d.status = 'failed'),
         count(*) FILTER (WHERE d.status = 'succeeded')
    INTO v_failed, v_ok
    FROM cron.job_run_details d
   WHERE d.start_time > now() - interval '15 minutes';
  v_healthy := v_failed < 3 AND v_ok >= 1;

  FOR r IN
    SELECT j.jobid, j.jobname, j.command, j.username, j.database,
           s.slot, s.period, p.catch_up, p.max_late, p.reason,
           (SELECT left(coalesce(d.return_message, d.status), 120)
              FROM cron.job_run_details d
             WHERE d.jobid = j.jobid AND d.start_time >= s.slot - interval '1 minute'
             ORDER BY d.start_time DESC LIMIT 1) AS last_failure
      FROM cron.job j
     CROSS JOIN LATERAL public.cron_catchup_last_slot(j.schedule, now()) s
      LEFT JOIN public.cron_catchup_policy p ON p.jobname = j.jobname
     WHERE j.active
       AND j.jobname <> 'cron-missed-slot-catch-up'
       AND now() - s.slot >= v_grace
       AND now() - s.slot <  s.period
       AND NOT EXISTS (SELECT 1 FROM public.cron_catchup_runs c
                        WHERE c.jobname = j.jobname AND c.slot = s.slot)
       AND NOT EXISTS (SELECT 1 FROM cron.job_run_details d
                        WHERE d.jobid = j.jobid
                          AND d.start_time >= s.slot - interval '1 minute'
                          AND d.status IN ('succeeded', 'running', 'starting'))
       AND (EXISTS (SELECT 1 FROM cron.job_run_details d
                     WHERE d.jobid = j.jobid AND d.start_time < s.slot - interval '1 minute')
            OR EXISTS (SELECT 1 FROM cron.job_run_details d
                        WHERE d.jobid = j.jobid AND d.start_time >= s.slot - interval '1 minute'
                          AND d.status = 'failed'))
     ORDER BY s.slot
  LOOP
    v_detail := NULL;
    IF r.catch_up IS NULL THEN
      v_action := 'alerted_unclassified';
    ELSIF r.catch_up IS NOT TRUE THEN
      v_action := 'alerted_unsafe';
    ELSIF r.username IS DISTINCT FROM current_user OR r.database IS DISTINCT FROM current_database() THEN
      v_action := 'alerted_unsafe';
      v_detail := format('runs as %s on %s, not as %s on %s', r.username, r.database, current_user, current_database());
    ELSIF now() - r.slot > r.max_late THEN
      v_action := 'alerted_too_late';
    ELSIF NOT v_healthy OR v_ran >= v_max_runs THEN
      -- Not now; asked again next tick, while still inside max_late.
      v_waiting := v_waiting + 1;
      CONTINUE;
    ELSE
      v_action := 'caught_up';
    END IF;

    -- The claim: one row per (job, slot), ever. Written before the command,
    -- in the same transaction, so a slot is never tried twice.
    BEGIN
      INSERT INTO public.cron_catchup_runs (jobname, slot, action, detail)
      VALUES (r.jobname, r.slot, v_action, v_detail)
      ON CONFLICT (jobname, slot) DO NOTHING;
      GET DIAGNOSTICS v_claimed = ROW_COUNT;
    EXCEPTION WHEN lock_not_available THEN
      v_claimed := 0;
    END;
    IF v_claimed = 0 THEN CONTINUE; END IF;

    IF v_action = 'caught_up' THEN
      v_ran := v_ran + 1;
      BEGIN
        EXECUTE regexp_replace(r.command, ';\s*$', '');
      EXCEPTION WHEN OTHERS THEN
        v_action := 'catch_up_failed';
        v_detail := left(SQLERRM, 300);
        UPDATE public.cron_catchup_runs SET action = v_action, detail = v_detail
         WHERE jobname = r.jobname AND slot = r.slot;
      END;
    END IF;

    IF v_action = 'caught_up' THEN
      INSERT INTO public.error_logs (severity, message, tags, context)
      VALUES ('warning',
              format('Missed cron slot caught up: %s — its %s UTC run did not succeed (%s) and nothing re-runs a missed slot, so it was run once at %s. Safe late because: %s',
                     r.jobname, to_char(r.slot AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI'),
                     coalesce(r.last_failure, 'no run recorded'),
                     to_char(now() AT TIME ZONE 'UTC', 'HH24:MI'), r.reason),
              jsonb_build_object('source', 'cron-caught-up', 'area', 'cron', 'job', r.jobname),
              jsonb_build_object('slot', r.slot, 'last_failure', r.last_failure, 'docs', 'docs/OPEN.md Q30'));
    ELSE
      INSERT INTO public.error_logs (severity, message, tags, context)
      VALUES ('error',
              format('Missed cron slot NOT re-run: %s — its %s UTC run did not succeed (%s). %s A person decides what the lost slot needs.',
                     r.jobname, to_char(r.slot AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI'),
                     coalesce(r.last_failure, 'no run recorded'),
                     CASE v_action
                       WHEN 'alerted_unclassified' THEN 'It has no row in cron_catchup_policy, so it is treated as unsafe (add one: src/test/cronCatchUpPolicy.test.ts).'
                       WHEN 'alerted_unsafe'       THEN 'Not catch-up-safe: ' || coalesce(v_detail, r.reason)
                       WHEN 'alerted_too_late'     THEN format('The database was not healthy again within its %s catch-up window.', r.max_late)
                       ELSE 'The catch-up run itself FAILED: ' || coalesce(v_detail, '?')
                     END),
              jsonb_build_object('source', 'cron-missed-slot', 'area', 'cron', 'job', r.jobname),
              jsonb_build_object('slot', r.slot, 'action', v_action, 'last_failure', r.last_failure,
                                 'docs', 'docs/OPEN.md Q30'));
    END IF;

    v_decided := v_decided || jsonb_build_array(jsonb_build_object('job', r.jobname, 'slot', r.slot, 'action', v_action));
  END LOOP;

  RETURN jsonb_build_object('checked', true, 'healthy', v_healthy, 'failed_15m', v_failed,
                            'succeeded_15m', v_ok, 'ran', v_ran, 'waiting', v_waiting,
                            'decided', v_decided);
END;
$fn$;

REVOKE ALL ON FUNCTION public.run_missed_cron_catch_up() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.run_missed_cron_catch_up() TO service_role;

-- ── 5. ledger close rule (live body + 'cron-caught-up') ────────────────────
CREATE OR REPLACE FUNCTION public.ops_alert_condition(p_source text, p_sample_ref jsonb, p_since timestamp with time zone, p_probe_only boolean DEFAULT false)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_job   text := p_sample_ref ->> 'job';
  v_dlq   text;
  v_depth bigint;
  v_probs text[];
  v_logp  text;
  v_min   timestamptz;
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

  ELSIF p_source = 'error-log-throttled' THEN
    IF p_probe_only THEN RETURN true; END IF;
    -- Q113. Judged by the latest COMPLETE minute. It must have begun after the
    -- last occurrence; until one has, cannot tell (NULL), never "cleared".
    -- Still failing while that minute dropped anything; a clean one clears it.
    v_min := date_trunc('minute', now()) - interval '1 minute';
    IF v_min < p_since THEN RETURN NULL; END IF;
    RETURN EXISTS (SELECT 1 FROM public.error_log_throttle_drops d WHERE d.minute = v_min);

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

  ELSIF p_source IN ('cron-dead', 'cron-startup-timeout', 'cron-caught-up') AND v_job IS NOT NULL THEN
    -- Q30: 'cron-caught-up' (a missed slot re-run by run_missed_cron_catch_up)
    -- closes by the same evidence: the job's next REGULAR run succeeded.
    IF p_probe_only THEN RETURN true; END IF;
    IF to_regclass('cron.job_run_details') IS NULL THEN RETURN NULL; END IF;
    -- Cleared only by a run that SUCCEEDED after the last report.
    RETURN NOT EXISTS (
      SELECT 1 FROM cron.job_run_details d
        JOIN cron.job c ON c.jobid = d.jobid
       WHERE c.jobname = v_job
         AND d.status = 'succeeded'
         AND d.start_time > p_since);

  ELSIF p_source = 'seed-boundary-check-failed' THEN
    IF p_probe_only THEN RETURN true; END IF;
    -- Q160. Still failing while ANY notification was dropped (in-app, digest
    -- queue or email) because the seed-boundary check itself errored in the
    -- last 24 hours. A deliberate seed suppression never matches: its
    -- error_message is 'seed subject to a non-seed recipient'.
    RETURN EXISTS (
      SELECT 1 FROM public.notification_logs l
       WHERE l.created_at > now() - interval '24 hours'
         AND l.error_message LIKE 'seed boundary check failed%');

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
$function$;

REVOKE ALL ON FUNCTION public.ops_alert_condition(text, jsonb, timestamptz, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ops_alert_condition(text, jsonb, timestamptz, boolean) TO service_role;

-- ── 6. schedule + liveness ─────────────────────────────────────────────────
DO $do$
BEGIN
  IF to_regclass('public.cron_work_expectations') IS NOT NULL THEN
    INSERT INTO public.cron_work_expectations (jobname, expected_max_gap, note)
    VALUES ('cron-missed-slot-catch-up', interval '1 hour',
            'Q30: every 10 min, re-runs a missed daily/weekly slot once (catch-up-safe jobs) or alerts.')
    ON CONFLICT (jobname) DO UPDATE SET expected_max_gap = EXCLUDED.expected_max_gap;
  END IF;

  IF EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'cron') THEN
    PERFORM cron.schedule('cron-missed-slot-catch-up', '9-59/10 * * * *',
                          'SELECT public.run_missed_cron_catch_up();');
  END IF;
END
$do$;
