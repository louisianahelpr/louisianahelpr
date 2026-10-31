-- The ID check, owner's rule of 2026-10-30 (replaces the removal of 2026-10-23;
-- "move to PayPal" is dropped, payouts stay on Stripe). Once per person. A poster
-- when they post a job (enforce_identity_before_post, UNCHANGED). A Helpr when
-- hired, or at the first payout if skipped; they cannot head out until verified
-- (enforce_identity_before_start, jobs + crew, UNCHANGED), including anyone hired
-- before the switch goes on. Their pay waits too. Once verified, never again.
-- Declutter: a seller when they list, a buyer at their first purchase, a delivery Helpr
-- when taking a delivery (section 1b). The seller's $2 from the payout is NOT in this change.
--
-- The switch `identity_check` stays OFF: an admin turns it on after one real session
-- works. While it is off, identity_check_exempt is TRUE for every member, so every
-- check below answers as today and landing this interrupts nobody.
--
-- Also the owner's: the poster is told 24 hours before the start and may cancel and
-- rehire without paying for the Helpr's time; nothing auto-cancels. What a captured charge
-- always keeps (the card's cost, a first job's $2: _shared/refundAmount.ts) is still kept. A dispute split waits whole. The 5 members
-- reset on 10-27 who were at 3 attempts get a fresh count.
--
-- poster_cancel_job and claim_payout_setup_reminders are restated whole.
-- REBUILT 2026-10-31 (LEAD-B49-REBUILD, Builder 31) from Builder 49's 20261030225327 (wip/b49-1030-id-rulings), which
-- never landed. New timestamp; every restated function re-read from origin/main's NEWEST CREATE (492d2b3241) and diffed:
--   poster_cancel_job            20261031015647_poster_cancel_strike_only_inside_24h.sql (NEWER than B49's base
--                                20261021130723: its strike-only-inside-24h rule (IF v_late) is kept; only B49's ID lines
--                                are added: v_id_outstanding, the on-the-way columns, the crew condition, the waiver row,
--                                the "before your ID was verified" notice. v_late reads v_committed, so no strike either.)
--   claim_payout_setup_reminders 20261030031059_job_reminder_choices.sql (B49's base, unchanged since)
--   payout_waits_on_identity     20261025162003_payout_after_hire.sql (B49's base, unchanged since)
--   payout_payee_wait_seen       20261019070737_payout_waits_for_payee_setup.sql (B49's base, unchanged since)
-- New: enforce_identity_before_delivery, identity_notify_posters_before_start, job_cancel_id_waivers.
-- Note: 20261031213005 (the 16 restored) runs first; members it restored to verified no longer match section 5.
-- Replay-safe: CREATE OR REPLACE, and the data fix matches once.

-- ── 1. No payout without a verified ID, whatever payout_after_hire says ────
-- refuse_payout_claim_while_held reads this for every job payout claim.
CREATE OR REPLACE FUNCTION public.payout_waits_on_identity(p_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
  -- identity_check_exempt is TRUE while identity_check is off for the member
  -- (and for a fixture test account), so this is FALSE until the switch goes on.
  SELECT p_user_id IS NOT NULL
     AND NOT public.identity_check_exempt(p_user_id)
     AND NOT COALESCE((SELECT public.identity_is_verified(p.idv_status, p.stripe_identity_verified)
                         FROM public.profiles p WHERE p.user_id = p_user_id), false);
$fn$;
REVOKE ALL ON FUNCTION public.payout_waits_on_identity(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.payout_waits_on_identity(uuid) TO service_role;

-- ── 1b. Declutter (owner 2026-10-30): a seller when they list and a buyer at their first
-- purchase, once across Jobs and Declutter: declutter_identity_gate stays, as do the list,
-- order, offer and counter triggers. An offer is kept because a buyer's offer commits their
-- saved card. Adding to a cart buys nothing, and checkout's order insert is gated: that one goes.
DROP TRIGGER IF EXISTS trg_declutter_cart_identity_before_buy ON public.declutter_cart_items;

-- A delivery Helpr: when they take a delivery.
CREATE OR REPLACE FUNCTION public.enforce_identity_before_delivery()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
BEGIN
  IF public.is_server_context() OR auth.uid() IS NULL THEN
    RETURN NEW;
  END IF;
  -- Judged only when the acting member takes this delivery for themselves.
  IF NEW.helpr_id IS NULL OR NEW.helpr_id IS NOT DISTINCT FROM OLD.helpr_id OR auth.uid() IS DISTINCT FROM NEW.helpr_id THEN
    RETURN NEW;
  END IF;
  IF public.identity_check_exempt(NEW.helpr_id) OR public.is_identity_verified(NEW.helpr_id) THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'identity_required_to_deliver' USING ERRCODE = '42501',
    HINT = 'Verify your ID with Stripe before you take a delivery. It takes about 2 minutes, once.';
END;
$fn$;
REVOKE ALL ON FUNCTION public.enforce_identity_before_delivery() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS trg_helpr_tasks_identity_before_take ON public.helpr_tasks;
CREATE TRIGGER trg_helpr_tasks_identity_before_take
  BEFORE UPDATE OF helpr_id ON public.helpr_tasks
  FOR EACH ROW EXECUTE FUNCTION public.enforce_identity_before_delivery();

-- ── 2. The poster may cancel and rehire without paying for the Helpr's time ─
-- void-cancelled-payments honours the 0 recorded here (it would otherwise recompute a fee).
-- The refund itself is the normal one. A hold is released whole; a captured charge comes back
-- less the card's cost and a first job's $2 setup fee. The dialog shows the amount first.
--
-- The record that this 0 was the ID rule's, for money-reconciliation: the Helpr may verify later,
-- so their status then cannot explain it, and only this row separates it from a real mismatch.
-- A table of its own because authenticated holds table-level UPDATE and INSERT on public.jobs, so
-- a new jobs column would be writable by a member. Service role reads; only poster_cancel_job writes.
CREATE TABLE IF NOT EXISTS public.job_cancel_id_waivers (
  job_id uuid PRIMARY KEY REFERENCES public.jobs(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.job_cancel_id_waivers ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.job_cancel_id_waivers FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.job_cancel_id_waivers TO service_role;
DO $gate$
BEGIN
  IF to_regprocedure('public.attach_unconfirmed_email_gate()') IS NOT NULL THEN
    PERFORM public.attach_unconfirmed_email_gate();
  END IF;
END;
$gate$;
COMMENT ON TABLE public.job_cancel_id_waivers IS
  'A single-Helpr job whose poster cancelled with no fee because the hired Helpr had not verified their ID (owner 2026-10-30). Written only by poster_cancel_job; read by money-reconciliation.';

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

-- Declutter, Shops and delivery payouts wait in category 'identity': retried, no try used, the payee told.
CREATE OR REPLACE FUNCTION public.payout_payee_wait_seen(p_kind text, p_payout_id uuid, p_payee uuid, p_amount_cents integer,
  p_category text, p_reason text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  w public.payout_payee_waits;
  v_page boolean := false;
  v_remind boolean := false;
  v_quiet boolean;
  v_bound interval;
  v_amount text := to_char(COALESCE(p_amount_cents, 0) / 100.0, 'FM999999990.00');
BEGIN
  IF p_kind IS NULL OR p_kind NOT IN ('declutter', 'helpr_task', 'shop', 'declutter_refund', 'delivery_refund') OR p_payout_id IS NULL
     OR p_category IS NULL OR p_category NOT IN ('no_account', 'setup_unfinished', 'under_review', 'rejected', 'unusable',
       'payee_deleted', 'mixed_parties', 'banned', 'data_defect', 'transient', 'record_failed', 'unreadable', 'held', 'ban_review',
       'suspended', 'needs_reconcile', 'identity') THEN
    RAISE EXCEPTION 'invalid_wait' USING ERRCODE = '22023';
  END IF;
  INSERT INTO public.payout_payee_waits (payout_kind, payout_id, payee_id, category, last_reason)
  VALUES (p_kind, p_payout_id, p_payee, p_category, left(p_category || COALESCE(': ' || NULLIF(btrim(p_reason), ''), ''), 200))
  ON CONFLICT (payout_kind, payout_id) DO UPDATE
    SET last_checked_at = now(), last_reason = EXCLUDED.last_reason, payee_id = EXCLUDED.payee_id, category = EXCLUDED.category
  RETURNING * INTO w;
  -- The payee is nudged only for what they can act on, never when banned or on payout hold.
  v_quiet := p_payee IS NULL
          OR p_category NOT IN ('no_account', 'setup_unfinished', 'under_review', 'rejected', 'unusable', 'identity')
          OR EXISTS (SELECT 1 FROM public.profiles pr WHERE pr.user_id = p_payee
                       AND pr.ban_status IN ('banned', 'temp_banned', 'permanently_banned'))
          OR EXISTS (SELECT 1 FROM public.payout_holds ph WHERE ph.helper_id = p_payee);
  IF NOT v_quiet AND NOT EXISTS (SELECT 1 FROM public.payout_payee_reminders r
                                  WHERE r.payee_id = p_payee AND r.last_reminded_at > now() - interval '3 days') THEN
    v_remind := true;
    INSERT INTO public.payout_payee_reminders (payee_id, last_reminded_at) VALUES (p_payee, now())
    ON CONFLICT (payee_id) DO UPDATE SET last_reminded_at = now();
    UPDATE public.payout_payee_waits SET last_reminded_at = now() WHERE payout_kind = p_kind AND payout_id = p_payout_id;
    PERFORM public.declutter_notify(p_payee, 'payment',
      CASE p_category
        WHEN 'identity' THEN 'Verify your ID to get paid'
        WHEN 'under_review' THEN 'Stripe is reviewing your payout account'
        WHEN 'rejected' THEN 'Your payout account needs help'
        WHEN 'unusable' THEN 'Set up payouts again to get paid'
        ELSE 'Finish payout setup to get paid' END,
      CASE p_category
        WHEN 'identity' THEN format('$%s is waiting for you. Verify your ID once with Stripe and we send it right away.', v_amount)
        WHEN 'under_review' THEN format('$%s is waiting for you. Stripe is reviewing your payout account; we send it as soon as they finish. Nothing to do unless Stripe asks you for something.', v_amount)
        WHEN 'rejected' THEN format('$%s is waiting for you, but Stripe would not approve your payout account. Contact Louisiana Helpr support and we will help you sort it out.', v_amount)
        WHEN 'unusable' THEN format('$%s is waiting for you, but your payout account can no longer be used. Set up payouts again in your profile''s Earnings tab.', v_amount)
        ELSE format('$%s is waiting for you. Finish payout setup in your profile''s Earnings tab and we send it right away.', v_amount) END,
      CASE p_category WHEN 'identity' THEN '/home?verify_id=1' ELSE '/profile?tab=earnings' END);
  END IF;
  -- Ops: ONCE per payout when its bound is reached; again only when the reason changed to
  -- one that will not fix itself. Only ANSWERED here: payout_payee_paged marks it after the
  -- Slack post went through.
  v_bound := CASE WHEN p_category IN ('rejected', 'unusable', 'payee_deleted', 'mixed_parties', 'banned', 'data_defect', 'needs_reconcile') THEN interval '0'
                  WHEN p_category IN ('transient', 'record_failed', 'unreadable') THEN interval '24 hours'
                  ELSE interval '7 days' END;
  IF (w.ops_paged_at IS NULL
      OR (w.paged_category IS DISTINCT FROM p_category AND p_category IN ('rejected', 'unusable', 'payee_deleted', 'mixed_parties', 'banned', 'data_defect', 'needs_reconcile')))
     AND w.first_waiting_at <= now() - v_bound THEN
    v_page := true;
  END IF;
  RETURN jsonb_build_object('page_due', v_page, 'reminded', v_remind, 'waiting_since', w.first_waiting_at,
    'payee_seed', COALESCE((SELECT pr.is_seed FROM public.profiles pr WHERE pr.user_id = p_payee), false));
END;
$fn$;
REVOKE ALL ON FUNCTION public.payout_payee_wait_seen(text, uuid, uuid, integer, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.payout_payee_wait_seen(text, uuid, uuid, integer, text, text) TO service_role;

-- ── 3. The hire ladder asks for the ID while it is outstanding ──────────────
CREATE OR REPLACE FUNCTION public.claim_payout_setup_reminders(p_limit integer DEFAULT 100)
 RETURNS TABLE(helper_id uuid, reminder_key text, stage text, job_id uuid, job_title text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  -- When payout_after_hire went to everyone (feature_switches.updated_at,
  -- measured 2026-10-27). A constant on purpose: updated_at moves on every
  -- later audience change, and a hire before go-live was never told to set up
  -- at the hire, so it is not told now.
  v_since constant timestamptz := '2026-10-25 23:40:59+00';
BEGIN
  RETURN QUERY
  WITH hires AS (
    SELECT j.helper_id AS uid, j.id AS jid, j.title AS jtitle, j.payment_status::text AS pay,
           j.accepted_at AS hired_on,
           (j.status::text NOT IN ('completed', 'cancelled', 'disputed')) AS live
      FROM public.jobs j
     WHERE j.helper_id IS NOT NULL
       AND j.status::text <> 'cancelled'
       AND j.payment_status::text IN ('escrow', 'payout_pending')
    UNION ALL
    -- A crew seat: hired when it joined; the crew job may still be 'open'
    -- while other seats fill.
    SELECT g.helper_id, j.id, j.title, j.payment_status::text,
           g.joined_at,
           (j.status::text NOT IN ('completed', 'cancelled', 'disputed'))
      FROM public.group_job_helpers g
      JOIN public.jobs j ON j.id = g.job_id
     WHERE j.status::text <> 'cancelled'
       AND j.payment_status::text IN ('escrow', 'payout_pending')
  ),
  helprs AS (
    SELECT DISTINCT h.uid
      FROM hires h
      JOIN public.profiles p ON p.user_id = h.uid
     WHERE (p.stripe_account_id IS NULL OR p.stripe_payouts_enabled IS NOT TRUE
              -- Owner 2026-10-30: the same ladder asks for the ID check while it is on for them.
              OR public.payout_waits_on_identity(h.uid))
       AND NOT (p.is_seed IS TRUE AND p.stripe_account_id IS NULL
                AND EXISTS (SELECT 1 FROM public.test_accounts t WHERE t.user_id = p.user_id))
       AND NOT EXISTS (SELECT 1 FROM public.payout_setup_reminders r
                        WHERE r.helper_id = h.uid AND r.claimed_at > now() - interval '20 hours')
       AND public.feature_enabled_for_user('payout_after_hire', h.uid)
       AND public.feature_enabled_for_user('payout_setup', h.uid)
  ),
  -- One 'hired' per hire: a live hire made after go-live and in the last 72 h
  -- that has not had its own. Not a COMPLETED or disputed job (owner report
  -- 2026-10-26), not a hire from before go-live, not one with no hire time.
  hired_due AS (
    SELECT DISTINCT ON (h.uid) h.uid, h.jid
      FROM hires h
     WHERE h.uid IN (SELECT x.uid FROM helprs x)
       AND h.live
       AND h.hired_on >= v_since
       AND h.hired_on > now() - interval '72 hours'
       AND NOT EXISTS (SELECT 1 FROM public.payout_setup_reminders r
                        WHERE r.helper_id = h.uid AND r.reminder_stage = 'hired' AND r.job_id = h.jid)
     ORDER BY h.uid, h.hired_on DESC, h.jid
  ),
  -- day1 / day3 / day7 per hire, counted from THAT hire's 'hired' reminder,
  -- and only while the hire is live.
  nudge_due AS (
    SELECT DISTINCT ON (n.uid) n.uid, n.jid, n.step
      FROM (
        SELECT h.uid, h.jid,
               CASE
                 WHEN hr.claimed_at <= now() - interval '7 days' AND COALESCE(ls.last_step, 0) < 3 THEN 'day7'
                 WHEN hr.claimed_at <= now() - interval '3 days' AND COALESCE(ls.last_step, 0) < 2 THEN 'day3'
                 WHEN hr.claimed_at <= now() - interval '1 day'  AND COALESCE(ls.last_step, 0) < 1 THEN 'day1'
               END AS step
          FROM hires h
          JOIN public.payout_setup_reminders hr
            ON hr.helper_id = h.uid AND hr.reminder_stage = 'hired' AND hr.job_id = h.jid
          LEFT JOIN LATERAL (
            SELECT max(CASE r.reminder_stage WHEN 'day1' THEN 1 WHEN 'day3' THEN 2 WHEN 'day7' THEN 3 ELSE 0 END) AS last_step
              FROM public.payout_setup_reminders r
             WHERE r.helper_id = h.uid AND r.job_id = h.jid AND r.reminder_stage IN ('day1', 'day3', 'day7')
          ) ls ON true
         WHERE h.live AND h.uid IN (SELECT x.uid FROM helprs x)
           -- Job reminders (owner 2026-10-29): the day1/day3/day7 follow-ups are
           -- switchable; 'hired' and 'money' stay always on.
           AND NOT EXISTS (SELECT 1 FROM public.notification_preferences np
                            WHERE np.user_id = h.uid AND np.remind_payout_followups IS FALSE)
      ) n
     WHERE n.step IS NOT NULL
     ORDER BY n.uid, n.jid
  ),
  due AS (
    SELECT x.uid,
           -- money first: one per job whose payout waits on this Helpr
           (SELECT 'money:' || h.jid::text FROM hires h
             WHERE h.uid = x.uid AND h.pay = 'payout_pending'
               AND NOT EXISTS (SELECT 1 FROM public.payout_setup_reminders r
                                WHERE r.helper_id = x.uid AND r.reminder_key = 'money:' || h.jid::text)
             ORDER BY h.jid LIMIT 1) AS money_key,
           (SELECT hd.jid FROM hired_due hd WHERE hd.uid = x.uid) AS hired_jid,
           (SELECT nd.jid FROM nudge_due nd WHERE nd.uid = x.uid) AS nudge_jid,
           (SELECT nd.step FROM nudge_due nd WHERE nd.uid = x.uid) AS nudge_step
      FROM helprs x
  ),
  chosen AS (
    SELECT d.uid,
           CASE WHEN d.money_key IS NOT NULL THEN d.money_key
                WHEN d.hired_jid IS NOT NULL THEN 'hired:' || d.hired_jid::text
                ELSE d.nudge_step || ':' || d.nudge_jid::text END AS rkey,
           CASE WHEN d.money_key IS NOT NULL THEN 'money'
                WHEN d.hired_jid IS NOT NULL THEN 'hired'
                ELSE d.nudge_step END AS rstage,
           CASE WHEN d.money_key IS NOT NULL THEN substr(d.money_key, 7)::uuid
                WHEN d.hired_jid IS NOT NULL THEN d.hired_jid
                ELSE d.nudge_jid END AS rjob
      FROM due d
     WHERE d.money_key IS NOT NULL OR d.hired_jid IS NOT NULL OR d.nudge_step IS NOT NULL
     ORDER BY d.uid
     LIMIT GREATEST(COALESCE(p_limit, 100), 0)
  ),
  ins AS (
    INSERT INTO public.payout_setup_reminders (helper_id, reminder_key, reminder_stage, job_id)
    SELECT c.uid, c.rkey, c.rstage, c.rjob FROM chosen c
    ON CONFLICT DO NOTHING
    RETURNING public.payout_setup_reminders.helper_id, public.payout_setup_reminders.reminder_key,
              public.payout_setup_reminders.reminder_stage, public.payout_setup_reminders.job_id
  )
  SELECT i.helper_id, i.reminder_key, i.reminder_stage, i.job_id, j.title
    FROM ins i
    LEFT JOIN public.jobs j ON j.id = i.job_id;
END;
$function$;
REVOKE ALL ON FUNCTION public.claim_payout_setup_reminders(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_payout_setup_reminders(integer) TO service_role;

-- ── 4. The poster is told 24 hours before the start ────────────────────────
-- Called by the payout-setup-reminders cron. One notice per job and Helpr: the
-- notification row is the record. Nothing auto-cancels.
CREATE OR REPLACE FUNCTION public.identity_notify_posters_before_start(p_limit integer DEFAULT 100)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_title constant text := 'Your Helpr hasn''t verified their ID yet';
  v_count integer;
BEGIN
  WITH hired AS (
    SELECT j.id, j.title, j.customer_id, j.date_needed, j.start_time, j.helper_id AS uid,
           j.helper_on_the_way_at AS otw, j.helper_arrived_at AS arrived
      FROM public.jobs j
     WHERE j.helper_id IS NOT NULL AND j.status::text = 'accepted' AND j.customer_id IS NOT NULL
    UNION ALL
    SELECT j.id, j.title, j.customer_id, j.date_needed, j.start_time, g.helper_id,
           g.helper_on_the_way_at, g.helper_arrived_at
      FROM public.group_job_helpers g JOIN public.jobs j ON j.id = g.job_id
     WHERE g.helper_id IS NOT NULL AND j.status::text IN ('open', 'accepted') AND j.customer_id IS NOT NULL
  ), due AS (
    SELECT DISTINCT ON (h.id) h.id, h.title, h.customer_id
      FROM hired h
     WHERE h.otw IS NULL AND h.arrived IS NULL
       AND public.job_hours_until_start(h.date_needed, h.start_time, now()) BETWEEN 0 AND 24
       AND public.payout_waits_on_identity(h.uid)
       AND NOT EXISTS (SELECT 1 FROM public.notifications n
                        WHERE n.user_id = h.customer_id AND n.job_id = h.id AND n.title = v_title)
     ORDER BY h.id
     LIMIT GREATEST(COALESCE(p_limit, 100), 0)
  ), ins AS (
    INSERT INTO public.notifications (user_id, title, message, type, link, job_id)
    SELECT d.customer_id, v_title,
           format('They can''t head out to "%s" until they do. You can cancel without paying for their time and hire someone else, or wait for them. You''ll see what comes back to you before you confirm. Nothing changes unless you choose.', COALESCE(d.title, 'your job')),
           'warning', '/jobs?job=' || d.id::text, d.id
      FROM due d
    RETURNING 1
  )
  SELECT count(*) INTO v_count FROM ins;
  RETURN v_count;
END;
$fn$;
REVOKE ALL ON FUNCTION public.identity_notify_posters_before_start(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.identity_notify_posters_before_start(integer) TO service_role;

-- ── 5. Data, once: the 5 reset on 10-27 who sit at 3 attempts could never start
-- a check again (claim_idv_attempt: attempt_limit_reached). Owner 2026-10-30.
-- The audit row names the reset; a later attempt moves idv_attempted_at past it.
UPDATE public.profiles p
   SET idv_attempt_count = 0
 WHERE p.idv_status = 'not_started'
   AND p.idv_attempt_count >= 3
   AND p.is_seed IS NOT TRUE
   AND p.idv_attempted_at < timestamptz '2026-10-27 16:59:00+00'
   AND EXISTS (SELECT 1 FROM public.helper_verifications h
                WHERE h.user_id = p.user_id AND h.field = 'idv_status'
                  AND h.old_value = 'verified' AND h.new_value = 'not_started'
                  AND h.changed_at >= timestamptz '2026-10-27 16:59:00+00'
                  AND h.changed_at <  timestamptz '2026-10-27 17:00:00+00');

UPDATE public.feature_switches
   SET description = 'ID verification (Stripe Identity), once per person. Off = no ID check is required or offered anywhere. Testers = admins and test accounts only. Everyone = every member: asked when posting a job or when hired; an unverified hired Helpr cannot head out and no payout goes out until verified. Never at sign-up or applying. While off, the ID-level ban-evasion check does not run. Homes'' landlord photo-ID review does not depend on this switch.'
 WHERE key = 'identity_check';
