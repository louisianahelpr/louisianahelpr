-- Give the SQL cron functions somewhere to report failure that a human reads.
--
-- ── The gap ─────────────────────────────────────────────────────────────────
--
-- Sixteen pg_cron jobs run plain SQL rather than an edge function. Ten of them
-- handle their own failures like this (20260824263000, and it is the shared
-- idiom):
--
--     EXCEPTION WHEN OTHERS THEN
--       RAISE NOTICE 'sweep_release_last_chance: job % failed: %', rec.id, SQLERRM;
--
-- RAISE NOTICE goes to the Postgres log and nowhere else. There is no
-- error_logs row, no Slack message, no counter, and no dashboard — nothing any
-- person on this project has ever opened. The two HTTP-cron watchers cannot see
-- them either: sweep_cron_http_failures and sweep_silent_cron_failures both
-- read net._http_response, and a SQL cron never makes an HTTP request. So a
-- SQL sweep can fail on every row, every five minutes, forever, and every
-- signal in the system stays green.
--
-- Verified against production on 2026-08-31: across all 533 rows in error_logs,
-- `tags->>'source'` is one of these functions exactly 4 times — 3 from
-- sweep_old_notifications and 1 from detect_stuck_payments, the only two that
-- ever write. The other ten have contributed zero rows in the tables' lifetime.
--
-- ── The worse case: no handler at all ───────────────────────────────────────
--
-- Two functions have no EXCEPTION handling anywhere:
--
--   * auto_start_due_jobs (20260811140000) is a single set-based UPDATE. jobs
--     carries AFTER-UPDATE triggers (notify_poster_on_status_change and
--     friends), and a trigger that raises on ONE row aborts the whole
--     statement — so one bad row means zero jobs start, on the cron that owns
--     the accepted → in_progress transition that the escrow clock hangs off.
--     Recorded only in cron.job_run_details, which nothing reads.
--   * detect_suspicious_user_patterns (latest definition 20260510033016) runs
--     four fraud-pattern loops with a bare INSERT in each. One rejected
--     fraud_flags insert kills the run, and patterns 2-4 never get evaluated.
--
-- ── What this migration changes, and what it does not ───────────────────────
--
-- ONLY how these functions report and isolate failure. Every predicate, every
-- window, every LIMIT, every message body, every counter and every return value
-- is reproduced verbatim from the migration that last defined it. The three
-- edits applied to each function are mechanical:
--
--   1. every `RAISE NOTICE '<fn>: … SQLERRM'` gains a public.log_cron_defect()
--      call alongside it (the NOTICE stays — it is still the cheapest thing to
--      grep in the Postgres log);
--   2. every function gets an OUTER handler, so a failure in the driving query
--      itself — the part no per-row block can catch — is recorded instead of
--      vanishing into cron.job_run_details. The partial count is returned, as
--      sweep_old_notifications has always done;
--   3. the two functions with no per-row isolation get it, so one bad row can
--      no longer take the batch down with it.
--
-- Left alone on purpose: detect_stuck_payments and sweep_old_notifications
-- (already write error_logs correctly, and are the shape copied here),
-- sweep_cron_http_failures and sweep_silent_cron_failures (they ARE the
-- watchers, and both already write error_logs and post to slack-ops-alert).
--
-- REPLAY-SAFETY: every statement is CREATE OR REPLACE / CREATE INDEX IF NOT
-- EXISTS. No schedule is touched — the cron.job rows these functions hang off
-- already exist and are correct, and re-typing a working job's command is how a
-- cosmetic migration breaks a live sweep (20260829010000's own header says so).


-- ─────────────────────────────────────────────────────────────────────────────
-- 1. The reporting sink
-- ─────────────────────────────────────────────────────────────────────────────
-- Shape matches what detect_stuck_payments already writes: severity + message +
-- tags.source + context. `tags.area = 'cron'` and `tags.job` match what the two
-- HTTP-cron watchers write, so one filter finds cron failures of either kind.
--
-- Three properties this has to have, because of WHERE it is called from:
--
--   * It must never raise. Every call site is inside an EXCEPTION handler; a
--     throw there propagates out of the handler and aborts exactly the batch
--     the handler exists to protect. Hence the inner catch-all.
--   * It must survive the rollback that put us here. It does: entering an
--     EXCEPTION handler rolls back to the block's savepoint, and statements run
--     inside the handler start a fresh subtransaction that commits with the
--     function's transaction. The defect row lands even though the work did not.
--   * It must be BOUNDED. sweep_daily_job_digest loops over every eligible
--     helper and sweep_pending_broadcast_fan_outs runs every 60 seconds; a
--     systemically broken INSERT would otherwise write thousands of identical
--     rows an hour into the very table the error-log TTL sweeper is trying to
--     keep small. Two limits below: one row per (function, ref) per hour, and
--     at most 20 rows per function per hour. Twenty identical failures is
--     already an unambiguous page; the 21st adds nothing a human needs.
CREATE OR REPLACE FUNCTION public.log_cron_defect(
  p_fn      text,
  p_ref     text,
  p_err     text,
  p_context jsonb DEFAULT '{}'::jsonb
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_ref text := COALESCE(NULLIF(p_ref, ''), 'run');
BEGIN
  -- Same (function, row) already reported this hour — the sweep is simply
  -- retrying a row it cannot process, which is one fact, not sixty.
  IF EXISTS (
    SELECT 1 FROM public.error_logs e
     WHERE e.tags->>'source' = p_fn
       AND e.tags->>'ref'    = v_ref
       AND e.created_at > now() - interval '1 hour'
  ) THEN
    RETURN;
  END IF;

  -- Flood cap. Deliberately silent past the cap: an alert that fills the log is
  -- an alert someone deletes the table to escape.
  IF (
    SELECT count(*) FROM public.error_logs e
     WHERE e.tags->>'source' = p_fn
       AND e.created_at > now() - interval '1 hour'
  ) >= 20 THEN
    RAISE WARNING 'log_cron_defect(%): hourly cap reached, suppressing: % (%)', p_fn, p_err, v_ref;
    RETURN;
  END IF;

  INSERT INTO public.error_logs (severity, message, tags, context)
  VALUES (
    'error',
    format('%s: %s failed: %s', p_fn, v_ref, left(COALESCE(p_err, 'unknown error'), 400)),
    jsonb_build_object('source', p_fn, 'area', 'cron', 'job', p_fn, 'ref', v_ref),
    COALESCE(p_context, '{}'::jsonb) || jsonb_build_object('error', p_err)
  );
EXCEPTION WHEN OTHERS THEN
  -- Logging must never be the thing that breaks the sweep.
  RAISE WARNING 'log_cron_defect(%): could not record defect: % (original: %)', p_fn, SQLERRM, p_err;
END;
$$;

REVOKE ALL ON FUNCTION public.log_cron_defect(text, text, text, jsonb) FROM PUBLIC, anon, authenticated;

-- Makes the two guard queries above index-only rather than a scan of every
-- error_logs row on each call.
CREATE INDEX IF NOT EXISTS error_logs_cron_defect_idx
  ON public.error_logs ((tags->>'source'), (tags->>'ref'), created_at DESC);


-- ─────────────────────────────────────────────────────────────────────────────
-- 2. auto_start_due_jobs — per-row isolation it never had
-- ─────────────────────────────────────────────────────────────────────────────
-- Was one set-based UPDATE, so a trigger raising on any single job aborted the
-- run and started NONE of them. Now the candidate set is selected first and
-- each row updated in its own subtransaction, exactly the shape every other
-- sweep here uses.
--
-- Behaviour preserved exactly: same four predicates, same America/Chicago
-- conversion, same 7-day retro-start backstop, same integer return of how many
-- jobs moved. The only added predicate is `status = 'accepted'` re-checked at
-- UPDATE time, which is a no-op unless the row changed between the scan and the
-- write — in which case skipping it is what the original set-based statement
-- did too, since it held a row lock for the whole statement.
--
-- No LIMIT, matching the original: the 7-day backstop is what bounds the set.
CREATE OR REPLACE FUNCTION public.auto_start_due_jobs()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  rec     record;
  started integer := 0;
BEGIN
  FOR rec IN
    SELECT j.id
      FROM public.jobs j
     WHERE j.status = 'accepted'::job_status
       -- Truly BOOKED, not merely offered. `accepted` covers two different
       -- moments: helpr chosen but not yet confirmed, and both sides locked
       -- in. Auto-starting the former would start a job nobody agreed to.
       AND j.helper_id IS NOT NULL
       AND j.helper_confirmed_at IS NOT NULL
       -- A flexible-schedule job has no meaningful start moment, so there is
       -- nothing to trigger on. Those stay manual.
       AND COALESCE(j.is_flexible_schedule, false) = false
       -- date_needed is a DATE and start_time a naive TIME; both are local
       -- wall-clock. Helpr is Louisiana-only, so they are interpreted in
       -- America/Chicago and converted to an absolute instant.
       AND ((j.date_needed + COALESCE(j.start_time, '00:00'::time))
              AT TIME ZONE 'America/Chicago') <= now()
       -- Backstop: never retro-start something long past.
       AND ((j.date_needed + COALESCE(j.start_time, '00:00'::time))
              AT TIME ZONE 'America/Chicago') > now() - interval '7 days'
     ORDER BY (j.date_needed + COALESCE(j.start_time, '00:00'::time))
  LOOP
    BEGIN
      UPDATE public.jobs j
         SET status = 'in_progress'::job_status
       WHERE j.id = rec.id
         AND j.status = 'accepted'::job_status;

      IF FOUND THEN
        started := started + 1;
      END IF;
    EXCEPTION WHEN OTHERS THEN
      PERFORM public.log_cron_defect(
        'auto_start_due_jobs', rec.id::text, SQLERRM,
        jsonb_build_object('job_id', rec.id));
      RAISE NOTICE 'auto_start_due_jobs: job % failed: %', rec.id, SQLERRM;
    END;
  END LOOP;

  RETURN started;
EXCEPTION WHEN OTHERS THEN
  PERFORM public.log_cron_defect(
    'auto_start_due_jobs', 'run', SQLERRM,
    jsonb_build_object('phase', 'scan', 'started_before_failure', started));
  RETURN started;
END;
$$;


-- ─────────────────────────────────────────────────────────────────────────────
-- 3. detect_suspicious_user_patterns — per-pattern isolation it never had
-- ─────────────────────────────────────────────────────────────────────────────
-- Body reproduced verbatim from 20260510033016 (its latest definition), with
-- each loop's INSERT wrapped so one rejected fraud_flags row cannot stop the
-- remaining patterns from being evaluated. Thresholds, dedup conditions,
-- windows and message text are unchanged.
CREATE OR REPLACE FUNCTION public.detect_suspicious_user_patterns()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  flagged integer := 0;
  rec RECORD;
BEGIN
  -- Pattern 1: burst job posting (10+ jobs in 24h)
  FOR rec IN
    SELECT customer_id AS user_id, COUNT(*) AS job_count
    FROM public.jobs
    WHERE created_at > NOW() - INTERVAL '24 hours'
      AND customer_id IS NOT NULL
    GROUP BY customer_id
    HAVING COUNT(*) >= 10
  LOOP
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM public.fraud_flags ff
        WHERE ff.user_id = rec.user_id
          AND ff.flag_type = 'burst_job_posting'
          AND ff.resolved = false
      ) THEN
        INSERT INTO public.fraud_flags (user_id, flag_type, details, resolved)
        VALUES (
          rec.user_id,
          'burst_job_posting',
          format('Posted %s jobs in the last 24h (threshold 10). Possible bot or spam pattern.', rec.job_count),
          false
        );
        flagged := flagged + 1;
      END IF;
    EXCEPTION WHEN OTHERS THEN
      PERFORM public.log_cron_defect(
        'detect_suspicious_user_patterns', rec.user_id::text, SQLERRM,
        jsonb_build_object('pattern', 'burst_job_posting', 'user_id', rec.user_id));
      RAISE NOTICE 'detect_suspicious_user_patterns burst_job_posting: user % failed: %', rec.user_id, SQLERRM;
    END;
  END LOOP;

  -- Pattern 2: multi-reporter pile-on (3+ distinct reporters in 30d)
  FOR rec IN
    SELECT
      r.reported_id AS user_id,
      COUNT(DISTINCT r.reporter_id) AS distinct_reporters
    FROM public.reports r
    WHERE r.reported_type = 'user'
      AND r.created_at > NOW() - INTERVAL '30 days'
      AND COALESCE(r.status, 'open') NOT IN ('dismissed', 'invalid')
    GROUP BY r.reported_id
    HAVING COUNT(DISTINCT r.reporter_id) >= 3
  LOOP
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM public.fraud_flags ff
        WHERE ff.user_id = rec.user_id
          AND ff.flag_type = 'multi_reporter_flag'
          AND ff.resolved = false
      ) THEN
        INSERT INTO public.fraud_flags (user_id, flag_type, details, resolved)
        VALUES (
          rec.user_id,
          'multi_reporter_flag',
          format('Reported by %s distinct reporters in the last 30 days (threshold 3). Pile-on signal.', rec.distinct_reporters),
          false
        );
        flagged := flagged + 1;
      END IF;
    EXCEPTION WHEN OTHERS THEN
      PERFORM public.log_cron_defect(
        'detect_suspicious_user_patterns', rec.user_id::text, SQLERRM,
        jsonb_build_object('pattern', 'multi_reporter_flag', 'user_id', rec.user_id));
      RAISE NOTICE 'detect_suspicious_user_patterns multi_reporter_flag: user % failed: %', rec.user_id, SQLERRM;
    END;
  END LOOP;

  -- Pattern 3: rapid cancellation (5+ jobs cancelled within 2h of post in 7d)
  FOR rec IN
    SELECT customer_id AS user_id, COUNT(*) AS rapid_cancel_count
    FROM public.jobs
    WHERE created_at > NOW() - INTERVAL '7 days'
      AND customer_id IS NOT NULL
      AND status = 'cancelled'
      AND cancelled_at IS NOT NULL
      AND cancelled_at - created_at < INTERVAL '2 hours'
    GROUP BY customer_id
    HAVING COUNT(*) >= 5
  LOOP
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM public.fraud_flags ff
        WHERE ff.user_id = rec.user_id
          AND ff.flag_type = 'rapid_cancellation_pattern'
          AND ff.resolved = false
      ) THEN
        INSERT INTO public.fraud_flags (user_id, flag_type, details, resolved)
        VALUES (
          rec.user_id,
          'rapid_cancellation_pattern',
          format('Cancelled %s jobs within 2h of posting in the last 7 days (threshold 5). Possible platform churn/test pattern.', rec.rapid_cancel_count),
          false
        );
        flagged := flagged + 1;
      END IF;
    EXCEPTION WHEN OTHERS THEN
      PERFORM public.log_cron_defect(
        'detect_suspicious_user_patterns', rec.user_id::text, SQLERRM,
        jsonb_build_object('pattern', 'rapid_cancellation_pattern', 'user_id', rec.user_id));
      RAISE NOTICE 'detect_suspicious_user_patterns rapid_cancellation_pattern: user % failed: %', rec.user_id, SQLERRM;
    END;
  END LOOP;

  -- Pattern 4: duplicate-content posting (3+ jobs with identical title
  -- OR identical description in last 7d). DISTINCT ON preserves the
  -- single highest-count row per customer so dup_value, dup_field, and
  -- dup_count always describe the same underlying record.
  FOR rec IN
    SELECT DISTINCT ON (customer_id)
      customer_id AS user_id,
      dup_count,
      dup_value,
      dup_field
    FROM (
      SELECT
        customer_id,
        title AS dup_value,
        'title' AS dup_field,
        COUNT(*) AS dup_count
      FROM public.jobs
      WHERE created_at > NOW() - INTERVAL '7 days'
        AND customer_id IS NOT NULL
        AND parent_job_id IS NULL
        AND title IS NOT NULL
        AND length(trim(title)) > 0
      GROUP BY customer_id, title
      HAVING COUNT(*) >= 3
      UNION ALL
      SELECT
        customer_id,
        left(description, 80) AS dup_value,
        'description' AS dup_field,
        COUNT(*) AS dup_count
      FROM public.jobs
      WHERE created_at > NOW() - INTERVAL '7 days'
        AND customer_id IS NOT NULL
        AND parent_job_id IS NULL
        AND description IS NOT NULL
        AND length(trim(description)) > 20
      GROUP BY customer_id, description
      HAVING COUNT(*) >= 3
    ) dups
    ORDER BY customer_id, dup_count DESC
  LOOP
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM public.fraud_flags ff
        WHERE ff.user_id = rec.user_id
          AND ff.flag_type = 'duplicate_content_posting'
          AND ff.resolved = false
      ) THEN
        INSERT INTO public.fraud_flags (user_id, flag_type, details, resolved)
        VALUES (
          rec.user_id,
          'duplicate_content_posting',
          format(
            'Posted %s jobs in the last 7 days with identical %s ("%s"...). Possible copy-paste spam.',
            rec.dup_count,
            rec.dup_field,
            left(rec.dup_value, 60)
          ),
          false
        );
        flagged := flagged + 1;
      END IF;
    EXCEPTION WHEN OTHERS THEN
      PERFORM public.log_cron_defect(
        'detect_suspicious_user_patterns', rec.user_id::text, SQLERRM,
        jsonb_build_object('pattern', 'duplicate_content_posting', 'user_id', rec.user_id));
      RAISE NOTICE 'detect_suspicious_user_patterns duplicate_content_posting: user % failed: %', rec.user_id, SQLERRM;
    END;
  END LOOP;

  RETURN flagged;
EXCEPTION WHEN OTHERS THEN
  PERFORM public.log_cron_defect(
    'detect_suspicious_user_patterns', 'run', SQLERRM,
    jsonb_build_object('phase', 'scan', 'flagged_before_failure', flagged));
  RETURN flagged;
END;
$$;


-- ─────────────────────────────────────────────────────────────────────────────
-- 4. sweep_pending_broadcast_fan_outs (20260506180000)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.sweep_pending_broadcast_fan_outs()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  rec RECORD;
  total_pushed integer := 0;
  this_pushed integer;
BEGIN
  FOR rec IN
    SELECT id, title, message
    FROM public.broadcast_messages
    WHERE pending_push_fan_out_at IS NOT NULL
      AND pending_push_fan_out_at <= NOW()
      AND push_fanned_out_at IS NULL
    ORDER BY pending_push_fan_out_at
    LIMIT 50
  LOOP
    BEGIN
      WITH eligible AS (
        SELECT DISTINCT pt.user_id
        FROM public.push_tokens pt
        LEFT JOIN public.notification_preferences np ON np.user_id = pt.user_id
        WHERE np.user_id IS NULL
           OR (np.push_enabled IS TRUE AND COALESCE(np.system_alerts, true) IS TRUE)
      )
      INSERT INTO public.notifications (user_id, type, title, message, read)
      SELECT user_id, 'system_alert', rec.title, rec.message, false
      FROM eligible;

      GET DIAGNOSTICS this_pushed = ROW_COUNT;
      total_pushed := total_pushed + this_pushed;

      UPDATE public.broadcast_messages
      SET push_fanned_out_at = NOW(),
          pending_push_fan_out_at = NULL
      WHERE id = rec.id;
    EXCEPTION WHEN OTHERS THEN
      PERFORM public.log_cron_defect(
        'sweep_pending_broadcast_fan_outs', rec.id::text, SQLERRM,
        jsonb_build_object('broadcast_id', rec.id));
      RAISE NOTICE 'sweep_pending_broadcast_fan_outs: row % failed: %', rec.id, SQLERRM;
    END;
  END LOOP;
  RETURN total_pushed;
EXCEPTION WHEN OTHERS THEN
  PERFORM public.log_cron_defect(
    'sweep_pending_broadcast_fan_outs', 'run', SQLERRM,
    jsonb_build_object('phase', 'scan', 'pushed_before_failure', total_pushed));
  RETURN total_pushed;
END;
$$;


-- ─────────────────────────────────────────────────────────────────────────────
-- 5. sweep_expired_auto_bans (20260506175614)
-- ─────────────────────────────────────────────────────────────────────────────
-- Worth naming what silence costs here specifically: this is the function that
-- ENDS a suspension. If it fails quietly, a user whose 7-day window expired
-- stays locked out indefinitely, and nothing anywhere says so.
CREATE OR REPLACE FUNCTION public.sweep_expired_auto_bans()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  rec RECORD;
  released integer := 0;
BEGIN
  FOR rec IN
    SELECT user_id, COALESCE(NULLIF(full_name, ''), email, 'A user') AS label
    FROM public.profiles
    WHERE ban_status = 'temp_banned'
      AND auto_suspended_until IS NOT NULL
      AND auto_suspended_until < NOW()
    LIMIT 200
  LOOP
    BEGIN
      UPDATE public.profiles
      SET ban_status = 'active',
          auto_suspended_until = NULL
      WHERE user_id = rec.user_id
        AND ban_status = 'temp_banned'
        AND auto_suspended_until IS NOT NULL
        AND auto_suspended_until < NOW();

      INSERT INTO public.notifications (user_id, type, title, message, link, read)
      VALUES (
        rec.user_id,
        'system_alert',
        'Restriction lifted',
        'Your suspension window has ended. Welcome back — please review the rules to avoid further violations.',
        '/profile',
        false
      );

      released := released + 1;
    EXCEPTION WHEN OTHERS THEN
      PERFORM public.log_cron_defect(
        'sweep_expired_auto_bans', rec.user_id::text, SQLERRM,
        jsonb_build_object('user_id', rec.user_id));
      RAISE NOTICE 'sweep_expired_auto_bans: user % failed: %', rec.user_id, SQLERRM;
    END;
  END LOOP;
  RETURN released;
EXCEPTION WHEN OTHERS THEN
  PERFORM public.log_cron_defect(
    'sweep_expired_auto_bans', 'run', SQLERRM,
    jsonb_build_object('phase', 'scan', 'released_before_failure', released));
  RETURN released;
END;
$$;


-- ─────────────────────────────────────────────────────────────────────────────
-- 6. sweep_job_start_reminders (20260506190000)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.sweep_job_start_reminders()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  rec RECORD;
  total_pushed integer := 0;
BEGIN
  FOR rec IN
    SELECT
      j.id,
      j.title,
      j.customer_id,
      j.helper_id,
      ((j.date_needed + j.start_time) AT TIME ZONE 'America/Chicago') AS scheduled_start
    FROM public.jobs j
    WHERE j.start_reminder_sent_at IS NULL
      AND j.status = 'accepted'
      AND j.helper_id IS NOT NULL
      AND j.start_time IS NOT NULL
      AND j.date_needed IS NOT NULL
      AND ((j.date_needed + j.start_time) AT TIME ZONE 'America/Chicago')
            BETWEEN NOW() AND NOW() + INTERVAL '35 minutes'
    ORDER BY (j.date_needed + j.start_time)
    LIMIT 100
  LOOP
    BEGIN
      INSERT INTO public.notifications (user_id, type, title, message, link, read)
      VALUES
        (
          rec.customer_id,
          'job_update',
          'Starting soon',
          format('"%s" starts in about 30 minutes. Your helpr should be on the way.', rec.title),
          format('/jobs/%s', rec.id),
          false
        ),
        (
          rec.helper_id,
          'job_update',
          'Starting soon',
          format('"%s" starts in about 30 minutes. Head out so you arrive on time.', rec.title),
          format('/jobs/%s', rec.id),
          false
        );

      UPDATE public.jobs
      SET start_reminder_sent_at = NOW()
      WHERE id = rec.id;

      total_pushed := total_pushed + 2;
    EXCEPTION WHEN OTHERS THEN
      PERFORM public.log_cron_defect(
        'sweep_job_start_reminders', rec.id::text, SQLERRM,
        jsonb_build_object('job_id', rec.id));
      RAISE NOTICE 'sweep_job_start_reminders: job % failed: %', rec.id, SQLERRM;
    END;
  END LOOP;
  RETURN total_pushed;
EXCEPTION WHEN OTHERS THEN
  PERFORM public.log_cron_defect(
    'sweep_job_start_reminders', 'run', SQLERRM,
    jsonb_build_object('phase', 'scan', 'pushed_before_failure', total_pushed));
  RETURN total_pushed;
END;
$$;


-- ─────────────────────────────────────────────────────────────────────────────
-- 7. sweep_no_show_alerts (20260506200000)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.sweep_no_show_alerts()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  rec RECORD;
  total_pushed integer := 0;
BEGIN
  FOR rec IN
    SELECT
      j.id,
      j.title,
      j.customer_id,
      j.helper_id
    FROM public.jobs j
    WHERE j.no_show_alert_sent_at IS NULL
      AND j.status = 'accepted'
      AND j.helper_id IS NOT NULL
      AND j.start_time IS NOT NULL
      AND j.date_needed IS NOT NULL
      -- Scheduled start was at least 30 min ago and at most 6 hours ago.
      -- The 6-hour cap stops the sweep from re-alerting on stale rows
      -- whose helpers genuinely abandoned them — those become an admin
      -- triage problem, not a notification spam loop.
      AND ((j.date_needed + j.start_time) AT TIME ZONE 'America/Chicago')
            BETWEEN NOW() - INTERVAL '6 hours' AND NOW() - INTERVAL '30 minutes'
    ORDER BY (j.date_needed + j.start_time)
    LIMIT 100
  LOOP
    BEGIN
      INSERT INTO public.notifications (user_id, type, title, message, link, read)
      VALUES
        (
          rec.customer_id,
          'job_update',
          'Has your helpr arrived?',
          format('"%s" was scheduled to start 30 minutes ago. If your helpr hasn''t arrived, you can mark this as a no-show in the app.', rec.title),
          format('/jobs/%s', rec.id),
          false
        ),
        (
          rec.helper_id,
          'work_status',
          'Did you start this job?',
          format('"%s" was scheduled to start 30 minutes ago. Tap Start when you arrive, or message the customer if you''re delayed.', rec.title),
          format('/jobs/%s', rec.id),
          false
        );

      UPDATE public.jobs
      SET no_show_alert_sent_at = NOW()
      WHERE id = rec.id;

      total_pushed := total_pushed + 2;
    EXCEPTION WHEN OTHERS THEN
      PERFORM public.log_cron_defect(
        'sweep_no_show_alerts', rec.id::text, SQLERRM,
        jsonb_build_object('job_id', rec.id));
      RAISE NOTICE 'sweep_no_show_alerts: job % failed: %', rec.id, SQLERRM;
    END;
  END LOOP;
  RETURN total_pushed;
EXCEPTION WHEN OTHERS THEN
  PERFORM public.log_cron_defect(
    'sweep_no_show_alerts', 'run', SQLERRM,
    jsonb_build_object('phase', 'scan', 'pushed_before_failure', total_pushed));
  RETURN total_pushed;
END;
$$;


-- ─────────────────────────────────────────────────────────────────────────────
-- 8. sweep_daily_job_digest (20260506202145)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.sweep_daily_job_digest()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  rec RECORD;
  total_sent integer := 0;
  budget_lo integer;
  budget_hi integer;
BEGIN
  FOR rec IN
    WITH new_jobs AS (
      SELECT j.id, j.parish, j.budget
      FROM public.jobs j
      WHERE j.status = 'open'
        AND j.created_at > NOW() - INTERVAL '24 hours'
        AND j.parish IS NOT NULL
    ),
    parish_counts AS (
      SELECT
        parish,
        COUNT(*) AS cnt,
        MIN(budget) AS min_budget,
        MAX(budget) AS max_budget
      FROM new_jobs
      GROUP BY parish
    )
    SELECT
      p.user_id,
      p.parish,
      pc.cnt,
      pc.min_budget,
      pc.max_budget
    FROM public.profiles p
    JOIN parish_counts pc ON pc.parish = p.parish
    LEFT JOIN public.notification_preferences np ON np.user_id = p.user_id
    WHERE p.parish IS NOT NULL
      AND p.approval_status = 'approved'
      AND (p.ban_status IS NULL OR p.ban_status NOT IN ('banned', 'temp_banned', 'permanently_banned'))
      AND (np.user_id IS NULL OR COALESCE(np.job_updates, true) IS TRUE)
      AND EXISTS (
        SELECT 1 FROM public.applications WHERE helper_id = p.user_id
        UNION ALL
        SELECT 1 FROM public.jobs WHERE customer_id = p.user_id
      )
      AND NOT EXISTS (
        SELECT 1 FROM public.notifications n
        WHERE n.user_id = p.user_id
          AND n.title LIKE 'New jobs in%'
          AND n.created_at > NOW() - INTERVAL '23 hours'
      )
  LOOP
    BEGIN
      budget_lo := FLOOR(rec.min_budget)::integer;
      budget_hi := CEIL(rec.max_budget)::integer;
      INSERT INTO public.notifications (user_id, type, title, message, link, read)
      VALUES (
        rec.user_id,
        'job_match',
        format('New jobs in %s', rec.parish),
        format(
          '%s new %s posted in the last 24 hours — %s. Tap to browse.',
          rec.cnt,
          CASE WHEN rec.cnt = 1 THEN 'job' ELSE 'jobs' END,
          CASE
            WHEN budget_lo = budget_hi THEN format('$%s', budget_lo)
            ELSE format('$%s to $%s', budget_lo, budget_hi)
          END
        ),
        '/dashboard',
        false
      );
      total_sent := total_sent + 1;
    EXCEPTION WHEN OTHERS THEN
      PERFORM public.log_cron_defect(
        'sweep_daily_job_digest', rec.user_id::text, SQLERRM,
        jsonb_build_object('user_id', rec.user_id, 'parish', rec.parish));
      RAISE NOTICE 'sweep_daily_job_digest: user % failed: %', rec.user_id, SQLERRM;
    END;
  END LOOP;
  RETURN total_sent;
EXCEPTION WHEN OTHERS THEN
  PERFORM public.log_cron_defect(
    'sweep_daily_job_digest', 'run', SQLERRM,
    jsonb_build_object('phase', 'scan', 'sent_before_failure', total_sent));
  RETURN total_sent;
END;
$$;


-- ─────────────────────────────────────────────────────────────────────────────
-- 9. sweep_dayof_confirm_reminders (20260824241000)
-- ─────────────────────────────────────────────────────────────────────────────
-- Two passes, two per-row handlers; both are reported separately so an alert
-- says which pass broke.
CREATE OR REPLACE FUNCTION public.sweep_dayof_confirm_reminders()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  rec RECORD;
  total_pushed integer := 0;
  v_start timestamptz;
BEGIN
  -- Pass 1: window open — remind the unanswered parties.
  FOR rec IN
    SELECT j.id, j.title, j.customer_id, j.helper_id,
           j.helper_confirmed_at, j.helper_dayof_confirmed_at, j.poster_confirmed_at,
           ((j.date_needed + COALESCE(j.start_time, '09:00'::time)) AT TIME ZONE 'America/Chicago') AS scheduled_start
    FROM public.jobs j
    WHERE j.dayof_confirm_reminder_sent_at IS NULL
      AND j.status = 'accepted'
      AND j.helper_id IS NOT NULL
      AND j.date_needed IS NOT NULL
      AND ((j.date_needed + COALESCE(j.start_time, '09:00'::time)) AT TIME ZONE 'America/Chicago')
            BETWEEN NOW() AND NOW() + INTERVAL '24 hours'
    ORDER BY (j.date_needed + j.start_time)
    LIMIT 100
  LOOP
    BEGIN
      v_start := rec.scheduled_start;
      -- Helper: skip when the day-of stamp exists OR the accept itself
      -- happened inside the window (same grace as JobConfirmation).
      IF rec.helper_dayof_confirmed_at IS NULL
         AND (rec.helper_confirmed_at IS NULL
              OR v_start - rec.helper_confirmed_at > INTERVAL '24 hours') THEN
        INSERT INTO public.notifications (user_id, type, title, message, link, read)
        VALUES (rec.helper_id, 'job_update', 'Still on for tomorrow?',
                format('"%s" starts soon — tap to confirm you''re still on. One tap keeps your spot.', rec.title),
                '/my-jobs?filter=offered', false);
        total_pushed := total_pushed + 1;
      END IF;
      IF rec.poster_confirmed_at IS NULL THEN
        INSERT INTO public.notifications (user_id, type, title, message, link, read)
        VALUES (rec.customer_id, 'job_update', 'Still on for tomorrow?',
                format('"%s" starts soon — tap to confirm you''re still on so your Helpr knows it''s a go.', rec.title),
                '/my-posts?filter=offered', false);
        total_pushed := total_pushed + 1;
      END IF;
      UPDATE public.jobs SET dayof_confirm_reminder_sent_at = NOW() WHERE id = rec.id;
    EXCEPTION WHEN OTHERS THEN
      PERFORM public.log_cron_defect(
        'sweep_dayof_confirm_reminders', format('p1:%s', rec.id), SQLERRM,
        jsonb_build_object('pass', 1, 'job_id', rec.id));
      RAISE NOTICE 'sweep_dayof_confirm_reminders p1: job % failed: %', rec.id, SQLERRM;
    END;
  END LOOP;

  -- Pass 2: T-12h and the helper still hasn't answered — alert the poster.
  FOR rec IN
    SELECT j.id, j.title, j.customer_id,
           ((j.date_needed + COALESCE(j.start_time, '09:00'::time)) AT TIME ZONE 'America/Chicago') AS scheduled_start
    FROM public.jobs j
    WHERE j.dayof_unanswered_poster_alert_sent_at IS NULL
      AND j.status = 'accepted'
      AND j.helper_id IS NOT NULL
      AND j.date_needed IS NOT NULL
      AND j.helper_dayof_confirmed_at IS NULL
      AND (j.helper_confirmed_at IS NULL
           OR ((j.date_needed + COALESCE(j.start_time, '09:00'::time)) AT TIME ZONE 'America/Chicago') - j.helper_confirmed_at > INTERVAL '24 hours')
      AND ((j.date_needed + COALESCE(j.start_time, '09:00'::time)) AT TIME ZONE 'America/Chicago')
            BETWEEN NOW() AND NOW() + INTERVAL '12 hours'
    ORDER BY (j.date_needed + j.start_time)
    LIMIT 100
  LOOP
    BEGIN
      INSERT INTO public.notifications (user_id, type, title, message, link, read)
      VALUES (rec.customer_id, 'warning', 'Your Helpr hasn''t confirmed yet',
              format('"%s" starts in under 12 hours and your Helpr hasn''t confirmed they''re still on. Message them — or line up a backup while there''s time.', rec.title),
              '/my-posts?filter=offered', false);
      UPDATE public.jobs SET dayof_unanswered_poster_alert_sent_at = NOW() WHERE id = rec.id;
      total_pushed := total_pushed + 1;
    EXCEPTION WHEN OTHERS THEN
      PERFORM public.log_cron_defect(
        'sweep_dayof_confirm_reminders', format('p2:%s', rec.id), SQLERRM,
        jsonb_build_object('pass', 2, 'job_id', rec.id));
      RAISE NOTICE 'sweep_dayof_confirm_reminders p2: job % failed: %', rec.id, SQLERRM;
    END;
  END LOOP;

  RETURN total_pushed;
EXCEPTION WHEN OTHERS THEN
  PERFORM public.log_cron_defect(
    'sweep_dayof_confirm_reminders', 'run', SQLERRM,
    jsonb_build_object('phase', 'scan', 'pushed_before_failure', total_pushed));
  RETURN total_pushed;
END;
$$;


-- ─────────────────────────────────────────────────────────────────────────────
-- 10. sweep_release_last_chance (20260824263000) — the exemplar in the report
-- ─────────────────────────────────────────────────────────────────────────────
-- This one is on the money path: it is the last warning a poster gets before
-- escrow auto-releases. A silent failure here means the release happens with no
-- warning at all, and the only trace was a NOTICE.
CREATE OR REPLACE FUNCTION public.sweep_release_last_chance()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  rec RECORD;
  total_pushed integer := 0;
BEGIN
  FOR rec IN
    SELECT j.id, j.title, j.customer_id
      FROM public.jobs j
     WHERE j.release_last_chance_notif_sent_at IS NULL
       AND j.status = 'in_progress'
       AND j.payment_status = 'escrow'
       AND j.poster_completed_at IS NULL
       AND j.revision_requested_at IS NULL
       AND j.helper_completed_at IS NOT NULL
       -- inside the final 2 hours of the 24h window
       AND j.helper_completed_at <= NOW() - INTERVAL '22 hours'
       AND j.helper_completed_at >  NOW() - INTERVAL '24 hours'
     ORDER BY j.helper_completed_at
     LIMIT 100
  LOOP
    BEGIN
      INSERT INTO public.notifications (user_id, type, title, message, link, read)
      VALUES (
        rec.customer_id,
        'warning',
        'Last chance to review',
        format('"%s" auto-releases payment in about 2 hours. Approve it, or request a revision now if something''s wrong.', rec.title),
        '/my-posts',
        false
      );
      UPDATE public.jobs SET release_last_chance_notif_sent_at = NOW() WHERE id = rec.id;
      total_pushed := total_pushed + 1;
    EXCEPTION WHEN OTHERS THEN
      PERFORM public.log_cron_defect(
        'sweep_release_last_chance', rec.id::text, SQLERRM,
        jsonb_build_object('job_id', rec.id));
      RAISE NOTICE 'sweep_release_last_chance: job % failed: %', rec.id, SQLERRM;
    END;
  END LOOP;
  RETURN total_pushed;
EXCEPTION WHEN OTHERS THEN
  PERFORM public.log_cron_defect(
    'sweep_release_last_chance', 'run', SQLERRM,
    jsonb_build_object('phase', 'scan', 'pushed_before_failure', total_pushed));
  RETURN total_pushed;
END;
$$;


-- ─────────────────────────────────────────────────────────────────────────────
-- 11. The three delete-only TTL sweeps
-- ─────────────────────────────────────────────────────────────────────────────
-- These do not SWALLOW anything — a failing DELETE propagates. But it
-- propagates to cron.job_run_details, which is the same "recorded nowhere a
-- human looks" outcome, so they get the same sink. Behaviour, windows and
-- return values unchanged.
CREATE OR REPLACE FUNCTION public.sweep_old_error_logs()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  deleted_count integer := 0;
  noisy_deleted integer := 0;
  serious_deleted integer := 0;
BEGIN
  -- info/warning rows older than 30 days
  DELETE FROM public.error_logs
  WHERE severity IN ('info', 'warning')
    AND created_at < NOW() - INTERVAL '30 days';
  GET DIAGNOSTICS noisy_deleted = ROW_COUNT;

  -- error/fatal rows older than 90 days
  DELETE FROM public.error_logs
  WHERE severity IN ('error', 'fatal')
    AND created_at < NOW() - INTERVAL '90 days';
  GET DIAGNOSTICS serious_deleted = ROW_COUNT;

  deleted_count := noisy_deleted + serious_deleted;
  RETURN deleted_count;
EXCEPTION WHEN OTHERS THEN
  PERFORM public.log_cron_defect('sweep_old_error_logs', 'run', SQLERRM, '{}'::jsonb);
  RETURN deleted_count;
END;
$$;

CREATE OR REPLACE FUNCTION public.sweep_old_email_send_log()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  deleted_count integer := 0;
BEGIN
  DELETE FROM public.email_send_log
  WHERE status IN ('sent', 'suppressed', 'failed', 'bounced', 'complained')
    AND created_at < NOW() - INTERVAL '90 days';
  GET DIAGNOSTICS deleted_count = ROW_COUNT;

  RETURN deleted_count;
EXCEPTION WHEN OTHERS THEN
  PERFORM public.log_cron_defect('sweep_old_email_send_log', 'run', SQLERRM, '{}'::jsonb);
  RETURN deleted_count;
END;
$$;

-- Was LANGUAGE sql; becomes plpgsql only so it can have a handler. Same DELETE,
-- same 45-day window, same void return.
CREATE OR REPLACE FUNCTION public.prune_cron_run_log()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  DELETE FROM public.cron_run_log WHERE occurred_at < now() - interval '45 days';
EXCEPTION WHEN OTHERS THEN
  PERFORM public.log_cron_defect('prune_cron_run_log', 'run', SQLERRM, '{}'::jsonb);
END;
$$;


-- ─────────────────────────────────────────────────────────────────────────────
-- 12. Grants
-- ─────────────────────────────────────────────────────────────────────────────
-- CREATE OR REPLACE preserves existing privileges, so these are restatements of
-- what each migration already set. Kept explicit because the Supabase advisor
-- pass has stripped defaults before (the #355/#358/#364/#366 grant regressions)
-- and scripts/check-migration-grants.mjs wants an explicit grant on record.
REVOKE ALL ON FUNCTION public.auto_start_due_jobs()               FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.detect_suspicious_user_patterns()   FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.sweep_pending_broadcast_fan_outs()  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.sweep_expired_auto_bans()           FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.sweep_job_start_reminders()         FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.sweep_no_show_alerts()              FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.sweep_daily_job_digest()            FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.sweep_dayof_confirm_reminders()     FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.sweep_release_last_chance()         FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.sweep_old_error_logs()              FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.sweep_old_email_send_log()          FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.prune_cron_run_log()                FROM PUBLIC, anon, authenticated;

COMMENT ON FUNCTION public.log_cron_defect(text, text, text, jsonb) IS
'Failure sink for SQL cron functions: writes one error_logs row per (function, ref) per hour, capped at 20 per function per hour, and never raises. Call it from inside an EXCEPTION handler.';
