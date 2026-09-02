-- Reschedule payment-confirm-reminder from daily to every six hours.
--
-- ── The reminder that could never arrive ────────────────────────────────────
--
-- `payment-confirm-reminder` nudges the poster to confirm completion (or ask
-- for a revision) once the helper has marked a job done. Its eligibility window
-- is a TWELVE-hour band: `helper_completed_at` between 12 and 24 hours ago —
-- 12 because that leaves the poster the second half of the auto-release clock
-- to act in, 24 because `auto-release-payment` has already moved the money by
-- then and there is nothing left to confirm.
--
-- The schedule was `15 15 * * *` — ONCE A DAY (20260612440000, restaged to
-- 15:15 by 20260829010000). A once-daily sample against a twelve-hour window
-- cannot cover it. Let t₀ be the gap between the helper marking complete and
-- the next tick, t₀ ∈ [0,24). The job is graded at t₀, t₀+24, … and
-- `helper_completed_at ∈ [now-24h, now-12h]` requires `t₀+24k ∈ [12,24]`, which
-- has a solution only for t₀ ∈ [12,24]. Every job completed in the twelve hours
-- AFTER a tick is looked at once too early (< 12h) and next at t₀+24 (> 24h,
-- past auto-release), and is never reminded at all.
--
-- Roughly half of all submissions, therefore, could never land in this cron on
-- either pass. Measured on prod 2026-09-02: `jobs.payment_confirm_notif_sent`
-- is true on ZERO rows, ever. The run answers 200 with a plausible
-- `processed: 0` every day, because from its own point of view nothing went
-- wrong — there genuinely were no eligible rows in the band it was allowed to
-- look at.
--
-- This is a reminder about a deadline that never arrives before the deadline.
--
-- ── Why the schedule and not the window ─────────────────────────────────────
--
-- Widening the window is the fix that worked for `review-nag-cron`. It is not
-- available here, because this deadline is HARD: `auto-release-payment` moves
-- the money at `AUTO_COMPLETE_HOURS` (24h, `_shared/escrowTiming.ts`). A window
-- wide enough for a daily cron would have to start at 0h — pinging the poster
-- minutes after the helper's own "job complete" notification, which is noise —
-- and would still have nothing useful to say to a job that is already 23 hours
-- old. There is no 24-hour-wide window inside a 24-hour deadline that is also a
-- useful reminder. The sample rate is what is wrong, so the sample rate is what
-- changes.
--
-- ── Why six hours ──────────────────────────────────────────────────────────
--
-- Coverage requires `period <= AUTO_COMPLETE_HOURS - REMIND_AFTER_HOURS`, i.e.
-- <= 12. Twelve exactly would close the hole with ZERO margin: the grid would
-- equal the window width, so a single missed firing reopens it — and missed
-- firings are not hypothetical here. pg_net times out at 5s and this project
-- logs those routinely, and on 2026-09-01 pg_cron dispatched nothing at all for
-- 65 minutes (07:43–08:48 UTC), a gap visible in `cron_run_log` across every
-- job in the product. Six hours makes the grid half the window, so every job is
-- graded inside the band TWICE — which `payment_confirm_notif_sent` makes
-- harmless, since it is set on the first send and excluded from the query
-- thereafter — and one skipped tick still leaves full coverage.
--
-- `15 */6 * * *` → 00:15, 06:15, 12:15, 18:15 UTC. The function names this
-- exact expression in its own header and in the defect text it emits; this is
-- that migration.
--
-- ── Minute-map check (20260829010000) ───────────────────────────────────────
--
-- Minute :15 is claimed by nothing else at any hour. The neighbours at these
-- hours are :10 void-cancelled-payments (hourly), :17 backfill-job-geocode
-- (*/4), :20 process-scheduled-payouts (hourly) and money-reconciliation
-- (08:20), :21 auto-resolve-disputes (*/6), :41 saved-helper-availability-push
-- (*/6) and :44 str-ical-sync (*/6). Nothing co-fires, so
-- `sweep_cron_http_failures`'s proximity fallback keeps its exact attribution.
--
-- ── Replay-safety ──────────────────────────────────────────────────────────
--
-- `cron.alter_job`, not unschedule-then-schedule — the same choice
-- 20260829010000 made and for the same reason: re-typing the command of a live
-- cron is how a cosmetic migration breaks a working job. If the job does not
-- exist (a fresh or restored database where 20260612440000 has not created it
-- yet, or pg_cron is not installed), this is a no-op and 20260612440000 remains
-- the file that creates it. Re-running changes nothing.

DO $$
DECLARE
  v_jobid bigint;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    RAISE NOTICE 'pg_cron not installed — leaving payment-confirm-reminder alone';
    RETURN;
  END IF;

  SELECT j.jobid INTO v_jobid FROM cron.job j WHERE j.jobname = 'payment-confirm-reminder';

  IF v_jobid IS NULL THEN
    RAISE NOTICE 'payment-confirm-reminder is not scheduled here — nothing to re-schedule';
    RETURN;
  END IF;

  PERFORM cron.alter_job(job_id := v_jobid, schedule := '15 */6 * * *');
  RAISE NOTICE 'payment-confirm-reminder rescheduled to 15 */6 * * *';
END;
$$;

-- Liveness tolerance follows the schedule. 20260901030926 gave this job
-- `interval '30 hours'` on the assumption it fired once a day; at a six-hour
-- period that tolerance would let it miss FOUR consecutive firings — the whole
-- coverage guarantee above — before anything noticed. 14 hours is the same
-- roughly-2.5x rule that file applies to the other `*/6` jobs
-- (auto-resolve-disputes, saved-helper-availability-push), so one missed
-- firing never pages and two consecutive ones do.
DO $$
BEGIN
  IF to_regclass('public.cron_work_expectations') IS NULL THEN
    RETURN;
  END IF;
  UPDATE public.cron_work_expectations
     SET expected_max_gap = interval '14 hours'
   WHERE jobname = 'payment-confirm-reminder';
END;
$$;
