-- Schedule str-ical-sync. It has never been scheduled anywhere.
--
-- ── The gap ─────────────────────────────────────────────────────────────────
--
-- supabase/functions/str-ical-sync/index.ts documents itself as a cron in its
-- own header ("Cron (Authorization: Bearer <CRON_SECRET>) → syncs all active")
-- and carries the full internal-caller auth path to prove it. It appears in no
-- `cron.schedule` call, in no workflow, and in no migration. Its only caller in
-- the entire repository is src/pages/StrSettings.tsx (a "Sync now" button),
-- which always sends a `connection_id`.
--
-- So the automatic half of the feature does not exist: a host connects an
-- Airbnb/VRBO calendar, and their turnover cleaning jobs are created only on
-- the passes where they happen to open Settings and tap. Availability goes
-- stale silently — `last_synced_at` is only ever written by that manual tap.
--
-- ── Why schedule it rather than delete the scaffolding ──────────────────────
--
-- The alternative was to strip the CRON_SECRET path and the header and call it
-- an explicitly manual tool. Rejected: the function's entire purpose is
-- unattended work. `str_calendar_connections.auto_create_cleaning` and the
-- 7-day checkout look-ahead only mean anything if something runs on a clock —
-- a checkout that happens on Tuesday has to become a job before Tuesday, and a
-- host who has to remember to tap has no reason to connect a calendar at all.
-- The idempotency guard the feature needs for a cron is already built and
-- already load-bearing (str_processed_events UNIQUE(connection_id, event_uid)),
-- so scheduling adds no new failure mode.
--
-- ── Blast radius today: zero ────────────────────────────────────────────────
--
-- `str_calendar_connections` has 0 rows in production (verified 2026-08-31), so
-- every run of this cron is a no-op until someone connects a calendar. That is
-- the reason to land it now rather than after the first host is affected.
--
-- ── Separate file on purpose ────────────────────────────────────────────────
--
-- 20260831190419 declares the 13 HTTP crons that exist in prod but in no
-- migration. This one is the opposite case — a cron that exists NOWHERE, prod
-- included — so it must actually create the job rather than skip a job that is
-- already there. Keeping it apart means neither file has to explain the other's
-- guard.
--
-- ── Schedule ────────────────────────────────────────────────────────────────
--
-- '44 */6 * * *' — four times a day, on a minute nothing else uses. Against a
-- 7-day look-ahead window, six hours of latency is invisible; the cost of a
-- tighter schedule is real (one outbound iCal fetch per connection per run,
-- against Airbnb/VRBO endpoints that rate-limit).
--
-- Minute :44 is free in the map set by 20260829010000 and extended since:
--   :00 auto-expire-jobs · :03-58/5 process-email-queue · :05,:35
--   auto-release-payment · :07 auto-tip-charge · :10 void-cancelled-payments ·
--   :15/30/45 detect-stuck-payments · :17 */4 backfill-job-geocode ·
--   :21 */6 auto-resolve-disputes · :41 */6 saved-helper-availability-push ·
--   :47 sweep-silent-cron-failures.
--
-- Same http_post shape as every other cron-invoked edge function here, with the
-- URL and bearer read from vault at RUN time (20260505220500 rewrote them all
-- to `service_role_key` in one pass, which is the evidence they share a shape).
-- An empty body is what str-ical-sync's "sync ALL active connections" branch
-- expects.
--
-- REPLAY-SAFETY: unschedule-then-schedule so a re-run replaces cleanly instead
-- of erroring on the duplicate name; the whole block is skipped when pg_cron is
-- absent (from-scratch rebuild) rather than erroring.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    RAISE NOTICE 'pg_cron not installed — skipping str-ical-sync schedule';
    RETURN;
  END IF;

  PERFORM cron.unschedule('str-ical-sync')
    WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'str-ical-sync');

  PERFORM cron.schedule(
    'str-ical-sync',
    '44 */6 * * *',
    $cmd$
      SELECT net.http_post(
        url := (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'supabase_url' LIMIT 1)
               || '/functions/v1/str-ical-sync',
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'service_role_key' LIMIT 1)
        ),
        body := '{}'::jsonb
      );
    $cmd$
  );
END;
$$;
