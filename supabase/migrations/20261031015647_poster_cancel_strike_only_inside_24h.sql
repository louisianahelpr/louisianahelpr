-- JOBS-14 (owner ruling, 10-30): a poster gets a strike for cancelling a hired
-- Helpr only within 24 hours of the start, matching Helprs. No fee rule changes.
--
-- poster_cancel_job struck every committed cancel (IF v_committed THEN), while
-- helper_cancel_booking strikes only when is_late_cancellation is true. The gate
-- is now v_late, the value this function already computes and stamps on the job
-- as late_cancellation: committed AND under 24 hours, including after the start.
-- A job with no date has no hours, so it is not late and gets no strike and no
-- fee, the same as helper_cancel_booking.
--
-- Body is the EFFECTIVE definition (20261021130723_poster_cancel_checks_quoted_fee.sql
-- plus the later notice-wording rewrites), whose pg_get_functiondef is md5-equal to
-- live prod (2026-10-30: e17830cacf38417f19896c7c18d311a6). Only the strike gate and
-- its comment change.
-- CREATE OR REPLACE on the same signature; replay-safe.
--
-- block_user_and_settle has its own strike gates and is NOT changed here.
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
            format('"%s" was cancelled by the person who posted it. You''ll receive about $%s for the time you set aside, on its way within the hour.',
                   COALESCE(v_job.title, 'A job'),
                   to_char(v_helper_cut, 'FM999999990.00'),
                   v_share.fee_percent)
          WHEN NOT v_share.committed THEN
            format('"%s" was cancelled by the person who posted it before you confirmed your spot, so there is no payment for it.',
                   COALESCE(v_job.title, 'A job'))
          ELSE
            format('"%s" was cancelled by the person who posted it. It was more than 24 hours out, so there is no payment for it.',
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
          format('"%s" was cancelled by the person who posted it. You''ll receive about $%s for the time you set aside, on its way within the hour.',
                 COALESCE(v_job.title, 'A job'),
                 to_char(v_helper_cut, 'FM999999990.00'),
                 v_percent)
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
      CASE WHEN v_fee > 0 THEN 'payment' ELSE 'warning' END,
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
