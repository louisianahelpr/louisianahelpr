-- JOBS AUDIT 11-08, #1 (High) and #5 (Medium): ~/.lh-shots/handoffs-1108/jobs-audit.md.
--
-- #1  poster_cancel_job (restated from its newest definition, 20261102074317) accepted 'in_progress' and
--     'revision_requested' and refused only once the Helpr marked done. The app hides Cancel once work starts, so only a
--     direct RPC call reached it, but that call worked: a poster could cancel after the Helpr arrived and worked (or on
--     a continue day, where the done is cleared), priced on day 1's start-time ladder (cancellation_fee_percent, newest
--     20260826200000: 0% from 24 h out, 25% inside 24 h, 50% inside 2 h and after the start). So the poster got 50% of
--     the budget back for work already done, and 100% when the Helpr had not tapped the day-before confirm (or was
--     waiting on their ID check, or under a ban review): v_committed false prices the fee at 0.
--     Now: refused with 'work_started' (hint: use Report a problem to open a dispute) once the job is in progress or
--     being fixed, the Helpr is on site (helper_arrived_at, or the poster confirmed the arrival), or a continue day is
--     asked or agreed. A crew is refused while it is in progress with anyone still on its roster, or once any member
--     is on site; an in-progress crew whose every member was a no-show (empty roster) still cancels for a full refund.
-- #5  Three Jobs notices pushed under "System alerts" (type 'warning'): the Helpr's "Job cancelled" (no money) from
--     poster_cancel_job (single and crew), and the poster's last chance to approve ("Please review the work",
--     sweep_release_last_chance, restated from 20261023143240). They are now 'job_updates' and 'work_status', so the
--     Jobs switches control them. sms_kind_for (restated from 20261102002011) reads the new types exactly as it read
--     'warning' for those titles, so no text changes kind. The single cancel notice now carries its job_id.
--
-- Proof: src/test/pglite/posterCancelAfterWorkStarted.pglite.mjs. Guard: src/test/posterCancelAfterWorkStarted.test.ts.
-- Sensitive: money + authz (escrow refund path).

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
         j.helper_on_the_way_at, j.helper_arrived_at, j.poster_confirmed_arrival_at
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

  -- ADDED 2026-11-08 (Jobs audit 11-08 #1): once the Helpr has started, Cancel is not the way out. Before this a
  -- direct RPC call (the app hides Cancel then) cancelled an in-progress job on day 1's start-time ladder: the Helpr
  -- got 50% of the budget for the work done and the poster the rest back, or ALL of it when the Helpr's confirm was
  -- missing. Started = the job is in progress or being fixed, the Helpr (or the poster's word) put them on site, or a
  -- continue day is asked or agreed. The poster's ways out from here are Report a problem (a dispute) or a refund
  -- request. A crew is judged per member below (its exit for an empty roster stays).
  IF v_job.is_group_job IS NOT TRUE AND (
       v_job.status::text IN ('in_progress', 'revision_requested')
       OR v_job.helper_arrived_at IS NOT NULL
       OR v_job.poster_confirmed_arrival_at IS NOT NULL
       OR EXISTS (SELECT 1 FROM public.job_continue_days c WHERE c.job_id = v_job.id AND c.status IN ('proposed', 'set'))
     ) THEN
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
    -- ADDED 2026-11-08 (Jobs audit 11-08 #1): a crew under way with anyone still on it, or any member on site, is
    -- started: Report a problem, not Cancel. An in-progress crew whose every member was reported a no-show has an
    -- empty roster and still cancels for a full refund (crewNobodyLeft, JOBS-3).
    IF EXISTS (
      SELECT 1 FROM public.group_job_helpers g
       WHERE g.job_id = v_job.id AND g.helper_id IS NOT NULL
         AND (g.helper_arrived_at IS NOT NULL OR v_job.status::text IN ('in_progress', 'revision_requested'))
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
