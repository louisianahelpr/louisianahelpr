-- A Helpr reported as a no-show is shown as a no-show, not "Declined" or "You weren't picked".
--
-- 20261029154727 (A2-B14) made report_helper_no_show close the struck Helpr's
-- accepted application as 'rejected', with closed_reason NULL. A rejected
-- application with no reason reads "Declined" on the poster's applicant list
-- (posterApplicantBadge) and "You weren't picked" on the Helpr's card
-- (deriveHelperWait): both false, nobody declined anyone.
--
-- This migration:
--   1. adds 'no_show' to applications_closed_reason_check (newest before this:
--      20261008205730; live constraint read 2026-10-29 matches it);
--   2. restates report_helper_no_show VERBATIM from its newest body
--      (20261029154727) with one change: that UPDATE also sets
--      closed_reason = 'no_show';
--   3. restates its grants (live proacl 2026-10-29: authenticated, service_role).
--
-- Triggers on that UPDATE (read live 2026-10-29): enforce_application_party_columns
-- returns early for a definer RPC; notify_on_application's rejected branch needs
-- OLD.status = 'pending', so no notice goes out.
--
-- REPLAY-SAFETY: the constraint is dropped IF EXISTS and re-added; the function
-- is CREATE OR REPLACE; both apply cleanly any number of times.

ALTER TABLE public.applications DROP CONSTRAINT IF EXISTS applications_closed_reason_check;
ALTER TABLE public.applications ADD CONSTRAINT applications_closed_reason_check
  CHECK (closed_reason IS NULL OR closed_reason IN ('job_cancelled', 'party_blocked', 'offer_expired', 'not_confirmed', 'no_show'));

CREATE OR REPLACE FUNCTION public.report_helper_no_show(p_job_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_customer_id uuid;
  v_helper_id uuid;
  v_job_title text;
  v_payment_status text;
  v_date_needed date;
  v_start_time time;
  v_starts_at timestamptz;
  v_prior_count int;
  v_result jsonb;
  v_arrived_at timestamptz;
  v_helper_completed_at timestamptz;
  v_near_miss_at timestamptz;
  v_confirmed_at timestamptz;
BEGIN
  -- Trusted ladder — see apply_job_denial_consequence for why this line exists.
  -- (Also releases the jobs field-lock for the server-owned unassign below.)
  PERFORM set_config('app.trusted_ladder_write', 'on', true);

  -- Lock the job row.
  SELECT j.customer_id, j.helper_id, j.title, j.payment_status, j.date_needed, j.start_time,
         j.helper_arrived_at, j.helper_completed_at, j.helper_arrival_near_miss_at, j.helper_confirmed_at
    INTO v_customer_id, v_helper_id, v_job_title, v_payment_status, v_date_needed, v_start_time,
         v_arrived_at, v_helper_completed_at, v_near_miss_at, v_confirmed_at
  FROM public.jobs j
  WHERE j.id = p_job_id
  FOR UPDATE;

  IF v_customer_id IS NULL THEN
    RAISE EXCEPTION 'job_not_found';
  END IF;

  -- Only the job's poster may report a no-show.
  IF v_customer_id IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'not_authorized';
  END IF;

  IF v_helper_id IS NULL THEN
    RAISE EXCEPTION 'no_helper_assigned';
  END IF;

  -- GUARD -1 (Q1180, lh-authz-rls review 2026-10-03): a Helpr who never
  -- accepted the offer cannot have failed to show for it. Since 20261003193541
  -- an offer can sit unaccepted while the Helpr finishes Stripe setup.
  IF v_confirmed_at IS NULL THEN
    RAISE EXCEPTION 'helper_never_accepted'
      USING HINT = 'This Helpr never accepted the offer, so it cannot be a no-show. You can pick someone else from your applicants.';
  END IF;

  -- GUARD 0 (20260915044137, VN-33) — a Helpr who ARRIVED did not no-show.
  -- Since that migration an arrival exists only when the server found the
  -- Helpr within 500ft, and a reopen clears the arrival stamps
  -- (zz_jobs_arrival_integrity) — so a no-show report after an arrival would
  -- both strike a Helpr who was there AND erase the evidence that they were.
  -- The app already hides No-Show once helper_arrived_at is stamped; this is
  -- the same rule on the server. A completed Helpr is refused for the same
  -- reason, and because reopening would hand their completion to the next one.
  IF v_arrived_at IS NOT NULL OR v_helper_completed_at IS NOT NULL THEN
    RAISE EXCEPTION 'helper_already_arrived'
      USING HINT = 'The Helpr marked arrived on this job, so it cannot be reported as a no-show.';
  END IF;

  -- GUARD 0b (20260915074058, VN-33(b)) — a Helpr whose location was recorded
  -- within a mile of the pin in the last 12 hours may be at the real door of a
  -- wrong pin. The reopen below would strike them AND clear the near-miss
  -- record (zz_jobs_arrival_integrity), erasing the only evidence they came.
  -- The poster confirms the arrival or asks support; after 12 hours, with no
  -- confirmation, the report is allowed again.
  IF v_near_miss_at IS NOT NULL AND v_near_miss_at > now() - interval '12 hours' THEN
    RAISE EXCEPTION 'helper_near_miss_pending'
      USING HINT = 'Your Helpr checked in near the job, a little way from its map pin. If they are there, tap Confirm They Arrived; if not, contact support.';
  END IF;

  -- GUARD 1 — the job must be funded. Closes the throwaway-job ban attack.
  IF v_payment_status IS NULL OR v_payment_status = 'unpaid' THEN
    RAISE EXCEPTION 'job_not_funded'
      USING HINT = 'A no-show can only be reported on a funded job.';
  END IF;

  -- GUARD 2 — the scheduled start must have passed.
  v_starts_at := (v_date_needed + COALESCE(v_start_time, '00:00'::time))
                   AT TIME ZONE 'America/Chicago';
  IF v_starts_at IS NULL OR now() < v_starts_at THEN
    RAISE EXCEPTION 'job_not_started'
      USING HINT = 'Wait until the scheduled start time before reporting a no-show.';
  END IF;

  -- GUARD 3a — one report per job PER HELPR (DH-006). A no-show reopens the
  -- job and the poster may hire someone else; if that second Helpr also fails
  -- to show, they are a different person and must be reportable. The guard was
  -- job-wide, so the second no-show was refused with a message about the first.
  IF EXISTS (
    SELECT 1 FROM public.user_violations
    WHERE job_id = p_job_id AND violation_type = 'no_show'
      AND user_id = v_helper_id  -- DH-006 per-Helpr guard
  ) THEN
    RAISE EXCEPTION 'already_reported'
      USING HINT = 'This job already has a no-show report.';
  END IF;

  -- GUARD 3b — escalate on DISTINCT reporters, so one poster acting alone
  -- can warn but never reach the top rung.
  SELECT count(DISTINCT reported_by) INTO v_prior_count
  FROM public.user_violations
  WHERE user_id = v_helper_id
    AND violation_type = 'no_show'
    AND reported_by IS DISTINCT FROM auth.uid();

  -- The ladder itself is no longer written here. Same core, same policy switch
  -- as the other three wrappers: 'permanent' + p_permanent_requires_review
  -- becomes 'review' — a reversible 7-day restriction plus an admin case.
  v_result := public.apply_consequence_ladder(
    p_user                      => v_helper_id,
    p_violation_type            => 'no_show',
    p_description               => 'No-show for job: ' || COALESCE(v_job_title, 'Unknown'),
    p_job_id                    => p_job_id,
    p_prior_count               => v_prior_count,
    p_rungs                     => ARRAY['warning', 'pending_ban_review'],
    p_effects                   => ARRAY['final_warning', 'permanent'],
    -- No Helpr-facing copy from the core: the client already sends exactly one
    -- notification for this event (see the header). Casts are required —
    -- jsonb_build_array is VARIADIC "any" and cannot resolve a bare NULL.
    p_copy                      => jsonb_build_array(null::jsonb, null::jsonb),
    p_permanent_requires_review => true,
    p_suspension_days           => 7,
    p_clamp_to_worse_status     => true,
    p_admin_message_format      => '%s has %s no-show reports on file from different posters and is restricted for 7 days pending your decision.',
    -- Unused while p_permanent_requires_review is true; kept verbatim from the
    -- old direct-ban path so that path stays fully specified if the policy is
    -- ever revisited.
    p_ban_reason                => 'Repeated no-show violations'
  );

  -- ATTRIBUTION. The shared core does not know about `reported_by` — it is a
  -- column only the no-show ladder uses, and it is load-bearing: GUARD 3b
  -- counts DISTINCT reporters, and count(DISTINCT reported_by) ignores NULLs,
  -- so an unstamped row would make every future no-show look like a first
  -- offence and the ladder would never escalate at all. GUARD 3a proved above
  -- that this job had NO no_show row for this Helpr before the core inserted one, so this
  -- matches exactly the row just written.
  UPDATE public.user_violations
     SET reported_by = auth.uid()
   WHERE job_id = p_job_id
     AND violation_type = 'no_show'
     AND user_id = v_helper_id  -- DH-006 this Helpr's row only
     AND reported_by IS NULL;

  -- ADDED 20261029154727 (audit 2026-10-29 A2-B14): the struck Helpr's
  -- application closes with the booking, as helper_cancel_booking closes its
  -- own. The reopen below cleared jobs.helper_id but left this row 'accepted',
  -- so his Working tab listed the job under NEEDS YOU with "Accept job /
  -- Decline" beside his Final warning, and an accept could have put him back
  -- on the job he was just reported for. accepted -> rejected sends no notice
  -- (notify_on_application speaks only for pending -> rejected); the client
  -- already sends the one no-show notice.
  -- CHANGED 20261029180706: the close says why (closed_reason 'no_show'), so
  -- the poster's applicant badge reads "No-show" and the Helpr's own card
  -- "Reported as a no-show", never "Declined" / "You weren't picked".
  UPDATE public.applications
     SET status = 'rejected',
         closed_reason = 'no_show'
   WHERE job_id = p_job_id
     AND helper_id = v_helper_id
     AND status = 'accepted';

  -- Reopen the job so the poster can pick another applicant.
  -- Every stamp of the departed Helpr's booking goes with them (as
  -- helper_cancel_booking does): a confirmation left behind made the next
  -- Hire read as an already-accepted re-save (Q1180 review F3).
  UPDATE public.jobs
     SET status = 'open',
         helper_id = NULL,
         response_deadline = NULL,
         helper_confirmed_at = NULL,
         helper_dayof_confirmed_at = NULL,
         dayof_confirm_reminder_sent_at = NULL,
         dayof_unanswered_poster_alert_sent_at = NULL,
         start_reminder_sent_at = NULL
   WHERE id = p_job_id;

  -- Return shape unchanged: the core supplies {action, prior_count}, and the
  -- two fields the client reads for its own notifications are merged back on.
  RETURN v_result || jsonb_build_object(
    'helper_id', v_helper_id,
    'job_title', v_job_title
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.report_helper_no_show(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.report_helper_no_show(uuid) TO authenticated, service_role;
