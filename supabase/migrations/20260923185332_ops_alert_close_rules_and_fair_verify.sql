-- Q287, Q298, Q291 (docs/OPEN.md): three ledger close-rule fixes, one
-- migration because each restates ops_alert_condition or its verifier.
--
--  * Q287. 'cron-http-untagged' items (sweep_cron_http_failures, Q218) had no
--    ops_alert_condition branch, so ops_alert_record filed them 'manual' and
--    only a person could close one. New branch: still failing while an ACTIVE
--    cron.job row with that jobname calls net.http_post without
--    cron_http_tag( (the detector's own predicate). Open items already filed
--    are moved to sql_condition below; ops_alert_record never rewrites
--    verify_kind on a repeat. 'cron-missed-slot' stays manual by design.
--  * Q298. (a) A user-error-screen item with no screen keyed to '/'
--    (ops_route_key(null) = '/'), so any press pass on the landing page closed
--    it, against its own comment. It now stays failing before the probe check.
--    (b) record_route_probe_passes takes at most 1000 routes (raises
--    otherwise, never truncates silently) and keys at most 512 chars of each.
--  * Q291. ops_alert_verify re-asked at most 200 items per loop, newest
--    last_seen first, so a burst of fresh items starved an older item (a stuck
--    payment) indefinitely. Now each source's least recently asked item comes
--    before any source's second, never-asked first then oldest last_seen, and
--    every ask stamps verify_started_at (including "could not tell") so the
--    rotation always advances. The companions loop rotates the same way.
--
-- Restated from the NEWEST bodies: ops_alert_condition from
-- 20260923182022_ops_route_probe_close_rule.sql (keeps Q64's user-report
-- branches and Q94's probe half), ops_alert_verify and
-- record_route_probe_passes from 20260923050059 / 20260923182022; verbatim
-- apart from the changes above.
-- Replay-safe: CREATE OR REPLACE only; the backfill is idempotent.
-- Grants: FROM PUBLIC, anon, authenticated; service_role only.

CREATE OR REPLACE FUNCTION public.record_route_probe_passes(p_routes text[], p_run_ref text DEFAULT NULL)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $fn$
DECLARE
  v_n int;
BEGIN
  -- Q298(b): one press shard walks well under 1000 screens.
  IF coalesce(cardinality(p_routes), 0) > 1000 THEN
    RAISE EXCEPTION 'record_route_probe_passes: % routes, at most 1000', cardinality(p_routes)
      USING ERRCODE = '22023';
  END IF;
  INSERT INTO public.ops_route_probe AS p (route, passed_at, run_ref)
  SELECT DISTINCT public.ops_route_key(left(r, 512)), now(), left(p_run_ref, 200)
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

-- ledger close rule (newest body, 20260923182022 (Q94), + Q287 and Q298(a))
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

  ELSIF p_source = 'cron-http-untagged' AND v_job IS NOT NULL THEN
    IF p_probe_only THEN RETURN true; END IF;
    -- Q287. The detector's own predicate (sweep_cron_http_failures, Q218) for
    -- THIS job: still failing while an ACTIVE cron.job row of that name (or
    -- 'jobid N' when unnamed, as the detector names it) calls net.http_post
    -- without public.cron_http_tag(. Wrapped, deactivated or unscheduled clears.
    -- 'cron-missed-slot' (Q207) has no branch on purpose: it stays manual.
    IF to_regclass('cron.job') IS NULL THEN RETURN NULL; END IF;
    RETURN EXISTS (
      SELECT 1 FROM cron.job j
       WHERE j.active
         AND coalesce(j.jobname, 'jobid ' || j.jobid) = v_job
         AND j.command LIKE '%net.http_post(%'
         AND j.command NOT LIKE '%cron_http_tag(%');

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

  ELSIF p_source = 'user-report' THEN
    IF p_probe_only THEN RETURN true; END IF;
    -- Q64. Re-asks public.reports itself: still failing while ANY real report
    -- with this normalised title is still open (pending/new/investigating) in
    -- its admin queue. Resolving or dismissing it there is what clears it.
    -- The status list is spelled out (not only user_report_is_open) so the
    -- planner filters on the column before any per-row function call.
    --
    -- The overflow item (the new-item cap) has no single title: still failing
    -- while ANY open real report has no item of its own.
    IF coalesce((p_sample_ref ->> 'overflow')::boolean, false) THEN
      RETURN EXISTS (
        SELECT 1 FROM public.reports r
         WHERE r.status IN ('pending', 'new', 'investigating')
           AND public.user_report_is_real(r.reporter_id)
           AND NOT EXISTS (
             SELECT 1 FROM public.ops_alert_ledger l
              WHERE l.source_kind = 'user-report' AND l.source = 'user-report'
                AND l.title = public.ops_alert_normalise(public.user_report_title(r.reported_type, r.reason))));
    END IF;
    IF p_sample_ref ->> 'title_norm' IS NULL THEN RETURN NULL; END IF;
    RETURN EXISTS (
      SELECT 1 FROM public.reports r
       WHERE r.status IN ('pending', 'new', 'investigating')
         AND public.user_report_is_open(r.status)
         AND public.user_report_is_real(r.reporter_id)
         AND public.ops_alert_normalise(public.user_report_title(r.reported_type, r.reason))
             = p_sample_ref ->> 'title_norm');

  ELSIF p_source = 'ops-alert:support_request' THEN
    IF p_probe_only THEN RETURN true; END IF;
    -- Q64. The Slack ping contact-support posts. The per-report user-report
    -- items carry the tracking; this one clears when none of them is open.
    RETURN EXISTS (
      SELECT 1 FROM public.ops_alert_ledger l
       WHERE l.source_kind = 'user-report' AND l.status <> 'closed');

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
    -- Q298(a): no screen would key to '/' (ops_route_key(null) = '/'), so a
    -- press pass on the landing page would close it. Nothing to probe: open.
    IF nullif(p_sample_ref ->> 'screen', '') IS NULL THEN RETURN true; END IF;
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

-- Q291: the verifier (newest body, 20260923050059), fair rotation.
CREATE OR REPLACE FUNCTION public.ops_alert_verify()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  r         record;
  v_still   boolean;
  v_closed  int := 0;
  v_open    int := 0;
  v_unknown int := 0;
  v_comp      int;
  v_comp_open int;
  v_folded  int;
  v_at      timestamptz := clock_timestamp();
BEGIN
  -- Occurrences that arrived while their ledger row was busy. Folded BEFORE
  -- anything is judged, so a queued re-occurrence re-opens its item instead of
  -- the item being closed under it.
  v_folded := public.ops_alert_fold_pending();

  -- Q291: fair, not newest-first. Each source's least recently asked item
  -- (never asked first, then oldest last_seen) comes before any source's
  -- second, so a burst of fresh items from one source can no longer push an
  -- older item of another (a stuck payment) past the batch limit.
  FOR r IN SELECT * FROM (
             SELECT l.*, row_number() OVER (
                      PARTITION BY coalesce(l.verify_ref, l.source)
                      ORDER BY l.verify_started_at ASC NULLS FIRST, l.last_seen ASC, l.id) AS src_rank
               FROM public.ops_alert_ledger l
              WHERE l.status <> 'closed' AND l.verify_kind = 'sql_condition') x
            ORDER BY x.src_rank, x.verify_started_at ASC NULLS FIRST, x.last_seen ASC, x.id
            LIMIT 200
  LOOP
    BEGIN
      -- NOTE: not side-effect free for every source — ops-digest-undelivered
      -- may write error_logs and post to Slack (see ops_alert_condition).
      v_still := public.ops_alert_condition(coalesce(r.verify_ref, r.source), r.sample_ref, r.last_seen, false);
    EXCEPTION WHEN OTHERS THEN
      v_still := NULL;
      UPDATE public.ops_alert_ledger SET verify_note = left('verify raised: ' || SQLERRM, 500), updated_at = now()
       WHERE id = r.id;
    END;

    IF v_still IS FALSE THEN
      -- Guard against a new occurrence landing between the read and here.
      UPDATE public.ops_alert_ledger
         SET status = 'closed', closed_at = now(), verify_started_at = v_at,
             closed_evidence = format('ops_alert_condition(%s) re-asked at %s: cleared', coalesce(r.verify_ref, r.source), v_at),
             updated_at = now()
       WHERE id = r.id AND last_seen = r.last_seen AND status <> 'closed';
      v_closed := v_closed + 1;
    ELSIF v_still IS TRUE THEN
      UPDATE public.ops_alert_ledger
         SET verify_started_at = v_at,
             verify_note = format('still failing when re-asked at %s', v_at),
             status = CASE WHEN status = 'verifying' THEN 'open' ELSE status END,
             updated_at = now()
       WHERE id = r.id;
      v_open := v_open + 1;
    ELSE
      -- Q291: asked, even if it could not tell, so the rotation moves on.
      UPDATE public.ops_alert_ledger SET verify_started_at = v_at, updated_at = now() WHERE id = r.id;
      v_unknown := v_unknown + 1;
    END IF;
  END LOOP;
  -- Slack posts that SUMMARISE error_logs rows: closed when there ARE
  -- companion error_logs items (seen in the 5 minutes up to the post) and
  -- every one of them is closed. No companions -> it stays open for a person.
  -- Q291: the same rotation; a post that stays open is stamped as asked below.
  FOR r IN SELECT * FROM public.ops_alert_ledger
            WHERE status <> 'closed' AND verify_kind = 'companions'
            ORDER BY verify_started_at ASC NULLS FIRST, last_seen ASC, id LIMIT 200
  LOOP
    WITH comp AS (
      SELECT DISTINCT md5('error_logs|' || left(src, 120) || '|' ||
                          coalesce(nullif(public.ops_alert_normalise(split_part(coalesce(e.message, ''), ' — ', 1)), ''), '(no message)')) AS fp
        FROM public.error_logs e
        CROSS JOIN LATERAL (SELECT coalesce(CASE WHEN jsonb_typeof(e.tags) = 'object'
                                                 THEN coalesce(e.tags ->> 'source', e.tags ->> 'area') END, 'app') AS src) s
       WHERE e.created_at BETWEEN r.last_seen - interval '5 minutes' AND r.last_seen
         AND coalesce(e.tags ->> 'origin', '') <> 'client'
         AND s.src NOT IN ('ops-alert', 'ops-digest')
    )
    SELECT count(*), count(*) FILTER (WHERE l.status <> 'closed')
      INTO v_comp, v_comp_open
      FROM comp JOIN public.ops_alert_ledger l ON l.fingerprint = comp.fp;

    IF v_comp > 0 AND v_comp_open = 0 THEN
      UPDATE public.ops_alert_ledger
         SET status = 'closed', closed_at = now(), verify_started_at = v_at,
             closed_evidence = format('all %s error_logs alert(s) this post summarised (rows %s .. %s) are verified cleared',
                                      v_comp, r.last_seen - interval '5 minutes', r.last_seen),
             updated_at = now()
       WHERE id = r.id AND last_seen = r.last_seen AND status <> 'closed';
      v_closed := v_closed + 1;
    ELSE
      UPDATE public.ops_alert_ledger SET verify_started_at = v_at, updated_at = now()
       WHERE id = r.id;
    END IF;
  END LOOP;

  RETURN jsonb_build_object('folded', v_folded, 'closed', v_closed, 'still_failing', v_open,
                            'could_not_ask', v_unknown, 'at', v_at);
END;
$fn$;

REVOKE ALL ON FUNCTION public.ops_alert_verify() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ops_alert_verify() TO service_role;

-- Q287: open 'cron-http-untagged' items filed before the branch existed.
UPDATE public.ops_alert_ledger
   SET verify_kind = 'sql_condition', verify_ref = 'cron-http-untagged', updated_at = now()
 WHERE source_kind = 'error_logs'
   AND source = 'cron-http-untagged'
   AND verify_kind = 'manual'
   AND status <> 'closed'
   AND sample_ref ->> 'job' IS NOT NULL;
