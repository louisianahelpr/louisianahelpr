-- Q327: a permanent ban settles every live ONE-OFF job the account is on.
--
-- THE GAP (docs/OPEN.md Q327, found by the Q301 lh-money-escrow review,
-- 2026-09-23): a permanent ban wrote profiles.ban_status and nothing else.
-- admin-user-actions cancels pending applications only on the 3-strike
-- SUSPENSION rung; no SQL function that reads ban_status cancels, reopens or
-- refunds a job. A banned poster's funded jobs stayed live with applicants and
-- hired Helprs waiting on someone who can no longer act (the ban gate refuses
-- their writes), and a banned Helpr stayed hired, holding the poster's escrow
-- behind a person who will never show up.
--
-- THE RULE. When profiles.ban_status becomes 'banned' or 'permanently_banned'
-- (every writer: admin-user-actions set_ban_status / confirm_message_ban, a
-- manual SQL fix), settle_one_off_jobs_for_banned_account(user) decides each
-- job with ban_settlement_action(), a pure function of (seat, status,
-- payment_status, work started, crew, series). Every job_status value and
-- every jobs_payment_status_check value lands in a named bucket there, and the
-- ELSE is 'unhandled', which pages admins instead of guessing (class guard:
-- src/test/banSettlesOneOffJobs.test.ts; behaviour over every combination:
-- src/test/pglite/banSettlesOneOffJobs.pglite.mjs).
--
-- Each outcome reuses existing machinery; there is no new money path:
--
--   cancel_priced    POSTER banned, funded (escrow), no work started. Cancelled
--                    exactly as poster_cancel_job prices it (the same
--                    job_hours_until_start / cancellation_fee_percent ladder,
--                    committed = helper_confirmed_at, which void-cancelled-
--                    payments recomputes from the same job fields: F-MONEY-32).
--                    void-cancelled-payments then pays a committed Helpr their
--                    late fee and refunds the rest LESS max(service fee,
--                    Stripe's processing fee), so the platform never absorbs a
--                    fee (owner, Q407 (12)). No strike: the account is closed.
--   cancel_no_money  POSTER banned, nothing was ever paid (NULL/unpaid/
--                    abandoned/failed/cancelled). Cancelled with no fee: there
--                    is no money to price one from. An open checkout on it is
--                    expired by void-cancelled-payments Part B2.
--   reopen           HELPR banned, no work started (or nothing paid). The job
--                    goes back to open with the escrow untouched, the clean
--                    slate helper_cancel_booking / helper_abort_job Branch A
--                    leave. The banned Helpr's accepted application is rejected
--                    and helper_confirmed_at leaves with them, so no later
--                    cancel can price a fee for them.
--   hold_dispute     EITHER party banned, funded, work already started (arrived,
--                    Done, a proof photo, or a revision was asked for). Paying
--                    for work done is an owner question (docs/OPEN.md Q327), so
--                    this is the most conservative money-safe path: the
--                    platform files an ESCALATED dispute (helper_abort_job
--                    Branch B's device). auto-resolve-disputes never settles an
--                    escalated dispute and auto-release-payment never selects a
--                    disputed job, so nothing pays out automatically; the escrow
--                    stays held and an admin decides with the existing dispute
--                    tools. Neither party can withdraw a platform-filed dispute.
--   escalate_dispute Already disputed: the dispute is escalated, so the 72h
--                    timeout can no longer settle it for either side.
--   admin_review     Money already moving or moved on a live job (cancelling,
--                    payout_pending, released, refunded, chargeback), a crew (group jobs; flag off in prod), a
--                    finished job whose payout to the banned Helpr has not left
--                    yet, or a cancelled job whose fee to the banned Helpr may
--                    not be paid yet. Nothing changes automatically (any
--                    automatic move could pay twice); every admin gets an
--                    admin_alert naming the job.
--   none_finished /  Finished, or already cancelled with nothing owed to the
--   none_settling    banned account: nothing to do.
--   series_lane      A recurring series or one of its visits: owned by
--                    end_series_for_banned_account (the recurring lane). Not
--                    touched here.
--
-- Pending applications from the banned account are closed silently
-- (closed_reason 'party_blocked': notify_on_application sends nothing, as for
-- a block; a ban bars the account from dealing with everyone). A pending
-- direct offer to the banned account is declined and its poster told the job
-- is open again. Applicants on a cancelled job are told by the existing
-- close-pending-applications trigger (20260923205811).
--
-- The other party is told in role-neutral copy; the banned account is never
-- notified here (its account notice is admin-user-actions'). A TEMPORARY ban
-- does not fire this (docs/OPEN.md Q327 carries that as an owner question for
-- one-off jobs; the recurring lane pauses series).
--
-- SAFETY: a ban must never fail because a job could not be settled. Each job
-- is settled in its own subtransaction; an error rolls back only that job and
-- pages admins with the error. The function runs inside whoever wrote the ban
-- (in practice the service role: admin-user-actions; every consequence
-- ladder's permanent rung requires review) and is service_role-callable to
-- re-run by hand; a second run finds nothing live and changes nothing.
--
-- REPLAY-SAFE: CREATE OR REPLACE, DROP TRIGGER IF EXISTS, guarded on
-- public.profiles existing. Runs 3x clean (PGlite).

CREATE OR REPLACE FUNCTION public.ban_settlement_action(
  p_seat text,              -- 'poster' | 'helpr'
  p_status text,            -- jobs.status
  p_payment_status text,    -- jobs.payment_status (NULL = never paid)
  p_work_started boolean,
  p_is_crew boolean,
  p_is_series boolean
)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path TO ''
AS $fn$
  SELECT CASE
    WHEN p_is_series THEN 'series_lane'
    WHEN p_seat IS NULL OR p_seat NOT IN ('poster', 'helpr') THEN 'unhandled'
    -- The money buckets. Every jobs_payment_status_check value is in exactly
    -- one of NO_MONEY / HELD / MOVING; any other value is 'unhandled'.
    WHEN NOT (COALESCE(p_payment_status, 'unpaid') IN ('unpaid', 'abandoned', 'failed', 'cancelled')        -- NO_MONEY
              OR p_payment_status IN ('escrow')                                                              -- HELD
              OR p_payment_status IN ('cancelling', 'payout_pending', 'released', 'refunded',
                                      'chargeback'))                                                         -- MOVING
      THEN 'unhandled'
    WHEN p_status = 'disputed' THEN 'escalate_dispute'
    WHEN p_status = 'completed' THEN
      CASE WHEN p_seat = 'helpr' AND p_payment_status IN ('escrow', 'payout_pending')
           THEN 'admin_review' ELSE 'none_finished' END
    WHEN p_status = 'cancelled' THEN
      CASE WHEN p_seat = 'helpr' AND p_payment_status = 'escrow'
           THEN 'admin_review' ELSE 'none_settling' END
    WHEN p_status IN ('open', 'pending_approval', 'accepted', 'in_progress', 'revision_requested') THEN
      CASE
        WHEN COALESCE(p_is_crew, false) THEN 'admin_review'
        WHEN p_payment_status IN ('cancelling', 'payout_pending', 'released', 'refunded',
                                  'chargeback') THEN 'admin_review'
        WHEN p_payment_status = 'escrow' AND COALESCE(p_work_started, false)
             AND p_status IN ('accepted', 'in_progress', 'revision_requested') THEN 'hold_dispute'
        WHEN p_seat = 'poster' THEN
          CASE WHEN p_payment_status = 'escrow' THEN 'cancel_priced' ELSE 'cancel_no_money' END
        -- helpr: enforce_job_status_transition has no edge from
        -- pending_approval or revision_requested to open, and neither holds a
        -- Helpr with no work and no money in practice, so a person looks.
        WHEN p_status IN ('pending_approval', 'revision_requested') THEN 'admin_review'
        ELSE 'reopen'
      END
    ELSE 'unhandled'
  END
$fn$;

REVOKE ALL ON FUNCTION public.ban_settlement_action(text, text, text, boolean, boolean, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ban_settlement_action(text, text, text, boolean, boolean, boolean) TO service_role;

CREATE OR REPLACE FUNCTION public.settle_one_off_jobs_for_banned_account(p_user uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
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
           j.budget, j.date_needed, j.start_time, j.helper_confirmed_at, j.helper_fee_percent,
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
          v_cut := GREATEST(0, round((v_fee - round(v_fee * COALESCE(v_job.helper_fee_percent, 10)) / 100.0) * 100) / 100.0);
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
          INSERT INTO public.notifications (user_id, title, message, type, link, job_id)
          VALUES (
            v_job.offered_to_helper_id,
            'Offer closed',
            format('"%s" was cancelled because %s, so its offer is closed.', v_title, v_gone),
            'warning',
            '/jobs?job=' || v_job.id::text,
            v_job.id
          );
        END IF;

      ELSIF v_action = 'reopen' THEN
        UPDATE public.applications
           SET status = 'rejected'
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
        v_admin_note := format('an account on it was banned and it could not be settled automatically (status %s, payment %s%s). Nothing was changed.',
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
      INSERT INTO public.notifications (user_id, title, message, type, link, job_id)
      SELECT r.user_id,
             'Banned account: job needs a decision',
             format('"%s": %s', v_title, v_admin_note),
             'admin_alert',
             '/admin?view=jobs&job=' || v_job.id::text,
             v_job.id
        FROM public.user_roles r
       WHERE r.role = 'admin';
    END IF;

    -- Only what this run did (or could not do) is reported; a job with
    -- nothing to settle is not, so a re-run reports nothing.
    IF v_action NOT LIKE 'none%' AND v_action <> 'series_lane' THEN
      v_out := v_out || jsonb_build_object('job_id', v_job.id, 'seat', v_seat, 'action', v_action, 'cancellation_fee', v_fee);
    END IF;
  END LOOP;

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
    SELECT j.id, j.title, j.customer_id
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
          format('The person you offered "%s" to can no longer use Louisiana Helpr, so the offer is closed and the job is open to everyone again.',
                 COALESCE(v_job.title, 'your job')),
          'warning',
          '/posts?job=' || v_job.id::text,
          v_job.id
        );
      END IF;
    END IF;
  END LOOP;

  PERFORM set_config('app.trusted_ladder_write', COALESCE(v_ladder_flag, 'off'), true);

  RETURN jsonb_build_object(
    'settled', v_out,
    'closed_applications', v_closed_apps,
    'closed_offers', v_closed_offers
  );
END;
$fn$;

REVOKE ALL ON FUNCTION public.settle_one_off_jobs_for_banned_account(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.settle_one_off_jobs_for_banned_account(uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.settle_one_off_jobs_on_permanent_ban()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
BEGIN
  PERFORM public.settle_one_off_jobs_for_banned_account(NEW.user_id);
  RETURN NULL;
END;
$fn$;

REVOKE ALL ON FUNCTION public.settle_one_off_jobs_on_permanent_ban() FROM PUBLIC, anon, authenticated;

DO $trg$
BEGIN
  IF to_regclass('public.profiles') IS NULL THEN
    RAISE NOTICE 'profiles absent: skipped';
    RETURN;
  END IF;
  DROP TRIGGER IF EXISTS trg_settle_one_off_jobs_on_permanent_ban ON public.profiles;
  CREATE TRIGGER trg_settle_one_off_jobs_on_permanent_ban
    AFTER UPDATE OF ban_status ON public.profiles
    FOR EACH ROW
    WHEN (NEW.ban_status IN ('banned', 'permanently_banned')
          AND OLD.ban_status IS DISTINCT FROM NEW.ban_status)
    EXECUTE FUNCTION public.settle_one_off_jobs_on_permanent_ban();
END
$trg$;
