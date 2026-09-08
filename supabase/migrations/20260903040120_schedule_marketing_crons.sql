-- Schedules the two marketing crons.
--
-- Minute choice is not arbitrary. 20260829010000 staggers every HTTP cron in
-- this product onto distinct minutes so they cannot co-fire and exhaust pg_net,
-- and 20260829020000/20260901030926 reserve :47, :52, :53 and :57 for the cron
-- watchers themselves. `sync-profiles-update-grants` additionally owns the
-- 4-59/10 series (:04 :14 :24 :34 :44 :54). :03/:18/:33/:48 and 07:38 are free
-- of all of that.
--
-- Both jobs are safe to over-fire. `marketing-publish` reads a due-time queue
-- and takes rows with an atomic claim, so an extra run publishes nothing extra;
-- it just finds no work. The daily cap is enforced against rows that ACTUALLY
-- published, so even a runaway schedule cannot exceed it.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    RAISE NOTICE 'pg_cron not installed — skipping marketing cron scheduling';
    RETURN;
  END IF;

  -- ── The dispatcher ─────────────────────────────────────────────────────
  -- Every 15 minutes. The queue is due-time driven, so this is just the
  -- granularity at which a scheduled post can go out — a post scheduled for
  -- 09:07 publishes at 09:18.
  PERFORM cron.unschedule('marketing-publish')
    WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'marketing-publish');

  PERFORM cron.schedule(
    'marketing-publish',
    '3,18,33,48 * * * *',
    $cron$
    SELECT net.http_post(
      url := (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'supabase_url' LIMIT 1) || '/functions/v1/marketing-publish',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'service_role_key' LIMIT 1)
      ),
      body := '{}'::jsonb
    );
    $cron$
  );

  -- ── Token health ───────────────────────────────────────────────────────
  -- Daily at 07:38 UTC (≈01:38 Central). A Meta token dying is a SILENT
  -- failure — posting stops and nothing says so — which is the whole reason
  -- this job exists separately from the dispatcher. If it were folded into
  -- `marketing-publish`, a kill switch that is off would also silence the
  -- warning that the token is about to die.
  PERFORM cron.unschedule('marketing-token-health')
    WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'marketing-token-health');

  PERFORM cron.schedule(
    'marketing-token-health',
    '38 7 * * *',
    $cron$
    SELECT net.http_post(
      url := (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'supabase_url' LIMIT 1) || '/functions/v1/marketing-token-health',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'service_role_key' LIMIT 1)
      ),
      body := '{}'::jsonb
    );
    $cron$
  );
END;
$$;

-- ── Liveness ─────────────────────────────────────────────────────────────
-- Registers both jobs with the dead-cron watcher (20260901030926) so that a
-- job which stops dispatching entirely is reported. Guarded on the table
-- existing so a from-scratch replay cannot break on migration order.
--
-- These rows ALSO arm the silent-failure detector (20260829020000), which
-- pages when a run reports candidates but dispositions none of them. That is
-- only safe because of how `disposition_keys` is chosen below, and the choice
-- is the whole point:
--
--   * kill switch off  → the function returns before claiming anything, so
--     `claimed` is 0 and the rule does not fire (it requires candidates > 0);
--   * channel disabled or daily cap reached → rows are claimed and then
--     RELEASED back to 'scheduled', so `released` counts as work done;
--   * a row that genuinely could not be posted → `failed` counts as work done.
--
-- So the only shape that pages is: rows were claimed, and none of them were
-- published, failed, released or skipped — i.e. work was taken and then
-- vanished. That is unambiguously a defect, which is the bar 20260829020000's
-- own comment sets for being in this table at all.
--
-- CONTRACT: `marketing-publish` MUST emit `claimed` plus all four disposition
-- keys in its response body, and `marketing-token-health` MUST emit `checked`
-- plus `healthy`/`alerted`/`skipped`. A renamed key silently disables the rule — the JOIN requires
-- `body ? candidate_key`, so a missing key means the run is never evaluated
-- rather than reported.
DO $$
BEGIN
  IF to_regclass('public.cron_work_expectations') IS NULL THEN
    RETURN;
  END IF;

  INSERT INTO public.cron_work_expectations (jobname, candidate_key, disposition_keys, expected_max_gap, note)
  VALUES
    ('marketing-publish', 'claimed', ARRAY['published', 'failed', 'released', 'skipped'],
     interval '2 hours',
     'Dispatches scheduled Facebook/Instagram posts. Zero published is legitimate whenever auto_publish_enabled is false or a channel is disabled, so this job is intentionally excluded from silent-failure paging and registered for LIVENESS only.'),
    -- `healthy`, NOT `ok`. cronResult builds `{ ok: <boolean>, fn, ...body,
    -- defects }` and spreads the body AFTER `ok`, so registering `ok` as a
    -- disposition key makes the function emit a NUMBER over the top of that
    -- boolean. Nothing reads `ok` out of a cron body today, so it breaks
    -- nothing — but it leaves `ok: 3` in a field whose whole contract is
    -- true/false, and the first thing that ever casts it as a boolean errors.
    ('marketing-token-health', 'checked', ARRAY['healthy', 'alerted', 'skipped'],
     interval '30 hours',
     'Warns before a Meta access token expires. Its own silence is the failure mode it exists to catch, so its liveness gap matters more than its output.')
  ON CONFLICT (jobname) DO UPDATE
    SET candidate_key     = EXCLUDED.candidate_key,
        disposition_keys  = EXCLUDED.disposition_keys,
        expected_max_gap  = EXCLUDED.expected_max_gap,
        note              = EXCLUDED.note;
END;
$$;
