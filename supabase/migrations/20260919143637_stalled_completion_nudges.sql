-- A job nobody ever marks done no longer holds its escrow forever.
--
-- WHAT WAS BROKEN (verified live on fncmgoasalhdgfwzhsqa, 2026-09-19)
-- A job at status='in_progress' whose Helpr never taps "Mark Job Complete"
-- matched NO scheduled sweep at all:
--
--   auto-expire-jobs        §1 accepted + helper_confirmed_at IS NULL
--                           §2 open
--                           §3 expire_unanswered_offers   (accepted)
--                           §4 expire_pending_direct_offers
--   auto-release-payment    poster_completed_at <= cutoff
--                           OR helper_completed_at <= cutoff
--   arrival-confirm-reminder  poster_confirmed_arrival_at IS NULL — and an
--                           in_progress job has that stamp by definition
--
-- Eleven such rows were sitting on prod when this was written:
--   status='in_progress' AND helper_completed_at IS NULL
--   AND poster_completed_at IS NULL AND payment_status='escrow'
--   AND date_needed < today(America/Chicago)   ->  11
-- The escrow is held indefinitely and the person who posted the job is offered
-- no Approve control either (InProgressStep gates it on helper_completed_at),
-- so there is not even an explanation on screen.
--
-- THE DECISION (owner, 2026-09-19, pop-up: "Nudge both, then admin queue.
-- Never move money automatically.") — measured from the job's SCHEDULED END:
--   +2h  nudge BOTH parties
--   +24h nudge BOTH parties again
--   +48h a QUEUE ITEM AWAITING AN ADMIN, plus an ops alert
-- Money never moves on this path. Nobody can prove from the data whether the
-- work happened, so release/refund is a human decision. The thresholds are the
-- app's own constants (2h = cancellationFee's harshest tier and arrivalNudge's
-- SECOND_AFTER_HOURS; 24h = AUTO_COMPLETE_HOURS; 48h = TOTAL_TO_PAYOUT_HOURS,
-- i.e. the instant funds WOULD have landed on the normal path). Justified in
-- full in supabase/functions/_shared/stalledCompletion.ts.
--
-- WHAT THIS FILE ADDS
--   1. public.job_completion_nudges — the per-job stage ledger, which is ALSO
--      the admin queue (escalated_at set, resolved_at null = awaiting a human).
--   2. public.admin_stalled_job_queue() — how an admin reads that queue.
--   3. public.resolve_stalled_job_flag() — how an admin clears one.
--   4. the daily cron that runs the `stalled-completion-reminder` edge
--      function, and the liveness expectation that watches it.
--
-- NOT an admin_audit_log row. Every row there names an admin_id and the only
-- admins are real people; this is a queue item AWAITING an admin, never a
-- record of one having acted.
--
-- WHY A SIDE TABLE, NOT COLUMNS ON jobs. Same reasoning as
-- 20260915070651_arrival_confirm_nudges: `jobs` is client-reachable with column
-- whitelists and a dozen guard triggers, and three server-only stamps would
-- have to be added to every one of them. A table with RLS on, no policies and
-- no client grants is unreachable by anon and authenticated, and the sweep
-- claims each stage with a conditional write so two overlapping runs cannot
-- double-send.
--
-- REPLAY-SAFETY: CREATE TABLE/INDEX ... IF NOT EXISTS, ADD COLUMN IF NOT
-- EXISTS, CREATE OR REPLACE FUNCTION, the cron block skipped when pg_cron or
-- the vault secrets are absent and never re-scheduling an existing jobname, and
-- the expectation upsert guarded on its table existing. Applied 3x under PGlite.

CREATE TABLE IF NOT EXISTS public.job_completion_nudges (
  job_id          uuid PRIMARY KEY REFERENCES public.jobs(id) ON DELETE CASCADE,
  first_sent_at   timestamptz,
  second_sent_at  timestamptz,
  escalated_at    timestamptz,
  -- The queue half. Written ONLY by an admin, through
  -- resolve_stalled_job_flag() below. The sweep never touches these.
  resolved_at     timestamptz,
  resolved_by     uuid,
  created_at      timestamptz NOT NULL DEFAULT now()
);

-- Belt-and-braces for a tree where an earlier revision of this table may
-- already exist without the queue columns.
ALTER TABLE public.job_completion_nudges ADD COLUMN IF NOT EXISTS resolved_at timestamptz;
ALTER TABLE public.job_completion_nudges ADD COLUMN IF NOT EXISTS resolved_by uuid;

-- The queue read is "escalated and not yet resolved, oldest first".
CREATE INDEX IF NOT EXISTS job_completion_nudges_open_queue_idx
  ON public.job_completion_nudges (escalated_at)
  WHERE escalated_at IS NOT NULL AND resolved_at IS NULL;

ALTER TABLE public.job_completion_nudges ENABLE ROW LEVEL SECURITY;

-- Server-only. Default privileges on this project grant new tables to anon and
-- authenticated, so the revoke is explicit and BY ROLE NAME — `FROM PUBLIC`
-- alone leaves anon's own grant standing (CLAUDE.md).
REVOKE ALL ON public.job_completion_nudges FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.job_completion_nudges TO service_role;

COMMENT ON TABLE public.job_completion_nudges IS
  'Which stalled-completion nudge stages have been sent per job, and whether the '
  'escalation is still awaiting an admin. Written by the stalled-completion-reminder '
  'edge function (service role); read by admins through admin_stalled_job_queue().';

-- ───────────────────────────────────────────────────────────────────────────
-- The admin queue. Shaped after admin_support_queue: SECURITY DEFINER with the
-- admin predicate INSIDE, so a non-admin gets zero rows rather than an error,
-- and the base table keeps no client grants at all.
-- ───────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.admin_stalled_job_queue(
  p_include_resolved boolean DEFAULT false
)
RETURNS TABLE(
  job_id          uuid,
  title           text,
  customer_id     uuid,
  helper_id       uuid,
  budget          numeric,
  date_needed     date,
  start_time      time without time zone,
  estimated_hours numeric,
  status          text,
  payment_status  text,
  first_sent_at   timestamptz,
  second_sent_at  timestamptz,
  escalated_at    timestamptz,
  resolved_at     timestamptz
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT
    n.job_id,
    j.title,
    j.customer_id,
    j.helper_id,
    j.budget,
    j.date_needed,
    j.start_time,
    j.estimated_hours,
    j.status::text,
    j.payment_status::text,
    n.first_sent_at,
    n.second_sent_at,
    n.escalated_at,
    n.resolved_at
  FROM public.job_completion_nudges n
  JOIN public.jobs j ON j.id = n.job_id
  WHERE n.escalated_at IS NOT NULL
    -- Server-side authorization: non-admins get no rows, not an error.
    AND public.has_role(auth.uid(), 'admin')
    AND (coalesce(p_include_resolved, false) OR n.resolved_at IS NULL)
  ORDER BY n.escalated_at ASC, n.job_id ASC;
$function$;

REVOKE ALL ON FUNCTION public.admin_stalled_job_queue(boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_stalled_job_queue(boolean) TO authenticated;

COMMENT ON FUNCTION public.admin_stalled_job_queue(boolean) IS
  'Jobs that stalled in_progress with escrow held and nobody marking them done, '
  'escalated by stalled-completion-reminder and AWAITING a human decision. Oldest '
  'escalation first. Non-admins get zero rows.';

-- ───────────────────────────────────────────────────────────────────────────
-- How an admin clears one. Separate from any money movement on purpose: the
-- release / refund / dispute itself goes through the existing admin money
-- paths, and this only says "a person has dealt with it".
-- ───────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.resolve_stalled_job_flag(p_job_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_rows integer;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'not authorized';
  END IF;

  UPDATE public.job_completion_nudges
     SET resolved_at = now(),
         resolved_by = auth.uid()
   WHERE job_id = p_job_id
     AND escalated_at IS NOT NULL
     AND resolved_at IS NULL;

  GET DIAGNOSTICS v_rows = ROW_COUNT;
  -- false means "there was nothing open to resolve" — already cleared, or
  -- never escalated. The caller must not read that as success.
  RETURN v_rows > 0;
END;
$function$;

REVOKE ALL ON FUNCTION public.resolve_stalled_job_flag(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.resolve_stalled_job_flag(uuid) TO authenticated;

COMMENT ON FUNCTION public.resolve_stalled_job_flag(uuid) IS
  'Marks one stalled-job queue item as handled by the calling admin. Returns false '
  'when nothing was open to resolve. Moves no money — the release, refund or dispute '
  'goes through the existing admin money paths.';

-- ───────────────────────────────────────────────────────────────────────────
-- The cron. DAILY at 14:00 UTC (9am CDT / 8am CST) rather than hourly: the
-- anchor is the end of a calendar day, so a finer schedule would only buy the
-- ability to push someone at 2am. With this schedule a job whose day ended is
-- nudged the next morning, again the morning after, and escalated the morning
-- after that.
-- ───────────────────────────────────────────────────────────────────────────
DO $$
BEGIN
  IF to_regnamespace('cron') IS NULL THEN
    RAISE NOTICE 'pg_cron not installed; stalled-completion-reminder not scheduled';
    RETURN;
  END IF;
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'stalled-completion-reminder') THEN
    RETURN;
  END IF;
  PERFORM cron.schedule(
    'stalled-completion-reminder',
    '0 14 * * *',
    $cmd$
      SELECT net.http_post(
        url := (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'supabase_url' LIMIT 1)
               || '/functions/v1/stalled-completion-reminder',
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
  VALUES (
    'stalled-completion-reminder',
    interval '26 hours',
    'Nudges both sides of a job stuck in_progress with no completion stamp, then queues it for an admin. Runs daily at 14:00 UTC.'
  )
  ON CONFLICT (jobname) DO UPDATE SET expected_max_gap = EXCLUDED.expected_max_gap;
END;
$$;
