-- A REAL person seeing a full error screen becomes an ops alert ledger item
-- (docs/OPEN.md Q39; follow-up of Q12).
--
-- ── WHY ────────────────────────────────────────────────────────────────────
-- The ledger (20260923043402) skips every client-origin error_logs row: a
-- browser can write them, so they would be noise and forgeable. But "Error
-- screen shown: We couldn't load your account." for a NON-seed person is the
-- one client row the owner means by an alert. Measured 2026-09-23: the only
-- real occurrence in 14 days (the owner's own account, 2026-09-22 15:10Z,
-- right after the DB outage) reached error_logs and nothing else.
--
-- ── WHAT THIS ADDS ─────────────────────────────────────────────────────────
--  * source_kind 'user-error-screen' on ops_alert_ledger.
--  * is_user_error_screen_row(tags): a client row from an error SURFACE —
--    tags.kind = 'user-error-screen' (every surface sends it from this change
--    on: src/lib/currentScreen.ts USER_ERROR_SCREEN) OR tags.source is one of
--    the five surfaces that reported before the kind tag existed (so an old
--    native bundle still counts until it is replaced).
--  * user_error_screen_is_real(user_id, tags): not seed-tagged, and the
--    user's profile is not is_seed. A guest (NULL user_id) or a user with no
--    profile row is REAL — unknown is never assumed to be a test.
--  * ops_alert_record_user_error_screen(...): fingerprint = screen + message,
--    normalised by ops_alert_normalise (uuids/ids/numbers stripped, so
--    /user/<uuid> is one screen). Severity is fixed at 'error' — the client's
--    claimed severity is not trusted. RATE-LIMITED against flood/forgery:
--    an EXISTING item always just counts (one broken screen is one item,
--    however often it is hit); a NEW item is refused when the person has
--    already hit > 5 distinct screens in the hour, or 20 new user-error-screen
--    items were opened in the hour. A refused one is counted on ONE overflow
--    item, so a flood is still an open alert, never silence.
--  * trg_error_logs_zz_user_error_screen (AFTER INSERT on error_logs) calls it
--    for every row; the function decides. Failure is swallowed with a WARNING
--    (the error_logs write must never fail because of the ledger), and the
--    record goes through ops_alert_record, whose row-lock wait is bounded
--    (src/test/errorLogTriggersNeverWait.test.ts).
--  * ops_alert_condition('user-error-screen') — the CLOSE RULE, verify_kind
--    sql_condition, run hourly by ops_alert_verify(): still failing while
--    error_logs holds a real person's row for that same normalised
--    screen+message in the last 24 hours (re-asked from error_logs, not from
--    the ledger's own last_seen). A synthetic route check is NOT part of the
--    rule yet: nothing that probes routes writes its result where SQL can
--    read it (docs/OPEN.md, follow-up item).
--  * Backfill: the last 72 h of surface rows, once (only while no
--    user-error-screen item exists), so the rule is exercised on real data.
--
-- ── WHO CAN WRITE ──────────────────────────────────────────────────────────
-- A client still cannot touch the ledger: it can only INSERT an error_logs row
-- (as it always could — RLS pins user_id to NULL or its own uid, and
-- stamp_error_log_origin forces tags.origin='client'). What it can cause is
-- bounded: items only under source_kind 'user-error-screen' (it cannot reach,
-- re-open or close any other kind), severity 'error', at most 5 new screens
-- per signed-in person per hour and 20 new items per hour overall, the rest
-- folded into one overflow item. Every new function: REVOKE FROM PUBLIC,
-- anon, authenticated; service_role only.

-- ── 1. the new source kind ──────────────────────────────────────────────────
ALTER TABLE public.ops_alert_ledger DROP CONSTRAINT IF EXISTS ops_alert_ledger_source_kind_chk;
ALTER TABLE public.ops_alert_ledger ADD CONSTRAINT ops_alert_ledger_source_kind_chk
  CHECK (source_kind IN ('error_logs', 'edge_slack', 'sql_slack', 'workflow', 'nightly_red', 'sentry',
                         'user-error-screen'));

-- ── 2. which rows are a person looking at an error screen ──────────────────
CREATE OR REPLACE FUNCTION public.is_user_error_screen_row(p_tags jsonb)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $fn$
  SELECT coalesce(
           jsonb_typeof(p_tags) = 'object'
           AND p_tags ->> 'origin' = 'client'
           AND (p_tags ->> 'kind' = 'user-error-screen'
                OR p_tags ->> 'source' IN ('ErrorState', 'ErrorBoundary', 'RouteErrorBoundary',
                                           'SectionBoundary', 'BootWatchdog')),
         false)
$fn$;

REVOKE ALL ON FUNCTION public.is_user_error_screen_row(jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.is_user_error_screen_row(jsonb) TO service_role;

CREATE OR REPLACE FUNCTION public.user_error_screen_is_real(p_user_id uuid, p_tags jsonb)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $fn$
  SELECT NOT public.error_log_is_seed(p_tags)
     AND NOT EXISTS (SELECT 1 FROM public.profiles p
                      WHERE p_user_id IS NOT NULL
                        AND p.user_id = p_user_id
                        AND p.is_seed IS TRUE)
$fn$;

REVOKE ALL ON FUNCTION public.user_error_screen_is_real(uuid, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.user_error_screen_is_real(uuid, jsonb) TO service_role;

-- The fingerprint text, before ops_alert_normalise: "<screen> · <message>".
-- The screen is client-supplied, so anything that is not a plain path is one
-- bucket instead of an arbitrary string.
CREATE OR REPLACE FUNCTION public.user_error_screen_title(p_screen text, p_message text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $fn$
  SELECT CASE WHEN btrim(coalesce(p_screen, '')) ~ '^/[A-Za-z0-9/_.~%:@+-]{0,200}$'
              THEN left(btrim(p_screen), 120)
              ELSE '(unknown screen)' END
         || ' · '
         || left(coalesce(nullif(btrim(p_message), ''), '(no message)'), 300)
$fn$;

REVOKE ALL ON FUNCTION public.user_error_screen_title(text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.user_error_screen_title(text, text) TO service_role;

-- ── 3. record one occurrence (rate-limited) ─────────────────────────────────
CREATE OR REPLACE FUNCTION public.ops_alert_record_user_error_screen(
  p_error_log_id uuid,
  p_user_id      uuid,
  p_message      text,
  p_tags         jsonb,
  p_seen_at      timestamptz DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_tags         jsonb := CASE WHEN jsonb_typeof(p_tags) = 'object' THEN p_tags ELSE '{}'::jsonb END;
  v_seen         timestamptz := coalesce(p_seen_at, now());
  v_title        text;
  v_norm         text;
  v_surface      text;
  v_screens      int := 0;
  v_new_in_hour  int := 0;
BEGIN
  IF NOT public.is_user_error_screen_row(v_tags) THEN RETURN NULL; END IF;
  IF NOT public.user_error_screen_is_real(p_user_id, v_tags) THEN RETURN NULL; END IF;

  v_title   := public.user_error_screen_title(v_tags ->> 'screen', p_message);
  v_norm    := public.ops_alert_normalise(v_title);
  v_surface := left(regexp_replace(coalesce(v_tags ->> 'source', ''), '[^A-Za-z0-9._-]', '', 'g'), 60);

  -- The rate limit applies only to opening a NEW item. The title is the whole
  -- fingerprint here (source_kind and source are constant).
  IF NOT EXISTS (SELECT 1 FROM public.ops_alert_ledger
                  WHERE source_kind = 'user-error-screen' AND source = 'user-error-screen'
                    AND title = v_norm) THEN
    IF p_user_id IS NOT NULL THEN
      SELECT count(DISTINCT coalesce(e.tags ->> 'screen', '')) INTO v_screens
        FROM public.error_logs e
       WHERE e.user_id = p_user_id
         AND e.created_at > v_seen - interval '1 hour'
         AND e.created_at <= v_seen
         AND public.is_user_error_screen_row(e.tags);
    END IF;
    SELECT count(*) INTO v_new_in_hour
      FROM public.ops_alert_ledger l
     WHERE l.source_kind = 'user-error-screen'
       AND l.first_seen > v_seen - interval '1 hour'
       AND l.first_seen <= v_seen
       AND NOT coalesce((l.sample_ref ->> 'overflow')::boolean, false);

    IF v_screens > 5 OR v_new_in_hour >= 20 THEN
      RETURN public.ops_alert_record(
        'user-error-screen', 'user-error-screen',
        'Real users hit more NEW error screens than the cap (20 per hour overall, 5 per person); the rest are only in error_logs',
        'error',
        left(v_title, 1000),
        jsonb_build_object('overflow', true, 'surface', v_surface, 'error_log_id', p_error_log_id,
                           'capped_by', CASE WHEN v_screens > 5 THEN 'per-person' ELSE 'global' END),
        'sql_condition', 'user-error-screen', v_seen);
    END IF;
  END IF;

  RETURN public.ops_alert_record(
    'user-error-screen', 'user-error-screen',
    v_title,
    'error',
    left(v_title, 1000),
    jsonb_strip_nulls(jsonb_build_object(
      'title_norm', v_norm,
      'screen', left(v_tags ->> 'screen', 200),
      'surface', v_surface,
      'error_log_id', p_error_log_id,
      'signed_in', p_user_id IS NOT NULL)),
    'sql_condition', 'user-error-screen', v_seen);
END;
$fn$;

REVOKE ALL ON FUNCTION public.ops_alert_record_user_error_screen(uuid, uuid, text, jsonb, timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ops_alert_record_user_error_screen(uuid, uuid, text, jsonb, timestamptz) TO service_role;

-- ── 4. the close rule (ops_alert_condition gains a branch) ──────────────────
-- Body is the 20260923055631 definition verbatim plus the 'user-error-screen'
-- branch at the end.
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

-- ── 5. error_logs feeds it ──────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.ops_alert_ledger_from_user_error_screen()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
BEGIN
  BEGIN
    PERFORM public.ops_alert_record_user_error_screen(
      NEW.id, NEW.user_id, NEW.message, NEW.tags, coalesce(NEW.created_at, now()));
  EXCEPTION WHEN OTHERS THEN
    -- Never take down the error_logs write. Loud in the Postgres log.
    RAISE WARNING 'ops_alert_ledger_from_user_error_screen: % (error_logs.id=%)', SQLERRM, NEW.id;
  END;
  RETURN NULL;
END;
$fn$;

REVOKE ALL ON FUNCTION public.ops_alert_ledger_from_user_error_screen() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_error_logs_zz_user_error_screen ON public.error_logs;
CREATE TRIGGER trg_error_logs_zz_user_error_screen
  AFTER INSERT ON public.error_logs
  FOR EACH ROW EXECUTE FUNCTION public.ops_alert_ledger_from_user_error_screen();

-- ── 6. backfill: the last 72 hours, once ────────────────────────────────────
DO $backfill$
DECLARE
  r record;
BEGIN
  IF EXISTS (SELECT 1 FROM public.ops_alert_ledger WHERE source_kind = 'user-error-screen') THEN
    RETURN;
  END IF;
  FOR r IN
    SELECT e.id, e.user_id, e.message, e.tags, e.created_at
      FROM public.error_logs e
     WHERE e.created_at > now() - interval '72 hours'
       AND public.is_user_error_screen_row(e.tags)
     ORDER BY e.created_at
  LOOP
    PERFORM public.ops_alert_record_user_error_screen(r.id, r.user_id, r.message, r.tags, r.created_at);
  END LOOP;
END;
$backfill$;
