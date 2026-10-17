-- Q1840 (lh-money-escrow review of 032657f02, should-fix 2): the SQL money
-- notices and the earnings export priced a flat-model job (jobs fee model F3,
-- owner 2026-10-14/15: the Helpr pays 5% + $0.70 of their pay, stamped on the
-- job as helper_fee_flat_cents at funding) at the tier percent alone, so a
-- flat job's "about $X" was 70c too high and an export row with no payout
-- ledger showed the wrong fee. Every one now decides by the job's STAMP, the
-- same rule the payout paths use (_shared/helprFlatFee.ts helprFlatFeeCents):
--
--   * public.helpr_flat_fee_cents(share_cents, percent, flat_cents): that rule
--     in SQL (5% of the share rounded to the cent, plus the fixed 70c, never
--     more than the share; a NULL percent reads as 5 and a NULL flat as 70,
--     as the TS does). Pure math; EXECUTE for service_role only (its callers
--     below are SECURITY DEFINER, owned by postgres).
--   * poster_cancel_job: the crew loop and the solo notice price a flat job's
--     cancellation fee as void-cancelled-payments does (5% + 70c of each
--     member's share / of the fee).
--   * settle_one_off_jobs_for_banned_account: the same on its late-cancel
--     notice.
--   * get_helper_earnings_export: the no-ledger fallback on a flat job prices
--     budget + urgent bonus (F3b) at 5% + 70c; ledger rows are unchanged.
--   * get_helper_analytics: both the jobs list and the not-entitled preview
--     carry helper_fee_flat_cents, so helperPlatformFeeDollars (the client)
--     prices a flat job at its stamp. jsonb, so no signature change.
--
-- A legacy job (stamp NULL) keeps every old expression byte for byte. Like the
-- old notices, the "about $X" is not floored to the whole dollar the transfer
-- pays (unchanged behaviour for both models).
--
-- Bodies copied from the newest definitions, each md5-equal to live prosrc
-- (prod, 2026-10-17): poster_cancel_job 20260925154606 (b1aac189...),
-- settle_one_off_jobs_for_banned_account 20261006030849 (e8e6bb1f...),
-- get_helper_earnings_export 20261012175545 (10d5e080...),
-- get_helper_analytics 20260907194734 (82f52968...). Only the lines marked
-- Q1840 changed, plus the stamp column added to the v_job SELECTs
-- (poster_cancel_job, settle_one_off_jobs_for_banned_account) and to the
-- analytics jobs list and preview. REPLAY-SAFE: CREATE OR REPLACE throughout, grants restated
-- equal to live proacl; the COMMENT on get_helper_analytics is kept by
-- CREATE OR REPLACE.

CREATE OR REPLACE FUNCTION public.helpr_flat_fee_cents(p_share_cents numeric, p_percent numeric, p_flat_cents numeric)
 RETURNS bigint
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public'
AS $function$
  SELECT (CASE
    WHEN s.share = 0 THEN 0
    ELSE LEAST(s.share, round(s.share * COALESCE(p_percent, 5) / 100.0) + GREATEST(0, round(COALESCE(p_flat_cents, 70))))
  END)::bigint
  FROM (SELECT GREATEST(0, round(COALESCE(p_share_cents, 0))) AS share) s
$function$;

REVOKE ALL ON FUNCTION public.helpr_flat_fee_cents(numeric, numeric, numeric) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.helpr_flat_fee_cents(numeric, numeric, numeric) TO service_role;

CREATE OR REPLACE FUNCTION public.poster_cancel_job(p_job_id uuid, p_reason text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_job record;
  v_reason text;
  v_hours numeric;
  v_percent int;
  v_fee numeric;
  v_late boolean;
  v_committed boolean;
  v_commission numeric;
  v_helper_cut numeric;
  v_crew boolean;
  v_needed int;
  v_share record;
  v_verdict jsonb := jsonb_build_object('action', 'none', 'prior_count', 0);
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;

  v_reason := left(NULLIF(btrim(COALESCE(p_reason, '')), ''), 1000);

  SELECT j.id, j.title, j.budget, j.date_needed, j.start_time, j.customer_id, j.helper_id,
         j.status, j.helper_fee_percent, j.helper_fee_flat_cents, j.helper_confirmed_at,
         j.helper_completed_at, j.is_group_job, j.helpers_needed
    INTO v_job
    FROM public.jobs j
   WHERE j.id = p_job_id
   FOR UPDATE;

  IF v_job.id IS NULL THEN
    RAISE EXCEPTION 'job_not_found';
  END IF;

  -- The server owns the decision. A helper (or any third party) hitting this
  -- gets not_authorized rather than a partial write.
  IF v_job.customer_id IS DISTINCT FROM v_uid THEN
    RAISE EXCEPTION 'not_authorized';
  END IF;

  -- Deliberately NOT 'pending_approval': enforce_job_status_transition has no
  -- pending_approval -> cancelled edge for a non-admin, so offering it here
  -- would promise an exit the very next trigger rejects. That draft is
  -- withdrawn through reject_pending_job, which is the business-approval path.
  -- 'disputed' is excluded too: escrow must not move while a human is deciding.
  IF v_job.status::text NOT IN ('open', 'accepted', 'in_progress', 'revision_requested') THEN
    RAISE EXCEPTION 'not_cancellable'
      USING HINT = 'This job is already finished, cancelled, or under dispute.';
  END IF;

  -- ADDED 2026-09-14: a job the Helpr has marked DONE is not cancellable.
  -- From here the poster's moves are approve, ask for a change, or dispute —
  -- never a cancel that refunds the escrow and pays a cancellation fee for
  -- finished work. No poster screen offers Cancel once work is underway
  -- (derivePosterStep renders no Cancel for in_progress/revision_requested),
  -- so the only way here was a stale screen racing the Helpr's Done. Read under
  -- the FOR UPDATE above: a Done that committed first is seen here, and a Done
  -- queued behind this lock is refused by trg_completion_on_live_job.
  IF v_job.helper_completed_at IS NOT NULL THEN
    RAISE EXCEPTION 'not_cancellable'
      USING HINT = 'Your Helpr already marked this job done. Approve it, ask for a change, or open a dispute.';
  END IF;

  -- ADDED 2026-09-25 (Q407): a crew has no lead. Its hired members are the
  -- roster rows that still name a Helpr, every one of them equal.
  v_crew := v_job.is_group_job IS TRUE;
  IF v_crew THEN
    -- Lock the crew so a member's Done or departure cannot land between the
    -- reads below and the ledger rows they price.
    PERFORM 1 FROM public.group_job_helpers g WHERE g.job_id = v_job.id FOR UPDATE;
    -- The same rule as the single job's Done, per member: once anyone on the
    -- crew has finished their part, the poster's moves are approve or dispute.
    IF EXISTS (
      SELECT 1 FROM public.group_job_helpers g
       WHERE g.job_id = v_job.id AND g.helper_completed_at IS NOT NULL
    ) THEN
      RAISE EXCEPTION 'not_cancellable'
        USING HINT = 'A Helpr on this crew already marked their part done. Approve it, ask for a change, or open a dispute.';
    END IF;
    -- The owner rule decides whether a hired member who never confirmed
    -- counts (crew_fee_pays_unconfirmed, default true: every hired member).
    v_committed := EXISTS (
      SELECT 1 FROM public.group_job_helpers g
       WHERE g.job_id = v_job.id
         AND g.helper_id IS NOT NULL
         AND (public.crew_fee_pays_unconfirmed() OR g.helper_confirmed_at IS NOT NULL)
    );
  ELSE
    -- ADDED 2026-09-08: the one question both the fee and the strike turn on.
    -- Chosen is not committed; see this migration's header.
    v_committed := v_job.helper_id IS NOT NULL AND v_job.helper_confirmed_at IS NOT NULL;
  END IF;

  -- The fee is DERIVED here, never accepted from the caller — same ladder
  -- void-cancelled-payments recomputes from, so the persisted row and the money
  -- that moves can no longer disagree.
  -- CHANGED 2026-09-05: now anchored on the job's START TIME, not midnight of
  -- its day. See that migration's header for the 41-hours-reads-as-23 case.
  v_hours   := public.job_hours_until_start(v_job.date_needed, v_job.start_time, now());
  v_percent := public.cancellation_fee_percent(v_committed, v_hours);

  IF v_crew THEN
    -- One share per hired member: that member's frozen slice of the budget
    -- (group_job_helpers.share_cents, largest remainder at hire) on the same
    -- ladder as a single booking. _shared/crewShares.ts crewMemberFeeCents()
    -- is the same formula, cent for cent. A roster row from before the slots
    -- existed is priced on its would-be slot share in hire order.
    v_needed := GREATEST(COALESCE(v_job.helpers_needed, 1), 1);
    INSERT INTO public.crew_cancellation_fee_shares
      (job_id, helper_id, committed, share_basis_cents, fee_percent, share_amount)
    SELECT v_job.id, m.helper_id, m.committed, m.basis, m.pct,
           round(m.basis * m.pct / 100.0) / 100.0
      FROM (
        SELECT g.helper_id,
               (public.crew_fee_pays_unconfirmed() OR g.helper_confirmed_at IS NOT NULL) AS committed,
               COALESCE(g.share_cents,
                        public.crew_slot_share_cents(round(COALESCE(v_job.budget, 0) * 100)::bigint, v_needed,
                          (row_number() OVER (ORDER BY g.joined_at NULLS LAST, g.id) - 1)::integer)) AS basis,
               public.cancellation_fee_percent(public.crew_fee_pays_unconfirmed() OR g.helper_confirmed_at IS NOT NULL, v_hours) AS pct
          FROM public.group_job_helpers g
         WHERE g.job_id = v_job.id
           AND g.helper_id IS NOT NULL
      ) m
    ON CONFLICT (job_id, helper_id) DO NOTHING;

    SELECT COALESCE(sum(s.share_amount), 0) INTO v_fee
      FROM public.crew_cancellation_fee_shares s
     WHERE s.job_id = v_job.id;

    -- Never more than the budget the escrow holds (the shares' bases add up to
    -- at most the budget and the ladder tops out at 50%, so this is a tripwire
    -- for a corrupted share, not a rule that normally bites).
    IF round(v_fee * 100) > round(COALESCE(v_job.budget, 0) * 100) THEN
      RAISE EXCEPTION 'crew_fee_exceeds_budget: the crew''s cancellation fee % is more than the budget % (job_id=%)', v_fee, v_job.budget, v_job.id
        USING ERRCODE = 'check_violation';
    END IF;
  ELSE
    v_fee := CASE
      WHEN COALESCE(v_job.budget, 0) > 0 AND v_percent > 0
        THEN round(v_job.budget * v_percent) / 100.0
      ELSE 0
    END;
  END IF;
  -- CHANGED 2026-08-26: was `v_hours < 24 AND v_hours > 0`, which called a
  -- post-start cancellation "not late" while charging it the top 50% tier.
  v_late := public.is_late_cancellation(v_committed, v_hours);

  PERFORM set_config('app.sanctioned_cancel', 'on', true);

  UPDATE public.jobs
     SET status = 'cancelled'::job_status,
         cancelled_by = v_uid,
         cancelled_at = now(),
         cancellation_reason = v_reason,
         late_cancellation = v_late,
         cancellation_fee = v_fee,
         cancellation_fee_status = CASE WHEN v_fee > 0 THEN 'pending' ELSE NULL END
   WHERE id = v_job.id;

  PERFORM set_config('app.sanctioned_cancel', 'off', true);

  v_commission := COALESCE(v_job.helper_fee_percent, 10);

  IF v_crew THEN
    -- Every hired member hears about THEIR share, and nobody else's.
    FOR v_share IN
      SELECT s.helper_id, s.share_amount, s.fee_percent, s.committed
        FROM public.crew_cancellation_fee_shares s
       WHERE s.job_id = v_job.id AND s.helper_id IS NOT NULL
    LOOP
      -- Q1840: a flat-model job (F3) keeps 5% + 70c of EACH member's share,
      -- as void-cancelled-payments' crew path does; a legacy job keeps the
      -- tier percent.
      v_helper_cut := CASE WHEN v_job.helper_fee_flat_cents IS NOT NULL
        THEN GREATEST(0, round(v_share.share_amount * 100)
               - public.helpr_flat_fee_cents(round(v_share.share_amount * 100), v_job.helper_fee_percent, v_job.helper_fee_flat_cents)) / 100.0
        ELSE GREATEST(0, round((v_share.share_amount - round(v_share.share_amount * v_commission) / 100.0) * 100) / 100.0)
      END;
      INSERT INTO public.notifications (user_id, title, message, type, link, job_id)
      VALUES (
        v_share.helper_id,
        CASE WHEN v_share.share_amount > 0 THEN 'Job cancelled — you''ll be compensated' ELSE 'Job cancelled' END,
        CASE
          WHEN v_share.share_amount > 0 THEN
            format('"%s" was cancelled by the person who posted it. Your share of the cancellation fee is about $%s (%s%% of your part of the budget, minus the platform fee), processed within the hour.',
                   COALESCE(v_job.title, 'A job'),
                   to_char(v_helper_cut, 'FM999999990.00'),
                   v_share.fee_percent)
          WHEN NOT v_share.committed THEN
            format('"%s" was cancelled by the person who posted it before you confirmed your spot, so no cancellation fee applies.',
                   COALESCE(v_job.title, 'A job'))
          ELSE
            format('"%s" was cancelled by the person who posted it. It was more than 24 hours out, so no cancellation fee applies.',
                   COALESCE(v_job.title, 'A job'))
        END,
        CASE WHEN v_share.share_amount > 0 THEN 'payment' ELSE 'warning' END,
        '/jobs?job=' || v_job.id::text,
        v_job.id
      );
    END LOOP;
  ELSIF v_job.helper_id IS NOT NULL THEN
    -- Tell the Helpr what happened to their money. This used to be a separate
    -- client-side createNotification() that a cancelling client could skip.
    -- Still sent to a merely-offered Helpr: they were waiting on this job and
    -- deserve to know it is gone — but with copy that does not promise a fee.
    -- Q1840: a flat-model job (F3) keeps 5% + 70c of the fee, exactly as
    -- void-cancelled-payments prices it; a legacy job keeps the tier percent.
    v_helper_cut := CASE WHEN v_job.helper_fee_flat_cents IS NOT NULL
      THEN GREATEST(0, round(v_fee * 100)
             - public.helpr_flat_fee_cents(round(v_fee * 100), v_job.helper_fee_percent, v_job.helper_fee_flat_cents)) / 100.0
      ELSE GREATEST(0, round((v_fee - round(v_fee * v_commission) / 100.0) * 100) / 100.0)
    END;

    INSERT INTO public.notifications (user_id, title, message, type, link)
    VALUES (
      v_job.helper_id,
      CASE WHEN v_fee > 0 THEN 'Job cancelled — you''ll be compensated' ELSE 'Job cancelled' END,
      CASE
        WHEN v_fee > 0 THEN
          format('"%s" was cancelled by the person who posted it. You''ll receive approximately $%s as a cancellation fee (%s%% of the budget minus platform fee), processed within the hour.',
                 COALESCE(v_job.title, 'A job'),
                 to_char(v_helper_cut, 'FM999999990.00'),
                 v_percent)
        WHEN NOT v_committed THEN
          -- The old copy claimed "it was more than 24 hours out", which is
          -- simply false when the reason for the $0 is that this offer was
          -- never accepted.
          format('"%s" was cancelled by the person who posted it before you accepted it, so no cancellation fee applies.',
                 COALESCE(v_job.title, 'A job'))
        ELSE
          format('"%s" was cancelled by the person who posted it. It was more than 24 hours out, so no cancellation fee applies.',
                 COALESCE(v_job.title, 'A job'))
      END,
      CASE WHEN v_fee > 0 THEN 'payment' ELSE 'warning' END,
      '/jobs?job=' || v_job.id::text
    );
  END IF;

  -- THE LADDER, in the same transaction as the state change. Idempotent on
  -- (user, 'cancel_with_helper', job_id), so one cancelled job is one strike
  -- however many times this is retried. A crew is ONE booking: one strike.
  -- CHANGED 2026-09-08: gated on v_committed, not on helper_id alone.
  IF v_committed THEN
    v_verdict := public.apply_cancellation_violation_consequence(v_job.id);
  END IF;

  RETURN v_verdict || jsonb_build_object(
    'cancellation_fee', v_fee,
    'fee_percent', v_percent,
    'late_cancellation', v_late,
    -- Kept under its original key so existing callers keep parsing, but it now
    -- answers the question the callers were always really asking.
    'had_helper', v_committed,
    'helper_committed', v_committed
  );
END;
$function$;
REVOKE ALL ON FUNCTION public.poster_cancel_job(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.poster_cancel_job(uuid, text) TO authenticated, service_role;

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

CREATE OR REPLACE FUNCTION public.get_helper_earnings_export(
  _helper_id uuid,
  _start_date date,
  _end_date date
)
RETURNS TABLE (
  job_id uuid,
  date_completed date,
  job_title text,
  category text,
  parish text,
  tax_status text,
  gross_budget numeric,
  platform_fee numeric,
  parish_tax_collected numeric,
  net_payout numeric
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
BEGIN
  IF auth.uid() IS DISTINCT FROM _helper_id AND NOT COALESCE(has_role(auth.uid(), 'admin'::app_role), false) THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  RETURN QUERY
  SELECT x.* FROM (
    SELECT
      j.id AS job_id,
      COALESCE(j.poster_completed_at::date, j.helper_completed_at::date, j.updated_at::date) AS date_completed,
      j.title AS job_title,
      j.category::text AS category,
      COALESCE(j.parish, 'Unknown') AS parish,
      CASE WHEN public.is_category_taxable(j.category) THEN 'Taxable' ELSE 'Exempt' END AS tax_status,
      -- Q1840: a row with no ledger on a flat-model job (F3) is priced the
      -- way its payout is: 5% + 70c of budget + urgent bonus (the bonus is
      -- part of the job price, F3b). A legacy row is unchanged.
      CASE WHEN pt.ledger_rows > 0
           THEN ROUND((COALESCE(pt.paid_cents, 0) + COALESCE(pt.fee_cents, 0)) / 100.0, 2)
           WHEN j.helper_fee_flat_cents IS NOT NULL
           THEN ROUND(fl.gross_cents / 100.0, 2)
           ELSE j.budget END AS gross_budget,
      CASE WHEN pt.ledger_rows > 0
           THEN ROUND(COALESCE(pt.fee_cents, 0) / 100.0, 2)
           WHEN j.helper_fee_flat_cents IS NOT NULL
           THEN ROUND(fl.fee_cents / 100.0, 2)
           ELSE ROUND(j.budget * COALESCE(j.helper_fee_percent, 10) / 100.0, 2) END AS platform_fee,
      COALESCE(j.sales_tax_amount, 0) AS parish_tax_collected,
      CASE WHEN pt.ledger_rows > 0
           THEN ROUND(COALESCE(pt.paid_cents, 0) / 100.0, 2)
           WHEN j.helper_fee_flat_cents IS NOT NULL
           THEN ROUND((fl.gross_cents - fl.fee_cents) / 100.0, 2)
           ELSE ROUND(j.budget - (j.budget * COALESCE(j.helper_fee_percent, 10) / 100.0), 2) END AS net_payout
    FROM public.jobs j
    LEFT JOIN LATERAL (
      SELECT
        -- What the Helpr KEPT: a paid row in full; a reversed row less the
        -- part Stripe took back (transferReversed.ts flips the whole row to
        -- 'reversed' even for a partial reversal and records the amount in
        -- metadata.amount_reversed_cents; a won dispute re-pays that part as
        -- its own 'paid' row). No recorded amount reads as fully reversed.
        SUM(CASE WHEN p.status = 'paid' THEN p.amount_cents
                 WHEN p.status = 'reversed' THEN GREATEST(0, p.amount_cents
                      - COALESCE((p.metadata->>'amount_reversed_cents')::bigint, p.amount_cents)) END) AS paid_cents,
        -- The fee on what was kept: a reversed row's fee pro-rated the same way.
        -- Plus what the payout WITHHELD and never sent (Q1520): a first
        -- payout's one-time onboarding fee and the sub-dollar remainder of
        -- rounding the payout down to whole dollars, recorded on the row's
        -- metadata by the payout paths. Counted in full on a reversed row
        -- too (see the header: a re-pay row carries none, so no double count).
        SUM(CASE WHEN p.status = 'paid' THEN COALESCE(p.platform_fee_cents, 0)
                 WHEN p.status = 'reversed' AND p.amount_cents > 0 THEN ROUND(COALESCE(p.platform_fee_cents, 0)::numeric
                      * GREATEST(0, p.amount_cents - COALESCE((p.metadata->>'amount_reversed_cents')::bigint, p.amount_cents))
                      / p.amount_cents) ELSE 0 END
            + CASE WHEN p.status IN ('paid', 'reversed')
                   THEN GREATEST(0, COALESCE((p.metadata->>'onboarding_fee_cents')::bigint, 0))
                        + GREATEST(0, COALESCE((p.metadata->>'rounding_remainder_cents')::bigint, 0))
                   ELSE 0 END) AS fee_cents,
        COUNT(*) AS ledger_rows
      FROM public.payout_transfers p
      WHERE p.job_id = j.id AND p.helper_id = _helper_id
    ) pt ON true
    CROSS JOIN LATERAL (
      SELECT g0.gross_cents,
             public.helpr_flat_fee_cents(g0.gross_cents, j.helper_fee_percent, j.helper_fee_flat_cents) AS fee_cents
        FROM (SELECT round(COALESCE(j.budget, 0) * 100)
                     + GREATEST(0, round(COALESCE(j.urgent_fee, 0) * 100)) AS gross_cents) g0
    ) fl
    WHERE j.helper_id = _helper_id
      -- A crew's members are the half below (a legacy crew lead in helper_id
      -- would otherwise be listed twice off the same ledger rows).
      AND j.is_group_job IS NOT TRUE
      AND j.status = 'completed'
      AND j.payment_status = 'released'
    UNION ALL
    -- A crew member's share: only once the payout ledger shows it PAID to them
    -- (a crew pays member by member; a refunded member has no paid row).
    SELECT
      j.id,
      COALESCE(j.poster_completed_at::date, g.poster_confirmed_completion_at::date,
               g.helper_completed_at::date, j.updated_at::date),
      j.title,
      j.category::text,
      COALESCE(j.parish, 'Unknown'),
      CASE WHEN public.is_category_taxable(j.category) THEN 'Taxable' ELSE 'Exempt' END,
      ROUND((pt.paid_cents + pt.fee_cents) / 100.0, 2),
      ROUND(pt.fee_cents / 100.0, 2),
      -- The job's tax, in the same proportion as this member's budget share.
      COALESCE(ROUND(COALESCE(j.sales_tax_amount, 0) * COALESCE(g.share_cents, 0)
            / NULLIF(ROUND(COALESCE(j.budget, 0) * 100), 0), 2), 0),
      ROUND(pt.paid_cents / 100.0, 2)
    FROM public.group_job_helpers g
    JOIN public.jobs j ON j.id = g.job_id AND j.is_group_job IS TRUE AND j.status = 'completed'
    JOIN LATERAL (
      SELECT
        -- What the Helpr KEPT: a paid row in full; a reversed row less the
        -- part Stripe took back (transferReversed.ts flips the whole row to
        -- 'reversed' even for a partial reversal and records the amount in
        -- metadata.amount_reversed_cents; a won dispute re-pays that part as
        -- its own 'paid' row). No recorded amount reads as fully reversed.
        SUM(CASE WHEN p.status = 'paid' THEN p.amount_cents
                 WHEN p.status = 'reversed' THEN GREATEST(0, p.amount_cents
                      - COALESCE((p.metadata->>'amount_reversed_cents')::bigint, p.amount_cents)) END) AS paid_cents,
        -- The fee on what was kept: a reversed row's fee pro-rated the same way.
        -- Plus what the payout WITHHELD and never sent (Q1520): a first
        -- payout's one-time onboarding fee and the sub-dollar remainder of
        -- rounding the payout down to whole dollars, recorded on the row's
        -- metadata by the payout paths. Counted in full on a reversed row
        -- too (see the header: a re-pay row carries none, so no double count).
        SUM(CASE WHEN p.status = 'paid' THEN COALESCE(p.platform_fee_cents, 0)
                 WHEN p.status = 'reversed' AND p.amount_cents > 0 THEN ROUND(COALESCE(p.platform_fee_cents, 0)::numeric
                      * GREATEST(0, p.amount_cents - COALESCE((p.metadata->>'amount_reversed_cents')::bigint, p.amount_cents))
                      / p.amount_cents) ELSE 0 END
            + CASE WHEN p.status IN ('paid', 'reversed')
                   THEN GREATEST(0, COALESCE((p.metadata->>'onboarding_fee_cents')::bigint, 0))
                        + GREATEST(0, COALESCE((p.metadata->>'rounding_remainder_cents')::bigint, 0))
                   ELSE 0 END) AS fee_cents,
        COUNT(*) AS ledger_rows
      FROM public.payout_transfers p
      WHERE p.job_id = j.id AND p.helper_id = g.helper_id
    ) pt ON pt.paid_cents > 0
    WHERE g.helper_id = _helper_id
  ) x
  WHERE x.date_completed BETWEEN _start_date AND _end_date
  ORDER BY x.date_completed DESC;
END;
$fn$;
REVOKE ALL ON FUNCTION public.get_helper_earnings_export(uuid, date, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_helper_earnings_export(uuid, date, date) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.get_helper_analytics(p_days integer DEFAULT 365)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  -- The subject is always the caller. No id parameter exists, so there is
  -- nothing to forge.
  v_uid          uuid := auth.uid();
  v_tier         text;
  v_entitled     boolean;
  -- Clamped: 30 days is the shortest window any panel can say something true
  -- about, 730 keeps the scan bounded.
  v_days         integer := LEAST(GREATEST(COALESCE(p_days, 365), 30), 730);
  v_since        timestamptz;
  -- The market window is fixed at 180 days and deliberately NOT the caller's
  -- window: "when do jobs get posted" is a property of the marketplace, not of
  -- the slider the helper happens to have dragged.
  v_market_days  constant integer := 180;
  v_market_since timestamptz;   -- := now() - v_market_days, set in the body
  v_parishes     text[];
  v_scope        text;

  -- Sample floors. Returned in the payload so the client applies the SAME
  -- numbers to the rows it aggregates itself.
  c_min_category_jobs        constant integer := 3;
  c_min_decided_apps         constant integer := 5;
  c_min_apps                 constant integer := 3;
  c_min_head_to_head         constant integer := 3;
  c_min_market_jobs          constant integer := 20;
  c_min_market_category_jobs constant integer := 5;

  v_jobs         jsonb;
  v_apps         jsonb;
  v_h2h          jsonb;
  v_demand       jsonb;
  v_rates        jsonb;
  v_market_n     integer;
  v_floors       jsonb;
BEGIN
  -- Derived from the constant the payload ADVERTISES, not from a second copy of
  -- the number. The two were separate literals for one draft, which is all it
  -- takes for the page to name a window it did not scan.
  v_market_since := now() - make_interval(days => v_market_days);

  v_floors := jsonb_build_object(
    'category_jobs',        c_min_category_jobs,
    'decided_applications', c_min_decided_apps,
    'applications',         c_min_apps,
    'head_to_head',         c_min_head_to_head,
    'market_jobs',          c_min_market_jobs,
    'market_category_jobs', c_min_market_category_jobs
  );

  IF v_uid IS NULL THEN
    -- Signed out / torn session. Deliberately the ONLY branch that omits
    -- `preview`, and the client keys off exactly that: an absent `preview`
    -- means "we could not identify you", while `preview.jobs = []` means "we
    -- looked and you have no completed jobs". Returning an empty preview here
    -- instead would have the page tell a ten-year helper they had never
    -- finished a job. Not an error, either — the route sits behind
    -- ProtectedRoute, so this is a stale-session render, not a crash.
    RETURN jsonb_build_object(
      'generated_at', now(),
      'window_days',  v_days,
      'tier',         NULL,
      'entitled',     false,
      'floors',       v_floors
    );
  END IF;

  SELECT p.subscription_tier INTO v_tier
  FROM public.profiles p WHERE p.user_id = v_uid LIMIT 1;

  v_entitled := public.helper_has_advanced_analytics(v_uid);
  v_since := now() - make_interval(days => v_days);

  -- ── The caller's completed helper jobs ───────────────────────────────────
  -- `status = 'completed'` matches what EarningsTab aggregates
  -- (Profile.tsx: `earningsJobs.filter(j => j.status === "completed")`), so
  -- the two screens count the same jobs.
  --
  -- THE GROUP-JOB ROSTER IS PART OF THAT, and it is the one place where these
  -- two surfaces used to disagree. Only ONE member is written to
  -- `jobs.helper_id`, while `release-payout` pays every row of
  -- `group_job_helpers`, so a `helper_id`-only query silently drops a paid
  -- group job from every non-lead member's earnings. `useProfileEarnings`
  -- (src/hooks/useProfileTabData.ts) was changed in the same commit to fold the
  -- roster in the same way. Both surfaces are now right, and they agree —
  -- rather than agreeing on the same omission. Zero rows in
  -- `group_job_helpers` on prod today, so the change is a no-op there and a
  -- correctness fix the first time a group job completes.
  --
  -- `completed_at` is COALESCE(helper_completed_at, created_at) — the exact
  -- fallback EarningsBreakdownCharts.tsx already uses to place a job on a
  -- month axis. `poster_completed_at` would arguably be a better second
  -- choice, but agreeing with the chart that already ships beats being
  -- marginally more correct and disagreeing with it.
  WITH mine AS (
    SELECT
      j.id,
      j.category::text                                   AS category,
      COALESCE(j.parish, z.parish)                       AS parish,
      COALESCE(j.helper_completed_at, j.created_at)      AS completed_at,
      j.budget,
      j.helper_fee_percent,
      -- Q1840: the fee-model stamp, so helperPlatformFeeDollars prices a
      -- flat-model job (F3) at its 5% + 70c, not the viewer's tier.
      j.helper_fee_flat_cents,
      j.platform_fee_amount,
      j.payment_status,
      j.is_group_job,
      j.helpers_needed,
      j.urgent_fee
    FROM public.jobs j
    LEFT JOIN public.louisiana_zip_parishes z ON z.zip_code = LEFT(REGEXP_REPLACE(COALESCE(j.zip_code, ''), '[^0-9]', '', 'g'), 5)
    WHERE j.status = 'completed'
      AND (
        j.helper_id = v_uid
        OR EXISTS (
          SELECT 1 FROM public.group_job_helpers g
          WHERE g.job_id = j.id AND g.helper_id = v_uid
        )
      )
      AND COALESCE(j.helper_completed_at, j.created_at) >= v_since
  )
  SELECT COALESCE(jsonb_agg(to_jsonb(m) ORDER BY m.completed_at DESC), '[]'::jsonb)
  INTO v_jobs
  FROM mine m;

  -- ── NOT ENTITLED ─────────────────────────────────────────────────────────
  -- Return early with a PREVIEW, not a broken dashboard.
  --
  -- The preview carries only the money fields of the caller's own completed
  -- jobs — the identical rows the Earnings tab already hands them for free —
  -- so the upgrade screen can say "you paid $X in platform fees last year; at
  -- the Pro rate those same jobs cost $Y" with a real number instead of a
  -- brochure. Category, parish, dates, the application funnel and every market
  -- aggregate stay behind the gate.
  IF NOT v_entitled THEN
    RETURN jsonb_build_object(
      'generated_at', now(),
      'window_days',  v_days,
      'tier',         v_tier,
      'entitled',     false,
      'floors',       v_floors,
      'preview',      jsonb_build_object(
        'jobs', (
          SELECT COALESCE(jsonb_agg(jsonb_build_object(
            'budget',              e->'budget',
            'helper_fee_percent',  e->'helper_fee_percent',
            'helper_fee_flat_cents', e->'helper_fee_flat_cents',
            'platform_fee_amount', e->'platform_fee_amount',
            'payment_status',      e->'payment_status',
            'is_group_job',        e->'is_group_job',
            'helpers_needed',      e->'helpers_needed',
            'urgent_fee',          e->'urgent_fee'
          )), '[]'::jsonb)
          FROM jsonb_array_elements(v_jobs) AS e
        )
      )
    );
  END IF;

  -- ── The caller's applications ────────────────────────────────────────────
  -- `minutes_to_apply` is the helper's own clock: how long after the job was
  -- posted they got their application in.
  WITH my_apps AS (
    SELECT
      a.id,
      a.created_at AS applied_at,
      j.id         AS job_id,
      j.status     AS job_status,
      j.helper_id  AS job_helper_id,
      j.category::text AS category,
      COALESCE(j.parish, z.parish) AS parish,
      a.status::text AS app_status,
      ROUND(EXTRACT(EPOCH FROM (a.created_at - j.created_at)) / 60.0)::integer AS minutes_to_apply
    FROM public.applications a
    JOIN public.jobs j ON j.id = a.job_id
    LEFT JOIN public.louisiana_zip_parishes z ON z.zip_code = LEFT(REGEXP_REPLACE(COALESCE(j.zip_code, ''), '[^0-9]', '', 'g'), 5)
    WHERE a.helper_id = v_uid
      AND a.created_at >= v_since
  ),
  classified AS (
    SELECT
      m.*,
      CASE
        WHEN m.app_status = 'accepted' THEN 'won'
        WHEN m.app_status = 'rejected' THEN 'lost'
        -- Still pending, but the job moved on without them. `pending_approval`
        -- and `open` are undecided; `cancelled` is nobody's loss.
        WHEN m.job_status IN ('accepted', 'in_progress', 'completed', 'revision_requested', 'disputed')
             AND m.job_helper_id IS DISTINCT FROM v_uid
             AND NOT EXISTS (
               SELECT 1 FROM public.group_job_helpers g
               WHERE g.job_id = m.job_id AND g.helper_id = v_uid
             )
          THEN 'lost'
        ELSE 'undecided'
      END AS outcome
    FROM my_apps m
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'id',               c.id,
    'applied_at',       c.applied_at,
    'minutes_to_apply', c.minutes_to_apply,
    'outcome',          c.outcome,
    'category',         c.category,
    'parish',           c.parish
  ) ORDER BY c.applied_at DESC), '[]'::jsonb)
  INTO v_apps
  FROM classified c;

  -- ── Speed vs. the applicant who actually won ─────────────────────────────
  -- Only jobs the caller applied to where SOMEBODY ELSE was accepted. Jobs the
  -- caller won are excluded on purpose: including them would put the caller on
  -- both sides of the comparison and flatter the result.
  WITH contested AS (
    SELECT
      j.id AS job_id,
      MIN(EXTRACT(EPOCH FROM (mine.created_at - j.created_at)) / 60.0) AS mine_min,
      MIN(EXTRACT(EPOCH FROM (won.created_at  - j.created_at)) / 60.0) AS won_min
    FROM public.applications mine
    JOIN public.jobs j ON j.id = mine.job_id
    JOIN public.applications won
      ON won.job_id = j.id AND won.status = 'accepted' AND won.helper_id <> v_uid
    WHERE mine.helper_id = v_uid
      AND mine.status <> 'accepted'
      AND mine.created_at >= v_since
    GROUP BY j.id
  )
  SELECT jsonb_build_object(
    'sample', COUNT(*)::integer,
    -- How many of those jobs the caller actually applied to FIRST. The medians
    -- alone cannot answer that — a lower median is compatible with being last
    -- on half the set — and the first draft of the UI turned "my median is
    -- lower" into "you got in first on those", which is a different claim.
    'you_were_first', COUNT(*) FILTER (WHERE mine_min < won_min)::integer,
    'your_median_minutes',
      CASE WHEN COUNT(*) >= c_min_head_to_head
        THEN ROUND(percentile_cont(0.5) WITHIN GROUP (ORDER BY mine_min)::numeric) END,
    'winner_median_minutes',
      CASE WHEN COUNT(*) >= c_min_head_to_head
        THEN ROUND(percentile_cont(0.5) WITHIN GROUP (ORDER BY won_min)::numeric) END
  )
  INTO v_h2h
  FROM contested;

  -- ── Market scope ─────────────────────────────────────────────────────────
  -- Two rungs: the parish the caller lives in (derived from their ZIP), and
  -- the parishes they have actually worked in. A third rung read
  -- `helper_preferred_parishes` until 2026-09-07; that table was removed
  -- because nothing could ever write it, and the comment that stood here
  -- already recorded that it held ZERO rows in prod — so the rung never
  -- contributed a parish to anybody's scope.
  -- ORDERED. scopeLabel() renders parishes[0] as the headline parish, and an
  -- unordered array_agg let "Jobs posted in Lafayette + 3 more" become
  -- "...in Orleans + 3 more" between two loads of the same page.
  SELECT COALESCE(array_agg(DISTINCT parish ORDER BY parish) FILTER (WHERE parish IS NOT NULL), '{}')
  INTO v_parishes
  FROM (
    SELECT p.parish
    FROM public.profiles p
    WHERE p.user_id = v_uid AND p.parish IS NOT NULL
    UNION
    SELECT COALESCE(j.parish, z.parish)
    FROM public.jobs j
    LEFT JOIN public.louisiana_zip_parishes z ON z.zip_code = LEFT(REGEXP_REPLACE(COALESCE(j.zip_code, ''), '[^0-9]', '', 'g'), 5)
    WHERE j.helper_id = v_uid
  ) s;

  v_scope := CASE WHEN COALESCE(array_length(v_parishes, 1), 0) > 0
                  THEN 'parish' ELSE 'statewide' END;

  -- ── The market population ────────────────────────────────────────────────
  -- Everyone else's real, human-posted demand.
  --   is_seed          — 59 of 64 prod rows; a clock drawn from those is a
  --                      picture of the seed script, not of the market.
  --   is_auto_created  — recurring clones are stamped by the cron that made
  --                      them, not by a person deciding to post at 7pm.
  --   customer_id      — the caller's own postings are not demand FOR them.
  WITH market AS (
    SELECT
      j.id,
      j.category::text AS category,
      j.budget,
      COALESCE(j.parish, z.parish) AS parish,
      (j.created_at AT TIME ZONE 'America/Chicago') AS posted_local
    FROM public.jobs j
    LEFT JOIN public.louisiana_zip_parishes z ON z.zip_code = LEFT(REGEXP_REPLACE(COALESCE(j.zip_code, ''), '[^0-9]', '', 'g'), 5)
    WHERE j.created_at >= v_market_since
      AND j.is_seed IS NOT TRUE
      AND j.is_auto_created IS NOT TRUE
      AND j.customer_id <> v_uid
  ),
  scoped AS (
    SELECT * FROM market
    WHERE v_scope = 'statewide' OR parish = ANY(v_parishes)
  )
  SELECT
    COUNT(*)::integer,
    -- The clock. Day-of-week 0=Sunday, six 4-hour blocks. Emitted only above
    -- the floor: a heatmap off nine jobs is a Rorschach test.
    CASE WHEN COUNT(*) >= c_min_market_jobs THEN (
      SELECT COALESCE(jsonb_agg(jsonb_build_object('dow', d.dow, 'block', d.block, 'jobs', d.n)
                                ORDER BY d.dow, d.block), '[]'::jsonb)
      FROM (
        SELECT EXTRACT(DOW FROM posted_local)::integer AS dow,
               (EXTRACT(HOUR FROM posted_local)::integer / 4) AS block,
               COUNT(*)::integer AS n
        FROM scoped
        GROUP BY 1, 2
      ) d
    ) END,
    -- Median posted budget per category, each with its own floor.
    (
      SELECT COALESCE(jsonb_agg(jsonb_build_object(
               'category', r.category, 'jobs', r.n, 'median_budget', r.median_budget)
               ORDER BY r.n DESC, r.category), '[]'::jsonb)
      FROM (
        SELECT category,
               COUNT(*)::integer AS n,
               CASE WHEN COUNT(*) >= c_min_market_category_jobs
                 THEN ROUND(percentile_cont(0.5) WITHIN GROUP (ORDER BY budget)::numeric, 2) END
                 AS median_budget
        FROM scoped
        WHERE budget IS NOT NULL
        GROUP BY category
      ) r
    )
  INTO v_market_n, v_demand, v_rates
  FROM scoped;

  RETURN jsonb_build_object(
    'generated_at',  now(),
    'window_days',   v_days,
    'tier',          v_tier,
    'entitled',      true,
    'floors',        v_floors,
    'jobs',          v_jobs,
    'applications',  v_apps,
    'head_to_head',  v_h2h,
    'market',        jsonb_build_object(
      'scope',       v_scope,
      'parishes',    to_jsonb(v_parishes),
      'window_days', v_market_days,
      'sample',      COALESCE(v_market_n, 0),
      'demand',      v_demand,          -- NULL below the floor, never a grid of zeros
      'rates',       COALESCE(v_rates, '[]'::jsonb)
    )
  );
END $function$;
REVOKE ALL ON FUNCTION public.get_helper_analytics(integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_helper_analytics(integer) TO authenticated, service_role;
