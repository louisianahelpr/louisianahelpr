-- Catch the cron that answers 200 and quietly does nothing.
--
-- 20260828030000 made a scheduled run answer non-2xx when its own defect
-- counter is non-zero. That closes the case where a function KNOWS it failed.
-- It does not close the case where a function believes it succeeded:
--
--   - payment-confirm-reminder answered `200 {"processed":14,"sent":0,...}`.
--     Fourteen posters were due a reminder; none got one. The status code
--     convention now catches this specific bug because the failed INSERTs are
--     counted — but only because they happened to be counted.
--   - the revision/payout-clock bug auto-completed jobs whose poster had asked
--     for a revision. That run had zero defects by any measure. It did exactly
--     what it was written to do, and what it was written to do was wrong.
--
-- The signal those share is arithmetic, not exceptional: the run FOUND work and
-- then produced none. `processed: 14, sent: 0` is a sentence that should never
-- be true twice in a row, and no amount of error handling inside the function
-- will say so, because from the function's point of view nothing went wrong.
--
-- IMPORTANT — why this is not simply "alert when a cron does nothing":
-- zero work is usually CORRECT. On a quiet day payment-confirm-reminder has no
-- eligible jobs and legitimately sends zero, forever, and a detector that pages
-- for that is one more thing to mute. The predicate is therefore always
-- "candidates were found AND none of them were dispositioned", never "the
-- count was zero". Every rule below is written so that a run with no candidates
-- is invisible to it.

-- ── 1. Durable record of what each run reported ──────────────────────────────
-- net._http_response is pruned after ~6 hours, which is far too short to see
-- "this has produced nothing for a week". This keeps only what is needed to
-- answer that: which cron, what it returned, and the JSON body it reported.
CREATE TABLE IF NOT EXISTS public.cron_run_log (
  id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  jobname      text        NOT NULL,
  status_code  int         NULL,
  body         jsonb       NOT NULL DEFAULT '{}'::jsonb,
  response_id  bigint      NOT NULL,
  occurred_at  timestamptz NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now()
);

-- One row per pg_net response, so re-reading the overlapping window is a no-op.
CREATE UNIQUE INDEX IF NOT EXISTS cron_run_log_response_idx
  ON public.cron_run_log (response_id);
CREATE INDEX IF NOT EXISTS cron_run_log_job_time_idx
  ON public.cron_run_log (jobname, occurred_at DESC);

ALTER TABLE public.cron_run_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "admins read cron_run_log" ON public.cron_run_log;
CREATE POLICY "admins read cron_run_log" ON public.cron_run_log
  FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

REVOKE ALL ON public.cron_run_log FROM anon;

-- ── 2. What "found work but produced none" means, per cron ───────────────────
-- Explicit per-cron config rather than inference. A generic "sum the numeric
-- fields" rule would fire on auto-tip-charge answering
-- `considered: 5, charged: 0, prompted: 5`, which is the function working
-- exactly as designed — every poster was correctly asked to tip by hand.
CREATE TABLE IF NOT EXISTS public.cron_work_expectations (
  jobname        text PRIMARY KEY,
  -- Body key holding "how many candidates this run found".
  candidate_key  text NOT NULL,
  -- Body keys that each count a candidate being dealt with, in ANY valid way.
  -- A run is only suspicious when every one of these is zero while candidates
  -- were found.
  disposition_keys text[] NOT NULL,
  -- Consecutive suspicious runs before it is worth saying anything. >1 so a
  -- single transient run never pages.
  min_streak     int  NOT NULL DEFAULT 2,
  note           text NOT NULL DEFAULT ''
);

ALTER TABLE public.cron_work_expectations ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "admins read cron_work_expectations" ON public.cron_work_expectations;
CREATE POLICY "admins read cron_work_expectations" ON public.cron_work_expectations
  FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));
REVOKE ALL ON public.cron_work_expectations FROM anon;

-- Seeded ONLY for crons where "candidates found, nothing dispositioned" is
-- unambiguously a defect. Crons whose zero-work runs can be legitimate
-- (cleanup-abandoned-accounts, whose `skipped` is the guards protecting live
-- accounts; engagement-automations, which has no candidate count) are
-- deliberately absent — a rule that cannot distinguish right from wrong is
-- worse than no rule.
INSERT INTO public.cron_work_expectations
  (jobname, candidate_key, disposition_keys, min_streak, note)
VALUES
  ('payment-confirm-reminder', 'processed', ARRAY['sent'], 2,
   'processed>0 with sent=0 is the exact shape of the PGRST204 bug that made this cron send nothing for its entire life.'),
  ('expiring-jobs-push', 'processed', ARRAY['sent'], 2,
   'Same shape as payment-confirm-reminder; both notify by INSERT into notifications.'),
  ('daily-match-digest', 'users', ARRAY['queued'], 2,
   'Users matched but nothing queued means the digest silently stopped mailing.'),
  ('charge-recurring-visits', 'seriesConsidered', ARRAY['funded','declined','skippedReleased','skippedExisting'], 2,
   'declined and the two skips are legitimate dispositions, so they count as work done; only a series that vanished entirely is suspicious.'),
  ('auto-tip-charge', 'considered', ARRAY['charged','prompted','failed'], 2,
   'prompted is a correct outcome (no saved card), so it counts. Candidates disappearing with no disposition at all is not.')
ON CONFLICT (jobname) DO UPDATE
  SET candidate_key    = EXCLUDED.candidate_key,
      disposition_keys = EXCLUDED.disposition_keys,
      min_streak       = EXCLUDED.min_streak,
      note             = EXCLUDED.note;

-- ── 3. Record every run, then look for silent ones ───────────────────────────
CREATE OR REPLACE FUNCTION public.sweep_silent_cron_failures()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_recorded int := 0;
  v_flagged  int := 0;
  v_names    text[] := ARRAY[]::text[];
  r          record;
BEGIN
  -- 3a. Ingest. Only rows whose body actually names its function are kept:
  -- without `fn` there is no trustworthy way to say which cron a body belongs
  -- to (see 20260828030000 — proximity guessed wrong 3 times in 4), and a
  -- streak counted against the wrong cron is worse than no streak at all.
  -- Body is left empty here and parsed in the loop below: a cast inside this
  -- set-returning INSERT would abort the entire ingest on one truncated or
  -- non-JSON body.
  INSERT INTO public.cron_run_log (jobname, status_code, body, response_id, occurred_at)
  SELECT substring(resp.content::text from '"fn"\s*:\s*"([a-zA-Z0-9_-]+)"'),
         resp.status_code,
         '{}'::jsonb,
         resp.id,
         resp.created
    FROM net._http_response resp
   WHERE resp.created > now() - interval '60 minutes'
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
         AND l.body ? c.candidate_key
    ),
    marked AS (
      SELECT r0.jobname, r0.rn, r0.min_streak, r0.note,
             COALESCE((r0.body ->> r0.candidate_key)::numeric, 0) AS candidates,
             (COALESCE((r0.body ->> r0.candidate_key)::numeric, 0) > 0
              AND (SELECT COALESCE(sum(COALESCE((r0.body ->> k)::numeric, 0)), 0)
                     FROM unnest(r0.disposition_keys) AS k) = 0) AS suspicious
        FROM runs r0
    )
    -- The streak is counted from the MOST RECENT run backwards: every row
    -- before the first non-suspicious one. Anchoring it there is what stops a
    -- cron that broke last week and has since recovered from paging today.
    SELECT m.jobname,
           m.min_streak,
           m.note,
           count(*) FILTER (
             WHERE m.rn < COALESCE(
               (SELECT min(m2.rn) FROM marked m2
                 WHERE m2.jobname = m.jobname AND NOT m2.suspicious),
               2147483647)
           ) AS streak,
           max(m.candidates) FILTER (WHERE m.rn = 1) AS latest_candidates
      FROM marked m
     GROUP BY m.jobname, m.min_streak, m.note
    HAVING count(*) FILTER (
             WHERE m.rn < COALESCE(
               (SELECT min(m2.rn) FROM marked m2
                 WHERE m2.jobname = m.jobname AND NOT m2.suspicious),
               2147483647)
           ) >= m.min_streak
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
$fn$;

REVOKE ALL ON FUNCTION public.sweep_silent_cron_failures() FROM PUBLIC, anon, authenticated;

-- Keep the log from growing without bound. 30 days is the detection window.
CREATE OR REPLACE FUNCTION public.prune_cron_run_log()
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  DELETE FROM public.cron_run_log WHERE occurred_at < now() - interval '45 days';
$$;

REVOKE ALL ON FUNCTION public.prune_cron_run_log() FROM PUBLIC, anon, authenticated;

-- Hourly at :47 — a free minute in the map set by 20260829010000, and this is
-- SQL-only so it never produces an http_response of its own to attribute.
SELECT cron.unschedule('sweep-silent-cron-failures')
 WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'sweep-silent-cron-failures');
SELECT cron.schedule('sweep-silent-cron-failures', '47 * * * *',
  $cron$SELECT public.sweep_silent_cron_failures();$cron$);

SELECT cron.unschedule('prune-cron-run-log')
 WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'prune-cron-run-log');
SELECT cron.schedule('prune-cron-run-log', '52 4 * * *',
  $cron$SELECT public.prune_cron_run_log();$cron$);
