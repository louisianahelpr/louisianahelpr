-- F272 money review note 1 (Medium): a no-show job's FULL refund keys on a SERVER-OWNED job marker.
-- Before: void-cancelled-payments (noShowFullRefund) and create-payment cancel_quote (qNoShowFull) keyed the full
-- refund on the struck Helpr's own user_violations 'no_show' row. Account deletion (20261006204113 delete_my_account)
-- and an admin reversal (20261109215021) delete that row, so a Helpr who deleted their account before the hourly sweep
-- made the poster get the ordinary refund (card fee and the $2 setup fee kept), against the owner's 11-11 ~2:50 PM rule.
--
-- After:
--   * jobs.no_show_reported_at (timestamptz): stamped by report_helper_no_show in the same UPDATE that reopens the
--     job, COALESCEd so a second report keeps the first instant, and never cleared by any path.
--   * trg_no_show_marker_server_owned: no client role sets or changes it (a direct PATCH or any other RPC); only a
--     server context or report_helper_no_show (transaction-local app.no_show_report_rpc, set around its one UPDATE).
--   * Backfill: every solo job that already carries a 'no_show' violation gets the violation's first created_at, so a
--     job reported before this migration keeps its full refund once the functions read the marker.
--   * report_helper_no_show restated from its newest definition (20261111202421); the ONLY change is the marker
--     stamp and the flag around the reopen UPDATE. Grants unchanged.
--
-- Proof: src/test/pglite/noShowRefundKey.pglite.mjs (the marker survives the violation row's deletion; a poster's
-- PATCH is refused). Edge: src/test/edge/void-cancelled-payments.noShowFullRefund.test.ts.
-- Sensitive: money (keys a refund) + authz (a new server-owned jobs column and its write lock).

ALTER TABLE public.jobs ADD COLUMN IF NOT EXISTS no_show_reported_at timestamptz;
COMMENT ON COLUMN public.jobs.no_show_reported_at IS
  'Set only by report_helper_no_show (20261111213317) when a poster reports the hired Helpr as a no-show; never cleared. void-cancelled-payments and create-payment cancel_quote refund such a job IN FULL while no Helpr is confirmed (owner 11-11). No client role writes it (trg_no_show_marker_server_owned).';

-- Backfill before the lock exists (a migration is a server context either way).
UPDATE public.jobs j
   SET no_show_reported_at = v.first_at
  FROM (SELECT uv.job_id, min(uv.created_at) AS first_at
          FROM public.user_violations uv
         WHERE uv.violation_type = 'no_show' AND uv.job_id IS NOT NULL
         GROUP BY uv.job_id) v
 WHERE j.id = v.job_id
   AND j.no_show_reported_at IS NULL
   AND j.is_group_job IS NOT TRUE;

CREATE OR REPLACE FUNCTION public.enforce_no_show_marker_server_owned()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
BEGIN
  IF public.is_server_context()
     OR current_setting('app.no_show_report_rpc', true) = '1' THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.no_show_reported_at IS NOT NULL THEN
      RAISE EXCEPTION 'no_show_marker_locked: jobs.no_show_reported_at is set only by report_helper_no_show'
        USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
  END IF;
  IF NEW.no_show_reported_at IS DISTINCT FROM OLD.no_show_reported_at THEN
    RAISE EXCEPTION 'no_show_marker_locked: jobs.no_show_reported_at is set only by report_helper_no_show (job_id=%)', OLD.id
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$fn$;

REVOKE ALL ON FUNCTION public.enforce_no_show_marker_server_owned() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_no_show_marker_server_owned ON public.jobs;
CREATE TRIGGER trg_no_show_marker_server_owned
  BEFORE INSERT OR UPDATE ON public.jobs
  FOR EACH ROW EXECUTE FUNCTION public.enforce_no_show_marker_server_owned();

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
  v_opens_at timestamptz;
  v_prior_count int;
  v_result jsonb;
  v_arrived_at timestamptz;
  v_helper_completed_at timestamptz;
  v_near_miss_at timestamptz;
  v_confirmed_at timestamptz;
  v_parent_job_id uuid;
  v_released date[];
BEGIN
  -- Trusted ladder — see apply_job_denial_consequence for why this line exists.
  -- (Also releases the jobs field-lock for the server-owned unassign below.)
  PERFORM set_config('app.trusted_ladder_write', 'on', true);

  -- Lock the job row.
  SELECT j.customer_id, j.helper_id, j.title, j.payment_status, j.date_needed, j.start_time,
         j.helper_arrived_at, j.helper_completed_at, j.helper_arrival_near_miss_at, j.helper_confirmed_at,
         j.parent_job_id
    INTO v_customer_id, v_helper_id, v_job_title, v_payment_status, v_date_needed, v_start_time,
         v_arrived_at, v_helper_completed_at, v_near_miss_at, v_confirmed_at,
         v_parent_job_id
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
  -- CHANGED 20261102100421 (Q2588): no start time is "any time that day" (src/lib/anyTimeThatDay.ts),
  -- so the Helpr is not a no-show until the day is over (the next Central midnight), never from the
  -- midnight that starts it. The app offers Report no-show from that same instant (jobIsOverdue).
  -- CHANGED 20261111202421 (F284, owner 11-11): a TIMED job can be reported only from 30 minutes after
  -- its start (a Helpr a few minutes late is not a no-show). The hint names that clock time, as the
  -- app's sheet does (src/lib/noShowOpens.ts). A job with no start time is unchanged: its day's end.
  v_starts_at := (CASE WHEN v_start_time IS NULL THEN (v_date_needed + 1) + '00:00'::time ELSE v_date_needed + v_start_time END)
                   AT TIME ZONE 'America/Chicago';
  v_opens_at := v_starts_at + CASE WHEN v_start_time IS NULL THEN interval '0 minutes' ELSE interval '30 minutes' END;
  IF v_starts_at IS NULL OR now() < v_opens_at THEN
    RAISE EXCEPTION 'job_not_started'
      USING HINT = CASE WHEN v_start_time IS NULL
        THEN 'This job is any time that day. You can report a no-show once the day is over.'
        ELSE 'You can report a no-show from '
             || CASE WHEN (v_opens_at AT TIME ZONE 'America/Chicago')::date = (now() AT TIME ZONE 'America/Chicago')::date
                     THEN to_char(v_opens_at AT TIME ZONE 'America/Chicago', 'FMHH12:MI AM')
                     ELSE to_char(v_opens_at AT TIME ZONE 'America/Chicago', 'FMDy, FMMon FMDD "at" FMHH12:MI AM') END
             || ', 30 minutes after the start time.' END;
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
    p_admin_message_format      => '%s has %s no-show reports on file from different people who posted jobs and is restricted for 7 days pending your decision.',
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
  -- ADDED 20261111213317 (F272 review note 1): the server-owned no-show marker, stamped once and never cleared.
  -- void-cancelled-payments and create-payment cancel_quote key the FULL refund on it (with helper_confirmed_at IS
  -- NULL), not on the Helpr's user_violations row, which account deletion and an admin reversal delete.
  PERFORM set_config('app.no_show_report_rpc', '1', true);
  UPDATE public.jobs
     SET status = 'open',
         no_show_reported_at = COALESCE(no_show_reported_at, now()),
         helper_id = NULL,
         response_deadline = NULL,
         helper_confirmed_at = NULL,
         helper_dayof_confirmed_at = NULL,
         dayof_confirm_reminder_sent_at = NULL,
         dayof_unanswered_poster_alert_sent_at = NULL,
         start_reminder_sent_at = NULL
   WHERE id = p_job_id;
  PERFORM set_config('app.no_show_report_rpc', '', true);

  -- ADDED 20261108202000 (Jobs audit 11-08 #7): the Helpr is told here, in the same transaction, as the crew version
  -- (rpc_poster_report_member_no_show) does. The app's own notice (create-notification 'no_show_reported') was best
  -- effort: a closed tab meant no notice. The words, type and link are exactly that template's, so an older app's
  -- second call is dropped by suppress_exact_duplicate_notification (same user, type, title, message, link within 10
  -- minutes). A warning is a Jobs notice (job_updates, audit #5); a restriction is about the account ('warning').
  INSERT INTO public.notifications (user_id, title, message, type, link, job_id)
  VALUES (
    v_helper_id,
    CASE WHEN v_result->>'action' = 'pending_ban_review' THEN '⛔ Account restricted for 7 days' ELSE '⚠️ No-show warning' END,
    CASE WHEN v_result->>'action' = 'pending_ban_review'
         THEN 'A second no-show was reported against you. Your account is restricted for 7 days while an admin reviews it. If you think this is wrong, email admin@louisianahelpr.com.'
         ELSE 'You received a no-show warning for "' || COALESCE(NULLIF(btrim(v_job_title), ''), 'your job') || '".' END,
    CASE WHEN v_result->>'action' = 'pending_ban_review' THEN 'warning' ELSE 'job_updates' END,
    '/profile?tab=warnings',
    p_job_id
  );

  -- ADDED 20261108202000 (Jobs audit 11-08 #12): a recurring visit's date goes back to the series, as
  -- helper_cancel_booking does, so the no-show Helpr's hold no longer books them into it (charge-recurring-visits
  -- books from series_visit_holds). After the reopen above: a vacated visit (open, no Helpr) is what it releases.
  IF v_parent_job_id IS NOT NULL THEN
    v_released := public.series_release_dates(v_parent_job_id, v_helper_id, ARRAY[v_date_needed], 'no_show',
                                              v_job_title, v_customer_id);
  END IF;

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
