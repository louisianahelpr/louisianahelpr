-- JOBS AUDIT 11-08, #1 (High) and #5 (Medium): ~/.lh-shots/handoffs-1108/jobs-audit.md.
--
-- #1  poster_cancel_job (restated from its newest definition, 20261102074317) accepted 'in_progress' and
--     'revision_requested' and refused only once the Helpr marked done. The app hides Cancel once work starts, so only a
--     direct RPC call reached it, but that call worked: a poster could cancel after the Helpr arrived and worked (or on
--     a continue day, where the done is cleared), priced on day 1's start-time ladder (cancellation_fee_percent, newest
--     20260826200000: 0% from 24 h out, 25% inside 24 h, 50% inside 2 h and after the start). So the poster got 50% of
--     the budget back for work already done, and 100% when the Helpr had not tapped the day-before confirm (or was
--     waiting on their ID check, or under a ban review): v_committed false prices the fee at 0.
--     Now: refused with 'work_started' (hint: use Report a problem to open a dispute) once there is real evidence of
--     work: job_work_started() = the Helpr is on site (helper_arrived_at; never poster_confirmed_arrival_at, which the
--     poster can write, Q423), the tracker says arrived / working / done, the job is being fixed (revision_requested), or a continue day is agreed
--     ('set'). NOT status 'in_progress' alone: auto_start_due_jobs (20261102100421) flips a job to in_progress at its
--     start time whether or not the Helpr came, and that no-show job keeps the old exits (the no-show report, and the
--     free, no-strike cancel for a confirmed Helpr whose ID check is outstanding or whose account is frozen).
--     A crew is refused once any member is on site, or while it is being fixed with anyone on it; an empty roster
--     (every member a no-show) still cancels for a full refund.
--     block_user_and_settle (restated from 20261102131745) was the same hole by another door: a poster who blocked the
--     Helpr mid-job had the job cancelled on the same ladder. A started single job is no longer settled by a block:
--     the block stands, the job is left as it is, and the admins are alerted (as a started crew job already was);
--     the money goes through Report a problem / Helpr support.
-- #5  Three Jobs notices pushed under "System alerts" (type 'warning'): the Helpr's "Job cancelled" (no money) from
--     poster_cancel_job (single and crew), and the poster's last chance to approve ("Please review the work",
--     sweep_release_last_chance, restated from 20261023143240). They are now 'job_updates' and 'work_status', so the
--     Jobs switches control them. sms_kind_for (restated from 20261102002011) reads the new types exactly as it read
--     'warning' for those titles, so no text changes kind. The single cancel notice now carries its job_id.
--
-- Proof: src/test/pglite/posterCancelAfterWorkStarted.pglite.mjs (block: B1-B3). Guard: src/test/posterCancelAfterWorkStarted.test.ts.
-- Sensitive: money + authz (escrow refund path).

-- Real evidence the Helpr did work on this job (Jobs audit 11-08 #1, lead review 11-08). Read by poster_cancel_job and
-- block_user_and_settle. Never status 'in_progress' alone (auto_start_due_jobs sets it at the start time). Only Helpr-side
-- or system stamps count: never poster_confirmed_arrival_at, which the poster can write (Q423, posterCannotMoveFeeInputs).
CREATE OR REPLACE FUNCTION public.job_work_started(p_job_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
  SELECT EXISTS (SELECT 1 FROM public.jobs j
                  WHERE j.id = p_job_id
                    AND (j.helper_arrived_at IS NOT NULL OR j.status::text = 'revision_requested'))
      OR EXISTS (SELECT 1 FROM public.job_tracking t JOIN public.jobs j ON j.id = t.job_id AND t.helper_id = j.helper_id
                  WHERE t.job_id = p_job_id AND t.status IN ('arrived', 'working', 'done'))
      OR EXISTS (SELECT 1 FROM public.job_continue_days c WHERE c.job_id = p_job_id AND c.status = 'set')
$fn$;
REVOKE ALL ON FUNCTION public.job_work_started(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.job_work_started(uuid) TO service_role;

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
  -- ADDED 2026-11-02 (Q1415 e): the hired Helpr is banned or under an open ban review (cancel_fee_payee_frozen).
  v_payee_frozen boolean := false;
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

  -- ADDED 2026-11-08 (Jobs audit 11-08 #1): once the Helpr has done work, Cancel is not the way out. Before this a
  -- direct RPC call (the app hides Cancel then) cancelled worked-on jobs on day 1's start-time ladder: the Helpr got
  -- 50% of the budget and the poster the rest back, or ALL of it when the Helpr's confirm was missing. Work =
  -- job_work_started() (on site, tracker arrived/working/done, being fixed, or an agreed continue day), never
  -- 'in_progress' alone. The poster's ways out from here are Report a problem (a dispute) or a refund request.
  -- A crew is judged per member below (its exit for an empty roster stays).
  IF v_job.is_group_job IS NOT TRUE AND public.job_work_started(v_job.id) THEN
    RAISE EXCEPTION 'work_started'
      USING HINT = 'Your Helpr already started this job, so it can''t be cancelled. If something''s wrong, use Report a problem on the job to open a dispute. Your payment stays on hold until it''s sorted.';
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
    -- ADDED 2026-11-08 (Jobs audit 11-08 #1): a member on site, or a crew being fixed with anyone on it, is work
    -- started: Report a problem, not Cancel. A crew whose every member was reported a no-show has an empty roster and
    -- still cancels for a full refund (crewNobodyLeft, JOBS-3).
    IF EXISTS (
      SELECT 1 FROM public.group_job_helpers g
       WHERE g.job_id = v_job.id AND g.helper_id IS NOT NULL
         AND (g.helper_arrived_at IS NOT NULL OR v_job.status::text = 'revision_requested')
    ) THEN
      RAISE EXCEPTION 'work_started'
        USING HINT = 'Your crew already started this job, so it can''t be cancelled. If something''s wrong, use Report a problem on the job to open a dispute. Your payment stays on hold until it''s sorted.';
    END IF;
    -- The owner rule decides whether a hired member who never confirmed
    -- counts (crew_fee_pays_unconfirmed, default true: every hired member).
    v_committed := EXISTS (
      SELECT 1 FROM public.group_job_helpers g
       WHERE g.job_id = v_job.id
         AND g.helper_id IS NOT NULL
         AND (public.crew_fee_pays_unconfirmed() OR g.helper_confirmed_at IS NOT NULL)
         AND NOT (g.helper_on_the_way_at IS NULL AND g.helper_arrived_at IS NULL AND public.payout_waits_on_identity(g.helper_id))
         AND NOT public.cancel_fee_payee_frozen(g.helper_id)
    );
  ELSE
    -- ADDED 2026-09-08: the one question both the fee and the strike turn on.
    -- Chosen is not committed; see this migration's header.
    v_id_outstanding := v_job.helper_id IS NOT NULL AND v_job.helper_on_the_way_at IS NULL
      AND v_job.helper_arrived_at IS NULL AND public.payout_waits_on_identity(v_job.helper_id);
    -- ADDED 2026-11-02 (Q1415 e): a Helpr under an open ban review or banned is owed no fee.
    v_payee_frozen := v_job.helper_id IS NOT NULL AND v_job.helper_confirmed_at IS NOT NULL AND NOT v_id_outstanding
      AND public.cancel_fee_payee_frozen(v_job.helper_id);
    v_committed := v_job.helper_id IS NOT NULL AND v_job.helper_confirmed_at IS NOT NULL AND NOT v_id_outstanding
      AND NOT v_payee_frozen;
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
                 AND NOT (g.helper_on_the_way_at IS NULL AND g.helper_arrived_at IS NULL AND public.payout_waits_on_identity(g.helper_id))
                 AND NOT public.cancel_fee_payee_frozen(g.helper_id)) AS committed,
               COALESCE(g.share_cents,
                        public.crew_slot_share_cents(round(COALESCE(v_job.budget, 0) * 100)::bigint, v_needed,
                          (row_number() OVER (ORDER BY g.joined_at NULLS LAST, g.id) - 1)::integer)) AS basis,
               public.cancellation_fee_percent((public.crew_fee_pays_unconfirmed() OR g.helper_confirmed_at IS NOT NULL)
                 AND NOT (g.helper_on_the_way_at IS NULL AND g.helper_arrived_at IS NULL AND public.payout_waits_on_identity(g.helper_id))
                 AND NOT public.cancel_fee_payee_frozen(g.helper_id), v_hours) AS pct
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
  -- ADDED 2026-11-02 (Q1415 e): the record the money paths settle this 0 from (see the header).
  ELSIF v_payee_frozen THEN
    INSERT INTO public.job_cancel_id_waivers (job_id, reason) VALUES (v_job.id, 'payee_frozen') ON CONFLICT (job_id) DO NOTHING;
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
          -- ADDED 2026-11-02 (Q1415 e): not "before you confirmed" for a member who did confirm.
          WHEN NOT v_share.committed AND public.cancel_fee_payee_frozen(v_share.helper_id) THEN
            format('"%s" was cancelled by the person who posted it. Your account is on hold, so there is no payment for it.',
                   COALESCE(v_job.title, 'A job'))
          WHEN NOT v_share.committed THEN
            format('"%s" was cancelled by the person who posted it before you confirmed your spot, so there is no payment for it.',
                   COALESCE(v_job.title, 'A job'))
          ELSE
            format('"%s" was cancelled by the person who posted it. It was more than 24 hours out, so there is no payment for it.',
                   COALESCE(v_job.title, 'A job'))
        END,
        CASE WHEN v_helper_cut > 0 THEN 'payment' ELSE 'job_updates' END,
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

    INSERT INTO public.notifications (user_id, title, message, type, link, job_id)
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
        -- ADDED 2026-11-02 (Q1415 e): not "before you accepted it" for a Helpr who did.
        WHEN v_payee_frozen THEN
          format('"%s" was cancelled by the person who posted it. Your account is on hold, so there is no payment for it.',
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
      CASE WHEN v_helper_cut > 0 THEN 'payment' ELSE 'job_updates' END,
      '/jobs?job=' || v_job.id::text,
      v_job.id
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

CREATE OR REPLACE FUNCTION public.sweep_release_last_chance()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  rec RECORD;
  total_pushed integer := 0;
  v_found      integer := 0;
  v_failed     integer := 0;
BEGIN
  FOR rec IN
    SELECT j.id, j.title, j.customer_id
      FROM public.jobs j
     WHERE j.release_last_chance_notif_sent_at IS NULL
       AND j.status = 'in_progress'
       AND j.payment_status = 'escrow'
       AND j.poster_completed_at IS NULL
       AND j.revision_requested_at IS NULL
       AND j.helper_completed_at IS NOT NULL
       -- inside the final 2 hours of the 24h window
       AND j.helper_completed_at <= NOW() - INTERVAL '22 hours'
       AND j.helper_completed_at >  NOW() - INTERVAL '24 hours'
     ORDER BY j.helper_completed_at
     LIMIT 100
  LOOP
    v_found := v_found + 1;
    BEGIN
      INSERT INTO public.notifications (user_id, type, title, message, link, read, job_id)
      VALUES (
        rec.customer_id,
        'work_status',
        'Please review the work',
        -- Owner 2026-10-23: nothing is paid without the poster's approval. The money stays held; Helpr
        -- support steps in when the 24 hours run out.
        format('Your Helpr finished "%s". Approve it, or ask for a change if something''s wrong. If we don''t hear from you in about 2 hours, Helpr support will reach out. Your payment stays held until then.', rec.title),
        '/posts?job=' || rec.id::text,
        false,
        rec.id
      );
      UPDATE public.jobs SET release_last_chance_notif_sent_at = NOW() WHERE id = rec.id;
      total_pushed := total_pushed + 1;
    EXCEPTION WHEN OTHERS THEN
      v_failed := v_failed + 1;
      PERFORM public.log_cron_defect(
        'sweep_release_last_chance', rec.id::text, SQLERRM,
        jsonb_build_object('job_id', rec.id));
      RAISE NOTICE 'sweep_release_last_chance: job % failed: %', rec.id, SQLERRM;
    END;
  END LOOP;
  RETURN jsonb_build_object('found', v_found, 'pushed', total_pushed, 'failed', v_failed);
EXCEPTION WHEN OTHERS THEN
  PERFORM public.log_cron_defect(
    'sweep_release_last_chance', 'run', SQLERRM,
    jsonb_build_object('phase', 'scan', 'pushed_before_failure', total_pushed));
  -- The outer handler rolled back every warning this run wrote, so none were
  -- pushed, whatever total_pushed counted before the failure.
  RETURN jsonb_build_object('found', v_found, 'pushed', 0, 'failed', v_failed, 'scan_failed', 1);
END;
$function$;

REVOKE ALL ON FUNCTION public.sweep_release_last_chance() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.sweep_release_last_chance() TO service_role;

CREATE OR REPLACE FUNCTION public.sms_kind_for(p_type text, p_title text, p_job_id uuid)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path TO 'public'
AS $fn$
  SELECT CASE
    -- Nearby / matching jobs are never texted (owner 2026-10-23). First, so nothing below can catch one.
    WHEN p_type = 'job_match' THEN NULL
    WHEN p_type = 'message' THEN 'message'
    -- Needs-you deadline reminders (owner 11-01 12:19 PM; 20261102002011): a step the member must take before a
    -- deadline. Jobs: approve the finished work (sweep_release_last_chance). Declutter: check out (the 24 h and 2 h
    -- checkout reminders), hand over (the 1-hour pickup reminder), answer an offer or a refund step
    -- (sweep_needs_you_reminders). Ahead of every catch-all.
    WHEN p_type IN ('warning', 'work_status') AND p_title = 'Please review the work' THEN 'needs_you'
    WHEN p_type = 'payment' AND p_title IN ('Check out within 24 hours', '2 hours left to check out') THEN 'needs_you'
    WHEN p_type = 'declutter_pickups' AND (p_title IN ('Porch pickup in 1 hour', 'Pickup in 1 hour')
                                           OR p_title LIKE 'Porch pickup at %' OR p_title LIKE 'Pickup at %') THEN 'needs_you'
    WHEN p_type = 'declutter_offers' AND p_title IN ('Answer the offer', 'Offer closes soon') THEN 'needs_you'
    WHEN p_type = 'declutter_refunds' AND p_title IN ('Answer the refund request', 'Refund request closes soon',
                                                      'Answer the refund offer', 'Refund offer closes soon') THEN 'needs_you'
    -- A job offer has an answer deadline (direct offer, or the hire offer).
    WHEN p_type = 'new_offers' AND p_title IN ('You got a direct job offer!', 'New job offer', '📋 New job offer!') THEN 'job_offer'
    WHEN p_type = 'info' AND p_title = '📋 New job offer!' THEN 'job_offer'
    WHEN p_type = 'application' AND p_title = 'New application' THEN 'application'
    WHEN p_type = 'job_update' AND p_title = 'Starting soon' THEN 'starting_soon'
    -- Q2483: the 2-hour and head-out start reminders are as time-critical as Starting soon.
    WHEN p_type = 'job_update' AND p_title IN ('Your job starts in 2 hours', 'Time to head out') THEN 'starting_soon'
    WHEN p_type = 'job_updates' AND p_title = 'New date or time requested' THEN 'reschedule'
    WHEN p_type IN ('warning', 'job_updates') AND p_title IN ('A dispute was opened', 'Job disputed') THEN 'dispute'
    WHEN p_type IN ('payment', 'warning', 'job_updates') AND p_title IN ('Job cancelled', 'Job cancelled — you''ll be compensated') THEN 'job_cancelled'
    WHEN p_type IN ('warning', 'job_updates') AND p_title = 'Your Helpr cancelled' THEN 'job_cancelled'
    WHEN p_type = 'job_updates' AND p_title = 'Job auto-cancelled' THEN 'job_cancelled'
    WHEN p_type = 'warning' AND p_title IN ('Your payout didn''t go through', 'Payout account needs attention',
                                            'Payment failed', 'Your bank payment failed', 'Job payment failed')
      THEN 'money_problem'
    WHEN p_type = 'payment' AND p_title = 'A refund didn''t go through' THEN 'money_problem'
    WHEN p_type = 'financial_alerts' AND p_title IN ('Payout account required', 'We couldn''t send your payout') THEN 'money_problem'
    -- Back-out reminders moved from 'warning' to 'job_updates' and are still never texted: ahead of the catch-all.
    WHEN p_type = 'job_updates' AND p_title IN ('Offer declined', 'Offer expired', 'Your Helpr didn''t confirm',
                                                'Your Helpr hasn''t confirmed yet', 'A Helpr on your crew hasn''t confirmed yet')
      THEN NULL
    -- Other updates on the member's own job.
    WHEN p_type IN ('job_updates', 'job_update', 'work_status', 'expired') AND p_job_id IS NOT NULL THEN 'job_update'
    WHEN p_type IN ('info', 'success') AND p_job_id IS NOT NULL THEN 'job_update'
    ELSE NULL
  END;
$fn$;

REVOKE ALL ON FUNCTION public.sms_kind_for(text, text, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.sms_kind_for(text, text, uuid) TO service_role;

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
  v_helpr_blocks boolean;
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
    -- CHANGED 20261102131745 (Q2692, lead 11-02): the blocker is the hired HELPR. That is the Helpr walking away,
    -- treated exactly like helper_cancel_booking: no late fee for the poster, and the Helpr's strike only inside
    -- 24 hours of the start (apply_job_denial_consequence, is_late_cancellation; owner Q407 (6)/(11)).
    v_helpr_blocks := v_job.helper_id = v_user;

    -- ADDED 2026-11-08 (Jobs audit 11-08 #1, lead review): a block does not settle a job the Helpr did work on. It was
    -- cancelled on the start-time ladder, so a poster who blocked the Helpr mid-job got 50-100% back. The block stands
    -- (above); the job is left as it is and the admins decide its money, as for a started crew job below. Only on a
    -- NEW block, so calling again cannot flood every admin.
    IF public.job_work_started(v_job.id) THEN
      INSERT INTO public.notifications (user_id, title, message, type, link, job_id)
      SELECT r.user_id,
             'Block on a started job',
             format('"%s": the person who posted it and the Helpr blocked each other after work started. Nothing on the job was changed; decide what happens to its payment.',
                    COALESCE(v_job.title, 'A job')),
             'admin_alert',
             '/admin?view=jobs&job=' || v_job.id::text,
             v_job.id
        FROM public.user_roles r
       WHERE r.role = 'admin'
         AND v_new_block;
      v_settled := v_settled || jsonb_build_object('job_id', v_job.id, 'title', v_job.title, 'action', 'admin_review');
      CONTINUE;
    END IF;

    -- CHANGED 2026-09-05: anchored on start_time, matching poster_cancel_job.
    -- Both settle paths must price a cancellation identically or the fee a
    -- poster is quoted depends on which exit they happened to take.
    v_hours := public.job_hours_until_start(v_job.date_needed, v_job.start_time, now());
    v_percent := public.cancellation_fee_percent(v_committed, v_hours);
    v_fee := CASE
      WHEN v_helpr_blocks THEN 0
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
          format('"%s" was cancelled. Because it was cancelled late, you''ll be paid for your time; it settles within the hour, and the amount shows in your Earnings.',
                 COALESCE(v_job.title, 'A job'), to_char(v_fee, 'FM999999990.00'))
        WHEN v_fee > 0 THEN
          format('"%s" was cancelled late, so $%s of it is for the Helpr''s time.',
                 COALESCE(v_job.title, 'A job'), to_char(v_fee, 'FM999999990.00'))
        ELSE
          format('"%s" was cancelled. Nothing is owed for it.', COALESCE(v_job.title, 'A job'))
      END,
      CASE WHEN v_fee > 0 THEN 'payment' ELSE 'warning' END,
      CASE WHEN v_job.helper_id = p_blocked THEN '/jobs?job=' ELSE '/posts?job=' END || v_job.id::text
    );

    -- The reliability strike, through the SAME ladder the normal cancel path
    -- uses. It authorises off auth.uid() = customer_id internally, so it is a
    -- no-op (raises 'not_authorized') for the helper-blocks-poster direction —
    -- only call it in the seat it is written for.
    -- CHANGED 2026-09-23: gated on v_committed, as poster_cancel_job is.
    -- CHANGED 20261102131745 (Q2675, lead 11-02): the poster's strike only inside 24 hours of the start, the rule
    -- poster_cancel_job already follows (JOBS-14, owner 10-30). It was filed at any distance.
    IF v_ladder_present AND v_job.customer_id = v_user AND v_committed AND public.is_late_cancellation(v_committed, v_hours) THEN
      PERFORM public.apply_cancellation_violation_consequence(v_job.id);
    END IF;
    -- CHANGED 20261102131745 (Q2692): the Helpr who blocked takes helper_cancel_booking's strike, inside 24 hours only,
    -- and only once they had accepted (the same accept stamp v_committed reads).
    IF v_helpr_blocks AND v_job.helper_confirmed_at IS NOT NULL AND public.is_late_cancellation(true, v_hours) THEN
      PERFORM public.apply_job_denial_consequence(
        v_user, v_job.id,
        'Cancelled after committing to: "' || COALESCE(v_job.title, 'Unknown') || '"');
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
                format('You blocked a crew member close to the start of "%s". $%s of that spot''s $%s share is for their time, and the spot stays closed. The rest of that share comes back to you when the job is done.',
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
                format('You''re no longer on the crew for "%s". Because this was close to the start, you''ll be paid for your time from the job''s payment when the job settles; the amount shows in your Earnings.',
                       COALESCE(v_crew.title, 'a job'), to_char(v_member_fee, 'FM999999990.00'))
              WHEN v_member_fee > 0 THEN
                format('You''re no longer on the crew for "%s". Because this was close to the start, you''ll be paid for your time; our team will send it to you.',
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
