-- Email dead-letter queues raise an alarm instead of swallowing a signup.
--
-- ── The blind spot, measured on prod 2026-09-22 ─────────────────────────────
-- Every email this product sends goes through pgmq: `auth-email-hook` (the
-- Supabase Send Email Hook) enqueues onto `auth_emails`, the app's senders
-- enqueue onto `transactional_emails`, and `process-email-queue` drains both
-- every five minutes through Resend. When a message cannot be delivered —
-- TTL exceeded, or `read_ct > MAX_RETRIES` — that function calls `move_to_dlq`
-- and the message lands in `pgmq.q_auth_emails_dlq` or
-- `pgmq.q_transactional_emails_dlq`.
--
-- Nothing read those tables. `_dlq` appeared in exactly one file in the repo,
-- `supabase/functions/process-email-queue/index.ts`, which is the WRITER. No
-- cron, no CI check, no alert, no test. Read live today:
--   pgmq.q_auth_emails_dlq            1 message  (a `recovery`/password reset
--                                                 for a test account, enqueued
--                                                 2026-09-12 11:23 UTC)
--   pgmq.q_transactional_emails_dlq  50 messages (app notifications, 09-13)
-- Both live queues were empty and the pipeline itself healthy (140 sent, 0
-- failed in 7 days), so every other signal said "email is fine".
--
-- Why it matters at launch: `ProtectedRoute.tsx` blocks on `email_confirmed_at`
-- and email confirmation is the ONLY gate between signup and account access.
-- A real person whose confirmation mail exhausts its retries is silently and
-- permanently locked out, and today nobody would be told. That is why an AUTH
-- message in a DLQ is graded differently from a transactional one below.
--
-- ── Where this hooks into the existing alerting ─────────────────────────────
-- No new alert path is invented. The 5-part system documented in
-- 20260914183932 (and corrected by 20260914192035) is used as-is:
--   * `public.error_logs` is the sink. Its severity is CHECKed to
--     info/warning/error/fatal, so 'critical' is not a storable value.
--   * `trg_error_logs_slack` / `notify_slack_on_error_log()` posts to
--     #ops-alerts for a SERVER-written `severity = 'fatal'` row (plus a short
--     money/security source allow-list), at most one per source per 10 min.
--     This function is SECURITY DEFINER, so `stamp_error_log_origin()` reads
--     `current_user` = its owner and stamps `tags.origin = 'server'` — the
--     fatal row below really does page.
--   * everything below fatal is summarised once a day by
--     `send_ops_daily_digest()` (14:40 UTC), grouped by `tags.source`.
--
-- SEVERITY SPLIT, and why:
--   auth_emails_dlq          → 'fatal'  → pages immediately. A locked-out human
--                                         who cannot get in and cannot ask.
--   transactional_emails_dlq → 'error'  → daily digest. A missed notification
--                                         is real but nobody is stuck.
-- The money/security source allow-list in `notify_slack_on_error_log()` is
-- deliberately NOT extended: severity 'fatal' is the documented general way in,
-- and it keeps the allow-list (mirrored in `_shared/alertPolicy.ts` and checked
-- by src/test/alertPolicy.test.ts) meaning exactly what it says.
--
-- The two queues also get DIFFERENT `tags.source` values on purpose. The Slack
-- trigger's throttle suppresses a post when another row with the SAME source
-- was written in the last 10 minutes, so a shared source would let the
-- transactional row (written in the same sweep) silence the auth page.
--
-- No `net.http_post` call of its own: the fatal row pages through the trigger.
-- A direct post beside it would double-post the same condition.
--
-- ── Not looping ────────────────────────────────────────────────────────────
-- 20260914183932 records what a looping alert costs: the every-row Slack
-- trigger posted a rate-limit error, which was itself logged, which was posted
-- — 616 rows in three days. A sweep that ran every quarter hour and wrote a row
-- whenever a DLQ was non-empty would do the same thing more slowly: the stuck
-- 2026-09-12 message alone would produce ~96 rows a day forever.
--
-- So the dedupe is on the IDENTITY of the backlog, not on a clock. pgmq's
-- `msg_id` comes from a per-queue sequence: monotonic, never reused. This sweep
-- records the highest msg_id it has reported (`context.high_water_msg_id`) and
-- alerts only when the DLQ's current max msg_id is HIGHER than that. So:
--   * a message that sits there unfixed is reported once and never again;
--   * a NEW failure always has a higher msg_id, so it is always reported;
--   * draining the DLQ and refilling it still reports, because msg_ids climb.
-- A time window would have had to choose between re-paging forever and going
-- quiet on a real new failure; the high-water mark has to do neither. It is the
-- same shape as `sweep_cron_blackouts`, which dedupes on `context.gap_start`.
--
-- This migration deliberately does NOT drain, delete or replay the 51 messages
-- already sitting in the two DLQs. The 50 transactional ones are 9-day-old
-- notifications that must never suddenly fire at real users, and what to do
-- with them is a separate decision. This is detection only. The first run will
-- report the existing backlog once (one fatal page for the auth DLQ, one digest
-- line for the transactional one) and then stay quiet until something new
-- fails.
--
-- Replay-safe: CREATE OR REPLACE, every pgmq / pg_cron / table reference
-- guarded by existence, cron re-scheduled by unschedule-then-schedule, the
-- expectation row an ON CONFLICT upsert.

CREATE OR REPLACE FUNCTION public.sweep_email_dlqs()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  -- The watched list. Each row is one DLQ `process-email-queue` can move a
  -- message into (`const dlq = `${queue}_dlq`` over ['auth_emails',
  -- 'transactional_emails']), with the severity that failure deserves.
  -- src/test/emailDlqIsWatched.test.ts reads the queue names out of that edge
  -- function and fails if any of them is missing here, so this list can never
  -- quietly fall behind the code that fills the queues.
  v_watched CONSTANT jsonb := jsonb_build_array(
    jsonb_build_object('dlq', 'auth_emails_dlq',
                       'severity', 'fatal',
                       'source', 'email-dlq-auth',
                       'what', 'sign-in, signup confirmation and password-reset email'),
    jsonb_build_object('dlq', 'transactional_emails_dlq',
                       'severity', 'error',
                       'source', 'email-dlq-transactional',
                       'what', 'app notification email')
  );
  v_reported  int := 0;
  v_seen      jsonb := '[]'::jsonb;
  r           record;
  v_relname   text;
  v_depth     bigint;
  v_max_id    bigint;
  v_oldest    timestamptz;
  v_last_id   bigint;
BEGIN
  FOR r IN SELECT value ->> 'dlq'      AS dlq,
                  value ->> 'severity' AS severity,
                  value ->> 'source'   AS source,
                  value ->> 'what'     AS what
             FROM jsonb_array_elements(v_watched)
  LOOP
    v_relname := 'pgmq.q_' || r.dlq;

    -- pgmq may not be installed at all (a from-scratch replay, PGlite): that is
    -- not a defect to report, it is nothing to look at.
    IF to_regclass(v_relname) IS NULL THEN
      v_seen := v_seen || jsonb_build_object('queue', r.dlq, 'skipped', 'no such queue');
      CONTINUE;
    END IF;

    EXECUTE format('SELECT count(*), max(msg_id), min(enqueued_at) FROM %s', v_relname)
       INTO v_depth, v_max_id, v_oldest;

    IF COALESCE(v_depth, 0) = 0 THEN
      v_seen := v_seen || jsonb_build_object('queue', r.dlq, 'depth', 0);
      CONTINUE;
    END IF;

    -- The highest msg_id any previous alert for this queue covered. NULL means
    -- this queue has never been reported.
    SELECT max((e.context ->> 'high_water_msg_id')::bigint)
      INTO v_last_id
      FROM public.error_logs e
     WHERE e.tags ->> 'queue' = r.dlq
       AND e.tags ->> 'area'  = 'email-dlq'
       AND e.context ? 'high_water_msg_id';

    IF v_last_id IS NOT NULL AND v_last_id >= v_max_id THEN
      -- Same backlog as last time, or smaller. Already reported; say nothing.
      v_seen := v_seen || jsonb_build_object('queue', r.dlq, 'depth', v_depth,
                                             'already_reported_through', v_last_id);
      CONTINUE;
    END IF;

    INSERT INTO public.error_logs (severity, message, tags, context)
    VALUES (
      r.severity,
      format('%s message(s) in the %s dead-letter queue — %s that will never be delivered and that nothing retries. Oldest queued %s UTC.',
             v_depth, r.dlq, r.what,
             to_char(v_oldest AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI')),
      jsonb_build_object('source', r.source, 'area', 'email-dlq', 'queue', r.dlq),
      jsonb_build_object('depth',              v_depth,
                         'high_water_msg_id',  v_max_id,
                         'previously_reported_through', v_last_id,
                         'new_since_last_alert', CASE WHEN v_last_id IS NULL THEN v_depth END,
                         'oldest_enqueued_at',  v_oldest,
                         'queue',               r.dlq));

    v_reported := v_reported + 1;
    v_seen := v_seen || jsonb_build_object('queue', r.dlq, 'depth', v_depth,
                                           'reported_through', v_max_id,
                                           'severity', r.severity);
  END LOOP;

  RETURN jsonb_build_object('reported', v_reported, 'queues', v_seen);
END;
$fn$;

REVOKE ALL ON FUNCTION public.sweep_email_dlqs() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.sweep_email_dlqs() TO service_role;

COMMENT ON FUNCTION public.sweep_email_dlqs() IS
  'Watches the email dead-letter queues that process-email-queue writes to. A non-empty auth_emails_dlq writes a fatal error_logs row (a person locked out of signup) and therefore pages via trg_error_logs_slack; transactional_emails_dlq writes an error row for the daily digest. Deduped on the DLQ''s highest pgmq msg_id, so a stuck message is reported once and a new failure is always reported.';

-- ── Scheduled ──────────────────────────────────────────────────────────────
-- Four times an hour on minutes nothing else uses (see cron.job: 6 is free
-- except 06:06 daily, 21 except every-6h, 36 and 51 are empty). Fifteen minutes
-- is at most three drains of process-email-queue ('3-58/5') behind a permanent
-- failure.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    RAISE NOTICE 'pg_cron not installed — skipping sweep-email-dlqs';
    RETURN;
  END IF;
  PERFORM cron.unschedule('sweep-email-dlqs')
    WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'sweep-email-dlqs');
  PERFORM cron.schedule('sweep-email-dlqs', '6,21,36,51 * * * *',
    $cron$SELECT public.sweep_email_dlqs();$cron$);
END;
$$;

-- A watcher nobody watches is the gap this migration exists to close, so the
-- sweep itself gets a liveness expectation. House rule from 20260901030926:
-- the schedule interval plus real slack, so one missed firing never pages and
-- several consecutive ones do. 15 minutes → 1 hour.
DO $$
BEGIN
  IF to_regclass('public.cron_work_expectations') IS NULL THEN
    RETURN;
  END IF;
  INSERT INTO public.cron_work_expectations (jobname, expected_max_gap)
  VALUES ('sweep-email-dlqs', interval '1 hour')
  ON CONFLICT (jobname) DO UPDATE SET expected_max_gap = EXCLUDED.expected_max_gap;
END;
$$;
