-- Q2093 (sec-a, 2026-10-18): two notices about a pending direct offer spoke
-- as if the job were live when its money had not arrived (owner, 2026-10-17:
-- "The job shouldn't post until the money is paid"; 20261018024631 gated the
-- offer notice, the Helpr's offer list and the expiry sweep on
-- job_payment_is_funded).
--   1. settle_one_off_jobs_for_banned_account (newest 20261017104746, body
--      verbatim from prod: md5 82dc7826dd3c075e6d44627ced758600 = the file)
--      told the offered Helpr "Offer closed" about an offer he was never shown,
--      and told the poster of a job offered TO the banned account that it is
--      "open to everyone again". Now: no Helpr notice on an unfunded job, and
--      the poster's notice drops the "open to everyone" clause.
--   2. jobs_offer_target_gone_retires_offer (20261007045539, verbatim from
--      prod: md5 dff24dc3400d81567e6df92699e6df1d) told the poster "The job is
--      now open to everyone" when the offered Helpr's account went. Same rule.
--   3. respond_to_direct_offer (Q2131, below) told the poster "The job is open
--      to everyone again" when the offered Helpr declined an unfunded job's
--      offer, and record_backout_notice (20261017073146, verbatim from prod:
--      md5 51500f6d2f0eb31a4f458c5c480eb49f) sent the same words as a banner
--      row and email on any pending -> declined/expired offer (the decline and
--      the ban settlement's). Same rule: its offer branch needs a funded job.
-- Only notification text/recipients change; every state change is as before.
-- Guard: src/test/directOfferWaitsForFunding.test.ts.

CREATE OR REPLACE FUNCTION public.settle_one_off_jobs_for_banned_account(p_user uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_job record;
  v_seat text;
  v_other uuid;
  v_action text;
  v_started boolean;
  v_series boolean;
  v_hours numeric;
  v_percent int;
  v_fee numeric;
  v_committed boolean;
  v_cut numeric;
  v_n int;
  v_title text;
  v_admin_note text;
  v_out jsonb := '[]'::jsonb;
  v_closed_apps int := 0;
  v_closed_offers int := 0;
  v_cancel_flag text := current_setting('app.sanctioned_cancel', true);
  v_ladder_flag text := current_setting('app.trusted_ladder_write', true);
  v_reason CONSTANT text := 'Cancelled because an account on this job was closed by Louisiana Helpr.';
  v_dispute_reason CONSTANT text := 'An account on this job was closed by Louisiana Helpr after work had started. An admin decides the payment.';
  v_gone CONSTANT text := 'the other person on it can no longer use Louisiana Helpr';
BEGIN
  IF p_user IS NULL THEN
    RETURN jsonb_build_object('settled', '[]'::jsonb, 'closed_applications', 0, 'closed_offers', 0);
  END IF;

  FOR v_job IN
    SELECT j.id, j.title, j.customer_id, j.helper_id, j.status::text AS status, j.payment_status,
           j.budget, j.date_needed, j.start_time, j.helper_confirmed_at, j.helper_fee_percent, j.helper_fee_flat_cents,
           j.helper_arrived_at, j.helper_completed_at, j.proof_before_urls, j.proof_after_urls,
           j.is_group_job, j.parent_job_id, j.recurrence_days,
           j.offered_to_helper_id, j.direct_offer_status
      FROM public.jobs j
     WHERE (
             (j.customer_id = p_user OR j.helper_id = p_user
              OR EXISTS (SELECT 1 FROM public.group_job_helpers g
                          WHERE g.job_id = j.id AND g.helper_id = p_user))
             AND j.status::text NOT IN ('completed', 'cancelled')
           )
        OR (j.helper_id = p_user
            AND j.status::text IN ('completed', 'cancelled')
            AND j.payment_status IN ('escrow', 'payout_pending'))
        -- Q731(b), owner 2026-10-05: a crew has no lead (Q407), so a banned
        -- crew MEMBER of a finished crew job is found through the roster, and
        -- is treated exactly as a banned single Helpr (ban_settlement_action:
        -- admin_review, every admin alerted, payouts run on schedule). A member
        -- whose own share already paid out has nothing left to decide.
        OR (j.is_group_job IS TRUE
            AND j.status::text IN ('completed', 'cancelled')
            AND j.payment_status IN ('escrow', 'payout_pending')
            AND EXISTS (SELECT 1 FROM public.group_job_helpers g
                         WHERE g.job_id = j.id AND g.helper_id = p_user)
            AND NOT EXISTS (SELECT 1 FROM public.payout_transfers pt
                             WHERE pt.job_id = j.id AND pt.helper_id = p_user AND pt.status = 'paid'))
     ORDER BY j.id
       FOR UPDATE
  LOOP
    v_seat := CASE WHEN v_job.customer_id = p_user THEN 'poster' ELSE 'helpr' END;
    v_other := CASE WHEN v_seat = 'poster' THEN v_job.helper_id ELSE v_job.customer_id END;
    v_series := v_job.parent_job_id IS NOT NULL OR v_job.recurrence_days IS NOT NULL;
    -- helper_abort_job's "work started" test, plus a requested revision (which
    -- only follows a Done).
    v_started := v_job.helper_arrived_at IS NOT NULL
              OR v_job.helper_completed_at IS NOT NULL
              OR COALESCE(array_length(v_job.proof_before_urls, 1), 0) > 0
              OR COALESCE(array_length(v_job.proof_after_urls, 1), 0) > 0
              OR v_job.status = 'revision_requested';
    v_action := public.ban_settlement_action(v_seat, v_job.status, v_job.payment_status,
                                             v_started, COALESCE(v_job.is_group_job, false), v_series);
    v_title := COALESCE(v_job.title, 'A job');
    v_admin_note := NULL;
    v_fee := 0;
    v_hours := NULL;

    BEGIN
      -- The sanctioned hatches this settlement is (trg_cancellation_requires_rpc,
      -- the helper column whitelist), transaction-local and restored below.
      PERFORM set_config('app.sanctioned_cancel', 'on', true);
      PERFORM set_config('app.trusted_ladder_write', 'on', true);

      IF v_action IN ('cancel_priced', 'cancel_no_money') THEN
        v_committed := v_job.helper_id IS NOT NULL AND v_job.helper_confirmed_at IS NOT NULL;
        IF v_action = 'cancel_priced' THEN
          -- poster_cancel_job's single-job pricing.
          v_hours := public.job_hours_until_start(v_job.date_needed, v_job.start_time, now());
          -- Q1324: an admin confirming a fingerprint-match ban settles as of
          -- the ban (admin_confirm_ban_settlement sets the review's start, so
          -- the late-cancel fee is the one the ban would have charged); every
          -- other ban settles at once, as of now.
          IF NULLIF(current_setting('app.ban_settlement_as_of', true), '') IS NOT NULL THEN
            v_hours := public.job_hours_until_start(v_job.date_needed, v_job.start_time,
                         current_setting('app.ban_settlement_as_of', true)::timestamptz);
          END IF;
          v_percent := public.cancellation_fee_percent(v_committed, v_hours);
          v_fee := CASE WHEN COALESCE(v_job.budget, 0) > 0 AND v_percent > 0
                        THEN round(v_job.budget * v_percent) / 100.0 ELSE 0 END;
        END IF;

        UPDATE public.jobs
           SET status = 'cancelled',
               cancelled_by = NULL,
               cancelled_at = now(),
               cancellation_reason = v_reason,
               late_cancellation = CASE WHEN v_action = 'cancel_priced'
                                        THEN public.is_late_cancellation(v_committed, v_hours) ELSE false END,
               cancellation_fee = v_fee,
               cancellation_fee_status = CASE WHEN v_fee > 0 THEN 'pending' ELSE NULL END,
               direct_offer_status = CASE WHEN direct_offer_status = 'pending' THEN 'declined' ELSE direct_offer_status END,
               direct_offer_expires_at = CASE WHEN direct_offer_status = 'pending' THEN NULL ELSE direct_offer_expires_at END
         WHERE id = v_job.id
           AND status::text = v_job.status;
        GET DIAGNOSTICS v_n = ROW_COUNT;
        IF v_n = 0 THEN
          RAISE EXCEPTION 'job moved while being settled';
        END IF;

        IF v_job.helper_id IS NOT NULL THEN
          -- Q1840: a flat-model job (F3) keeps 5% + 70c of the fee, as
          -- void-cancelled-payments prices it; a legacy job the tier percent.
          v_cut := CASE WHEN v_job.helper_fee_flat_cents IS NOT NULL
            THEN GREATEST(0, round(v_fee * 100)
                   - public.helpr_flat_fee_cents(round(v_fee * 100), v_job.helper_fee_percent, v_job.helper_fee_flat_cents)) / 100.0
            ELSE GREATEST(0, round((v_fee - round(v_fee * COALESCE(v_job.helper_fee_percent, 10)) / 100.0) * 100) / 100.0)
          END;
          INSERT INTO public.notifications (user_id, title, message, type, link, job_id)
          VALUES (
            v_job.helper_id,
            CASE WHEN v_fee > 0 THEN 'Job cancelled — you''ll be compensated' ELSE 'Job cancelled' END,
            CASE WHEN v_fee > 0 THEN
              format('"%s" was cancelled because %s. It was cancelled late, so you''ll receive about $%s as a cancellation fee, processed within the hour.',
                     v_title, v_gone, to_char(v_cut, 'FM999999990.00'))
            ELSE format('"%s" was cancelled because %s.', v_title, v_gone) END,
            CASE WHEN v_fee > 0 THEN 'payment' ELSE 'warning' END,
            '/jobs?job=' || v_job.id::text,
            v_job.id
          );
        ELSIF v_job.offered_to_helper_id IS NOT NULL AND v_job.direct_offer_status = 'pending' THEN
          -- Q2093: the offered Helpr was told about the offer only once its
          -- money arrived (notify_helper_on_direct_offer), so an unfunded
          -- offer's close is not news to them: no notice.
          INSERT INTO public.notifications (user_id, title, message, type, link, job_id)
          SELECT
            v_job.offered_to_helper_id,
            'Offer closed',
            format('"%s" was cancelled because %s, so its offer is closed.', v_title, v_gone),
            'warning',
            '/jobs?job=' || v_job.id::text,
            v_job.id
           WHERE public.job_payment_is_funded(v_job.payment_status);
        END IF;

      ELSIF v_action = 'reopen' THEN
        UPDATE public.applications
           SET status = 'rejected',
               closed_reason = 'party_blocked'
         WHERE job_id = v_job.id AND helper_id = p_user AND status = 'accepted';

        UPDATE public.jobs
           SET status = 'open',
               helper_id = NULL,
               response_deadline = NULL,
               helper_confirmed_at = NULL,
               helper_dayof_confirmed_at = NULL,
               helper_on_the_way_at = NULL,
               helper_arrived_at = NULL,
               dayof_confirm_reminder_sent_at = NULL,
               dayof_unanswered_poster_alert_sent_at = NULL,
               start_reminder_sent_at = NULL
         WHERE id = v_job.id
           AND helper_id = p_user
           AND status::text = v_job.status;
        GET DIAGNOSTICS v_n = ROW_COUNT;
        IF v_n = 0 THEN
          RAISE EXCEPTION 'job moved while being settled';
        END IF;

        IF v_job.customer_id IS NOT NULL THEN
          INSERT INTO public.notifications (user_id, title, message, type, link, job_id)
          VALUES (
            v_job.customer_id,
            'Your job is open again',
            format('"%s" is open to everyone again because the person you hired can no longer use Louisiana Helpr. %s',
                   v_title,
                   CASE WHEN v_job.payment_status = 'escrow'
                        THEN 'Your payment stays protected in escrow for whoever you pick next.'
                        ELSE 'Pick someone new whenever you''re ready.' END),
            'warning',
            '/posts?job=' || v_job.id::text,
            v_job.id
          );
        END IF;

      ELSIF v_action = 'hold_dispute' THEN
        INSERT INTO public.disputes (job_id, opener_id, reason, evidence_urls)
        VALUES (v_job.id, NULL, v_dispute_reason, '{}'::text[]);

        -- One statement, so set_dispute_deadline sees disputed_at on the flip.
        -- ESCALATED from the start: the 72h timeout never settles it.
        UPDATE public.jobs
           SET status = 'disputed',
               disputed_by = NULL,
               disputed_at = now(),
               dispute_reason = v_dispute_reason,
               dispute_status = 'escalated'
         WHERE id = v_job.id
           AND status::text = v_job.status
           AND payment_status = 'escrow';
        GET DIAGNOSTICS v_n = ROW_COUNT;
        IF v_n = 0 THEN
          RAISE EXCEPTION 'job moved while being settled';
        END IF;

        IF v_other IS NOT NULL THEN
          INSERT INTO public.notifications (user_id, title, message, type, link, job_id)
          VALUES (
            v_other,
            'Job on hold for review',
            format('"%s" is on hold because %s. Work had already started, so a person at Louisiana Helpr will review it and decide the payment. The money stays in escrow until then, and you don''t need to do anything.',
                   v_title, v_gone),
            'warning',
            CASE WHEN v_seat = 'poster' THEN '/jobs?job=' ELSE '/posts?job=' END || v_job.id::text,
            v_job.id
          );
        END IF;
        v_admin_note := 'work had started when an account on it was banned, so the platform opened an ESCALATED dispute. Nothing pays out until an admin decides.';

      ELSIF v_action = 'escalate_dispute' THEN
        UPDATE public.jobs
           SET dispute_status = 'escalated'
         WHERE id = v_job.id
           AND status = 'disputed'
           AND dispute_status IS DISTINCT FROM 'escalated';
        GET DIAGNOSTICS v_n = ROW_COUNT;
        IF v_n > 0 THEN
          v_admin_note := 'an account on this disputed job was banned. The dispute is escalated so the 72h timeout cannot settle it.';
        ELSE
          v_action := 'none_already_held';  -- escalated already: a re-run says nothing
        END IF;

      ELSIF v_action = 'admin_review' THEN
        v_admin_note := format('an account on it was banned and it could not be settled automatically (status %s, payment %s%s). Nothing on the job was changed, and any scheduled payout or refund still runs on schedule unless an admin steps in.',
                               v_job.status, COALESCE(v_job.payment_status, 'none'),
                               CASE WHEN v_job.is_group_job THEN ', crew' ELSE '' END);
        IF v_job.status IN ('open', 'pending_approval', 'accepted', 'in_progress', 'revision_requested')
           AND v_other IS NOT NULL THEN
          INSERT INTO public.notifications (user_id, title, message, type, link, job_id)
          VALUES (
            v_other,
            'Job under review',
            format('"%s": %s. A person at Louisiana Helpr will review this job, and you don''t need to do anything.',
                   v_title, v_gone),
            'warning',
            CASE WHEN v_seat = 'poster' THEN '/jobs?job=' ELSE '/posts?job=' END || v_job.id::text,
            v_job.id
          );
        END IF;

      ELSIF v_action IN ('none_finished', 'none_settling', 'series_lane') THEN
        -- Nothing to do: finished, already cancelled with nothing owed to the
        -- banned account, or the recurring lane's.
        NULL;

      ELSE
        RAISE EXCEPTION 'unhandled ban settlement (seat %, status %, payment %)',
          v_seat, v_job.status, COALESCE(v_job.payment_status, 'none');
      END IF;

      PERFORM set_config('app.sanctioned_cancel', COALESCE(v_cancel_flag, 'off'), true);
      PERFORM set_config('app.trusted_ladder_write', COALESCE(v_ladder_flag, 'off'), true);
    EXCEPTION WHEN OTHERS THEN
      -- Only this job's writes roll back; the ban and every other job stand.
      PERFORM set_config('app.sanctioned_cancel', COALESCE(v_cancel_flag, 'off'), true);
      PERFORM set_config('app.trusted_ladder_write', COALESCE(v_ladder_flag, 'off'), true);
      v_admin_note := format('an account on it was banned but settling it failed (%s: %s). Nothing was changed; settle it by hand.',
                             v_action, SQLERRM);
      v_action := 'failed';
      v_fee := 0;
    END;

    IF v_admin_note IS NOT NULL THEN
      -- Its own subtransaction: a failed alert never rolls back the ban.
      BEGIN
        INSERT INTO public.notifications (user_id, title, message, type, link, job_id)
        SELECT r.user_id,
               'Banned account: job needs a decision',
               format('"%s": %s', v_title, v_admin_note),
               'admin_alert',
               '/admin?view=jobs&job=' || v_job.id::text,
               v_job.id
          FROM public.user_roles r
         WHERE r.role = 'admin';
      EXCEPTION WHEN OTHERS THEN
        RAISE WARNING 'ban settlement: admin alert for job % failed: %', v_job.id, SQLERRM;
      END;
    END IF;

    -- Only what this run did (or could not do) is reported; a job with
    -- nothing to settle is not, so a re-run reports nothing.
    IF v_action NOT LIKE 'none%' AND v_action <> 'series_lane' THEN
      v_out := v_out || jsonb_build_object('job_id', v_job.id, 'seat', v_seat, 'action', v_action, 'cancellation_fee', v_fee);
    END IF;
  END LOOP;

  -- Its own subtransaction: closing applications and offers can never roll
  -- back the ban or the jobs settled above.
  BEGIN
  PERFORM set_config('app.trusted_ladder_write', 'on', true);

  -- Pending applications FROM the banned account: closed silently.
  UPDATE public.applications a
     SET status = 'rejected',
         closed_reason = 'party_blocked'
   WHERE a.helper_id = p_user
     AND a.status = 'pending';
  GET DIAGNOSTICS v_closed_apps = ROW_COUNT;

  -- A pending direct offer TO the banned account: declined (the job reopens to
  -- everyone, as a declined offer does) and its poster told.
  FOR v_job IN
    SELECT j.id, j.title, j.customer_id, j.payment_status
      FROM public.jobs j
     WHERE j.offered_to_helper_id = p_user
       AND j.direct_offer_status = 'pending'
       AND j.helper_id IS NULL
     ORDER BY j.id
       FOR UPDATE
  LOOP
    UPDATE public.jobs
       SET direct_offer_status = 'declined',
           direct_offer_expires_at = NULL
     WHERE id = v_job.id AND direct_offer_status = 'pending';
    GET DIAGNOSTICS v_n = ROW_COUNT;
    IF v_n > 0 THEN
      v_closed_offers := v_closed_offers + 1;
      IF v_job.customer_id IS NOT NULL AND v_job.customer_id <> p_user THEN
        INSERT INTO public.notifications (user_id, title, message, type, link, job_id)
        VALUES (
          v_job.customer_id,
          'Offer closed',
          -- Q2093: a job whose money has not arrived is open to no one, so
          -- only a funded job is "open to everyone again".
          CASE WHEN public.job_payment_is_funded(v_job.payment_status) THEN
            format('The person you offered "%s" to can no longer use Louisiana Helpr, so the offer is closed and the job is open to everyone again.',
                   COALESCE(v_job.title, 'your job'))
          ELSE
            format('The person you offered "%s" to can no longer use Louisiana Helpr, so the offer is closed.',
                   COALESCE(v_job.title, 'your job'))
          END,
          'warning',
          '/posts?job=' || v_job.id::text,
          v_job.id
        );
      END IF;
    END IF;
  END LOOP;

  PERFORM set_config('app.trusted_ladder_write', COALESCE(v_ladder_flag, 'off'), true);
  EXCEPTION WHEN OTHERS THEN
    PERFORM set_config('app.trusted_ladder_write', COALESCE(v_ladder_flag, 'off'), true);
    v_closed_apps := 0;
    v_closed_offers := 0;
    BEGIN
      INSERT INTO public.notifications (user_id, title, message, type, link)
      SELECT r.user_id,
             'Banned account: applications need a look',
             format('Closing the banned account''s pending applications and offers failed (%s). Nothing was changed; close them by hand.', SQLERRM),
             'admin_alert',
             '/admin?view=users&user=' || p_user::text
        FROM public.user_roles r
       WHERE r.role = 'admin';
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'ban settlement: application/offer close failed for %: %', p_user, SQLERRM;
    END;
  END;

  RETURN jsonb_build_object(
    'settled', v_out,
    'closed_applications', v_closed_apps,
    'closed_offers', v_closed_offers
  );
END;
$function$;
REVOKE ALL ON FUNCTION public.settle_one_off_jobs_for_banned_account(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.settle_one_off_jobs_for_banned_account(uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.jobs_offer_target_gone_retires_offer()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $fn$
BEGIN
  IF OLD.offered_to_helper_id IS NOT NULL
     AND NEW.offered_to_helper_id IS NULL
     AND NEW.direct_offer_status = 'pending' THEN
    NEW.direct_offer_status := 'expired';
    IF NEW.customer_id IS NOT NULL THEN
      INSERT INTO public.notifications (user_id, title, message, type, link)
      VALUES (NEW.customer_id,
              'Direct offer closed',
              -- Q2093: a job whose money has not arrived is open to no one.
              CASE WHEN public.job_payment_is_funded(NEW.payment_status) THEN
                'The Helpr you offered "' || COALESCE(NEW.title, 'your job')
                  || '" to is no longer on Helpr. The job is now open to everyone.'
              ELSE
                'The Helpr you offered "' || COALESCE(NEW.title, 'your job')
                  || '" to is no longer on Helpr, so the offer is closed.'
              END,
              'job_updates',
              '/posts?job=' || NEW.id::text);
    END IF;
  END IF;
  RETURN NEW;
END;
$fn$;

REVOKE ALL ON FUNCTION public.jobs_offer_target_gone_retires_offer() FROM PUBLIC, anon, authenticated;

-- Q2131 (lh-money-escrow review of Q2093): respond_to_direct_offer
-- (20261003214350, verbatim from prod: md5 409fc292c1498b938a9923f1a7f20a6b)
-- let the offered Helpr decline an offer on an unfunded job (reachable only by
-- calling the RPC with the job's id: the offer list and notice are gated) and
-- told the poster "The job is open to everyone again". The decline still
-- closes the offer; the poster hears "open to everyone" only on a funded job.
CREATE OR REPLACE FUNCTION public.respond_to_direct_offer(p_job_id uuid, p_accept boolean)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_offered_to uuid;
  v_offer_status text;
  v_job_status text;
  v_expires_at timestamptz;
  v_customer uuid;
  v_now timestamptz := now();
  v_reason text;
  v_block text;
  v_done jsonb;
BEGIN
  -- Q1185: profile before job, the lock order of accept_job_offer and of the
  -- profiles trigger that completes pending accepts, so a Stripe status write
  -- landing mid-accept is either read fresh here or sees the pending row.
  PERFORM 1 FROM public.profiles WHERE user_id = auth.uid() FOR SHARE;

  -- Lock the job. Serializes against a concurrent poster cancel/reassign and
  -- against the expire_pending_direct_offers sweep.
  SELECT offered_to_helper_id, direct_offer_status, status, direct_offer_expires_at, customer_id
    INTO v_offered_to, v_offer_status, v_job_status, v_expires_at, v_customer
  FROM public.jobs
  WHERE id = p_job_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'job_not_found';
  END IF;

  -- Authorize on the OFFER, not on job ownership: the caller must be the
  -- helper this job was handed to.
  IF v_offered_to IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'not_your_offer';
  END IF;

  IF v_offer_status IS DISTINCT FROM 'pending' THEN
    RAISE EXCEPTION 'offer_not_pending';
  END IF;

  IF v_job_status IS DISTINCT FROM 'open' THEN
    RAISE EXCEPTION 'job_not_open';
  END IF;

  IF v_expires_at IS NOT NULL AND v_expires_at < v_now THEN
    RAISE EXCEPTION 'offer_expired';
  END IF;

  IF p_accept THEN
    -- Q345: no hire across a block, in either direction. The applications
    -- trigger (C10) would refuse the INSERT below anyway; naming it here gives
    -- the caller a code this RPC owns, and copy for it. Accept branch only:
    -- declining an offer across a block is still allowed.
    IF public.are_users_blocked(auth.uid(), v_customer) THEN
      RAISE EXCEPTION 'applicant_blocked' USING ERRCODE = '42501';
    END IF;

    -- Q1185 (re-review must-fix A, should-fix B): everything the deferred
    -- completion will check is checked now, so nobody is told "thanks" for an
    -- accept that can never complete.
    IF public.is_caller_banned() THEN
      RAISE EXCEPTION 'account_restricted' USING ERRCODE = '42501';
    END IF;
    v_block := public.direct_accept_block_reason(p_job_id, auth.uid());
    IF v_block = 'credential_tier_required' THEN
      RAISE EXCEPTION 'credential_tier_required' USING ERRCODE = '42501';
    ELSIF v_block = 'job_date_has_passed' THEN
      RAISE EXCEPTION 'job_date_has_passed' USING ERRCODE = '42501';
    ELSIF v_block = 'job_expired' THEN
      RAISE EXCEPTION 'job_expired' USING ERRCODE = '42501';
    ELSIF v_block = 'job_not_funded' THEN
      RAISE EXCEPTION 'job_not_funded' USING ERRCODE = '42501';
    ELSIF v_block = 'account_restricted' THEN
      RAISE EXCEPTION 'account_restricted' USING ERRCODE = '42501';
    ELSIF v_block IS NOT NULL THEN
      RAISE EXCEPTION 'offer_not_active';
    END IF;

    -- Q1185 (owner, 2026-10-03: "Same as a regular offer"): the accept needs
    -- payout setup and Stripe ID, as accept_job_offer's does. Unready, the
    -- direct offer stays exactly as it is (open, pending, on its own clock,
    -- the poster told nothing) and the yes is remembered in job_accept_pending;
    -- trg_profiles_complete_pending_accepts completes it once both are done.
    v_reason := public.helper_accept_block_reason(auth.uid());
    IF v_reason = 'helper_unknown' THEN
      RAISE EXCEPTION 'helper_unknown';
    END IF;
    IF v_reason IS NOT NULL THEN
      INSERT INTO public.job_accept_pending (job_id, helper_id)
      VALUES (p_job_id, auth.uid())
      ON CONFLICT (job_id) DO UPDATE
        SET helper_id = EXCLUDED.helper_id, requested_at = now()
        WHERE public.job_accept_pending.helper_id IS DISTINCT FROM EXCLUDED.helper_id;
      RETURN jsonb_build_object('action', 'pending_setup',
                                'missing', to_jsonb(public.helper_accept_missing(auth.uid())));
    END IF;

    -- Ready: the accept completes now, through the one completion both doors
    -- share (the poster is told "<name> accepted your offer"). NULL means it
    -- did not (the offer moved on between the check and the write): an error,
    -- never an answer the app shows as "Job accepted" (final review #4).
    v_done := public.complete_direct_offer_accept(p_job_id, auth.uid());
    IF v_done IS NULL THEN
      RAISE EXCEPTION 'offer_not_active';
    END IF;
    RETURN v_done;
  END IF;

  -- Decline: the offer closes, the job reopens to everyone. `offered_to_helper_id`
  -- is retained so the poster's own card can say who declined
  -- (activityStateLabel reads direct_offer_status = 'declined').
  UPDATE public.jobs
     SET direct_offer_status = 'declined',
         direct_offer_expires_at = NULL
   WHERE id = p_job_id;

  INSERT INTO public.notifications (user_id, title, message, type, link, job_id)
  SELECT customer_id,
         'Offer declined',
         -- Q2131: only a funded job is "open to everyone again".
         CASE WHEN public.job_payment_is_funded(payment_status) THEN
           'Your direct offer for "' || title || '" was declined. The job is open to everyone again.'
         ELSE
           'Your direct offer for "' || title || '" was declined.'
         END,
         'job_updates',
         '/posts?job=' || id::text,
         id
    FROM public.jobs
   WHERE id = p_job_id;

  RETURN jsonb_build_object('action', 'declined');
END;
$function$;
REVOKE ALL ON FUNCTION public.respond_to_direct_offer(uuid, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.respond_to_direct_offer(uuid, boolean) TO authenticated;

-- Q2131 (lh-money-escrow delta re-review of 25dc6611c, #1): the back-out
-- banner + email ("<Helpr> declined your offer ... It's open to everyone
-- again.") fired for an offer on an unfunded job too.
CREATE OR REPLACE FUNCTION public.record_backout_notice()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  v_kind text;
  v_recipient uuid;
  v_actor uuid;
  v_actor_name text;
  v_link text;
  v_text record;
BEGIN
  IF OLD.is_group_job IS TRUE OR OLD.parent_job_id IS NOT NULL THEN
    RETURN NULL;
  END IF;
  -- A10 (20261017073146): a setup job the Declutter seller's backing out
  -- cancelled is not the poster's cancel; declutter_refund_cancels_setup_jobs
  -- tells the Helpr itself, in the right words (lh-silent-failure review of
  -- c57d948d0 #2: this said "<poster> cancelled").
  IF COALESCE(current_setting('app.declutter_seller_fault_cancel', true), '') = 'on' THEN
    RETURN NULL;
  END IF;

  IF OLD.helper_id IS NOT NULL AND NEW.helper_id IS NULL
     AND OLD.status::text IN ('accepted', 'in_progress') AND NEW.status::text = 'open' THEN
    -- The booked (or offered) Helpr is off the job and it reopened.
    v_recipient := OLD.customer_id;
    v_actor := OLD.helper_id;
    v_kind := CASE
      WHEN COALESCE(current_setting('app.repost_unconfirmed', true), '') = '1' THEN 'helper_unconfirmed'
      WHEN OLD.helper_confirmed_at IS NOT NULL THEN 'helper_cancelled'
      WHEN auth.uid() IS NOT DISTINCT FROM OLD.helper_id THEN 'offer_declined'
      ELSE 'offer_expired' END;
  ELSIF OLD.direct_offer_status = 'pending' AND NEW.direct_offer_status IN ('declined', 'expired')
     AND OLD.offered_to_helper_id IS NOT NULL
     -- Q2131: "<Helpr> declined your offer ... open to everyone again" only
     -- about a funded job (the notification row says "was declined." alone).
     AND public.job_payment_is_funded(NEW.payment_status) THEN
    v_recipient := OLD.customer_id;
    v_actor := OLD.offered_to_helper_id;
    v_kind := CASE WHEN NEW.direct_offer_status = 'declined' THEN 'offer_declined' ELSE 'offer_expired' END;
  ELSIF NEW.status::text = 'cancelled' AND OLD.status::text IN ('accepted', 'in_progress')
     AND OLD.helper_id IS NOT NULL AND NEW.cancelled_by IS DISTINCT FROM OLD.helper_id THEN
    v_recipient := OLD.helper_id;
    v_actor := COALESCE(NEW.cancelled_by, OLD.customer_id);
    v_kind := 'poster_cancelled';
  ELSE
    RETURN NULL;
  END IF;

  IF v_recipient IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT NULLIF(split_part(btrim(p.full_name), ' ', 1), '') INTO v_actor_name
    FROM public.profiles p WHERE p.user_id = v_actor;

  INSERT INTO public.backout_notices (job_id, user_id, actor_name, backout_kind)
  VALUES (OLD.id, v_recipient, v_actor_name, v_kind);

  v_link := CASE WHEN v_recipient = OLD.customer_id THEN '/posts?job=' ELSE '/jobs?job=' END || OLD.id::text;
  SELECT * INTO v_text FROM public.backout_notice_text(v_kind, v_actor_name, OLD.title);
  PERFORM public.send_backout_email(v_recipient, OLD.id, v_text.title, v_text.message, v_link);
  RETURN NULL;
END;
$fn$;
REVOKE ALL ON FUNCTION public.record_backout_notice() FROM PUBLIC, anon, authenticated;
