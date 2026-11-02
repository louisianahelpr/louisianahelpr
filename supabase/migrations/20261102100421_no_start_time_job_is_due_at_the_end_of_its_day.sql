-- A JOB WITH NO START TIME IS DUE WHEN ITS DAY IS OVER, NOT AT THE MIDNIGHT THAT STARTS IT (Jobs audit 1102b row 2, Q2588, server half).
--
-- What was broken (prod bodies read 2026-11-02 ~4:10 AM CT; md5(prosrc) equal to the newest CREATE in the repo for all
-- four: auto_start_due_jobs 2b230b84..., report_helper_no_show 71479674..., rpc_poster_report_member_no_show 3fb264bc...,
-- get_helper_on_time_percents db5ec820...):
--   * auto_start_due_jobs (cron every 15 min) read a NULL start_time as 00:00, so at 12:00 AM on the job's day it set
--     a booked no-start-time job to in_progress, and notify_poster_on_status_change (20261029160717) then told the
--     poster "Start time passed — <Helpr> hasn't checked in" just after midnight. 368 of 535 jobs posted in the 60 days
--     to 2026-11-02 have no start time (auditor's prod SELECT).
--   * report_helper_no_show and rpc_poster_report_member_no_show read it the same way, so a poster could strike a
--     Helpr (or a crew member) as a no-show at 12:01 AM on the day the job was "any time".
--   * get_helper_on_time_percents (the applicant's on-time % the poster sees, from 5 completed jobs) counted a
--     no-start-time job as late for any arrival after 12:10 AM. It also cast the arrival with ::timestamp, in the
--     session's zone (UTC on prod, read 2026-11-02), against a Louisiana wall-clock start, so a Helpr who came at
--     9:05 AM Central to a 9:00 AM job read as 5 hours late. Both read in America/Chicago now. Prod today: 2
--     completed real jobs with an arrival, no Helpr with the 5 that show a figure, so no shown number moves today.
--
-- The rule (the app's, one place: src/lib/anyTimeThatDay.ts): a job with no start time is "any time that day". It is
-- never late on its day; once the day is over, the overdue lines take over. jobIsOverdue
-- (src/components/job-card/activityFilters.ts) turns such a job overdue when its date is behind today in Central
-- time, i.e. at the NEXT Central midnight, (date_needed + 1) 00:00 America/Chicago. That one instant is now the due
-- instant here for all of them: the auto-start, its 7-day backstop and order, the no-show gate, and the on-time count
-- (arrived before the day is over). A job with a start
-- time is unchanged (date_needed + start_time). Wall-clock + AT TIME ZONE, so both DST days are right.
--
-- Not changed, checked: sweep_no_show_alerts (20261029173937) and sweep_job_start_reminders (20260927012241) already
-- skip start_time IS NULL. notify_poster_on_status_change is not restated (its newest body is on the unlanded
-- 20261102043115 train): its "Start time passed" branch is reached by a no-start-time job only through this
-- auto-start, which now runs at the end of the day. The Helpr's own on-the-way sets in_progress and the stamp in one
-- update (helper_mark_on_the_way), so that notice says "is on the way".
--
-- How: each function is the newest body verbatim apart from the lines marked CHANGED 20261102100421, and the no-show
-- refusal's hint, which says "any time that day" for a no-start-time job. Codes, rows, links and the ladder do not move.
--
-- Replay-safe: CREATE OR REPLACE of existing functions; grants restated as live (auto_start_due_jobs: postgres,
-- service_role; the two report RPCs and get_helper_on_time_percents: authenticated, service_role). Proof: src/test/pglite/noStartTimeDueAtDayEnd.pglite.mjs.

CREATE OR REPLACE FUNCTION public.auto_start_due_jobs()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  rec     record;
  started integer := 0;
BEGIN
  FOR rec IN
    SELECT j.id
      FROM public.jobs j
     WHERE j.status = 'accepted'::job_status
       -- Truly BOOKED, not merely offered. `accepted` covers two different
       -- moments: helpr chosen but not yet confirmed, and both sides locked
       -- in. Auto-starting the former would start a job nobody agreed to.
       AND (
            (j.helper_id IS NOT NULL AND j.helper_confirmed_at IS NOT NULL)
            -- Q728: a CREW has no lead (helper_id NULL, Q407). It is booked
            -- when it is fully staffed ('accepted') and EVERY hired member has
            -- confirmed; a crew with an unconfirmed member stays manual, the
            -- same way an unconfirmed single booking does.
         OR (j.is_group_job IS TRUE
             AND EXISTS (SELECT 1 FROM public.group_job_helpers g WHERE g.job_id = j.id AND g.helper_id IS NOT NULL)
             AND NOT EXISTS (SELECT 1 FROM public.group_job_helpers g
                              WHERE g.job_id = j.id AND g.helper_id IS NOT NULL AND g.helper_confirmed_at IS NULL))
       )
       -- A flexible-schedule job has no meaningful start moment, so there is
       -- nothing to trigger on. Those stay manual.
       AND COALESCE(j.is_flexible_schedule, false) = false
       -- date_needed is a DATE and start_time a naive TIME; both are local
       -- wall-clock. Helpr is Louisiana-only, so they are interpreted in
       -- America/Chicago and converted to an absolute instant.
       -- CHANGED 20261102100421 (Q2588): a job with no start time is "any time that day"
       -- (src/lib/anyTimeThatDay.ts), so it is due when its day is over: the next Central midnight,
       -- the instant jobIsOverdue (src/components/job-card/activityFilters.ts) turns it overdue. It
       -- was due at the midnight that STARTS its day, and the poster was told "Start time passed"
       -- just after 12:00 AM.
       AND ((CASE WHEN j.start_time IS NULL THEN (j.date_needed + 1) + '00:00'::time ELSE j.date_needed + j.start_time END)
              AT TIME ZONE 'America/Chicago') <= now()
       -- Backstop: never retro-start something long past.
       AND ((CASE WHEN j.start_time IS NULL THEN (j.date_needed + 1) + '00:00'::time ELSE j.date_needed + j.start_time END)
              AT TIME ZONE 'America/Chicago') > now() - interval '7 days'
     ORDER BY (CASE WHEN j.start_time IS NULL THEN (j.date_needed + 1) + '00:00'::time ELSE j.date_needed + j.start_time END)
  LOOP
    BEGIN
      UPDATE public.jobs j
         SET status = 'in_progress'::job_status
       WHERE j.id = rec.id
         AND j.status = 'accepted'::job_status;

      IF FOUND THEN
        started := started + 1;
      END IF;
    EXCEPTION WHEN OTHERS THEN
      PERFORM public.log_cron_defect(
        'auto_start_due_jobs', rec.id::text, SQLERRM,
        jsonb_build_object('job_id', rec.id));
      RAISE NOTICE 'auto_start_due_jobs: job % failed: %', rec.id, SQLERRM;
    END;
  END LOOP;

  RETURN started;
EXCEPTION WHEN OTHERS THEN
  PERFORM public.log_cron_defect(
    'auto_start_due_jobs', 'run', SQLERRM,
    jsonb_build_object('phase', 'scan', 'started_before_failure', started));
  RETURN started;
END;
$$;


REVOKE ALL ON FUNCTION public.auto_start_due_jobs() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.auto_start_due_jobs() TO service_role;

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
  -- CHANGED 20261102100421 (Q2588): no start time is "any time that day" (src/lib/anyTimeThatDay.ts),
  -- so the Helpr is not a no-show until the day is over (the next Central midnight), never from the
  -- midnight that starts it. The app offers Report no-show from that same instant (jobIsOverdue).
  v_starts_at := (CASE WHEN v_start_time IS NULL THEN (v_date_needed + 1) + '00:00'::time ELSE v_date_needed + v_start_time END)
                   AT TIME ZONE 'America/Chicago';
  IF v_starts_at IS NULL OR now() < v_starts_at THEN
    RAISE EXCEPTION 'job_not_started'
      USING HINT = CASE WHEN v_start_time IS NULL
        THEN 'This job is any time that day. You can report a no-show once the day is over.'
        ELSE 'Wait until the scheduled start time before reporting a no-show.' END;
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

CREATE OR REPLACE FUNCTION public.rpc_poster_report_member_no_show(_job_id uuid, _member_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_job record;
  v_slot record;
  v_starts_at timestamptz;
  v_prior_count int;
  v_result jsonb;
  v_now timestamptz := now();
  v_remaining int;
  v_filled int;
  v_needed int;
  v_done int;
  v_job_complete boolean := false;
  v_gone uuid[];
  v_left int;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501';
  END IF;

  -- The ladder's trusted-write flag, as report_helper_no_show sets it.
  PERFORM set_config('app.trusted_ladder_write', 'on', true);

  SELECT j.id, j.customer_id, j.title, j.payment_status, j.date_needed, j.start_time,
         j.is_group_job, j.status::text AS status, COALESCE(j.helpers_needed, 1) AS helpers_needed
    INTO v_job
    FROM public.jobs j
   WHERE j.id = _job_id
   FOR UPDATE;

  IF v_job.id IS NULL THEN
    RAISE EXCEPTION 'job_not_found';
  END IF;
  -- Only the job's poster may report a member as a no-show.
  IF v_job.customer_id IS DISTINCT FROM v_uid THEN
    RAISE EXCEPTION 'not_authorized' USING ERRCODE = '42501';
  END IF;
  IF v_job.is_group_job IS NOT TRUE THEN
    RAISE EXCEPTION 'not_a_crew_job'
      USING HINT = 'This job has one Helpr: use Report No-Show on the job.';
  END IF;
  IF v_job.status NOT IN ('accepted', 'in_progress', 'revision_requested') THEN
    RAISE EXCEPTION 'job_not_active'
      USING HINT = 'A no-show can only be reported on a booked job that is not finished.';
  END IF;
  IF v_job.payment_status IS NULL OR v_job.payment_status = 'unpaid' THEN
    RAISE EXCEPTION 'job_not_funded'
      USING HINT = 'A no-show can only be reported on a funded job.';
  END IF;
  -- CHANGED 20261102100421 (Q2588): no start time is "any time that day": a member is not a
  -- no-show until the day is over (the next Central midnight), as report_helper_no_show.
  v_starts_at := (CASE WHEN v_job.start_time IS NULL THEN (v_job.date_needed + 1) + '00:00'::time ELSE v_job.date_needed + v_job.start_time END)
                   AT TIME ZONE 'America/Chicago';
  IF v_starts_at IS NULL OR v_now < v_starts_at THEN
    RAISE EXCEPTION 'job_not_started'
      USING HINT = CASE WHEN v_job.start_time IS NULL
        THEN 'This job is any time that day. You can report a no-show once the day is over.'
        ELSE 'Wait until the scheduled start time before reporting a no-show.' END;
  END IF;

  -- Once per member per job. Checked before the slot: a reported member's
  -- spot is gone, and the poster should hear "already reported", not "not on
  -- this crew".
  IF EXISTS (
    SELECT 1 FROM public.user_violations
     WHERE job_id = _job_id AND violation_type = 'no_show' AND user_id = _member_id
  ) THEN
    RAISE EXCEPTION 'already_reported'
      USING HINT = 'You already reported this crew member as a no-show.';
  END IF;

  SELECT g.* INTO v_slot
    FROM public.group_job_helpers g
   WHERE g.job_id = _job_id AND g.helper_id = _member_id
   FOR UPDATE;
  IF v_slot.id IS NULL THEN
    RAISE EXCEPTION 'not_on_this_crew' USING ERRCODE = '42501';
  END IF;
  IF v_slot.helper_confirmed_at IS NULL THEN
    RAISE EXCEPTION 'helper_never_accepted'
      USING HINT = 'This Helpr never confirmed their spot, so it closes on its own with no strike.';
  END IF;
  IF v_slot.helper_completed_at IS NOT NULL THEN
    RAISE EXCEPTION 'helper_already_done'
      USING HINT = 'This crew member marked their part done, so they cannot be a no-show.';
  END IF;
  IF v_slot.helper_arrived_at IS NOT NULL OR v_slot.poster_confirmed_arrival_at IS NOT NULL THEN
    RAISE EXCEPTION 'helper_already_arrived'
      USING HINT = 'This crew member checked in on this job, so they cannot be reported as a no-show.';
  END IF;
  IF v_slot.helper_arrival_near_miss_at IS NOT NULL
     AND v_slot.helper_arrival_near_miss_at > v_now - interval '12 hours' THEN
    RAISE EXCEPTION 'helper_near_miss_pending'
      USING HINT = 'This crew member checked in near the job, a little way from its map pin. If they are there, tap Confirm arrival; if not, contact support.';
  END IF;

  -- THE STRIKE: the no-show ladder, as report_helper_no_show (20261029180706) calls it.
  SELECT count(DISTINCT reported_by) INTO v_prior_count
    FROM public.user_violations
   WHERE user_id = _member_id
     AND violation_type = 'no_show'
     AND reported_by IS DISTINCT FROM v_uid;

  v_result := public.apply_consequence_ladder(
    p_user                      => _member_id,
    p_violation_type            => 'no_show',
    p_description               => 'No-show for crew job: ' || COALESCE(v_job.title, 'Unknown'),
    p_job_id                    => _job_id,
    p_prior_count               => v_prior_count,
    p_rungs                     => ARRAY['warning', 'pending_ban_review'],
    p_effects                   => ARRAY['final_warning', 'permanent'],
    p_copy                      => jsonb_build_array(null::jsonb, null::jsonb),
    p_permanent_requires_review => true,
    p_suspension_days           => 7,
    p_clamp_to_worse_status     => true,
    p_admin_message_format      => '%s has %s no-show reports on file from different people who posted jobs and is restricted for 7 days pending your decision.',
    p_ban_reason                => 'Repeated no-show violations'
  );
  -- Attribution: GUARD 3b of the ladder counts DISTINCT reporters.
  UPDATE public.user_violations
     SET reported_by = v_uid
   WHERE job_id = _job_id
     AND violation_type = 'no_show'
     AND user_id = _member_id
     AND reported_by IS NULL;

  -- THE SPOT CLOSES. trg_sync_job_after_roster_departure sets their accepted
  -- application to rejected; the line after says why.
  DELETE FROM public.group_job_helpers WHERE id = v_slot.id;
  UPDATE public.applications
     SET status = 'rejected', closed_reason = 'no_show'
   WHERE job_id = _job_id
     AND helper_id = _member_id
     AND status IN ('accepted', 'rejected')
     AND closed_reason IS NULL;

  -- type 'warning', as the one-Helpr no-show notice (notification-templates
  -- no_show_reported): notifications_type_check has no 'no_show' type, and an
  -- unlisted type would abort this whole report. The title follows the rung
  -- the ladder recorded, never the poster's claim.
  INSERT INTO public.notifications (user_id, title, message, type, link, job_id)
  VALUES (_member_id,
          CASE WHEN v_result->>'action' = 'pending_ban_review'
               THEN 'Account restricted for 7 days'
               ELSE 'No-show warning' END,
          'The person who posted "' || COALESCE(v_job.title, 'the job')
            || '" reported that you did not show up. Your spot on the crew is closed and you are not paid for it.'
            || CASE WHEN v_result->>'action' = 'pending_ban_review'
                    THEN ' This is your second no-show report, so your account is restricted for 7 days while an admin reviews it. If you think this is wrong, email admin@louisianahelpr.com.'
                    ELSE ' A no-show warning is on your record.' END,
          'warning',
          '/jobs?job=' || _job_id::text,
          _job_id);

  -- THE ROLL-UP, as rpc_group_member_mark_done (20261006031350) runs it after
  -- a member's Done: the rest of the crew may already be finished, and nobody
  -- else will tap Done to complete it.
  SELECT count(*) FILTER (WHERE g.helper_completed_at IS NULL AND g.helper_confirmed_at IS NOT NULL),
         count(*) FILTER (WHERE g.helper_confirmed_at IS NOT NULL OR g.helper_completed_at IS NOT NULL),
         count(*) FILTER (WHERE g.helper_completed_at IS NOT NULL)
    INTO v_remaining, v_filled, v_done
    FROM public.group_job_helpers g
   WHERE g.job_id = _job_id;

  -- helpers_needed from the job row this function locked first.
  v_needed := v_job.helpers_needed;

  -- v_done >= 1: a crew where nobody worked does not "complete" by reports
  -- alone (every member a no-show is a cancellation, not a payout).
  IF v_remaining = 0 AND v_done >= 1
     AND (v_filled >= v_needed
          OR (public.crew_completes_when_hired_done() AND v_filled >= 1)) THEN
    BEGIN
      WITH gone AS (
        DELETE FROM public.group_job_helpers
         WHERE job_id = _job_id
           AND helper_confirmed_at IS NULL
           AND helper_completed_at IS NULL
        RETURNING helper_id
      )
      SELECT array_agg(helper_id) INTO v_gone FROM gone;

      UPDATE public.applications a
         SET status = 'rejected', closed_reason = 'offer_expired'
       WHERE a.job_id = _job_id
         AND a.helper_id = ANY (COALESCE(v_gone, '{}'::uuid[]))
         AND a.status IN ('accepted', 'rejected')
         AND a.closed_reason IS NULL;
      INSERT INTO public.notifications (user_id, title, message, type, link, job_id)
      SELECT m,
             'Your offer closed',
             'The rest of the crew finished "' || COALESCE(v_job.title, 'the job')
               || '" before you confirmed your spot, so the offer closed. No strike.',
             'expired',
             '/jobs?job=' || _job_id::text,
             _job_id
        FROM unnest(COALESCE(v_gone, '{}'::uuid[])) AS m
       WHERE m IS NOT NULL;

      SELECT count(*) INTO v_left
        FROM public.group_job_helpers g
       WHERE g.job_id = _job_id
         AND g.helper_completed_at IS NULL;
      IF v_left > 0 THEN
        RAISE EXCEPTION 'crew_changed_under_completion' USING ERRCODE = 'LHC01';
      END IF;

      IF v_filled < v_needed THEN
        UPDATE public.jobs
           SET status = 'accepted'
         WHERE id = _job_id
           AND status = 'open';
      END IF;
      PERFORM set_config('app.group_rollup_rpc', '1', true);
      UPDATE public.jobs
         SET helper_completed_at = v_now
       WHERE id = _job_id
         AND helper_completed_at IS NULL
         AND status IN ('accepted', 'in_progress', 'revision_requested');
      PERFORM set_config('app.group_rollup_rpc', '0', true);
      v_job_complete := true;
    EXCEPTION WHEN SQLSTATE 'LHC01' THEN
      PERFORM set_config('app.group_rollup_rpc', '0', true);
      v_job_complete := false;
    END;
  END IF;

  RETURN v_result || jsonb_build_object(
    'helper_id', _member_id,
    'job_title', v_job.title,
    'crew_remaining', v_remaining,
    'job_complete', v_job_complete
  );
END;
$function$;


REVOKE ALL ON FUNCTION public.rpc_poster_report_member_no_show(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rpc_poster_report_member_no_show(uuid, uuid) TO authenticated, service_role;


CREATE OR REPLACE FUNCTION public.get_helper_on_time_percents(p_user_ids uuid[])
 RETURNS TABLE(user_id uuid, on_time_percent numeric)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  WITH timing_rows AS (
    SELECT
      helper_id,
      -- CHANGED 20261102100421 (Q2588): both sides are Louisiana wall-clock. The arrival was cast with
      -- ::timestamp, i.e. in the session's zone (UTC on prod), so a 9:05 AM Central arrival read as 2:05 PM
      -- against a 9:00 AM start; it is read in America/Chicago now. A job with no start time is "any time that
      -- day" (src/lib/anyTimeThatDay.ts): any arrival before its day is over is on time, never late from 12:10 AM.
      helper_arrived_at AT TIME ZONE 'America/Chicago' AS arrived_local,
      (start_time IS NULL) AS any_time,
      (CASE WHEN start_time IS NULL THEN (date_needed + 1) + '00:00'::time ELSE date_needed + start_time END)::timestamp AS scheduled_start
    FROM jobs
    WHERE helper_id = ANY(p_user_ids)
      AND status = 'completed'
      AND helper_arrived_at IS NOT NULL
      AND date_needed IS NOT NULL
      -- Test data never counts (b62).
      AND is_seed IS NOT TRUE
      AND NOT public.is_test_member(customer_id)
      AND NOT public.is_test_member(helper_id)
  ),
  helper_stats AS (
    SELECT
      helper_id,
      COUNT(*) AS total_with_timing,
      COUNT(*) FILTER (
        WHERE CASE WHEN any_time THEN arrived_local < scheduled_start
                   ELSE arrived_local - scheduled_start <= INTERVAL '10 minutes' END
      ) AS on_time_count
    FROM timing_rows
    GROUP BY helper_id
    HAVING COUNT(*) >= 5
  )
  SELECT
    helper_id AS user_id,
    ROUND(100.0 * on_time_count / NULLIF(total_with_timing, 0)) AS on_time_percent
  FROM helper_stats;
$function$;

REVOKE ALL ON FUNCTION public.get_helper_on_time_percents(uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_helper_on_time_percents(uuid[]) TO authenticated, service_role;
