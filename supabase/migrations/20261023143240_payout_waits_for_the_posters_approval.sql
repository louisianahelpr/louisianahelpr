-- A Helpr is paid only after the person who posted the job approves the work (owner 2026-10-23,
-- after "Mow two lawns" 7c6deb77, where the Helpr was told "$94 will be sent to your account 3 days after
-- the job is marked done" and, from this trigger, "Payment is being processed").
--
--   A. Clear money copy: a completion notice names the DAY the payout is sent, never "Payment is being
--      processed" or "has been captured".
--   B. The payout clock starts at the approval (supabase/functions/_shared/escrowTiming.ts, edge side).
--   C. Nothing releases on a timer: when the poster has not approved within 24 hours of the Helpr marking the
--      work done (or within the 72 hours to accept a revision fix), auto-release-payment files a row here and
--      Helpr support steps in. The money stays held until the poster or an admin approves, or an admin
--      refunds.
--
-- What this file does:
--   1. public.job_approval_escalations: the admin queue (one row per job; the service role files it through
--      file_approval_escalation, which re-opens a closed row when the job stalls AGAIN after it was closed;
--      admins read it through admin_approval_escalation_queue and close it through resolve_approval_escalation,
--      which writes admin_audit_log).
--   2. notify_on_job_update (restated from 20260925154606_group_crew_has_no_lead): the single-Helpr
--      "Job completed!" is no longer sent when the payout was scheduled in the same write (create-payment and
--      auto-release-payment send their own notice with the amount and the day); otherwise, and for every crew
--      member, it names the day the payout is sent, or says nothing about payment.
--   3. sweep_release_last_chance (restated from 20260926040817_money_sweeps_found_vs_done): the last warning
--      no longer says the payment "auto-releases"; it says Helpr support steps in and the money stays held.
--
-- Replay-safe: CREATE TABLE / INDEX IF NOT EXISTS, CREATE OR REPLACE, policies dropped and re-created.
-- Proof: src/test/pglite/payoutWaitsForApproval.pglite.mjs (this file applied 3x).

-- ── 1. The queue ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.job_approval_escalations (
  job_id       uuid PRIMARY KEY REFERENCES public.jobs(id) ON DELETE CASCADE,
  -- approval: the Helpr marked the work done and the poster did not answer in 24 hours.
  -- revision: the Helpr delivered a requested fix and the poster did not answer in 72 hours.
  reason       text NOT NULL CHECK (reason IN ('approval', 'revision')),
  escalated_at timestamptz NOT NULL DEFAULT now(),
  -- Written ONLY by an admin, through resolve_approval_escalation() below (or by the admin approval in
  -- create-payment, which closes it in the same request).
  resolved_at  timestamptz,
  resolved_by  uuid,
  resolution   text CHECK (resolution IS NULL OR resolution IN ('approved_for_poster', 'reviewed')),
  created_at   timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT job_approval_escalations_resolved CHECK ((resolved_at IS NULL) = (resolution IS NULL))
);
CREATE INDEX IF NOT EXISTS job_approval_escalations_open_idx
  ON public.job_approval_escalations (escalated_at) WHERE resolved_at IS NULL;

ALTER TABLE public.job_approval_escalations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.job_approval_escalations FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.job_approval_escalations TO service_role;
-- Q807: every table created after it carries the unconfirmed-email write gate (service-only here, so it only
-- matters if a client grant is ever added).
DO $do$
BEGIN
  IF to_regprocedure('public.attach_unconfirmed_email_gate()') IS NOT NULL THEN
    PERFORM public.attach_unconfirmed_email_gate();
  END IF;
END
$do$;
COMMENT ON TABLE public.job_approval_escalations IS
  'Jobs whose poster did not approve the finished work (or a revision fix) in time, so Helpr support steps '
  'in and the escrow stays held (owner 2026-10-23). Written by auto-release-payment (service role); read by '
  'admins through admin_approval_escalation_queue() (20261023143240).';

-- File (or re-open) a job's escalation, atomically. p_anchor is when the current stall began (the Helpr's done
-- stamp, or the revision fix's). true = this call filed it, so the caller tells everyone; false = it is already
-- open for this stall, or an admin closed it after this stall began. A row closed BEFORE the stall began, or an
-- open one filed before it (a new cycle: the poster asked for a fix after the first escalation, and then ignored
-- the fix), is re-opened (lh-money-escrow review: one row per job forever left a second stall silent).
CREATE OR REPLACE FUNCTION public.file_approval_escalation(p_job_id uuid, p_reason text, p_anchor timestamptz)
RETURNS boolean
LANGUAGE sql
SET search_path TO 'public'
AS $fn$
  WITH filed AS (
    INSERT INTO public.job_approval_escalations AS e (job_id, reason, escalated_at)
    VALUES (p_job_id, p_reason, now())
    ON CONFLICT (job_id) DO UPDATE
      SET reason = EXCLUDED.reason, escalated_at = now(), resolved_at = NULL, resolved_by = NULL, resolution = NULL
      WHERE p_anchor IS NOT NULL
        AND ((e.resolved_at IS NOT NULL AND e.resolved_at < p_anchor)
          OR (e.resolved_at IS NULL AND e.escalated_at < p_anchor))
    RETURNING 1
  )
  SELECT EXISTS (SELECT 1 FROM filed);
$fn$;
REVOKE ALL ON FUNCTION public.file_approval_escalation(uuid, text, timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.file_approval_escalation(uuid, text, timestamptz) TO service_role;

-- Admins read the queue. Non-admins get no rows, not an error (the admin_stalled_job_queue convention).
-- still_waiting: the job is still live with its escrow held and no approval, and the poster has not sent it back
-- for a fix that is still being made (lh-money-escrow review: an admin must never approve over the poster's
-- "not done"), so the admin's action is needed.
CREATE OR REPLACE FUNCTION public.admin_approval_escalation_queue(p_include_resolved boolean DEFAULT false)
RETURNS TABLE(
  job_id               uuid,
  reason               text,
  title                text,
  customer_id          uuid,
  helper_id            uuid,
  budget               numeric,
  status               text,
  payment_status       text,
  helper_completed_at  timestamptz,
  revision_completed_at timestamptz,
  is_group_job         boolean,
  escalated_at         timestamptz,
  resolved_at          timestamptz,
  resolution           text,
  still_waiting        boolean
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
  SELECT e.job_id, e.reason, j.title, j.customer_id, j.helper_id, j.budget, j.status::text,
         j.payment_status::text, j.helper_completed_at, j.revision_completed_at, j.is_group_job,
         e.escalated_at, e.resolved_at, e.resolution,
         (j.status::text IN ('in_progress', 'revision_requested', 'accepted')
          AND j.payment_status::text = 'escrow' AND j.poster_completed_at IS NULL
          AND j.helper_completed_at IS NOT NULL
          AND NOT (j.status::text = 'revision_requested'
                   AND (j.revision_completed_at IS NULL OR j.revision_acceptance_deadline IS NULL
                        OR j.revision_acceptance_deadline > now()))) AS still_waiting
    FROM public.job_approval_escalations e
    JOIN public.jobs j ON j.id = e.job_id
   WHERE public.has_role(auth.uid(), 'admin')
     AND (COALESCE(p_include_resolved, false) OR e.resolved_at IS NULL)
   ORDER BY e.escalated_at ASC, e.job_id ASC;
$fn$;
REVOKE ALL ON FUNCTION public.admin_approval_escalation_queue(boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_approval_escalation_queue(boolean) TO authenticated, service_role;

-- An admin closes one queue item without moving money (they talked to the poster, refunded in Jobs, ...).
-- false = nothing open to close. The audit row is written in the same transaction.
CREATE OR REPLACE FUNCTION public.resolve_approval_escalation(p_job_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  v_uid uuid := (SELECT auth.uid());
  v_escalated_at timestamptz;
BEGIN
  IF v_uid IS NULL OR NOT public.has_role(v_uid, 'admin') THEN
    RAISE EXCEPTION 'not_authorized' USING ERRCODE = '42501';
  END IF;
  UPDATE public.job_approval_escalations
     SET resolved_at = now(), resolved_by = v_uid, resolution = 'reviewed'
   WHERE job_id = p_job_id AND resolved_at IS NULL
  RETURNING escalated_at INTO v_escalated_at;
  IF NOT FOUND THEN
    RETURN false;
  END IF;
  INSERT INTO public.admin_audit_log (admin_id, action, target_type, target_id, details)
  VALUES (v_uid, 'resolve_approval_escalation', 'job', p_job_id::text,
          jsonb_build_object('escalated_at', v_escalated_at, 'resolution', 'reviewed'));
  RETURN true;
END;
$fn$;
REVOKE ALL ON FUNCTION public.resolve_approval_escalation(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.resolve_approval_escalation(uuid) TO authenticated, service_role;

-- The day a payout is sent, as members read it ("Sun, Oct 25"), in Louisiana time. NULL in, NULL out.
-- The SQL twin of payoutDayLabel (supabase/functions/_shared/escrowTiming.ts).
CREATE OR REPLACE FUNCTION public.payout_day_label(p_at timestamptz)
RETURNS text
LANGUAGE sql
STABLE
SET search_path TO 'public'
AS $fn$
  SELECT to_char(p_at AT TIME ZONE 'America/Chicago', 'Dy, Mon FMDD');
$fn$;
REVOKE ALL ON FUNCTION public.payout_day_label(timestamptz) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.payout_day_label(timestamptz) TO authenticated, service_role;

-- ── 2. The completion notice names the day (restated from 20260925154606) ──
CREATE OR REPLACE FUNCTION public.notify_on_job_update()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  -- One Helpr: when the same write scheduled the payout (create-payment's approval, auto-release-payment's
  -- release of an approved job), that writer already told the Helpr the amount and the day; a second
  -- "Job completed!" here was a duplicate that said "Payment is being processed" (owner 2026-10-23).
  -- Any other road to completed (an admin's status change) says the job is complete and nothing about money
  -- it cannot see.
  IF NEW.status = 'completed' AND OLD.status = 'in_progress' AND NEW.helper_id IS NOT NULL
     AND NEW.is_group_job IS NOT TRUE
     AND NOT (NEW.payment_status::text = 'payout_pending' AND NEW.payout_scheduled_at IS NOT NULL) THEN
    INSERT INTO public.notifications (user_id, title, message, type, link)
    VALUES (NEW.helper_id, 'Job completed!', '"' || NEW.title || '" is complete.', 'payment', '/jobs?job=' || NEW.id::text);
  END IF;

  IF NEW.status = 'cancelled' AND OLD.status != 'cancelled' AND OLD.helper_id IS NOT NULL
     AND COALESCE(current_setting('app.sanctioned_cancel', true), '') <> 'on' THEN
    INSERT INTO public.notifications (user_id, title, message, type, link)
    VALUES (OLD.helper_id, 'Job cancelled', '"' || OLD.title || '" was cancelled by the person who posted it.', 'warning', '/jobs?job=' || OLD.id::text);
  END IF;

  -- A crew (Q407): every member, never one. A crew job completes from any
  -- live status (the roster roll-up), so the edge is "became completed".
  -- poster_cancel_job tells each member their own share itself, so a
  -- sanctioned cancel is skipped here exactly as for a single Helpr.
  IF NEW.is_group_job IS TRUE THEN
    IF NEW.status = 'completed' AND OLD.status IS DISTINCT FROM 'completed' THEN
      INSERT INTO public.notifications (user_id, title, message, type, link, job_id)
      SELECT g.helper_id, 'Job completed!',
             '"' || NEW.title || '" is complete.'
               || CASE WHEN NEW.payment_status::text = 'payout_pending' AND NEW.payout_scheduled_at IS NOT NULL
                       THEN ' Your share will be sent to your account ' || public.payout_day_label(NEW.payout_scheduled_at) || '.'
                       ELSE '' END,
             'payment', '/jobs?job=' || NEW.id::text, NEW.id
        FROM public.group_job_helpers g
       WHERE g.job_id = NEW.id AND g.helper_id IS NOT NULL;
    END IF;

    IF NEW.status = 'cancelled' AND OLD.status != 'cancelled'
       AND COALESCE(current_setting('app.sanctioned_cancel', true), '') <> 'on' THEN
      INSERT INTO public.notifications (user_id, title, message, type, link, job_id)
      SELECT g.helper_id, 'Job cancelled',
             '"' || OLD.title || '" was cancelled by the person who posted it.',
             'warning', '/jobs?job=' || OLD.id::text, OLD.id
        FROM public.group_job_helpers g
       WHERE g.job_id = OLD.id AND g.helper_id IS NOT NULL;
    END IF;
  END IF;

  RETURN NEW;
END;
$function$;
REVOKE ALL ON FUNCTION public.notify_on_job_update() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.notify_on_job_update() TO service_role;

-- ── 3. The last warning before Helpr support steps in (restated from 20260926040817) ──
CREATE OR REPLACE FUNCTION public.sweep_release_last_chance()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  rec RECORD;
  total_pushed integer := 0;
  v_found      integer := 0;
  v_failed     integer := 0;
BEGIN
  FOR rec IN
    SELECT j.id, j.title, j.customer_id
      FROM public.jobs j
     WHERE j.release_last_chance_notif_sent_at IS NULL
       AND j.status = 'in_progress'
       AND j.payment_status = 'escrow'
       AND j.poster_completed_at IS NULL
       AND j.revision_requested_at IS NULL
       AND j.helper_completed_at IS NOT NULL
       -- inside the final 2 hours of the 24h window
       AND j.helper_completed_at <= NOW() - INTERVAL '22 hours'
       AND j.helper_completed_at >  NOW() - INTERVAL '24 hours'
     ORDER BY j.helper_completed_at
     LIMIT 100
  LOOP
    v_found := v_found + 1;
    BEGIN
      INSERT INTO public.notifications (user_id, type, title, message, link, read, job_id)
      VALUES (
        rec.customer_id,
        'warning',
        'Please review the work',
        -- Owner 2026-10-23: nothing is paid without the poster's approval. The money stays held; Helpr
        -- support steps in when the 24 hours run out.
        format('Your Helpr finished "%s". Approve it, or ask for a change if something''s wrong. If we don''t hear from you in about 2 hours, Helpr support will reach out. Your payment stays held until then.', rec.title),
        '/posts?job=' || rec.id::text,
        false,
        rec.id
      );
      UPDATE public.jobs SET release_last_chance_notif_sent_at = NOW() WHERE id = rec.id;
      total_pushed := total_pushed + 1;
    EXCEPTION WHEN OTHERS THEN
      v_failed := v_failed + 1;
      PERFORM public.log_cron_defect(
        'sweep_release_last_chance', rec.id::text, SQLERRM,
        jsonb_build_object('job_id', rec.id));
      RAISE NOTICE 'sweep_release_last_chance: job % failed: %', rec.id, SQLERRM;
    END;
  END LOOP;
  RETURN jsonb_build_object('found', v_found, 'pushed', total_pushed, 'failed', v_failed);
EXCEPTION WHEN OTHERS THEN
  PERFORM public.log_cron_defect(
    'sweep_release_last_chance', 'run', SQLERRM,
    jsonb_build_object('phase', 'scan', 'pushed_before_failure', total_pushed));
  -- The outer handler rolled back every warning this run wrote, so none were
  -- pushed, whatever total_pushed counted before the failure.
  RETURN jsonb_build_object('found', v_found, 'pushed', 0, 'failed', v_failed, 'scan_failed', 1);
END;
$function$;
REVOKE ALL ON FUNCTION public.sweep_release_last_chance() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.sweep_release_last_chance() TO service_role;
