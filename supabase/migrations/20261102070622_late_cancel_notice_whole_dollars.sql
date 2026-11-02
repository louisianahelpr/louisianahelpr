-- Q1979 (lh-money-escrow review of a2b4cab67, finding 1): the SQL late-cancel notices quoted the Helpr's part unrounded
-- ("about $0.49"), but void-cancelled-payments sends roundPayoutDownCents of it (whole dollars) and records under $1 as
-- waived, so a Helpr could be told "you'll be compensated" and get $0 (a $10 crew of 2 on the flat 5% + 70c: share
-- $1.25, part $0.49, $0 sent). Now poster_cancel_job (crew loop and solo notice) and
-- settle_one_off_jobs_for_banned_account round the quoted part DOWN to the whole dollar (helpr_payout_round_down_cents,
-- the SQL twin of roundPayoutDownCents), and when that is $0 they say there is no payment, with the 'warning' type.
-- No money moves differently: the fee, its shares and the payout are untouched; only the notice.
-- Restated from the EFFECTIVE definitions (src/test/helpers/effectiveFunctionDefs.ts): poster_cancel_job from
-- 20261031220849; settle_one_off_jobs_for_banned_account from 20261018050953 with the in-place copy rewrites of
-- 20261025203540 (#130) and 20261030220537 (#40, #50) already in its text. Grants restated as live holds them.
-- Replay-safe: CREATE OR REPLACE. Proof: src/test/pglite/lateCancelNoticeWholeDollars.pglite.mjs.

CREATE OR REPLACE FUNCTION public.poster_cancel_job(p_job_id uuid, p_reason text DEFAULT NULL::text, p_expected_fee_cents bigint DEFAULT NULL::bigint)
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
  -- Owner 2026-10-30: a hired Helpr who has not verified their ID cannot head out, so the poster
  -- may cancel and hire someone else: no pay for the Helpr's time and no strike on the poster.
  v_id_outstanding boolean := false;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;

  v_reason := left(NULLIF(btrim(COALESCE(p_reason, '')), ''), 1000);

  SELECT j.id, j.title, j.budget, j.date_needed, j.start_time, j.customer_id, j.helper_id,
         j.status, j.helper_fee_percent, j.helper_fee_flat_cents, j.helper_confirmed_at,
         j.helper_completed_at, j.is_group_job, j.helpers_needed,
         j.helper_on_the_way_at, j.helper_arrived_at
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
         AND NOT (g.helper_on_the_way_at IS NULL AND g.helper_arrived_at IS NULL AND public.payout_waits_on_identity(g.helper_id))
    );
  ELSE
    -- ADDED 2026-09-08: the one question both the fee and the strike turn on.
    -- Chosen is not committed; see this migration's header.
    v_id_outstanding := v_job.helper_id IS NOT NULL AND v_job.helper_on_the_way_at IS NULL
      AND v_job.helper_arrived_at IS NULL AND public.payout_waits_on_identity(v_job.helper_id);
    v_committed := v_job.helper_id IS NOT NULL AND v_job.helper_confirmed_at IS NOT NULL AND NOT v_id_outstanding;
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
               ((public.crew_fee_pays_unconfirmed() OR g.helper_confirmed_at IS NOT NULL)
                 AND NOT (g.helper_on_the_way_at IS NULL AND g.helper_arrived_at IS NULL AND public.payout_waits_on_identity(g.helper_id))) AS committed,
               COALESCE(g.share_cents,
                        public.crew_slot_share_cents(round(COALESCE(v_job.budget, 0) * 100)::bigint, v_needed,
                          (row_number() OVER (ORDER BY g.joined_at NULLS LAST, g.id) - 1)::integer)) AS basis,
               public.cancellation_fee_percent((public.crew_fee_pays_unconfirmed() OR g.helper_confirmed_at IS NOT NULL)
                 AND NOT (g.helper_on_the_way_at IS NULL AND g.helper_arrived_at IS NULL AND public.payout_waits_on_identity(g.helper_id)), v_hours) AS pct
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
  -- Boards 66/172 slice 2 (2026-10-21): the fee the poster was SHOWN. The
  -- cancel dialog quotes it (create-payment cancel_quote) and passes it back
  -- here in cents; if the job crossed a tier between the quote and the tap
  -- (24 h or 2 h before the start), or the dialog's number is otherwise not
  -- the fee this cancel records, refuse BEFORE anything is written and say
  -- the new fee, so nobody is charged a number they did not see. NULL (an
  -- older app build, a server caller) keeps the old behaviour.
  IF p_expected_fee_cents IS NOT NULL AND round(COALESCE(v_fee, 0) * 100) <> p_expected_fee_cents THEN
    RAISE EXCEPTION 'quote_changed'
      USING HINT = format('The amount for your Helpr''s time is now $%s.', to_char(COALESCE(v_fee, 0), 'FM999999990.00'));
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

  IF v_id_outstanding THEN
    INSERT INTO public.job_cancel_id_waivers (job_id) VALUES (v_job.id) ON CONFLICT (job_id) DO NOTHING;
  END IF;

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
      -- CHANGED (Q1979): what void-cancelled-payments sends, rounded DOWN to the whole dollar (roundPayoutDownCents);
      -- under $1 nothing is sent, so the notice promises nothing.
      v_helper_cut := public.helpr_payout_round_down_cents(round(v_helper_cut * 100)::integer) / 100.0;
      INSERT INTO public.notifications (user_id, title, message, type, link, job_id)
      VALUES (
        v_share.helper_id,
        CASE WHEN v_helper_cut > 0 THEN 'Job cancelled — you''ll be compensated' ELSE 'Job cancelled' END,
        CASE
          WHEN v_helper_cut > 0 THEN
            format('"%s" was cancelled by the person who posted it. You''ll receive about $%s for the time you set aside, on its way within the hour.',
                   COALESCE(v_job.title, 'A job'),
                   to_char(v_helper_cut, 'FM999999990.00'),
                   v_share.fee_percent)
          -- CHANGED (Q1979): a share whose part for the Helpr's time rounds down to $0.
          WHEN v_share.share_amount > 0 THEN
            format('"%s" was cancelled by the person who posted it. Your part for the time you set aside comes to under $1, so there is no payment for it.',
                   COALESCE(v_job.title, 'A job'))
          WHEN NOT v_share.committed THEN
            format('"%s" was cancelled by the person who posted it before you confirmed your spot, so there is no payment for it.',
                   COALESCE(v_job.title, 'A job'))
          ELSE
            format('"%s" was cancelled by the person who posted it. It was more than 24 hours out, so there is no payment for it.',
                   COALESCE(v_job.title, 'A job'))
        END,
        CASE WHEN v_helper_cut > 0 THEN 'payment' ELSE 'warning' END,
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
    -- CHANGED (Q1979): what void-cancelled-payments sends, rounded DOWN to the whole dollar (roundPayoutDownCents);
    -- under $1 nothing is sent, so the notice promises nothing.
    v_helper_cut := public.helpr_payout_round_down_cents(round(v_helper_cut * 100)::integer) / 100.0;

    INSERT INTO public.notifications (user_id, title, message, type, link)
    VALUES (
      v_job.helper_id,
      CASE WHEN v_helper_cut > 0 THEN 'Job cancelled — you''ll be compensated' ELSE 'Job cancelled' END,
      CASE
        WHEN v_helper_cut > 0 THEN
          format('"%s" was cancelled by the person who posted it. You''ll receive about $%s for the time you set aside, on its way within the hour.',
                 COALESCE(v_job.title, 'A job'),
                 to_char(v_helper_cut, 'FM999999990.00'),
                 v_percent)
        -- CHANGED (Q1979): a fee whose part for the Helpr's time rounds down to $0.
        WHEN v_fee > 0 THEN
          format('"%s" was cancelled by the person who posted it. Your part for the time you set aside comes to under $1, so there is no payment for it.',
                 COALESCE(v_job.title, 'A job'))
        WHEN v_id_outstanding THEN
          format('"%s" was cancelled by the person who posted it before your ID was verified, so there is no payment for it.',
                 COALESCE(v_job.title, 'A job'))
        WHEN NOT v_committed THEN
          -- The old copy claimed "it was more than 24 hours out", which is
          -- simply false when the reason for the $0 is that this offer was
          -- never accepted.
          format('"%s" was cancelled by the person who posted it before you accepted it, so there is no payment for it.',
                 COALESCE(v_job.title, 'A job'))
        ELSE
          format('"%s" was cancelled by the person who posted it. It was more than 24 hours out, so there is no payment for it.',
                 COALESCE(v_job.title, 'A job'))
      END,
      CASE WHEN v_helper_cut > 0 THEN 'payment' ELSE 'warning' END,
      '/jobs?job=' || v_job.id::text
    );
  END IF;

  -- THE LADDER, in the same transaction as the state change. Idempotent on
  -- (user, 'cancel_with_helper', job_id), so one cancelled job is one strike
  -- however many times this is retried. A crew is ONE booking: one strike.
  -- CHANGED 2026-09-08: gated on v_committed, not on helper_id alone.
  -- CHANGED 2026-10-30 (owner): a strike only inside 24 hours of the start,
  -- matching helper_cancel_booking. v_late is is_late_cancellation(v_committed,
  -- v_hours), so it is still never true without a committed Helpr.
  IF v_late THEN
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
REVOKE ALL ON FUNCTION public.poster_cancel_job(uuid, text, bigint) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.poster_cancel_job(uuid, text, bigint) TO authenticated, service_role;

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
          -- CHANGED (Q1979): what void-cancelled-payments sends, rounded DOWN to the whole dollar; under $1 nothing is sent.
          v_cut := public.helpr_payout_round_down_cents(round(v_cut * 100)::integer) / 100.0;
          INSERT INTO public.notifications (user_id, title, message, type, link, job_id)
          VALUES (
            v_job.helper_id,
            CASE WHEN v_cut > 0 THEN 'Job cancelled — you''ll be compensated' ELSE 'Job cancelled' END,
            CASE WHEN v_cut > 0 THEN
              format('"%s" was cancelled because %s. It was cancelled late, so you''ll receive about $%s for your time, on its way within the hour.',
                     v_title, v_gone, to_char(v_cut, 'FM999999990.00'))
                 -- CHANGED (Q1979): a late fee whose part for the Helpr's time rounds down to $0.
                 WHEN v_fee > 0 THEN
              format('"%s" was cancelled because %s. It was cancelled late, but your part for your time comes to under $1, so there is no payment for it.',
                     v_title, v_gone)
            ELSE format('"%s" was cancelled because %s.', v_title, v_gone) END,
            CASE WHEN v_cut > 0 THEN 'payment' ELSE 'warning' END,
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
                        THEN 'Your payment stays protected for whoever you pick next.'
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
            format('"%s" is on hold because %s. Work had already started, so a person at Louisiana Helpr will review it and decide the payment. The money stays on hold until then, and you don''t need to do anything.',
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
