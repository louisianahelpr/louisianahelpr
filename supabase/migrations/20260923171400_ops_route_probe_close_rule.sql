-- Q94 (docs/OPEN.md): the synthetic half of the user-error-screen close rule.
--
-- Owner spec (Q39): a user-error-screen ledger item closes only when the screen
-- went 24h without a real person seeing it AND a synthetic check of that route
-- passes. Until now only the 24h half existed: nothing that probes routes wrote
-- a per-route pass anywhere SQL could read it.
--
--  * public.ops_route_probe(route, passed_at): the newest clean synthetic pass
--    per route KEY. Written only by record_route_probe_passes() (service_role),
--    which press-every-control calls once per shard with every pathname whose
--    rows in that run loaded without an error screen and had zero failed
--    presses (scripts/audit/pressRouteProbe.mjs decides which).
--  * public.ops_route_key(text): the route key both sides agree on. Pathname
--    only (query and hash dropped), trailing slash dropped, and every uuid or
--    all-digit segment becomes ':id', so the press run's /jobs/<its fixture>
--    and a person's /jobs/<their job> are the same screen.
--  * ops_alert_condition('user-error-screen'): restated from its NEWEST
--    definition (20260923133021_cron_missed_slot_catch_up.sql) verbatim except
--    the non-overflow user-error-screen branch, which is still failing while a
--    real row is < 24h old (unchanged) OR no probe pass for the item's screen
--    is newer than p_since (the item's last_seen). The overflow item has no
--    single screen and keeps the 24h rule alone.
--
-- Replay-safe: IF NOT EXISTS / CREATE OR REPLACE, grants restated.
-- Grants: FROM PUBLIC, anon, authenticated; service_role only.

CREATE TABLE IF NOT EXISTS public.ops_route_probe (
  route     text PRIMARY KEY,
  passed_at timestamptz NOT NULL,
  run_ref   text
);
COMMENT ON TABLE public.ops_route_probe IS
  'Q94: newest clean synthetic pass per route key (ops_route_key). Written by record_route_probe_passes (press-every-control); read by ops_alert_condition(''user-error-screen'').';
ALTER TABLE public.ops_route_probe ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.ops_route_probe FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.ops_route_probe TO service_role;

CREATE OR REPLACE FUNCTION public.ops_route_key(p_route text)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public'
AS $fn$
  SELECT CASE WHEN k = '' THEN '/' ELSE k END
    FROM (
      SELECT regexp_replace(
               regexp_replace(
                 regexp_replace(
                   split_part(split_part(coalesce(p_route, ''), '?', 1), '#', 1),
                   '/[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}(?=/|$)', '/:id', 'g'),
                 '/[0-9]+(?=/|$)', '/:id', 'g'),
               '/+$', '') AS k
    ) x;
$fn$;
REVOKE ALL ON FUNCTION public.ops_route_key(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ops_route_key(text) TO service_role;

CREATE OR REPLACE FUNCTION public.record_route_probe_passes(p_routes text[], p_run_ref text DEFAULT NULL)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $fn$
DECLARE
  v_n int;
BEGIN
  INSERT INTO public.ops_route_probe AS p (route, passed_at, run_ref)
  SELECT DISTINCT public.ops_route_key(r), now(), left(p_run_ref, 200)
    FROM unnest(coalesce(p_routes, ARRAY[]::text[])) r
   WHERE r LIKE '/%'
  ON CONFLICT (route) DO UPDATE
     SET passed_at = GREATEST(p.passed_at, EXCLUDED.passed_at),
         run_ref   = EXCLUDED.run_ref;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN v_n;
END;
$fn$;
REVOKE ALL ON FUNCTION public.record_route_probe_passes(text[], text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_route_probe_passes(text[], text) TO service_role;

-- ledger close rule (newest body, 20260923133021, + the Q94 synthetic half)
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
    IF EXISTS (
      SELECT 1 FROM public.error_logs e
       WHERE e.created_at > now() - interval '24 hours'
         AND public.is_user_error_screen_row(e.tags)
         AND public.user_error_screen_is_real(e.user_id, e.tags)
         AND public.ops_alert_normalise(public.user_error_screen_title(e.tags ->> 'screen', e.message))
             = p_sample_ref ->> 'title_norm') THEN
      RETURN true;
    END IF;
    -- Q94, the synthetic half: 24h without a real person seeing it is not
    -- enough; the press run must also have walked the item's screen cleanly
    -- AFTER its last occurrence (p_since = the item's last_seen). An item with
    -- no screen has nothing to probe, so it stays open for a person to close.
    RETURN NOT EXISTS (
      SELECT 1 FROM public.ops_route_probe p
       WHERE p.route = public.ops_route_key(p_sample_ref ->> 'screen')
         AND p.passed_at > p_since);
  END IF;
  RETURN NULL;
END;
$function$;

REVOKE ALL ON FUNCTION public.ops_alert_condition(text, jsonb, timestamptz, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ops_alert_condition(text, jsonb, timestamptz, boolean) TO service_role;
