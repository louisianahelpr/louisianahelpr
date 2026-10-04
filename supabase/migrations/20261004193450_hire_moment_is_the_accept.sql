-- Q706 (owner decision 2026-10-04): every fee and strike rule that depends on
-- "the hire moment" starts when the Helpr ACCEPTS (complete_job_accept for a
-- single Helpr, Q1180; rpc_group_member_confirm for a crew member), never when
-- the poster offers.
--
-- INVENTORY (live function bodies, pg_proc.prosrc md5 equal to the newest
-- migration for each, 2026-10-04), what each keys on today:
--   poster_cancel_job, single Helpr: fee tier + poster's late-cancel strike on
--     helper_id AND helper_confirmed_at (the accept). Correct.
--   poster_cancel_job, crew: each member's fee share and the strike on
--     crew_fee_pays_unconfirmed() OR g.helper_confirmed_at. The rule returned
--     TRUE, so a member who was only offered a spot was paid a share and
--     counted toward the strike. KEYED ON THE OFFER: fixed below.
--   apply_cancellation_violation_consequence (the poster's strike for a crew):
--     the same rule. Fixed by the same flip.
--   block_user_and_settle, settle_one_off_jobs_for_banned_account: fee/strike
--     on helper_id AND helper_confirmed_at. Correct.
--   report_helper_no_show: refuses a Helpr whose helper_confirmed_at is NULL
--     (Q1180). Correct.
--   helper_abort_job: only from in_progress/revision_requested, which nothing
--     reaches without the accept (Q1180). Correct.
--   helper_cancel_booking, single Helpr: struck any 'accepted' job inside 24h,
--     with no check of helper_confirmed_at, so an offered Helpr who never
--     accepted was struck for "cancelling after committing" (and skipped the
--     decline path's Q1180 setup exemption). KEYED ON THE OFFER: it now refuses
--     an offer that was not accepted (decline_job_offer is the way out of an
--     offer; the app shows Cancel only on a confirmed booking).
--   helper_cancel_booking, crew: struck any rostered member inside 24h, with
--     no check of the member's own confirmation. KEYED ON THE OFFER: a member
--     who never confirmed their spot now leaves without a strike, as a member
--     who never confirmed pays no fee.
--   series_give_up_strike (give_up_series_dates, end_recurring_series): only
--     dates the Helpr holds, which exist only after their own accept
--     (stamp_recurring_series_helper keys recurring_helper_id on
--     helper_confirmed_at) or their own claim (claim_series_dates). Correct.
--   request/respond_job_schedule_change: no fee and no strike.
--   decline_job_offer, expire_unanswered_offers: strike for DECLINING or
--     IGNORING an offer (by nature before any accept; no strike while payout
--     setup is unfinished, Q1180). Not a hire-moment rule, left as is and
--     reported to the owner on Q706.
--
-- REPLAY-SAFETY: CREATE OR REPLACE of functions earlier migrations create;
-- privileges restated to the live ACL (postgres, authenticated, service_role).

-- ── 1. A crew member counts only once they confirmed their own spot ───────
-- _shared/crewShares.ts CREW_FEE_PAYS_UNCONFIRMED is the twin, flipped in the
-- same commit (src/test/groupCrewNoLead.test.ts fails if they disagree).
CREATE OR REPLACE FUNCTION public.crew_fee_pays_unconfirmed()
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path TO 'public'
AS $function$ SELECT false $function$;

REVOKE ALL ON FUNCTION public.crew_fee_pays_unconfirmed() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.crew_fee_pays_unconfirmed() TO authenticated, service_role;

-- ── 2. helper_cancel_booking: a strike only for a booking the Helpr accepted ─
CREATE OR REPLACE FUNCTION public.helper_cancel_booking(p_job_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_job record;
  v_starts_at timestamptz;
  v_result jsonb;
  v_slot_id uuid;
  v_slot_completed_at timestamptz;
  v_slot_confirmed_at timestamptz;
  v_remaining int;
  v_released date[];
BEGIN
  -- Q737: a series visit is cancelled under its series' lock, taken BEFORE the
  -- visit's, the order claim_series_dates / offer_series_dates /
  -- give_up_series_dates / end_recurring_series all use (parent, then visit).
  -- Visit-first deadlocked against a claim of the same date: the claim held
  -- the parent and waited on the visit while series_release_dates' writes
  -- (the release row, the series notifications) needed a key-share lock on the
  -- parent. parent_job_id never changes once a visit exists; a one-off job
  -- has none, so this locks nothing for it.
  PERFORM 1 FROM public.jobs pj
   WHERE pj.id = (SELECT c.parent_job_id FROM public.jobs c WHERE c.id = p_job_id)
   FOR UPDATE;

  SELECT j.id, j.title, j.customer_id, j.helper_id, j.status,
         j.date_needed, j.start_time, j.helper_completed_at, j.helper_confirmed_at,
         j.is_group_job, j.helpers_needed,
         j.parent_job_id, j.recurrence_days
    INTO v_job
    FROM public.jobs j
   WHERE j.id = p_job_id
   FOR UPDATE;

  IF v_job.id IS NULL THEN
    RAISE EXCEPTION 'job_not_found';
  END IF;

  IF v_job.is_group_job IS TRUE THEN
    SELECT g.id, g.helper_completed_at, g.helper_confirmed_at
      INTO v_slot_id, v_slot_completed_at, v_slot_confirmed_at
      FROM public.group_job_helpers g
     WHERE g.job_id = v_job.id AND g.helper_id = auth.uid()
     FOR UPDATE;
  END IF;

  v_starts_at := ((v_job.date_needed + COALESCE(v_job.start_time, '00:00'::time))
                    AT TIME ZONE 'America/Chicago');

  -- ── THE CREW BRANCH (20260925140148) ─────────────────────────────────────
  -- Membership is the caller's roster slot, not jobs.helper_id (the lead). A
  -- group job's lead with no slot (hired before the roster existed) falls
  -- through to the single-helper path below, which is the job they hold.
  IF v_job.is_group_job IS TRUE
     AND (v_slot_id IS NOT NULL OR v_job.helper_id IS DISTINCT FROM auth.uid()) THEN
    IF v_slot_id IS NULL THEN
      RAISE EXCEPTION 'not_authorized';
    END IF;
    -- 'open' included: a crew that is still staffing already holds the
    -- members hired so far. Q706: a member has COMMITTED only once they
    -- confirmed their own spot (rpc_group_member_confirm); before that,
    -- leaving costs them nothing, as it costs the poster no fee.
    IF v_job.status::text NOT IN ('open', 'accepted') THEN
      RAISE EXCEPTION 'not_cancellable'
        USING HINT = 'Only a booked job that has not started can be cancelled this way.';
    END IF;
    -- Leaving would drop a part this Helpr already marked done out of the
    -- roll-up that pays the crew.
    IF v_slot_completed_at IS NOT NULL THEN
      RAISE EXCEPTION 'not_cancellable'
        USING HINT = 'You already marked your part done, so you can''t leave this job. Message the person who posted it or open a dispute.';
    END IF;

    IF v_starts_at IS NOT NULL AND now() >= v_starts_at THEN
      RAISE EXCEPTION 'job_already_started'
        USING HINT = 'The scheduled start has passed — contact the person who posted it or support.';
    END IF;

    -- Owner decision Q407 (11): a strike only within 24 hours of the start.
    -- Q706: and only for a member who confirmed their spot.
    IF v_slot_confirmed_at IS NULL THEN
      v_result := jsonb_build_object('action', 'none', 'reason', 'spot_never_confirmed');
    ELSIF public.is_late_cancellation(true, EXTRACT(EPOCH FROM (v_starts_at - now())) / 3600.0) THEN
      v_result := public.apply_job_denial_consequence(
        auth.uid(), v_job.id,
        'Cancelled after committing to: "' || COALESCE(v_job.title, 'Unknown') || '"');
    ELSE
      v_result := jsonb_build_object('action', 'none', 'reason', 'more_than_24h_before_start');
    END IF;

    -- trg_sync_job_after_roster_departure rejects this Helpr's application
    -- and, when they were the lead, moves or clears the lead together with
    -- its confirmation stamps, response deadline and reminder sent-ats.
    DELETE FROM public.group_job_helpers WHERE id = v_slot_id;

    SELECT count(*) INTO v_remaining
      FROM public.group_job_helpers g
     WHERE g.job_id = v_job.id;

    IF v_job.status::text = 'accepted' AND v_remaining < COALESCE(v_job.helpers_needed, 1) THEN
      UPDATE public.jobs
         SET status = 'open'
       WHERE id = v_job.id;
    END IF;

    INSERT INTO public.notifications (user_id, title, message, type, link, job_id)
    VALUES (
      v_job.customer_id,
      'A Helpr left your crew',
      'One of your Helprs can''t make "' || COALESCE(v_job.title, 'your job')
        || '" — their spot is open to everyone again.',
      'warning',
      '/posts?job=' || v_job.id::text,
      v_job.id
    );

    RETURN v_result;
  END IF;

  -- ── THE SINGLE-HELPER PATH ───────────────────────────────────────────────
  IF v_job.helper_id IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'not_authorized';
  END IF;
  IF v_job.status <> 'accepted' THEN
    RAISE EXCEPTION 'not_cancellable'
      USING HINT = 'Only a booked job that has not started can be cancelled this way.';
  END IF;
  -- Q706: an offer the Helpr has not accepted is not a booking. Its way out is
  -- decline_job_offer, which carries the offer's own rule (no strike while
  -- payout setup is unfinished, Q1180); this path struck it as "cancelled
  -- after committing" with no commitment.
  IF v_job.helper_confirmed_at IS NULL THEN
    RAISE EXCEPTION 'offer_not_accepted'
      USING HINT = 'You haven''t accepted this offer, so there''s no booking to cancel. Decline the offer instead.';
  END IF;
  -- Reopening would hand the next Helpr this one's done stamp.
  IF v_job.helper_completed_at IS NOT NULL THEN
    RAISE EXCEPTION 'not_cancellable'
      USING HINT = 'You already marked this job done, so it can''t be cancelled. Message the person who posted it or open a dispute.';
  END IF;

  -- Once the start has passed this is a no-show question, not a cancellation.
  IF v_starts_at IS NOT NULL AND now() >= v_starts_at THEN
    RAISE EXCEPTION 'job_already_started'
      USING HINT = 'The scheduled start has passed — contact the person who posted it or support.';
  END IF;

  -- Owner decisions Q407 (6) and (11): a strike only within 24 hours of the
  -- start, for a series visit and a one-time job alike.
  IF public.is_late_cancellation(true, EXTRACT(EPOCH FROM (v_starts_at - now())) / 3600.0) THEN
    v_result := public.apply_job_denial_consequence(
      auth.uid(), v_job.id,
      'Cancelled after committing to: "' || COALESCE(v_job.title, 'Unknown') || '"');
  ELSE
    v_result := jsonb_build_object('action', 'none', 'reason', 'more_than_24h_before_start');
  END IF;

  UPDATE public.applications
     SET status = 'rejected'
   WHERE job_id = v_job.id AND helper_id = auth.uid() AND status = 'accepted';

  -- Reopen with a clean slate for the next helper: confirmation stamps and
  -- the reminder sent-ats reset so the day-of machinery runs fresh.
  -- Q402: the reminder sent-ats are not on the Helpr column whitelist; this
  -- flag lets this one UPDATE clear them (enforce_helper_jobs_column_whitelist).
  PERFORM set_config('app.helper_cancel_rpc', '1', true);
  UPDATE public.jobs
     SET status = 'open',
         helper_id = NULL,
         response_deadline = NULL,
         helper_confirmed_at = NULL,
         helper_dayof_confirmed_at = NULL,
         dayof_confirm_reminder_sent_at = NULL,
         dayof_unanswered_poster_alert_sent_at = NULL,
         start_reminder_sent_at = NULL
   WHERE id = v_job.id;
  PERFORM set_config('app.helper_cancel_rpc', '0', true);

  IF v_job.parent_job_id IS NOT NULL THEN
    -- The date goes back to the series: the poster and the other Helprs on it
    -- are told by series_release_dates.
    v_released := public.series_release_dates(v_job.parent_job_id, auth.uid(), ARRAY[v_job.date_needed], 'visit_cancelled',
                                              v_job.title, v_job.customer_id);
    -- Review LOW-1: nothing released (this Helpr held no hold on the date,
    -- e.g. legacy data) must still reach the poster, who can offer it.
    IF COALESCE(cardinality(v_released), 0) = 0 AND v_job.customer_id IS NOT NULL THEN
      INSERT INTO public.notifications (user_id, title, message, type, link, job_id)
      VALUES (
        v_job.customer_id,
        'Your Helpr cancelled',
        format('Your Helpr can''t make "%s" on %s. The visit stays paid for: offer the date to someone new from the series card. If nobody takes it, you''re refunded less the card processing fee.',
               COALESCE(v_job.title, 'your series'), to_char(v_job.date_needed, 'FMDy FMMon FMDD')),
        'warning',
        '/posts?job=' || v_job.parent_job_id::text,
        v_job.parent_job_id
      );
    END IF;
  ELSE
    INSERT INTO public.notifications (user_id, title, message, type, link)
    VALUES (
      v_job.customer_id,
      'Your Helpr cancelled',
      'Your Helpr can''t make "' || COALESCE(v_job.title, 'your job')
        || '" — it''s open to everyone again. Your payment stays protected in escrow for whoever you pick next.',
      'warning',
      '/posts?job=' || v_job.id::text
    );
  END IF;

  RETURN v_result;
END;
$function$;

REVOKE ALL ON FUNCTION public.helper_cancel_booking(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.helper_cancel_booking(uuid) TO authenticated, service_role;
