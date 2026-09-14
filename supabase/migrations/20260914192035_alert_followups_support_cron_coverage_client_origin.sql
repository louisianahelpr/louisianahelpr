-- Follow-ups left open by 20260914183932 (the alerting rebuild).
--
-- Three defects, each read live on prod 2026-09-14 before it was written:
--
-- 1. THREE SCHEDULED JOBS WITH NO LIVENESS EXPECTATION.
--    Read live (cron.job LEFT JOIN cron_work_expectations), two of the three
--    named in docs/OPEN.md really have no row: `extend-boosts-hourly`
--    ('0 * * * *') and `prune-cron-run-details` ('17 4 * * *'). The third,
--    `prune-edge-rate-limit-log`, already has a 30-hour expectation registered
--    2026-09-02 and is correct for its '56 4 * * *' schedule — the OPEN.md
--    line was wrong about it. Rows for the two real gaps are added below.
--
--    The deeper defect is that the gap was findable only by a person running
--    that join by hand: `sweep_dead_crons` reads cron_work_expectations and
--    LEFT JOINs cron.job, so it sees an expectation with no job
--    ('unscheduled') and is structurally blind to the reverse — a job with no
--    expectation. Every cron added from now on (or added outside a migration,
--    which is how extend-boosts-hourly got there: no cron.schedule call for it
--    exists anywhere in supabase/migrations) is unmonitored and nothing says
--    so. This migration adds the 'unmonitored' verdict, derived from cron.job
--    itself, so the list can never again be a list checked against itself.
--
-- 2. A BROWSER COULD FORGE A PAGING ALERT.
--    Read live (pg_policy on public.error_logs): ONE insert policy,
--    `anyone_can_insert_errors`, polroles = NULL (i.e. PUBLIC — anon and
--    authenticated included), WITH CHECK `user_id IS NULL OR user_id =
--    auth.uid()`. Nothing constrains `severity` or `tags`. So any visitor
--    holding the publishable key could POST /rest/v1/error_logs with
--    tags.source = 'rls-escalation-refused' (or a money source, or
--    severity='fatal') and trg_error_logs_slack would page #ops-alerts.
--    20260914183932 defended this by reading `request.jwt.claims ->> 'role'`,
--    which is a REQUEST header value: it is empty for a request that carries
--    no JWT, and 'role' is not the thing that decides what the insert may do.
--    The authority is the Postgres role the insert actually runs as —
--    `current_user`, which PostgREST SETs to anon/authenticated/service_role
--    and which is the function owner inside a SECURITY DEFINER path.
--
--    So: a BEFORE INSERT trigger, deliberately SECURITY INVOKER (a definer
--    trigger would see its own owner and learn nothing), stamps every row
--    with tags.origin — 'client' for anon/authenticated, 'server' otherwise —
--    and a client row cannot keep a paging source or a 'fatal' severity. The
--    stamp is not something a client can write itself: the trigger overwrites
--    whatever origin was sent. Client error logging keeps working unchanged:
--    the row is still stored, still carries its message, stack, url and its
--    original source under tags.claimed_source, and still appears in the
--    daily digest. It just cannot page.
--
-- 3. THE 'rls-escalation-refused' EXCEPTION IS NO LONGER AN EXCEPTION.
--    That row is written by public.prevent_self_escalation(), which is
--    SECURITY DEFINER (prosecdef = true, owner postgres, verified live), so
--    under the current_user rule it is a server row like any other and needs
--    no carve-out. The old carve-out was precisely the hole: it let a
--    browser-written row with that source through by name.
--
-- Replay-safe: CREATE OR REPLACE, DROP ... IF EXISTS, ON CONFLICT upsert, and
-- every cron/table reference guarded by existence.

-- ── 1a. The two missing liveness expectations ───────────────────────────────
-- Tolerances follow the house rule from 20260901030926: schedule interval plus
-- real slack, so ONE missed firing never pages and two consecutive ones do.
--   extend-boosts-hourly   '0 * * * *'  hourly → 3 hours (same as every other
--                                       hourly job in the table)
--   prune-cron-run-details '17 4 * * *' daily  → 30 hours (same as every other
--                                       daily job in the table)
DO $$
BEGIN
  IF to_regclass('public.cron_work_expectations') IS NULL THEN RETURN; END IF;

  INSERT INTO public.cron_work_expectations (jobname, expected_max_gap)
  VALUES
    ('extend-boosts-hourly',   interval '3 hours'),
    ('prune-cron-run-details', interval '30 hours')
  ON CONFLICT (jobname) DO UPDATE
    -- Tolerance only. An existing row's did-work rule and registered_at are
    -- left exactly as their own migration wrote them.
    SET expected_max_gap = EXCLUDED.expected_max_gap;
END;
$$;

-- ── 1b. Liveness coverage measured from cron.job, not from the list ─────────
-- Identical to 20260914183932's sweep_dead_crons except for the `uncovered`
-- branch and the roll-up wording.
CREATE OR REPLACE FUNCTION public.sweep_dead_crons()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_flagged    int := 0;
  v_names      text[] := ARRAY[]::text[];
  v_resumed_at timestamptz;
  v_gap_start  timestamptz;
  v_digest     jsonb;
  r            record;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    RETURN jsonb_build_object('flagged', 0, 'jobs', '[]'::jsonb,
                              'skipped', 'pg_cron not installed');
  END IF;

  -- The most recent scheduler blackout: a hole of 45+ minutes in the AGGREGATE
  -- dispatch stream. Unchanged from 20260914183932.
  SELECT g.prev_start, g.start_time
    INTO v_gap_start, v_resumed_at
    FROM (
      SELECT d.start_time,
             lag(d.start_time) OVER (ORDER BY d.start_time) AS prev_start
        FROM cron.job_run_details d
       WHERE d.start_time > now() - interval '8 days'
    ) g
   WHERE g.prev_start IS NOT NULL
     AND g.start_time - g.prev_start >= interval '45 minutes'
   ORDER BY g.start_time DESC
   LIMIT 1;

  FOR r IN
    WITH expected AS (
      SELECT c.jobname, c.expected_max_gap, c.registered_at
        FROM public.cron_work_expectations c
       WHERE c.expected_max_gap IS NOT NULL
    ),
    live AS (
      SELECT e.jobname,
             e.expected_max_gap,
             e.registered_at,
             j.jobid,
             j.active,
             (SELECT max(d.start_time)
                FROM cron.job_run_details d
               WHERE d.jobid = j.jobid)                     AS last_start,
             (SELECT count(*) FILTER (WHERE d.status <> 'succeeded')
                FROM (SELECT d2.status
                        FROM cron.job_run_details d2
                       WHERE d2.jobid = j.jobid
                         AND d2.end_time IS NOT NULL
                       ORDER BY d2.start_time DESC
                       LIMIT 3) d)                          AS recent_bad,
             (SELECT count(*)
                FROM (SELECT 1
                        FROM cron.job_run_details d3
                       WHERE d3.jobid = j.jobid
                         AND d3.end_time IS NOT NULL
                       ORDER BY d3.start_time DESC
                       LIMIT 3) d)                          AS recent_total
        FROM expected e
        LEFT JOIN cron.job j ON j.jobname = e.jobname
    ),
    graded AS (
      SELECT l.jobname,
             l.expected_max_gap,
             l.last_start,
             l.registered_at,
             CASE
               WHEN l.jobid IS NULL THEN 'unscheduled'
               WHEN l.active IS FALSE THEN 'inactive'
               WHEN l.last_start IS NULL
                    AND GREATEST(l.registered_at,
                          CASE WHEN l.registered_at >= v_gap_start - l.expected_max_gap
                               THEN v_resumed_at END) < now() - l.expected_max_gap
                 THEN 'never-ran'
               WHEN l.last_start IS NOT NULL
                    AND GREATEST(l.last_start,
                          CASE WHEN l.last_start >= v_gap_start - l.expected_max_gap
                               THEN v_resumed_at END) < now() - l.expected_max_gap
                 THEN 'dead'
               WHEN l.recent_total >= 3 AND l.recent_bad = l.recent_total THEN 'erroring'
               ELSE NULL
             END AS verdict
        FROM live l
    ),
    -- THE OTHER DIRECTION. `graded` can only ever grade jobs somebody
    -- remembered to register; this reads the scheduler itself, so a cron added
    -- by a future migration — or straight on the database, which is how
    -- extend-boosts-hourly came to exist — is reported the first time this
    -- sweep runs after it appears, instead of being silently unwatched.
    uncovered AS (
      SELECT j.jobname,
             NULL::interval    AS expected_max_gap,
             NULL::timestamptz AS last_start,
             NULL::timestamptz AS registered_at,
             'unmonitored'     AS verdict
        FROM cron.job j
       WHERE j.active
         AND j.jobname IS NOT NULL
         AND NOT EXISTS (
               SELECT 1 FROM public.cron_work_expectations c
                WHERE c.jobname = j.jobname
                  AND c.expected_max_gap IS NOT NULL)
    )
    SELECT * FROM graded WHERE verdict IS NOT NULL
    UNION ALL
    SELECT * FROM uncovered
  LOOP
    CONTINUE WHEN r.verdict IS NULL;

    IF NOT EXISTS (
      SELECT 1 FROM public.error_logs e
       WHERE e.tags->>'source' = 'cron-dead'
         AND e.tags->>'job' = r.jobname
         AND e.created_at > date_trunc('day', now())
    ) THEN
      INSERT INTO public.error_logs (severity, message, tags, context)
      VALUES (
        'error',
        CASE r.verdict
          WHEN 'unscheduled' THEN
            format('Cron %s is expected to run but does not exist in cron.job', r.jobname)
          WHEN 'inactive' THEN
            format('Cron %s exists but is disabled (active = false)', r.jobname)
          WHEN 'never-ran' THEN
            format('Cron %s has never fired since it was registered at %s (tolerance %s)',
                   r.jobname, r.registered_at, r.expected_max_gap)
          WHEN 'erroring' THEN
            format('Cron %s is firing but its last 3 runs all failed inside pg_cron', r.jobname)
          WHEN 'unmonitored' THEN
            format('Cron %s is scheduled and active but has no liveness expectation — nothing would notice if it stopped. Add a cron_work_expectations row with an expected_max_gap matching its schedule.',
                   r.jobname)
          ELSE
            format('Dead cron: %s has not fired since %s (tolerance %s)',
                   r.jobname, r.last_start, r.expected_max_gap)
        END,
        jsonb_build_object('source', 'cron-dead', 'area', 'cron',
                           'job', r.jobname, 'verdict', r.verdict),
        jsonb_build_object('last_start',         r.last_start,
                           'registered_at',      r.registered_at,
                           'scheduler_resumed_at', v_resumed_at,
                           'expected_max_gap',   r.expected_max_gap::text,
                           'verdict',            r.verdict));
      v_flagged := v_flagged + 1;
      v_names := v_names || r.jobname;
    END IF;
  END LOOP;

  IF v_flagged > 0 THEN
    BEGIN
      PERFORM net.http_post(
        url := (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'supabase_url' LIMIT 1)
               || '/functions/v1/slack-ops-alert',
        headers := jsonb_build_object(
          'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'service_role_key' LIMIT 1),
          'Content-Type', 'application/json'),
        body := jsonb_build_object(
          'title', format('%s cron(s) need attention', v_flagged),
          'message', format('Affected: %s. Each either missed a full tolerance while the scheduler was running, or is scheduled with no liveness expectation at all. See error_logs (tags.source = cron-dead, tags.verdict).',
                            array_to_string(v_names, ', ')),
          'severity', 'critical'));
    EXCEPTION WHEN OTHERS THEN
      NULL;
    END;
  END IF;

  BEGIN
    v_digest := public.check_ops_digest_delivery();
  EXCEPTION WHEN OTHERS THEN
    v_digest := jsonb_build_object('ok', false, 'check_error', SQLERRM);
    INSERT INTO public.error_logs (severity, message, tags)
    VALUES ('error', 'check_ops_digest_delivery raised: ' || SQLERRM,
            jsonb_build_object('source', 'cron-dead', 'area', 'alerting', 'job', 'check_ops_digest_delivery'));
  END;

  RETURN jsonb_build_object('flagged', v_flagged, 'jobs', to_jsonb(v_names),
                            'scheduler_resumed_at', v_resumed_at,
                            'digest_delivery', v_digest);
END;
$fn$;

REVOKE ALL ON FUNCTION public.sweep_dead_crons() FROM PUBLIC, anon, authenticated;

COMMENT ON FUNCTION public.sweep_dead_crons() IS
  'Liveness for every scheduled job from cron.job_run_details, PLUS coverage: an active cron.job row with no cron_work_expectations tolerance is reported as "unmonitored", so the expectation list is checked against the scheduler rather than against itself. A job''s tolerance is measured from the later of its last firing and the end of the most recent scheduler blackout.';

-- ── 2. A client-written row can never carry a paging source or severity ─────
--
-- SECURITY INVOKER on purpose (no SECURITY DEFINER clause): this function's
-- entire job is to read `current_user`, and a definer function would read its
-- own owner every time and stamp every row 'server'.
CREATE OR REPLACE FUNCTION public.stamp_error_log_origin()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $fn$
DECLARE
  -- Kept identical to CRITICAL_ERROR_LOG_SOURCES in
  -- supabase/functions/_shared/alertPolicy.ts and to v_critical_sources in
  -- notify_slack_on_error_log below; src/test/alertPolicy.test.ts compares all
  -- three.
  v_paging_sources CONSTANT text[] := ARRAY[
    'detect_stuck_payments',
    'auto_start_due_jobs',
    'detect_suspicious_user_patterns',
    'rls-escalation-refused'
  ];
  v_tags   jsonb;
  v_source text;
BEGIN
  -- tags is NOT NULL with a '{}' default, but nothing stops a caller sending an
  -- array or a scalar, and the stamp has to live on an object. Keep whatever
  -- came in rather than dropping it on the floor.
  IF jsonb_typeof(NEW.tags) = 'object' THEN
    v_tags := NEW.tags;
  ELSE
    v_tags := jsonb_build_object('claimed_tags', NEW.tags);
  END IF;

  -- Any role that is not one PostgREST hands a browser. That covers
  -- service_role (edge functions), postgres/supabase_admin (cron, migrations)
  -- and every SECURITY DEFINER path, which runs as its owner.
  IF current_user NOT IN ('anon', 'authenticated') THEN
    NEW.tags := jsonb_set(v_tags, '{origin}', '"server"', true);
    RETURN NEW;
  END IF;

  v_source := v_tags ->> 'source';

  -- The row is kept in full — message, stack, url, user agent — so client
  -- error logging is unchanged. Only the two fields that decide whether it
  -- PAGES are taken out of the client's hands.
  IF v_source = ANY (v_paging_sources) THEN
    v_tags := jsonb_set(v_tags, '{claimed_source}', to_jsonb(v_source), true);
    v_tags := jsonb_set(v_tags, '{source}', '"client-error"', true);
  END IF;

  -- 'fatal' is the other way into trg_error_logs_slack. A browser crash is a
  -- real 'error'; it is not an operator page.
  IF NEW.severity = 'fatal' THEN
    NEW.severity := 'error';
    v_tags := jsonb_set(v_tags, '{claimed_severity}', '"fatal"', true);
  END IF;

  NEW.tags := jsonb_set(v_tags, '{origin}', '"client"', true);
  RETURN NEW;
END;
$fn$;

COMMENT ON FUNCTION public.stamp_error_log_origin() IS
  'BEFORE INSERT on error_logs. Stamps tags.origin from current_user (client for anon/authenticated, server otherwise) and strips a paging source or fatal severity off a client row, keeping the original under tags.claimed_source / tags.claimed_severity. SECURITY INVOKER deliberately: it exists to read the real role.';

-- Named to sort FIRST. Postgres fires same-timing triggers in `tgname` order,
-- so a second BEFORE INSERT trigger that rewrote NEW.tags wholesale — or the
-- slack trigger ever being converted to BEFORE — would silently defeat the
-- stamp if this one sorted after it. '00_' costs nothing and removes that.
DROP TRIGGER IF EXISTS trg_error_logs_stamp_origin ON public.error_logs;
DROP TRIGGER IF EXISTS trg_error_logs_00_stamp_origin ON public.error_logs;
CREATE TRIGGER trg_error_logs_00_stamp_origin
  BEFORE INSERT ON public.error_logs
  FOR EACH ROW EXECUTE FUNCTION public.stamp_error_log_origin();

-- The insert policy, now naming its roles instead of PUBLIC (house rule: a
-- grant or policy that says PUBLIC is one nobody can read off). Same rule as
-- before for the rows a client may write — user_id null or their own — because
-- the severity/tags problem is fixed above, where it cannot be worked around
-- by choosing a different column value.
DROP POLICY IF EXISTS anyone_can_insert_errors ON public.error_logs;
CREATE POLICY anyone_can_insert_errors
  ON public.error_logs
  FOR INSERT
  TO anon, authenticated, service_role
  WITH CHECK (user_id IS NULL OR user_id = (SELECT auth.uid()));

COMMENT ON POLICY anyone_can_insert_errors ON public.error_logs IS
  'Client error logging. A row may be written for nobody or for the writer. What the row may CLAIM (tags.source, severity) is decided by trg_error_logs_stamp_origin, not here.';

-- ── 3. The Slack trigger trusts the stamp, not a request header ─────────────
CREATE OR REPLACE FUNCTION public.notify_slack_on_error_log()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_recent   int;
  v_title    text;
  v_source   text;
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

  IF NOT (NEW.severity = 'fatal' OR v_source = ANY (v_critical_sources)) THEN
    RETURN NEW;  -- counted in send_ops_daily_digest()
  END IF;

  -- Set by trg_error_logs_stamp_origin from current_user, which a client
  -- cannot choose. This replaces the 2026-09-14 check that read
  -- `request.jwt.claims ->> 'role'` and made an exception by source name for
  -- rls-escalation-refused: that exception was the forgeable hole, and it is
  -- no longer needed — prevent_self_escalation() is SECURITY DEFINER, so its
  -- row is stamped 'server' like any other.
  IF NEW.tags ->> 'origin' = 'client' THEN
    RETURN NEW;
  END IF;

  -- At most one post per source per 10 minutes (the rest are in error_logs and
  -- the digest). Bounds a burst.
  SELECT count(*) INTO v_recent
  FROM public.error_logs e
  WHERE e.id <> NEW.id
    AND e.created_at > now() - interval '10 minutes'
    AND (e.message = NEW.message
         OR (jsonb_typeof(e.tags) = 'object'
             AND COALESCE(e.tags ->> 'source', e.tags ->> 'area') = v_source));
  IF v_recent > 0 THEN
    RETURN NEW;
  END IF;

  v_title := left(format('[%s] %s', v_source, NEW.message), 140);

  BEGIN
    PERFORM net.http_post(
      url := (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'supabase_url')
             || '/functions/v1/slack-ops-alert',
      headers := jsonb_build_object(
        'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'service_role_key'),
        'Content-Type', 'application/json'),
      body := jsonb_build_object(
        'kind', 'custom',
        'severity', 'critical',
        'title', v_title,
        'message', left(COALESCE(NEW.message, ''), 900),
        'fields', jsonb_build_object(
          'url', COALESCE(NEW.url, '—'),
          'error_logs.id', NEW.id::text),
        'link', '/admin?view=health'));
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.notify_slack_on_error_log() FROM PUBLIC, anon, authenticated;

COMMENT ON TRIGGER trg_error_logs_slack ON public.error_logs IS
  'Posts SERVER-written fatal rows and money/security sources to #ops-alerts (one per source per 10 min). Server vs client is tags.origin, stamped from current_user by trg_error_logs_stamp_origin. Everything else goes to the daily digest.';
