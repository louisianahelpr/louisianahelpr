-- Q1263 + Q1264 (3): two error_logs readers that still counted a CLIENT row.
--
-- anon and authenticated may INSERT into public.error_logs (the signed-out app
-- logs its crashes); stamp_error_log_origin stamps tags.origin = 'client' on
-- those rows. 20261004004835 made every server throttle/dedupe ignore client
-- rows, except two:
--   * detect_stuck_payments: its seed-digest dedupe (source
--     'detect_stuck_payments-seed', job_id, 24 h) counted a forged client row,
--     so one forged row hid a seed job's daily digest line. It was not rewritten
--     then because its live prosrc differed from its newest migration; this body
--     is the LIVE one (pg_get_functiondef read 2026-10-07, md5(prosrc)
--     ae0e73fb0e3fd23491d58963c5279110) with one predicate added.
--   * cron_silent_rule: reads tags.rule off the row id it is handed, trusting
--     source = 'cron-silent' with no origin check (the ledger filters by origin
--     already; this closes the reader itself).
--
-- Guard: src/test/errorLogDedupesIgnoreClientRows.test.ts (both removed from
-- KNOWN_UNFILTERED; the guard fails on a stale entry). Replay-safe: CREATE OR
-- REPLACE with unchanged signatures; grants restated (service_role only, as
-- live: proacl {postgres=X, service_role=X}).

CREATE OR REPLACE FUNCTION public.detect_stuck_payments()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  rec RECORD;
  flagged integer := 0;
  user_label text;
  v_found               integer := 0;
  v_alerted             integer := 0;
  v_already_alerted     integer := 0;
  v_seed_logged         integer := 0;
  v_seed_already_logged integer := 0;
  v_failed              integer := 0;
BEGIN
  FOR rec IN
    SELECT j.id, j.title, j.customer_id, j.stripe_session_id, j.created_at,
           -- A seed job, or any job a seed/test account posted.
           coalesce(j.is_seed OR sp.is_seed, false) AS seed
    FROM public.jobs j
    LEFT JOIN public.profiles sp ON sp.user_id = j.customer_id
    WHERE j.stripe_session_id IS NOT NULL
      AND j.payment_status = 'unpaid'
      AND j.created_at < NOW() - INTERVAL '10 minutes'
      AND j.created_at > NOW() - INTERVAL '24 hours'
      -- A job cancelled with its checkout still open is unwound by
      -- void-cancelled-payments (hourly, :10): it expires the session and
      -- marks the job 'abandoned'. Give it two runs before this counts.
      AND NOT (j.status = 'cancelled'
               AND coalesce(j.cancelled_at, j.updated_at) > NOW() - INTERVAL '2 hours')
    LIMIT 50
  LOOP
    v_found := v_found + 1;
    BEGIN
      IF rec.seed THEN
        -- Seed/E2E job: one digest row per job per day, no admin notification,
        -- no page. error_log_is_seed() keeps it out of Slack and the ledger.
        IF EXISTS (
          SELECT 1 FROM public.error_logs e
           WHERE jsonb_typeof(e.tags) = 'object'
             AND coalesce(e.tags ->> 'origin', '') <> 'client'
             AND e.tags ->> 'source' = 'detect_stuck_payments-seed'
             AND e.tags ->> 'job_id' = rec.id::text
             AND e.created_at > NOW() - INTERVAL '24 hours') THEN
          v_seed_already_logged := v_seed_already_logged + 1;
          CONTINUE;
        END IF;
        INSERT INTO public.error_logs (severity, message, url, tags, context)
        VALUES (
          'info',
          'Stuck payment on a seed/E2E job — checkout started, never settled',
          format('/admin?view=jobs&job=%s', rec.id),
          jsonb_build_object('source', 'detect_stuck_payments-seed', 'seed', true, 'job_id', rec.id::text),
          jsonb_build_object('job_id', rec.id, 'stripe_session_id', rec.stripe_session_id,
                             'customer_id', rec.customer_id, 'created_at', rec.created_at));
        flagged := flagged + 1;
        v_seed_logged := v_seed_logged + 1;
        CONTINUE;
      END IF;

      -- Real job: unchanged — admin notification (deduped per poster per day)
      -- and a critical-source error_logs row that pages.
      IF EXISTS (
        SELECT 1 FROM public.notifications n
        WHERE n.type = 'system_alert'
          AND n.title = 'Stuck payment — webhook may be failing'
          AND n.link = format('/admin?view=people&user=%s', rec.customer_id)
          AND n.created_at > NOW() - INTERVAL '24 hours') THEN
        v_already_alerted := v_already_alerted + 1;
        CONTINUE;
      END IF;

      SELECT COALESCE(NULLIF(full_name, ''), email, 'A user')
      INTO user_label
      FROM public.profiles
      WHERE user_id = rec.customer_id;

      INSERT INTO public.notifications (user_id, type, title, message, link, read)
      SELECT
        ur.user_id,
        'system_alert',
        'Stuck payment — webhook may be failing',
        format('Job "%s" (%s) by %s was checkout-started %s ago but webhook never settled it. Investigate stripe-webhook logs.',
               rec.title,
               substring(rec.id::text, 1, 8),
               COALESCE(user_label, 'unknown'),
               age(NOW(), rec.created_at)),
        format('/admin?view=people&user=%s', rec.customer_id),
        false
      FROM public.user_roles ur
      WHERE ur.role = 'admin';

      INSERT INTO public.error_logs (severity, message, url, tags, context)
      VALUES (
        'error',
        'Stuck payment detected — webhook noop',
        format('/admin?view=jobs&job=%s', rec.id),
        jsonb_build_object('source', 'detect_stuck_payments', 'job_id', rec.id::text),
        jsonb_build_object(
          'job_id', rec.id,
          'stripe_session_id', rec.stripe_session_id,
          'customer_id', rec.customer_id,
          'created_at', rec.created_at
        )
      );

      flagged := flagged + 1;
      v_alerted := v_alerted + 1;
    EXCEPTION WHEN OTHERS THEN
      v_failed := v_failed + 1;
      -- Filed per row (review of this migration): a job that could not be
      -- alerted used to reach RAISE NOTICE only. A seed job's failure goes to
      -- the '-seed' source, which error_log_is_seed keeps out of Slack and the
      -- ledger, same as the seed path above.
      PERFORM public.log_cron_defect(
        CASE WHEN rec.seed THEN 'detect_stuck_payments-seed' ELSE 'detect_stuck_payments' END,
        rec.id::text, SQLERRM,
        jsonb_build_object('job_id', rec.id, 'seed', rec.seed));
      RAISE NOTICE 'detect_stuck_payments: job % failed: %', rec.id, SQLERRM;
    END;
  END LOOP;
  RETURN jsonb_build_object('found', v_found, 'flagged', flagged,
                            'alerted', v_alerted, 'already_alerted', v_already_alerted,
                            'seed_logged', v_seed_logged, 'seed_already_logged', v_seed_already_logged,
                            'failed', v_failed);
END;
$function$;

CREATE OR REPLACE FUNCTION public.cron_silent_rule(p_sample_ref jsonb)
 RETURNS text
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT e.tags ->> 'rule'
    FROM public.error_logs e
   WHERE e.id = CASE WHEN p_sample_ref ->> 'error_log_id' ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
                     THEN (p_sample_ref ->> 'error_log_id')::uuid END
     AND jsonb_typeof(e.tags) = 'object'
     AND coalesce(e.tags ->> 'origin', '') <> 'client'
     AND e.tags ->> 'source' = 'cron-silent'
$function$;

REVOKE ALL ON FUNCTION public.detect_stuck_payments() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.detect_stuck_payments() TO service_role;
REVOKE ALL ON FUNCTION public.cron_silent_rule(jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cron_silent_rule(jsonb) TO service_role;
