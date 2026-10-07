-- Q1186: a pending accept completes without the Helpr coming back to the app.
--
-- WHAT WAS BROKEN. accept_job_offer parks an accept in job_accept_pending while
-- the Helpr's payout setup or Stripe ID is unfinished, and
-- trg_profiles_complete_pending_accepts completes it when the cached gate
-- columns on profiles open. Prod's webhook receives no Connect events (Q876:
-- 0 account.* rows in stripe_webhook_events, re-measured 2026-10-06), so the
-- only writer of those columns was the Helpr's own stripe-connect `status`
-- call (Profile or Activity). A Helpr who finished Stripe and did not reopen
-- the app before the offer's deadline lost the offer. cron.job had no re-check
-- (read-only SQL, 2026-10-06).
--
-- THE FIX. Edge function recheck-pending-accepts re-reads every waiting Helpr's
-- Connect account and syncs it through the same writer `status` uses
-- (_shared/connectGateSync.ts). This schedules it every 15 minutes and
-- registers its liveness and work expectation.
--
-- Guard: src/test/edge/recheck-pending-accepts.test.ts (the function) and the
-- cron registries' own guards (cronWorkVisibility, cronLivenessCoverage,
-- cronHttpRequestsAreTagged, httpCronsDeclareATimeout).
--
-- Replay-safe: cron.schedule upserts by name; the expectation is upserted;
-- both are skipped where pg_cron or the registry table do not exist.

DO $do$
BEGIN
  IF to_regclass('public.cron_work_expectations') IS NOT NULL THEN
    INSERT INTO public.cron_work_expectations (jobname, expected_max_gap, note, work_visibility, work_exempt_reason)
    VALUES ('recheck-pending-accepts', interval '40 minutes',
            'Q1186: every 15 minutes, re-reads the Connect account of every Helpr whose accept waits on setup (job_accept_pending) and syncs the payout gate, which completes the accept.',
            'exempt',
            'Nothing waiting is the healthy state, so a run that changes nothing is not a silent failure. A run that could not read or write answers 500 through cronResult.')
    ON CONFLICT (jobname) DO UPDATE SET expected_max_gap = EXCLUDED.expected_max_gap, note = EXCLUDED.note,
      work_visibility = EXCLUDED.work_visibility, work_exempt_reason = EXCLUDED.work_exempt_reason;
  END IF;

  IF EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'cron') THEN
    PERFORM cron.schedule('recheck-pending-accepts', '1-59/15 * * * *', $c$SELECT public.cron_http_tag(q.request_id, 'recheck-pending-accepts')
  FROM (
      SELECT net.http_post(timeout_milliseconds := 90000,
        url := (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'supabase_url' LIMIT 1)
               || '/functions/v1/recheck-pending-accepts',
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'service_role_key' LIMIT 1)
        ),
        body := '{}'::jsonb
      )
) AS q(request_id);$c$);
  END IF;
END
$do$;
