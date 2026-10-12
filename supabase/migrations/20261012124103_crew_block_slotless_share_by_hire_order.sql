-- Q1380 (lh-money-escrow review, 2026-10-05): the crew block prices a
-- slotless roster row's fee at $0.
--
-- block_user_and_settle's crew branch prices the blocked member's share as
-- COALESCE(share_cents, crew_slot_share_cents(total, needed, slot_no)). A
-- roster row from before the slots existed (20260925154606) has neither a
-- slot nor a frozen share, and crew_slot_share_cents(.., NULL) is 0: the fee
-- came out $0, so the member was owed nothing and not even the "fee owed by
-- hand" admin alert fired. poster_cancel_job's crew branch falls back to the
-- share by hire order (row_number() OVER (ORDER BY joined_at NULLS LAST,
-- id) - 1); the block now uses the same position, counted directly (the loop
-- locks its rows FOR UPDATE, which cannot carry a window function).
--
-- Body = 20261007073145's (the newest definition in supabase/migrations) plus
-- that fallback. Same signature; grants restated as there. Replay-safe:
-- CREATE OR REPLACE.

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
  v_hire_ix int;
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
           g.share_cents, g.slot_no, g.joined_at AS member_joined_at
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
      -- Q1380: a roster row from before the slots existed has no slot_no;
      -- price it by hire order (joined_at NULLS LAST, id), the same fallback
      -- poster_cancel_job's crew branch uses, never as slot NULL ($0).
      v_hire_ix := v_crew.slot_no;
      IF v_hire_ix IS NULL THEN
        SELECT count(*)::int INTO v_hire_ix
          FROM public.group_job_helpers x
         WHERE x.job_id = v_crew.id
           AND x.helper_id IS NOT NULL
           AND x.id <> v_crew.slot_id
           AND CASE WHEN v_crew.member_joined_at IS NULL
                    THEN x.joined_at IS NOT NULL OR x.id < v_crew.slot_id
                    ELSE x.joined_at < v_crew.member_joined_at
                         OR (x.joined_at = v_crew.member_joined_at AND x.id < v_crew.slot_id) END;
      END IF;
      v_basis := COALESCE(v_crew.share_cents,
                          public.crew_slot_share_cents(round(COALESCE(v_crew.budget, 0) * 100)::bigint,
                                                       COALESCE(v_crew.helpers_needed, 1), v_hire_ix));
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

      IF v_member_fee > 0 AND v_crew.slot_no IS NOT NULL THEN
        -- Q1390 (owner 2026-10-07, (a)): the fee is paid from THIS job's
        -- escrow when it settles, out of this spot's share, and the spot stays
        -- closed (crew_spots_open, open_jobs_browse and accept_group_application
        -- count it as taken). _shared/crewBlockFees.ts pays the row;
        -- money-reconciliation reads it. A repeat block cannot price it twice.
        INSERT INTO public.crew_block_fees (job_id, helper_id, slot_no, share_basis_cents, fee_percent, fee_cents)
        VALUES (v_crew.id, v_crew.member, v_crew.slot_no, COALESCE(v_basis, 0)::int, v_percent,
                round(COALESCE(v_basis, 0) * v_percent / 100.0)::int)
        ON CONFLICT (job_id, slot_no) DO NOTHING;
        INSERT INTO public.notifications (user_id, title, message, type, link, job_id)
        VALUES (v_user, 'Crew spot closed',
                format('You blocked a crew member close to the start of "%s". Their $%s cancellation fee comes out of that spot''s $%s share, and the spot stays closed. The rest of that share comes back to you when the job is done.',
                       COALESCE(v_crew.title, 'your job'), to_char(v_member_fee, 'FM999999990.00'),
                       to_char(COALESCE(v_basis, 0) / 100.0, 'FM999999990.00')),
                'payment', '/posts?job=' || v_crew.id::text, v_crew.id);
      ELSIF v_member_fee > 0 THEN
        -- A roster row from before the slots existed (Q1380) has no slot to
        -- close and no frozen share: still settled by hand.
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
    IF v_remaining = 0
       AND COALESCE(v_crew.helpers_needed, 1)
           <= (SELECT count(*) FROM public.crew_block_fees b WHERE b.job_id = v_crew.id) THEN
      -- Q1390: every spot is closed by a block, so nobody can ever do the
      -- job and nothing reopens it. A person cancels it (the poster is then
      -- refunded less the block fees, which void-cancelled-payments pays).
      INSERT INTO public.notifications (user_id, title, message, type, link, job_id)
      SELECT r.user_id,
             'Crew job has no spots left',
             format('"%s": every spot on this crew was closed by a block with a fee, so nobody is left to do it. Cancel the job: whoever posted it is refunded less the block fees, which are paid to the members they blocked.',
                    COALESCE(v_crew.title, 'A job')),
             'admin_alert',
             '/admin?view=jobs&job=' || v_crew.id::text,
             v_crew.id
        FROM public.user_roles r
       WHERE r.role = 'admin';
    ELSIF v_crew.status = 'accepted' AND v_remaining = 0 THEN
      UPDATE public.jobs SET status = 'open' WHERE id = v_crew.id;
    END IF;
    PERFORM set_config('app.trusted_ladder_write', 'off', true);

    -- The other side is told; neither notice says who blocked whom.
    IF v_crew.customer_id = v_user THEN
      INSERT INTO public.notifications (user_id, title, message, type, link, job_id)
      -- lh-money-escrow review #2: a member owed a late fee is told so.
      VALUES (v_crew.member, 'You''re off this crew',
              CASE WHEN v_member_fee > 0 AND v_crew.slot_no IS NOT NULL THEN
                format('You''re no longer on the crew for "%s". Because this was close to the start, you''re owed a $%s cancellation fee, paid to you from the job''s payment when the job settles.',
                       COALESCE(v_crew.title, 'a job'), to_char(v_member_fee, 'FM999999990.00'))
              WHEN v_member_fee > 0 THEN
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
      'block_fee', CASE WHEN v_crew.slot_no IS NOT NULL THEN v_member_fee ELSE 0 END,
      'fee_owed_by_hand', CASE WHEN v_crew.slot_no IS NULL THEN v_member_fee ELSE 0 END,
      'fee_percent', v_percent);
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
