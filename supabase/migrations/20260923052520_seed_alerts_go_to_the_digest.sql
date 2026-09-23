-- Seed/E2E alerts go to the daily digest; real ones still page (docs/OPEN.md
-- Q2, Q42, Q46, Q29 follow-up).
--
-- ── WHAT WAS WRONG (measured on prod 2026-09-23) ───────────────────────────
-- The ops alert ledger held 36 open items. Nearly all of them were raised by
-- TEST activity, which runs against prod by design (no mock mode):
--   * "stuck payment" x36 (edge mirror) + detect_stuck_payments x14: every job
--     that tripped it in the last 3 days is an "[E2E DO NOT ACCEPT]" job,
--     is_seed = true, ALREADY CANCELLED by the spec's cleanup. The checkout the
--     spec abandoned stays `payment_status = 'unpaid'` with a session id, and
--     nothing ever moved a cancelled job out of 'unpaid'
--     (void-cancelled-payments' abandon sweep only looks at status = 'open').
--   * "dispute-unsettled-seed": already a separate source, but it still posted
--     to #ops-alerts at 'error' — "seed goes to the digest" was never true,
--     because every severity has posted since 20260922222229.
--   * email-dlq: all 51 dead letters were to is_seed accounts (Q29); archiving
--     them satisfied the ledger's depth check, so archiving a REAL user's
--     email would have closed the alert silently too.
--
-- ── WHAT THIS DOES ─────────────────────────────────────────────────────────
-- 1. public.error_log_is_seed(tags): the ONE definition of "this alert is
--    about seed/E2E data": tags.seed = true, or a source ending in '-seed'
--    (the convention the dispute sweep already uses).
-- 2. notify_slack_on_error_log: a seed row does not post. It is still an
--    error_logs row, so send_ops_daily_digest() lists it under its own
--    '-seed' source — nothing is dropped, it just does not page.
-- 3. ops_alert_ledger_from_error_log: a seed row is not an open ops item (the
--    ledger is the owner's to-do list of REAL problems; the digest carries
--    the seed ones).
-- 4. detect_stuck_payments: seed jobs report under
--    'detect_stuck_payments-seed' (info, seed-tagged, no admin notification);
--    and a CANCELLED unpaid job gets 2 h for void-cancelled-payments (hourly
--    at :10) to expire its Checkout Session and mark it 'abandoned' before it
--    counts. Past that it still pages: a cancelled job whose session could not
--    be shown unpaid may be a paid-but-unsettled checkout, the exact thing
--    this detector exists for.
-- 5. ops_alert_condition: detect_stuck_payments re-asks the SAME (non-seed,
--    grace-aware) question; the email DLQ items are cleared only when every
--    dead letter to a NON-seed recipient, live or archived, has a later
--    'sent' email_send_log row to that recipient for that template. Depth 0
--    is no longer enough.
-- 6. sweep_email_dlqs: a DLQ holding only seed recipients reports under
--    'email-dlq-*-seed' at info (digest); one real recipient keeps the old
--    source and severity (auth = fatal).
--
-- Replay-safe: CREATE OR REPLACE only; privileges restated.

-- ── 1. the one seed predicate ──────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.error_log_is_seed(p_tags jsonb)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $fn$
  SELECT CASE WHEN jsonb_typeof(p_tags) = 'object' THEN
           coalesce(p_tags ->> 'seed', '') = 'true'
           OR coalesce(p_tags ->> 'source', p_tags ->> 'area', '') LIKE '%-seed'
         ELSE false END
$fn$;

REVOKE ALL ON FUNCTION public.error_log_is_seed(jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.error_log_is_seed(jsonb) TO service_role;

-- An email address that belongs to a seed/test account (profiles.is_seed).
CREATE OR REPLACE FUNCTION public.is_seed_email(p_email text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $fn$
  SELECT EXISTS (
    SELECT 1
      FROM auth.users u
      JOIN public.profiles p ON p.user_id = u.id
     WHERE lower(u.email) = lower(btrim(p_email))
       AND p.is_seed IS TRUE)
$fn$;

REVOKE ALL ON FUNCTION public.is_seed_email(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.is_seed_email(text) TO service_role;

-- ── 2. Slack: seed rows do not page ────────────────────────────────────────
-- Body is 20260922222229's verbatim, plus the seed return.
CREATE OR REPLACE FUNCTION public.notify_slack_on_error_log()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_recent   int;
  v_title    text;
  v_source   text;
  v_window   interval;
  v_alert_sev text;
  v_critical_sources CONSTANT text[] := ARRAY[
    'detect_stuck_payments',
    'auto_start_due_jobs',
    'detect_suspicious_user_patterns',
    'rls-escalation-refused'
  ];
BEGIN
  v_source := COALESCE(
    CASE WHEN jsonb_typeof(NEW.tags) = 'object' THEN COALESCE(NEW.tags ->> 'source', NEW.tags ->> 'area') END,
    'app');

  -- UNCHANGED AND LOAD-BEARING. A row a browser can write must never page an
  -- operator. Stamped by trg_error_logs_stamp_origin from `current_user`,
  -- which a client cannot choose. Now that every severity posts, this is the
  -- only thing between a forged 'warning' and #ops-alerts.
  IF NEW.tags ->> 'origin' = 'client' THEN
    RETURN NEW;
  END IF;

  -- Seed/E2E data (tags.seed or a '-seed' source) goes to the daily digest,
  -- which lists every error_logs row by source. It never pages. Real rows are
  -- untouched (20260923052520).
  IF public.error_log_is_seed(NEW.tags) THEN
    RETURN NEW;
  END IF;

  -- One post per source per window; the window is the severity's cadence.
  -- Mirrored in alertPolicy.ts SLACK_THROTTLE_MINUTES.
  v_window := CASE NEW.severity
                WHEN 'fatal'   THEN interval '10 minutes'
                WHEN 'error'   THEN interval '60 minutes'
                WHEN 'warning' THEN interval '240 minutes'
                WHEN 'info'    THEN interval '720 minutes'
                ELSE interval '60 minutes'   -- an unreadable severity is not one to quietly drop
              END;

  -- A money/security source keeps the fastest cadence whatever it carries.
  IF v_source = ANY (v_critical_sources) THEN
    v_window := interval '10 minutes';
  END IF;

  SELECT count(*) INTO v_recent
  FROM public.error_logs e
  WHERE e.id <> NEW.id
    AND e.created_at > now() - v_window
    AND COALESCE(e.severity, '') = COALESCE(NEW.severity, '')
    AND (jsonb_typeof(e.tags) = 'object'
         AND COALESCE(e.tags ->> 'source', e.tags ->> 'area') = v_source);
  IF v_recent > 0 THEN
    RETURN NEW;
  END IF;

  -- fatal/error -> critical (alertPolicy's existing rule); warning and info
  -- keep their own icon and colour so a page still means "something is broken".
  v_alert_sev := CASE
                   WHEN v_source = ANY (v_critical_sources) THEN 'critical'
                   WHEN NEW.severity IN ('fatal', 'error') THEN 'critical'
                   WHEN NEW.severity = 'warning' THEN 'warning'
                   WHEN NEW.severity = 'info' THEN 'info'
                   ELSE 'critical'
                 END;

  -- The DB severity is in the title because it has four values and the channel
  -- shows three; without this a reader cannot tell an error from a fatal.
  v_title := left(format('[%s/%s] %s', upper(COALESCE(NEW.severity, '?')), v_source, NEW.message), 140);

  BEGIN
    PERFORM net.http_post(
      url := (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'supabase_url')
             || '/functions/v1/slack-ops-alert',
      headers := jsonb_build_object(
        'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'service_role_key'),
        'Content-Type', 'application/json'),
      body := jsonb_build_object(
        'kind', 'custom',
        'severity', v_alert_sev,
        'title', v_title,
        'message', left(COALESCE(NEW.message, ''), 900),
        'fields', jsonb_build_object(
          'url', COALESCE(NEW.url, '—'),
          'db_severity', COALESCE(NEW.severity, '?'),
          'error_logs.id', NEW.id::text),
        'link', '/admin?view=health'));
  EXCEPTION WHEN OTHERS THEN
    -- Slack is the notification; error_logs is the durable record. A failed
    -- post must never take the writing transaction down with it.
    NULL;
  END;
  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.notify_slack_on_error_log() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.notify_slack_on_error_log() TO service_role;

-- ── 3. ledger: seed rows are not open ops items ────────────────────────────
CREATE OR REPLACE FUNCTION public.ops_alert_ledger_from_error_log()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_tags   jsonb := CASE WHEN jsonb_typeof(NEW.tags) = 'object' THEN NEW.tags ELSE '{}'::jsonb END;
  v_source text;
BEGIN
  -- Same trust line as notify_slack_on_error_log: a browser can write these.
  IF v_tags ->> 'origin' = 'client' THEN
    RETURN NULL;
  END IF;
  -- Seed/E2E data: listed in the daily digest under its '-seed' source, not a
  -- to-do in the ledger (20260923052520). Same predicate as the Slack trigger.
  IF public.error_log_is_seed(v_tags) THEN
    RETURN NULL;
  END IF;
  v_source := coalesce(v_tags ->> 'source', v_tags ->> 'area', 'app');
  -- postSlackOpsAlert records its own ledger entry; ops-digest is the digest's
  -- delivery receipt (read by check_ops_digest_delivery), not an alert.
  IF v_source IN ('ops-alert', 'ops-digest') THEN
    RETURN NULL;
  END IF;

  BEGIN
    PERFORM public.ops_alert_record(
      'error_logs',
      v_source,
      split_part(coalesce(NEW.message, ''), ' — ', 1),
      coalesce(NEW.severity, 'error'),
      left(coalesce(NEW.message, ''), 1000),
      jsonb_strip_nulls(jsonb_build_object(
        'error_log_id', NEW.id,
        'job', v_tags ->> 'job',
        'job_id', v_tags ->> 'job_id',
        'queue', v_tags ->> 'queue',
        'url', NEW.url)),
      NULL, NULL,
      coalesce(NEW.created_at, now()));
  EXCEPTION WHEN OTHERS THEN
    -- The ledger must never take down the write that raised the alert. Loud in
    -- the Postgres log, and the error_logs row itself still exists.
    RAISE WARNING 'ops_alert_ledger_from_error_log: % (error_logs.id=%)', SQLERRM, NEW.id;
  END;
  RETURN NULL;
END;
$fn$;

REVOKE ALL ON FUNCTION public.ops_alert_ledger_from_error_log() FROM PUBLIC, anon, authenticated;

-- ── 4. detect_stuck_payments: seed to the digest, cancelled gets its grace ─
CREATE OR REPLACE FUNCTION public.detect_stuck_payments()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  rec RECORD;
  flagged integer := 0;
  user_label text;
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
    BEGIN
      IF rec.seed THEN
        -- Seed/E2E job: one digest row per job per day, no admin notification,
        -- no page. error_log_is_seed() keeps it out of Slack and the ledger.
        CONTINUE WHEN EXISTS (
          SELECT 1 FROM public.error_logs e
           WHERE jsonb_typeof(e.tags) = 'object'
             AND e.tags ->> 'source' = 'detect_stuck_payments-seed'
             AND e.tags ->> 'job_id' = rec.id::text
             AND e.created_at > NOW() - INTERVAL '24 hours');
        INSERT INTO public.error_logs (severity, message, url, tags, context)
        VALUES (
          'info',
          'Stuck payment on a seed/E2E job — checkout started, never settled',
          format('/admin?view=jobs&job=%s', rec.id),
          jsonb_build_object('source', 'detect_stuck_payments-seed', 'seed', true, 'job_id', rec.id::text),
          jsonb_build_object('job_id', rec.id, 'stripe_session_id', rec.stripe_session_id,
                             'customer_id', rec.customer_id, 'created_at', rec.created_at));
        flagged := flagged + 1;
        CONTINUE;
      END IF;

      -- Real job: unchanged — admin notification (deduped per poster per day)
      -- and a critical-source error_logs row that pages.
      CONTINUE WHEN EXISTS (
        SELECT 1 FROM public.notifications n
        WHERE n.type = 'system_alert'
          AND n.title = 'Stuck payment — webhook may be failing'
          AND n.link = format('/admin?view=people&user=%s', rec.customer_id)
          AND n.created_at > NOW() - INTERVAL '24 hours');

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
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'detect_stuck_payments: job % failed: %', rec.id, SQLERRM;
    END;
  END LOOP;
  RETURN flagged;
END;
$function$;

REVOKE ALL ON FUNCTION public.detect_stuck_payments() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.detect_stuck_payments() TO service_role;

-- ── 5. ops_alert_condition: same questions, seed-aware, DLQ needs evidence ─
-- Body is 20260923050059's, with the two branches below changed.
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
  END IF;
  RETURN NULL;
END;
$fn$;

REVOKE ALL ON FUNCTION public.ops_alert_condition(text, jsonb, timestamptz, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ops_alert_condition(text, jsonb, timestamptz, boolean) TO service_role;

-- ── 6. sweep_email_dlqs: seed-only DLQs go to the digest ───────────────────
CREATE OR REPLACE FUNCTION public.sweep_email_dlqs()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
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
  v_real      bigint;
  v_max_id    bigint;
  v_oldest    timestamptz;
  v_last_id   bigint;
  v_seed_only boolean;
BEGIN
  FOR r IN SELECT value ->> 'dlq'      AS dlq,
                  value ->> 'severity' AS severity,
                  value ->> 'source'   AS source,
                  value ->> 'what'     AS what
             FROM jsonb_array_elements(v_watched)
  LOOP
    v_relname := 'pgmq.q_' || r.dlq;

    IF to_regclass(v_relname) IS NULL THEN
      v_seen := v_seen || jsonb_build_object('queue', r.dlq, 'skipped', 'no such queue');
      CONTINUE;
    END IF;

    -- v_real: dead letters to a recipient that is NOT a seed/test account.
    EXECUTE format('SELECT count(*), count(*) FILTER (WHERE NOT public.is_seed_email(message ->> %L)),
                           max(msg_id), min(enqueued_at) FROM %s', 'to', v_relname)
       INTO v_depth, v_real, v_max_id, v_oldest;

    IF COALESCE(v_depth, 0) = 0 THEN
      v_seen := v_seen || jsonb_build_object('queue', r.dlq, 'depth', 0);
      CONTINUE;
    END IF;

    SELECT max((e.context ->> 'high_water_msg_id')::bigint)
      INTO v_last_id
      FROM public.error_logs e
     WHERE e.tags ->> 'queue' = r.dlq
       AND e.tags ->> 'area'  = 'email-dlq'
       AND e.context ? 'high_water_msg_id';

    IF v_last_id IS NOT NULL AND v_last_id >= v_max_id THEN
      v_seen := v_seen || jsonb_build_object('queue', r.dlq, 'depth', v_depth,
                                             'already_reported_through', v_last_id);
      CONTINUE;
    END IF;

    -- Only test accounts' mail: the digest, never a page (is_seed profiles).
    v_seed_only := COALESCE(v_real, 0) = 0;

    INSERT INTO public.error_logs (severity, message, tags, context)
    VALUES (
      CASE WHEN v_seed_only THEN 'info' ELSE r.severity END,
      format('%s message(s) in the %s dead-letter queue (%s to real recipients) — %s that will never be delivered and that nothing retries. Oldest queued %s UTC.',
             v_depth, r.dlq, COALESCE(v_real, 0), r.what,
             to_char(v_oldest AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI')),
      jsonb_build_object('source', CASE WHEN v_seed_only THEN r.source || '-seed' ELSE r.source END,
                         'area', 'email-dlq', 'queue', r.dlq)
        || CASE WHEN v_seed_only THEN jsonb_build_object('seed', true) ELSE '{}'::jsonb END,
      jsonb_build_object('depth',              v_depth,
                         'real_recipients',    v_real,
                         'high_water_msg_id',  v_max_id,
                         'previously_reported_through', v_last_id,
                         'new_since_last_alert', CASE WHEN v_last_id IS NULL THEN v_depth END,
                         'oldest_enqueued_at',  v_oldest,
                         'queue',               r.dlq));

    v_reported := v_reported + 1;
    v_seen := v_seen || jsonb_build_object('queue', r.dlq, 'depth', v_depth,
                                           'real_recipients', v_real,
                                           'reported_through', v_max_id,
                                           'severity', CASE WHEN v_seed_only THEN 'info' ELSE r.severity END);
  END LOOP;

  RETURN jsonb_build_object('reported', v_reported, 'queues', v_seen);
END;
$fn$;

REVOKE ALL ON FUNCTION public.sweep_email_dlqs() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.sweep_email_dlqs() TO service_role;
