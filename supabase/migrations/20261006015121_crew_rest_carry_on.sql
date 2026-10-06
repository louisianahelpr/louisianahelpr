-- Q1378 HIGH (docs/OPEN.md; lh-money-escrow@d0933e1b3#1): a crew sent back
-- to open was stranded. OWNER DECISION 2026-10-05 ~18:40 CT (final): when a
-- member leaves a full crew, THE REST CARRY ON.
--
-- Before: helper_cancel_booking's crew branch, block_user_and_settle's crew
-- loop and expire_unanswered_offers' crew pass (the three writers that delete
-- a roster row; inventoried live 2026-10-05 by every public function whose
-- body deletes from group_job_helpers) moved a booked crew back to 'open'
-- when a member left. An open crew cannot be worked
-- (rpc_group_member_on_the_way / _mark_arrival need accepted or in_progress)
-- and only the LAST hire booked it again, so if nobody refilled the spot
-- auto-expire-jobs cancelled it as 'no Helpr assigned': no fee for the
-- confirmed members who turned up, no strike for the poster.
--
-- After:
--   * a booked crew STAYS booked ('accepted') while anyone is left on it, so
--     the members left set out, arrive and finish as normal, and
--     auto_start_due_jobs starts it once every member left has confirmed;
--   * their shares are paid as normal and the empty spot's share is refunded
--     to the poster when the job pays out (process-scheduled-payouts'
--     under-filled crew refund under crew_completes_when_hired_done(),
--     rpc_group_member_mark_done completes on every HIRED member done);
--   * the poster may refill the spot before the start: accept_group_application
--     now hires into a booked crew with a free spot (it reuses the empty slot
--     and its frozen share, keeps the job booked, and still refuses inside 15
--     minutes of the start and a full crew);
--   * a crew with NOBODY left reopens, as before (nothing to carry on).
--   * the poster's notice says the crew is still on and how the spot is filled
--     or refunded, instead of "open to everyone again".
-- Unchanged: who pays what when a member leaves (the strike rules, the
-- by-hand fee alert when the poster blocks a committed member).
--
-- Every function is restated from its EFFECTIVE definition (the bodies match
-- prod's prosrc by md5, measured 2026-10-05) with only the edits above.
-- Replay-safe: CREATE OR REPLACE only (owner and ACL kept), grants restated as
-- live (pg_proc.proacl read 2026-10-05). No new function, no ban-gate change:
-- each of these is already exempt in scripts/ci/ban-gate-coverage.sql because
-- every table it writes is ban-gated, and expire_unanswered_offers is
-- service_role only.
-- Proof: src/test/pglite/crewRestCarryOn.pglite.mjs (--before is red).
-- Guard: src/test/crewRestCarryOn.test.ts.

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

    -- Q1378 (owner 2026-10-05): THE REST CARRY ON. A booked crew stays
    -- booked when a member leaves: the members left can still set out, arrive
    -- and finish (those RPCs need accepted or in_progress), their shares are
    -- paid as normal, the empty spot's share is refunded to the poster when
    -- the job pays out (process-scheduled-payouts, crew_completes_when_hired_done),
    -- and the poster may refill the spot before the start
    -- (accept_group_application). Only a crew with NOBODY left reopens.
    IF v_job.status::text = 'accepted' AND v_remaining = 0 THEN
      UPDATE public.jobs
         SET status = 'open'
       WHERE id = v_job.id;
    END IF;

    INSERT INTO public.notifications (user_id, title, message, type, link, job_id)
    VALUES (
      v_job.customer_id,
      'A Helpr left your crew',
      'One of your Helprs can''t make "' || COALESCE(v_job.title, 'your job')
        || CASE WHEN v_job.status::text = 'accepted' AND v_remaining > 0
             THEN '". The rest of your crew is still on. You can hire someone from your applicants for the open spot before it starts; if it stays empty, that spot''s share is refunded to you once the job is done.'
             ELSE '" — their spot is open to everyone again.'
           END,
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

CREATE OR REPLACE FUNCTION public.block_user_and_settle(p_blocked uuid, p_reason text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_user uuid := auth.uid();
  v_job record;
  v_hours numeric;
  v_percent int;
  v_fee numeric;
  v_committed boolean;
  v_updated int;
  v_settled jsonb := '[]'::jsonb;
  v_ladder_present boolean;
  v_closed_apps int;
  v_closed_offers int;
  v_crew record;
  v_starts timestamptz;
  v_basis bigint;
  v_member_fee numeric;
  v_remaining int;
  v_prior int;
  v_new_block boolean;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;
  IF p_blocked IS NULL OR p_blocked = v_user THEN
    RAISE EXCEPTION 'invalid_target';
  END IF;

  -- The block itself first: whatever happens to the jobs below, the person
  -- asking to be left alone is left alone.
  INSERT INTO public.user_blocks (blocker_id, blocked_id, reason)
  VALUES (v_user, p_blocked, NULLIF(btrim(COALESCE(p_reason, '')), ''))
  ON CONFLICT (blocker_id, blocked_id) DO NOTHING;
  -- A repeat call (the block already existed) must not re-alert admins below.
  GET DIAGNOSTICS v_updated = ROW_COUNT;
  v_new_block := v_updated > 0;

  -- ADDED 2026-09-23 (Q301): a banned caller keeps the block and settles
  -- nothing. The settle step's jobs UPDATE is refused by enforce_ban_gate,
  -- and because this is one transaction that refusal used to roll the block
  -- back too, so a banned user could not block someone they shared a live
  -- job with. Blocking while banned is allowed (Q281); cancelling a job and
  -- pricing its fee is not.
  IF public.is_caller_banned() THEN
    RETURN jsonb_build_object('blocked', p_blocked, 'settled', '[]'::jsonb, 'settle_skipped', 'account_restricted');
  END IF;

  v_ladder_present :=
    to_regprocedure('public.apply_cancellation_violation_consequence(uuid)') IS NOT NULL;

  FOR v_job IN
    SELECT j.id, j.title, j.budget, j.date_needed, j.start_time, j.customer_id, j.helper_id,
           j.helper_confirmed_at, j.status
      FROM public.jobs j
     WHERE j.status IN ('accepted', 'in_progress', 'revision_requested')
       -- ADDED 2026-09-14: finished work is not cancelled by a block.
       AND j.helper_completed_at IS NULL
       AND (
            (j.customer_id = v_user     AND j.helper_id = p_blocked)
         OR (j.customer_id = p_blocked  AND j.helper_id = v_user)
       )
     FOR UPDATE
  LOOP
    -- CHANGED 2026-09-23: committed, not merely assigned — the same predicate
    -- poster_cancel_job and _shared/cancellationFee.ts helperIsCommitted use.
    -- A Helpr who was chosen but never accepted lost no committed time.
    v_committed := v_job.helper_id IS NOT NULL AND v_job.helper_confirmed_at IS NOT NULL;

    -- CHANGED 2026-09-05: anchored on start_time, matching poster_cancel_job.
    -- Both settle paths must price a cancellation identically or the fee a
    -- poster is quoted depends on which exit they happened to take.
    v_hours := public.job_hours_until_start(v_job.date_needed, v_job.start_time, now());
    v_percent := public.cancellation_fee_percent(v_committed, v_hours);
    v_fee := CASE
      WHEN COALESCE(v_job.budget, 0) > 0 AND v_percent > 0
        THEN round(v_job.budget * v_percent) / 100.0
      ELSE 0
    END;

    -- The pinned columns (cancellation_*, late_cancellation) are legitimate
    -- server writes here, and the blocker may be the HELPER seat, which the
    -- helper column whitelist would otherwise reject. `app.sanctioned_cancel`
    -- additionally satisfies trg_cancellation_requires_rpc: this IS one of the
    -- sanctioned exits. Both hatches are transaction-local and switched off
    -- again immediately after the statement.
    PERFORM set_config('app.trusted_ladder_write', 'on', true);
    PERFORM set_config('app.sanctioned_cancel', 'on', true);

    UPDATE public.jobs
       SET status = 'cancelled',
           cancelled_by = v_user,
           cancelled_at = now(),
           cancellation_reason = 'Cancelled because one party blocked the other.',
           late_cancellation = public.is_late_cancellation(v_committed, v_hours),
           cancellation_fee = v_fee,
           cancellation_fee_status = CASE WHEN v_fee > 0 THEN 'pending' ELSE NULL END
     WHERE id = v_job.id
       AND status IN ('accepted', 'in_progress', 'revision_requested')
       AND helper_completed_at IS NULL;

    GET DIAGNOSTICS v_updated = ROW_COUNT;

    PERFORM set_config('app.trusted_ladder_write', 'off', true);
    PERFORM set_config('app.sanctioned_cancel', 'off', true);

    IF v_updated = 0 THEN
      CONTINUE;
    END IF;

    INSERT INTO public.notifications (user_id, title, message, type, link)
    VALUES (
      p_blocked,
      'Job cancelled',
      CASE
        WHEN v_fee > 0 AND v_job.helper_id = p_blocked THEN
          format('"%s" was cancelled. Because it was cancelled late, a $%s cancellation fee applies and your share is on its way — it settles within the hour.',
                 COALESCE(v_job.title, 'A job'), to_char(v_fee, 'FM999999990.00'))
        WHEN v_fee > 0 THEN
          format('"%s" was cancelled late, so a $%s cancellation fee applies.',
                 COALESCE(v_job.title, 'A job'), to_char(v_fee, 'FM999999990.00'))
        ELSE
          format('"%s" was cancelled. No cancellation fee applies.', COALESCE(v_job.title, 'A job'))
      END,
      CASE WHEN v_fee > 0 THEN 'payment' ELSE 'warning' END,
      CASE WHEN v_job.helper_id = p_blocked THEN '/jobs?job=' ELSE '/posts?job=' END || v_job.id::text
    );

    -- The reliability strike, through the SAME ladder the normal cancel path
    -- uses. It authorises off auth.uid() = customer_id internally, so it is a
    -- no-op (raises 'not_authorized') for the helper-blocks-poster direction —
    -- only call it in the seat it is written for.
    -- CHANGED 2026-09-23: gated on v_committed, as poster_cancel_job is.
    IF v_ladder_present AND v_job.customer_id = v_user AND v_committed THEN
      PERFORM public.apply_cancellation_violation_consequence(v_job.id);
    END IF;

    v_settled := v_settled || jsonb_build_object(
      'job_id', v_job.id,
      'title', v_job.title,
      'cancellation_fee', v_fee,
      'fee_percent', v_percent
    );
  END LOOP;

  -- ADDED 2026-10-05 (Q729/Q1282, owner): a crew has no lead (Q407), so the
  -- loop above never sees one. A block between the poster and ONE crew member
  -- takes only that member off the crew; their spot reopens.
  FOR v_crew IN
    SELECT j.id, j.title, j.budget, j.date_needed, j.start_time, j.customer_id,
           j.status::text AS status, j.helpers_needed,
           g.id AS slot_id, g.helper_id AS member, g.helper_confirmed_at AS member_confirmed_at,
           g.share_cents, g.slot_no
      FROM public.jobs j
      JOIN public.group_job_helpers g ON g.job_id = j.id
     WHERE j.is_group_job IS TRUE
       AND j.status IN ('open', 'accepted', 'in_progress', 'revision_requested')
       AND g.helper_completed_at IS NULL
       AND (
            (j.customer_id = v_user    AND g.helper_id = p_blocked)
         OR (j.customer_id = p_blocked AND g.helper_id = v_user)
       )
     ORDER BY j.id
       FOR UPDATE OF j, g
  LOOP
    v_starts := ((v_crew.date_needed + COALESCE(v_crew.start_time, '00:00'::time))
                   AT TIME ZONE 'America/Chicago');

    IF v_crew.status NOT IN ('open', 'accepted')
       OR (v_starts IS NOT NULL AND now() >= v_starts) THEN
      -- Work may be under way: nothing moves automatically (a crew member
      -- cannot leave a started job either); a person decides. Only on a NEW
      -- block, so calling again cannot flood every admin (review #2).
      INSERT INTO public.notifications (user_id, title, message, type, link, job_id)
      SELECT r.user_id,
             'Block on a started crew job',
             format('"%s": the person who posted it and one crew member blocked each other after the job started. Nothing on the job was changed; decide what happens to that member''s part.',
                    COALESCE(v_crew.title, 'A job')),
             'admin_alert',
             '/admin?view=jobs&job=' || v_crew.id::text,
             v_crew.id
        FROM public.user_roles r
       WHERE r.role = 'admin'
         AND v_new_block;
      v_settled := v_settled || jsonb_build_object('job_id', v_crew.id, 'title', v_crew.title,
                                                   'crew', true, 'action', 'admin_review');
      CONTINUE;
    END IF;

    v_hours := public.job_hours_until_start(v_crew.date_needed, v_crew.start_time, now());
    v_member_fee := 0;
    v_percent := 0;

    IF v_crew.customer_id = v_user THEN
      -- The POSTER blocked the member: priced as poster_cancel_job's crew
      -- branch prices this member's share.
      v_committed := public.crew_fee_pays_unconfirmed() OR v_crew.member_confirmed_at IS NOT NULL;
      v_percent := public.cancellation_fee_percent(v_committed, v_hours);
      v_basis := COALESCE(v_crew.share_cents,
                          public.crew_slot_share_cents(round(COALESCE(v_crew.budget, 0) * 100)::bigint,
                                                       COALESCE(v_crew.helpers_needed, 1), v_crew.slot_no));
      v_member_fee := round(COALESCE(v_basis, 0) * v_percent / 100.0) / 100.0;

      -- The cancel-with-Helpr strike, on the same ladder and violation type
      -- apply_cancellation_violation_consequence uses (it needs a cancelled
      -- job, and this one carries on), once per job.
      IF v_committed AND to_regprocedure('public.apply_consequence_ladder(uuid,text,text,uuid,integer,text[],text[],jsonb,boolean,integer,boolean,text,text)') IS NOT NULL
         AND NOT EXISTS (SELECT 1 FROM public.user_violations uv
                          WHERE uv.user_id = v_user AND uv.violation_type = 'cancel_with_helper' AND uv.job_id = v_crew.id) THEN
        SELECT count(*) INTO v_prior
          FROM public.user_violations
         WHERE user_id = v_user AND violation_type = 'cancel_with_helper';
        PERFORM public.apply_consequence_ladder(
          p_user                      => v_user,
          p_violation_type            => 'cancel_with_helper',
          p_description               => 'Removed a committed Helpr from a crew by blocking them: "' || COALESCE(v_crew.title, 'Unknown') || '"',
          p_job_id                    => v_crew.id,
          p_prior_count               => v_prior,
          p_rungs                     => ARRAY['warning', 'final_warning', 'pending_ban_review'],
          p_effects                   => ARRAY['notify', 'final_warning', 'permanent'],
          p_copy                      => jsonb_build_array(
            jsonb_build_object(
              'title', 'Cancellation warning (1 of 2)',
              'message', 'A Helpr who had committed to your job was taken off it. This is a warning; a second one is a final warning.'),
            jsonb_build_object(
              'title', 'Final warning',
              'message', 'That is your second cancellation after a Helpr committed. One more and your account is restricted for 7 days while an admin reviews it.'),
            jsonb_build_object(
              'title', 'Account restricted for 7 days',
              'message', 'Third cancellation after a Helpr committed — your account is restricted for 7 days and an admin is reviewing it. If you think this is wrong, email admin@louisianahelpr.com.')
          ),
          p_permanent_requires_review => true,
          p_suspension_days           => 7,
          p_clamp_to_worse_status     => true,
          p_admin_message_format      => '%s has cancelled %s jobs with a Helpr committed and is restricted for 7 days pending your decision.',
          p_ban_reason                => null
        );
      END IF;

      IF v_member_fee > 0 THEN
        -- Owner 2026-10-05: settled by hand for now (no path pays one member's
        -- fee while the crew carries on).
        INSERT INTO public.notifications (user_id, title, message, type, link, job_id)
        SELECT r.user_id,
               'Crew block: fee owed by hand',
               format('"%s": the person who posted it blocked a committed crew member %s hours before the start. That member is owed a $%s cancellation fee (%s%% of their $%s share). Nothing was charged or paid automatically; settle it by hand.',
                      COALESCE(v_crew.title, 'A job'), round(COALESCE(v_hours, 0), 1),
                      to_char(v_member_fee, 'FM999999990.00'), v_percent,
                      to_char(COALESCE(v_basis, 0) / 100.0, 'FM999999990.00')),
               'admin_alert',
               '/admin?view=jobs&job=' || v_crew.id::text,
               v_crew.id
          FROM public.user_roles r
         WHERE r.role = 'admin';
      END IF;
    ELSE
      -- The MEMBER blocked the poster: helper_cancel_booking's crew branch
      -- (owner: keep its strike).
      IF v_crew.member_confirmed_at IS NOT NULL
         AND public.is_late_cancellation(true, EXTRACT(EPOCH FROM (v_starts - now())) / 3600.0) THEN
        PERFORM public.apply_job_denial_consequence(
          v_user, v_crew.id,
          'Cancelled after committing to: "' || COALESCE(v_crew.title, 'Unknown') || '"');
      END IF;
    END IF;

    PERFORM set_config('app.trusted_ladder_write', 'on', true);
    UPDATE public.applications
       SET status = 'rejected', closed_reason = 'party_blocked'
     WHERE job_id = v_crew.id AND helper_id = v_crew.member AND status = 'accepted';
    DELETE FROM public.group_job_helpers WHERE id = v_crew.slot_id;
    SELECT count(*) INTO v_remaining FROM public.group_job_helpers g WHERE g.job_id = v_crew.id;
    -- Q1378 (owner 2026-10-05): the rest of the crew carries on; only a
    -- crew with nobody left reopens (see helper_cancel_booking).
    IF v_crew.status = 'accepted' AND v_remaining = 0 THEN
      UPDATE public.jobs SET status = 'open' WHERE id = v_crew.id;
    END IF;
    PERFORM set_config('app.trusted_ladder_write', 'off', true);

    -- The other side is told; neither notice says who blocked whom.
    IF v_crew.customer_id = v_user THEN
      INSERT INTO public.notifications (user_id, title, message, type, link, job_id)
      -- lh-money-escrow review #2: a member owed a late fee is told so.
      VALUES (v_crew.member, 'You''re off this crew',
              CASE WHEN v_member_fee > 0 THEN
                format('You''re no longer on the crew for "%s". Because this was close to the start, you''re owed a $%s cancellation fee; our team will send it to you.',
                       COALESCE(v_crew.title, 'a job'), to_char(v_member_fee, 'FM999999990.00'))
              ELSE format('You''re no longer on the crew for "%s".', COALESCE(v_crew.title, 'a job')) END,
              CASE WHEN v_member_fee > 0 THEN 'payment' ELSE 'warning' END,
              '/jobs?job=' || v_crew.id::text, v_crew.id);
    ELSE
      INSERT INTO public.notifications (user_id, title, message, type, link, job_id)
      VALUES (v_crew.customer_id, 'A Helpr left your crew',
              'One of your Helprs can''t make "' || COALESCE(v_crew.title, 'your job')
                || CASE WHEN v_crew.status = 'accepted' AND v_remaining > 0
                     THEN '". The rest of your crew is still on. You can hire someone from your applicants for the open spot before it starts; if it stays empty, that spot''s share is refunded to you once the job is done.'
                     ELSE '" — their spot is open to everyone again.'
                   END,
              'warning', '/posts?job=' || v_crew.id::text, v_crew.id);
    END IF;

    v_settled := v_settled || jsonb_build_object(
      'job_id', v_crew.id, 'title', v_crew.title, 'crew', true, 'action', 'member_left',
      'fee_owed_by_hand', v_member_fee, 'fee_percent', v_percent);
  END LOOP;

  -- ADDED 2026-09-24 (Q345): what is still PENDING between the two closes too.
  -- Pending applications, either seat: closed silently (notify_on_application
  -- skips closed_reason = 'party_blocked'). Neither the row nor its absence of
  -- a notice says who blocked whom.
  UPDATE public.applications a
     SET status = 'rejected',
         closed_reason = 'party_blocked'
    FROM public.jobs j
   WHERE j.id = a.job_id
     AND a.status = 'pending'
     AND (
          (a.helper_id = v_user    AND j.customer_id = p_blocked)
       OR (a.helper_id = p_blocked AND j.customer_id = v_user)
     );
  GET DIAGNOSTICS v_closed_apps = ROW_COUNT;

  -- A pending direct offer between the two: declined, as if the offered person
  -- had declined it — the job reopens to everyone (C4 no longer reserves it).
  -- Silent: no "Offer declined" notice.
  UPDATE public.jobs
     SET direct_offer_status = 'declined',
         direct_offer_expires_at = NULL
   WHERE direct_offer_status = 'pending'
     -- Only an answerable offer (the "Targeted helper can respond" policy's
     -- shape). A row with helper_id set is not one, and from the helper seat
     -- enforce_helper_jobs_column_whitelist would refuse the write and roll the
     -- block back with it (measured on prod, rolled back, 2026-09-24).
     AND helper_id IS NULL
     AND (
          (customer_id = v_user    AND offered_to_helper_id = p_blocked)
       OR (customer_id = p_blocked AND offered_to_helper_id = v_user)
     );
  GET DIAGNOSTICS v_closed_offers = ROW_COUNT;

  RETURN jsonb_build_object(
    'blocked', p_blocked,
    'settled', v_settled,
    'closed_applications', v_closed_apps,
    'closed_offers', v_closed_offers
  );
END;
$function$;
REVOKE ALL ON FUNCTION public.block_user_and_settle(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.block_user_and_settle(uuid, text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.expire_unanswered_offers()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_job record;
  v_locked record;
  v_app_id uuid;
  v_count int := 0;
  v_no_strike boolean;
  v_crew_no_strike boolean;
  v_cap_ended boolean;
  v_crew_cap boolean;
  v_slot record;
  v_cjob record;
  v_remaining int;
BEGIN
  -- Scan first WITHOUT a lock, then lock each candidate individually inside the
  -- loop. A cursor that carried its own FOR UPDATE would hold every row for the
  -- whole sweep, so one slow iteration blocks a helper trying to confirm an
  -- unrelated job; and the re-check below has to happen after the lock is
  -- granted either way.
  FOR v_job IN
    SELECT j.id, j.helper_id,
           -- Q1188: a seed job, or a seed/test Helpr (detect_stuck_payments'
           -- rule), logs a failure under the '-seed' source.
           (coalesce(j.is_seed, false) OR coalesce(hp.is_seed, false)) AS seed
      FROM public.jobs j
      LEFT JOIN public.profiles hp ON hp.user_id = j.helper_id
     WHERE j.status = 'accepted'
       AND j.helper_id IS NOT NULL
       AND j.response_deadline IS NOT NULL
       AND j.response_deadline < now()
       AND j.helper_confirmed_at IS NULL
  LOOP
    -- Q1188 (lh-authz-rls round 3 of Q1180, should-fix 2): each offer in its
    -- own subtransaction. accept_job_offer takes the Helpr's profile, then the
    -- job; this sweep holds the job when the strike ladder writes that
    -- profile. If Postgres picks this side of that deadlock (or anything else
    -- in one iteration fails), only this offer rolls back, it is logged with
    -- its job, and every other offer still expires. The next run retries it.
    BEGIN
      SELECT j.id, j.title, j.customer_id, j.helper_id, j.response_deadline, j.date_needed, j.start_time
        INTO v_locked
        FROM public.jobs j
       WHERE j.id = v_job.id
         AND j.status = 'accepted'
         AND j.helper_id IS NOT NULL
         AND j.response_deadline IS NOT NULL
         AND j.response_deadline < now()
         AND j.helper_confirmed_at IS NULL
       FOR UPDATE SKIP LOCKED;

      IF NOT FOUND THEN
        CONTINUE;
      END IF;

      SELECT a.id INTO v_app_id
        FROM public.applications a
       WHERE a.job_id = v_locked.id
         AND a.helper_id = v_locked.helper_id
         AND a.status = 'accepted'
       LIMIT 1;

      -- ONE ladder for the whole reliability family — see
      -- apply_job_denial_consequence (20260824243000). The literal copy this
      -- replaced is exactly the drift hazard its own comment warned about.
      -- No strike while the Helpr's Stripe setup is unfinished, or after they
      -- tapped Accept and were still finishing it (owner, 2026-10-03: "it
      -- shouldn't hold up anything"; Q1180).
      -- 20261005184940: an answer-by capped at the job's start can be minutes
      -- long. Letting THAT run out is not a strike (lh-money-escrow review of
      -- the cap, finding 1; the owner's wider Q1281 ruling is separate).
      v_cap_ended := v_locked.response_deadline >= public.job_offer_cutoff(v_locked.date_needed, v_locked.start_time);
      v_no_strike := v_cap_ended
        OR public.helper_accept_block_reason(v_locked.helper_id) IS NOT NULL
        OR EXISTS (SELECT 1 FROM public.job_accept_pending p
                    WHERE p.job_id = v_locked.id AND p.helper_id = v_locked.helper_id);
      IF NOT v_no_strike THEN
        PERFORM public.apply_job_denial_consequence(
          v_locked.helper_id, v_locked.id,
          'Let a job offer expire without answering: "' || COALESCE(v_locked.title, 'Unknown') || '"');
      END IF;

      IF v_app_id IS NOT NULL THEN
        -- Q1207: say why it closed, or the Helpr reads "You weren't picked".
        UPDATE public.applications
           SET status = 'rejected', closed_reason = 'offer_expired'
         WHERE id = v_app_id;
      END IF;

      UPDATE public.jobs
         SET status = 'open',
             helper_id = NULL,
             response_deadline = NULL
       WHERE id = v_locked.id;

      -- Both sides are told, because both sides were waiting on this.
      INSERT INTO public.notifications (user_id, title, message, type, link, job_id)
      VALUES (
        v_locked.customer_id,
        'Offer expired — job reopened',
        'Your Helpr didn''t answer in time for "' || COALESCE(v_locked.title, 'your job')
          || '". It''s open to everyone again, so you can pick somebody else.',
        'job_updates',
        '/posts?job=' || v_locked.id::text,
        v_locked.id
      );

      INSERT INTO public.notifications (user_id, title, message, type, link, job_id)
      VALUES (
        v_locked.helper_id,
        'You lost a job offer',
        'The deadline passed on "' || COALESCE(v_locked.title, 'a job')
          || CASE WHEN v_cap_ended
               THEN '" when the job started, so it went back to everyone. No strike.'
               WHEN v_no_strike
               THEN '" before your payout setup and Stripe ID were done, so it went back to everyone. No strike. Finish both so you can accept the next offer.'
               ELSE '" and it went back to everyone. Letting an offer expire counts the same as declining it.'
             END,
        'expired',
        '/jobs?job=' || v_locked.id::text,
        v_locked.id
      );

      v_count := v_count + 1;
    EXCEPTION WHEN OTHERS THEN
      -- A seed/E2E offer logs under the '-seed' source, which
      -- error_log_is_seed() keeps out of Slack and the alert ledger.
      INSERT INTO public.error_logs (severity, message, tags, context)
      VALUES (
        CASE WHEN v_job.seed THEN 'info' ELSE 'error' END,
        'unanswered offer expiry failed',
        jsonb_build_object('source', 'expire_unanswered_offers' || CASE WHEN v_job.seed THEN '-seed' ELSE '' END,
                           'seed', v_job.seed, 'job_id', v_job.id::text),
        jsonb_build_object('job_id', v_job.id, 'helper_id', v_job.helper_id, 'err', SQLERRM, 'sqlstate', SQLSTATE)
      );
    END;
  END LOOP;

  -- ── THE CREW PASS (Q729, owner 2026-10-05) ───────────────────────────────
  -- A crew has no lead, so its members are found on the roster. Each member
  -- whose own reply deadline passed unconfirmed loses the spot, exactly as a
  -- single offer expires: same strike rule and exemptions, application closed
  -- as offer_expired, both sides told; the spot reopens (a full crew goes back
  -- to open). No fee: nothing was committed.
  FOR v_slot IN
    SELECT g.id AS slot_id, g.job_id, g.helper_id,
           g.response_deadline, j.date_needed, j.start_time,
           (j.is_seed IS TRUE OR hp.is_seed IS TRUE) AS seed
      FROM public.group_job_helpers g
      JOIN public.jobs j ON j.id = g.job_id
      LEFT JOIN public.profiles hp ON hp.user_id = g.helper_id
     WHERE j.is_group_job IS TRUE
       AND j.status IN ('open', 'accepted')
       AND g.helper_id IS NOT NULL
       AND g.helper_confirmed_at IS NULL
       AND g.response_deadline IS NOT NULL
       AND g.response_deadline < now()
  LOOP
    BEGIN
      SELECT j.id, j.title, j.customer_id, j.status::text AS status, j.helpers_needed
        INTO v_cjob
        FROM public.jobs j
       WHERE j.id = v_slot.job_id
         AND j.is_group_job IS TRUE
         AND j.status IN ('open', 'accepted')
       FOR UPDATE SKIP LOCKED;
      IF NOT FOUND THEN
        CONTINUE;
      END IF;
      -- Re-checked under the job's lock: a confirm that landed first wins.
      PERFORM 1
        FROM public.group_job_helpers g
       WHERE g.id = v_slot.slot_id
         AND g.helper_confirmed_at IS NULL
         AND g.response_deadline IS NOT NULL
         AND g.response_deadline < now()
       FOR UPDATE;
      IF NOT FOUND THEN
        CONTINUE;
      END IF;

      v_crew_cap := v_slot.response_deadline >= public.job_offer_cutoff(v_slot.date_needed, v_slot.start_time);
      v_crew_no_strike := v_crew_cap
        OR public.helper_accept_block_reason(v_slot.helper_id) IS NOT NULL
        OR EXISTS (SELECT 1 FROM public.job_accept_pending p
                    WHERE p.job_id = v_cjob.id AND p.helper_id = v_slot.helper_id);
      IF NOT v_crew_no_strike THEN
        PERFORM public.apply_job_denial_consequence(
          v_slot.helper_id, v_cjob.id,
          'Let a job offer expire without answering: "' || COALESCE(v_cjob.title, 'Unknown') || '"');
      END IF;

      UPDATE public.applications
         SET status = 'rejected', closed_reason = 'offer_expired'
       WHERE job_id = v_cjob.id AND helper_id = v_slot.helper_id AND status = 'accepted';

      DELETE FROM public.group_job_helpers WHERE id = v_slot.slot_id;

      SELECT count(*) INTO v_remaining FROM public.group_job_helpers g WHERE g.job_id = v_cjob.id;
      -- Q1378 (owner 2026-10-05): the rest of the crew carries on; only a
      -- crew with nobody left reopens (see helper_cancel_booking).
      IF v_cjob.status = 'accepted' AND v_remaining = 0 THEN
        UPDATE public.jobs SET status = 'open' WHERE id = v_cjob.id;
      END IF;

      INSERT INTO public.notifications (user_id, title, message, type, link, job_id)
      VALUES (
        v_cjob.customer_id,
        'Offer expired — spot reopened',
        'A Helpr you picked didn''t answer in time for "' || COALESCE(v_cjob.title, 'your job')
          || CASE WHEN v_cjob.status = 'accepted' AND v_remaining > 0
               THEN '". The rest of your crew is still on. You can hire someone from your applicants for the open spot before it starts; if it stays empty, that spot''s share is refunded to you once the job is done.'
               ELSE '". Their spot is open to everyone again, so you can pick somebody else.'
             END,
        'job_updates',
        '/posts?job=' || v_cjob.id::text,
        v_cjob.id
      );

      INSERT INTO public.notifications (user_id, title, message, type, link, job_id)
      VALUES (
        v_slot.helper_id,
        'You lost a job offer',
        'The deadline passed on "' || COALESCE(v_cjob.title, 'a job')
          || CASE WHEN v_crew_cap
               THEN '" when the job started, so you lost your spot. No strike.'
               WHEN v_crew_no_strike
               THEN '" before your payout setup and Stripe ID were done, so you lost your spot. No strike. Finish both so you can accept the next offer.'
               ELSE '" and you lost your spot. Letting an offer expire counts the same as declining it.'
             END,
        'expired',
        '/jobs?job=' || v_cjob.id::text,
        v_cjob.id
      );

      v_count := v_count + 1;
    EXCEPTION WHEN OTHERS THEN
      INSERT INTO public.error_logs (severity, message, tags, context)
      VALUES (
        CASE WHEN v_slot.seed THEN 'info' ELSE 'error' END,
        'unanswered crew spot expiry failed',
        jsonb_build_object('source', 'expire_unanswered_offers' || CASE WHEN v_slot.seed THEN '-seed' ELSE '' END,
                           'seed', v_slot.seed, 'job_id', v_slot.job_id::text),
        jsonb_build_object('job_id', v_slot.job_id, 'helper_id', v_slot.helper_id, 'err', SQLERRM, 'sqlstate', SQLSTATE)
      );
    END;
  END LOOP;

  RETURN v_count;
END;
$function$;
REVOKE ALL ON FUNCTION public.expire_unanswered_offers() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.expire_unanswered_offers() TO service_role;

CREATE OR REPLACE FUNCTION public.accept_group_application(p_application_id uuid, p_deadline timestamp with time zone DEFAULT NULL::timestamp with time zone, p_offer_message text DEFAULT NULL::text)
 RETURNS TABLE(slots_filled integer, slots_total integer, roster_complete boolean)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_cutoff        timestamptz;
  v_crew_deadline      timestamptz;
  v_date_needed   date;
  v_start_time    time without time zone;
  v_job_id        uuid;
  v_helper_id     uuid;
  v_app_status    text;
  v_job_status    text;
  v_job_customer  uuid;
  v_is_group      boolean;
  v_needed        int;
  v_current       int;
  v_budget        numeric;
  v_slot          int;
BEGIN
  SELECT a.job_id, a.helper_id, a.status
    INTO v_job_id, v_helper_id, v_app_status
  FROM public.applications a
  WHERE a.id = p_application_id;

  IF v_job_id IS NULL THEN
    RAISE EXCEPTION 'application_not_found';
  END IF;

  -- Lock the job row — concurrent accepts serialize here, which is what makes
  -- the slot count below trustworthy.
  SELECT j.status, j.customer_id, j.is_group_job, j.helpers_needed, j.budget, j.date_needed, j.start_time
    INTO v_job_status, v_job_customer, v_is_group, v_needed, v_budget, v_date_needed, v_start_time
  FROM public.jobs j
  WHERE j.id = v_job_id
  FOR UPDATE;

  -- 20261005184940: the answer-by never runs past the job's start, so a hire
  -- too close to it would hand the member a window already gone (and a strike
  -- at the next sweep). Refused like accept_application, before any write.
  v_cutoff := public.job_offer_cutoff(v_date_needed, v_start_time);
  IF v_cutoff IS NOT NULL AND v_cutoff <= now() + interval '15 minutes' THEN
    RAISE EXCEPTION 'job_starts_too_soon';
  END IF;

  IF v_job_customer IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'not_authorized';
  END IF;

  -- Q345: no hire across a block, in either direction (see accept_application;
  -- are_users_blocked is symmetric, so the argument order does not matter).
  IF public.are_users_blocked(v_job_customer, v_helper_id) THEN
    RAISE EXCEPTION 'applicant_blocked' USING ERRCODE = '42501';
  END IF;

  IF v_is_group IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'not_a_group_job';
  END IF;

  -- Defensive: a group job with missing or invalid capacity would let the
  -- roster grow without bound.
  IF v_needed IS NULL OR v_needed < 1 THEN
    RAISE EXCEPTION 'invalid_helpers_needed';
  END IF;

  -- Q1378 (owner 2026-10-05): a booked crew a member left carries on with a
  -- free spot, and the poster may refill it before the start
  -- (job_starts_too_soon above refuses a hire inside 15 minutes of it). The
  -- capacity guard below refuses a booked crew that is full.
  IF v_job_status IS NULL OR v_job_status NOT IN ('open', 'accepted') THEN
    RAISE EXCEPTION 'job_not_open';
  END IF;

  IF v_app_status IS DISTINCT FROM 'pending' THEN
    RAISE EXCEPTION 'application_not_pending';
  END IF;

  SELECT COUNT(*) INTO v_current
  FROM public.group_job_helpers g
  WHERE g.job_id = v_job_id;

  -- Capacity guard. Under contention the loser lands here rather than
  -- overfilling the roster.
  IF v_current >= v_needed THEN
    RAISE EXCEPTION 'roster_full';
  END IF;

  UPDATE public.applications
     SET status = 'accepted',
         offer_message = COALESCE(p_offer_message, offer_message)
   WHERE id = p_application_id;

  -- The lowest free slot, and its frozen share of the budget in cents
  -- (largest remainder; see crew_slot_share_cents). A slot a departed member
  -- left is reused, so the N shares always add up to the budget.
  SELECT min(s) INTO v_slot
    FROM generate_series(0, v_needed - 1) AS s
   WHERE NOT EXISTS (SELECT 1 FROM public.group_job_helpers g WHERE g.job_id = v_job_id AND g.slot_no = s);
  IF v_slot IS NULL THEN
    RAISE EXCEPTION 'roster_full';
  END IF;

  -- UNIQUE (job_id, helper_id) turns a double-accept of the SAME helper into a
  -- 23505 rather than a silently duplicated slot. group_job_helpers_award_gate
  -- judges THIS member: award gate and, since 20260925154606, a funded job.
  INSERT INTO public.group_job_helpers (job_id, helper_id, slot_no, share_cents)
  VALUES (v_job_id, v_helper_id, v_slot,
          public.crew_slot_share_cents(round(COALESCE(v_budget, 0) * 100)::bigint, v_needed, v_slot));

  -- Q729 (owner 2026-10-05): the poster's reply deadline is kept for THIS
  -- member; expire_unanswered_offers reopens the spot once it passes unanswered.
  -- Clamped to the shortest deadline the app offers (1 hour, less 5 minutes
  -- of clock skew): a deadline in the past would get the member struck by the
  -- next sweep before they could answer (lh-authz-rls review #1, 2026-10-05).
  -- The answer-by never runs past the job's start (20261005184940), and a NULL
  -- (never expires) is bounded the same way, as accept_application now is.
  v_crew_deadline := LEAST(GREATEST(LEAST(COALESCE(p_deadline, now() + interval '48 hours'), now() + interval '48 hours'), now() + interval '55 minutes'), v_cutoff);
  UPDATE public.group_job_helpers
     SET response_deadline = v_crew_deadline
   WHERE job_id = v_job_id AND slot_no = v_slot;

  v_current := v_current + 1;

  -- A crew has no lead (Q407): jobs.helper_id stays NULL (trg_group_job_has_no_lead),
  -- and the job-level response_deadline, which timed ONE Helpr's reply, is not
  -- written. p_deadline stays in the signature for existing callers.
  UPDATE public.jobs
     SET
         -- Stay 'open' while partially staffed; only the final slot closes it.
         -- The cast is the fix for the one statement that never ran: a CASE of
         -- two bare literals resolves to text, and Postgres will not assign
         -- text to the job_status enum ("column "status" is of type job_status
         -- but expression is of type text"), so every call since 20260804122000
         -- raised here and rolled back (reproduced in PGlite, R0 in
         -- src/test/pglite/groupCrewNoLead.pglite.mjs).
         status = (CASE WHEN v_current >= v_needed THEN 'accepted' ELSE 'open' END)::job_status
   WHERE id = v_job_id
     -- A refill of a booked crew (Q1378) leaves it booked, full or not.
     AND v_job_status = 'open';

  slots_filled := v_current;
  slots_total := v_needed;
  roster_complete := v_current >= v_needed;
  RETURN NEXT;
END;
$function$;
REVOKE ALL ON FUNCTION public.accept_group_application(uuid, timestamp with time zone, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.accept_group_application(uuid, timestamp with time zone, text) TO authenticated, service_role;
