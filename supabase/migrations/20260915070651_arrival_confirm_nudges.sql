-- A poster who never taps "Confirm They Arrived" no longer strands the Helpr.
--
-- WHAT WAS BROKEN. Since 20260915044137 (VN-33) a Helpr needs BOTH the server's
-- GPS check AND the poster's "Confirm They Arrived" before they can start work
-- or mark the job complete. Nothing asked the poster to confirm: the only
-- "has arrived" notice rides the Helpr's tracking row and obeys the poster's
-- travel-update preference. A poster who muted that, or just didn't look, left
-- the Helpr standing at the door with no way forward and the payout clock never
-- starting.
--
-- THE DECISION (owner, 2026-09-14, pop-up "Nudge, then escalate"):
--   0h  — push + email the poster as soon as the GPS arrival lands;
--   2h  — push + email them again;
--   24h — escalate to admin to confirm the arrival or open a dispute.
-- The sends live in the `arrival-confirm-reminder` edge function. This file
-- adds only the ledger it claims each stage in, the cron that runs it, and the
-- liveness expectation that watches the cron.
--
-- WHY A SIDE TABLE, NOT COLUMNS ON jobs. `jobs` is a client-reachable table with
-- column whitelists and a dozen guard triggers; three more server-only stamps
-- would each need adding to every one of them. A table with RLS on, no
-- policies and no client grants cannot be read or written by anon or
-- authenticated at all, and the function claims a stage with a conditional
-- write, so two overlapping runs cannot double-send.
--
-- REPLAY-SAFETY: CREATE ... IF NOT EXISTS; the cron block is skipped when
-- pg_cron or the vault secrets are absent, and never re-types an existing job;
-- the expectation upsert is guarded on its table existing.

CREATE TABLE IF NOT EXISTS public.job_arrival_confirm_nudges (
  job_id          uuid PRIMARY KEY REFERENCES public.jobs(id) ON DELETE CASCADE,
  first_sent_at   timestamptz,
  second_sent_at  timestamptz,
  escalated_at    timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.job_arrival_confirm_nudges ENABLE ROW LEVEL SECURITY;

-- Server-only. Default privileges on this project grant new tables to anon and
-- authenticated, so the revoke is explicit (REVOKE by role name, not just
-- PUBLIC — CLAUDE.md).
REVOKE ALL ON public.job_arrival_confirm_nudges FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.job_arrival_confirm_nudges TO service_role;

COMMENT ON TABLE public.job_arrival_confirm_nudges IS
  'Which arrival-confirm nudge stages have been sent per job (VN-33). Written only by the arrival-confirm-reminder edge function (service role).';

DO $$
BEGIN
  IF to_regnamespace('cron') IS NULL THEN
    RAISE NOTICE 'pg_cron not installed; arrival-confirm-reminder not scheduled';
    RETURN;
  END IF;
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'arrival-confirm-reminder') THEN
    RETURN;
  END IF;
  -- Every 10 minutes at :04, :14, … — "right away" to within ten minutes, and a
  -- 2h / 24h stage can be late by at most one period.
  PERFORM cron.schedule(
    'arrival-confirm-reminder',
    '4-59/10 * * * *',
    $cmd$
      SELECT net.http_post(
        url := (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'supabase_url' LIMIT 1)
               || '/functions/v1/arrival-confirm-reminder',
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

DO $$
BEGIN
  IF to_regclass('public.cron_work_expectations') IS NULL THEN RETURN; END IF;
  INSERT INTO public.cron_work_expectations (jobname, expected_max_gap, note)
  VALUES ('arrival-confirm-reminder', interval '1 hour', 'VN-33 poster arrival-confirm nudges, runs every 10 min')
  ON CONFLICT (jobname) DO UPDATE SET expected_max_gap = EXCLUDED.expected_max_gap;
END;
$$;
