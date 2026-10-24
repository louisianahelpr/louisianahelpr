-- PayPal Plan A, phase 4: approve, then the admin "Pay this Helpr" queue (owner 2026-10-23: live PayPal
-- Payouts was denied, so the owner pays each Helpr by hand with PayPal Send Money and then presses
-- "Mark paid" with PayPal's transaction id). Design ~/.lh-wt/paypal-design.md section 6, row 4.
-- Builds on 20261023223419_paypal_provider_foundation (provider_payments / provider_payouts /
-- payee_accounts and their money guards).
--
-- THE FLOW
--   1. The poster approves (create-payment release) or the 24 h auto-release fires: the job goes to
--      completed / payout_pending exactly as before. For a job paid through PayPal (a captured
--      provider_payments row for the job), the edge function then calls
--      paypal_queue_manual_payout(): ONE transaction writes the payout_transfers claim (the existing
--      one-live-payout-per-job+Helpr lock, so no Stripe path can also pay it) and a provider_payouts
--      row (manual_paypal, pending) with the Helpr's PayPal email copied in and frozen.
--      Refunds of that payment are refused from here on (provider_refunds_guard, phase 1).
--   2. The admin sees it in admin_paypal_payout_queue(): name, amount, PayPal email, job.
--   3. The admin pays by hand, then admin_mark_paypal_payout_paid() with the rows paid in that ONE
--      Send Money (a Helpr's job pay and tips) and its ONE transaction id: admin only, the total typed
--      must equal the rows' total (and each job line its claim), the id is required, the same id twice
--      is a no-op, a different id on a paid row is refused, and one id names one payee + destination. It records who and when, writes admin_audit_log, moves
--      payout_transfers to 'paid' and the job to 'released', and tells the Helpr. Members never see
--      "paid" before this: until then payout_transfers says 'pending' and the job 'payout_pending'.
--   4. A Helpr who changes their PayPal email has their pending rows set to 'held' (phase 2), and a
--      payout queued to a destination changed since the Helpr's hire is written 'held' here. The
--      queue shows those as "Helpr changed their PayPal email", never as payable;
--      admin_requeue_held_paypal_payout() cancels the held claim and row and queues a fresh one to
--      the CURRENT payable email after the admin has checked it AND confirmed no Send Money went out.
--
-- THE SWITCH. The three admin RPCs start with require_feature('paypal_payments'). The writer
-- paypal_queue_manual_payout() is service-role only and has no signed-in user (it runs from the
-- release paths and crons); it acts only on a job that already has a captured provider_payments row,
-- which the database refuses to create for anyone the switch is off for (design 5.2).
--
-- get_payout_batches (the Stripe "Payout Queue") stops listing PayPal-paid jobs: its "Send Payout"
-- is a Stripe transfer, and PayPal jobs are paid from the new queue only.
--
-- REPLAY-SAFETY: CREATE OR REPLACE throughout; no table or column is created or altered.

-- ---------------------------------------------------------------------------------------------
-- When a member's PayPal destination last changed (Phase 1 review condition, P2 + P4): a new email
-- resets only `verified`, so the database alone would let a hijacked, freshly changed email be paid.
-- The queue writer compares this with the Helpr's hire (jobs.accepted_at, else the approval) and
-- refuses to queue a pending payout to a destination changed since then until an admin re-confirms
-- it (the row is written 'held').
-- ---------------------------------------------------------------------------------------------
ALTER TABLE public.payee_accounts ADD COLUMN IF NOT EXISTS destination_changed_at timestamptz NOT NULL DEFAULT now();

CREATE OR REPLACE FUNCTION public.payee_accounts_stamp_destination_change()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $fn$
BEGIN
  IF TG_OP = 'INSERT' THEN
    NEW.destination_changed_at := now();
  ELSIF NEW.user_id IS DISTINCT FROM OLD.user_id
     OR NEW.paypal_email IS DISTINCT FROM OLD.paypal_email
     OR NEW.paypal_payer_id IS DISTINCT FROM OLD.paypal_payer_id
     OR NEW.venmo_handle IS DISTINCT FROM OLD.venmo_handle THEN
    NEW.destination_changed_at := now();
  ELSE
    -- Server-owned: no writer moves it by hand.
    NEW.destination_changed_at := OLD.destination_changed_at;
  END IF;
  RETURN NEW;
END;
$fn$;
REVOKE ALL ON FUNCTION public.payee_accounts_stamp_destination_change() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_payee_accounts_stamp_destination_change ON public.payee_accounts;
CREATE TRIGGER trg_payee_accounts_stamp_destination_change
  BEFORE INSERT OR UPDATE ON public.payee_accounts
  FOR EACH ROW EXECUTE FUNCTION public.payee_accounts_stamp_destination_change();

-- ---------------------------------------------------------------------------------------------
-- The destination a manual payout copies: the Helpr's payable PayPal account in the payment's env.
-- Email first (Send Money is to an email), then payer id, then Venmo handle.
-- ---------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.paypal_payout_destination(p_user_id uuid, p_env text)
RETURNS TABLE (destination_kind text, destination_value text, changed_at timestamptz)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
  SELECT CASE WHEN a.paypal_email IS NOT NULL THEN 'paypal_email'
              WHEN a.paypal_payer_id IS NOT NULL THEN 'paypal_payer_id'
              ELSE 'venmo_handle' END,
         COALESCE(a.paypal_email, a.paypal_payer_id, a.venmo_handle),
         a.destination_changed_at
    FROM public.payee_accounts a
   WHERE a.user_id = p_user_id
     AND a.provider = 'paypal'
     AND a.env = p_env
     AND a.payable
     AND COALESCE(a.paypal_email, a.paypal_payer_id, a.venmo_handle) IS NOT NULL;
$fn$;
REVOKE ALL ON FUNCTION public.paypal_payout_destination(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.paypal_payout_destination(uuid, text) TO service_role;

-- ---------------------------------------------------------------------------------------------
-- 1. The queue writer (service role only). Idempotent: a job already queued answers already_queued.
-- ---------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.paypal_queue_manual_payout(
  p_job_id uuid,
  p_helper_id uuid,
  p_amount_cents integer,
  p_platform_fee_cents integer,
  p_initiated_by text DEFAULT 'system',
  p_initiated_by_user_id uuid DEFAULT NULL,
  p_source text DEFAULT 'release'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  v_job record;
  v_pay record;
  v_live record;
  v_dest record;
  v_pt_id uuid;
  v_payout_id uuid;
  v_unconfirmed boolean := false;
  v_disputes record;
  v_constraint text;
BEGIN
  IF p_job_id IS NULL OR p_helper_id IS NULL THEN
    RAISE EXCEPTION 'job_and_helper_required' USING ERRCODE = '22023';
  END IF;
  IF p_amount_cents IS NULL OR p_amount_cents <= 0 OR p_platform_fee_cents IS NULL OR p_platform_fee_cents < 0 THEN
    RAISE EXCEPTION 'payout_amount_invalid' USING ERRCODE = '22023';
  END IF;

  -- The job row is the serialization point with the release / refund / dispute writers.
  SELECT j.id, j.status::text AS status, j.payment_status::text AS payment_status, j.helper_id,
         j.is_group_job, j.helpers_needed, j.disputed_at, j.dispute_status::text AS dispute_status,
         -- The anchor a destination must predate: the Helpr's hire (the accept gate needs a payable
         -- email by then), else the approval. A job with neither is treated as unconfirmed.
         COALESCE(j.accepted_at, j.poster_completed_at, j.helper_completed_at) AS anchor_at
    INTO v_job
    FROM public.jobs j
   WHERE j.id = p_job_id
     FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('outcome', 'refused', 'reason', 'job_not_found');
  END IF;

  -- The money this pays out of: the job's own payment; for a cancellation fee also a repeat visit's
  -- payment that funded this job (phase 6's provider_payments.funds_job_id, read through to_jsonb so
  -- this compiles and runs before that column exists).
  SELECT p.id, p.env, p.amount_cents, p.status
    INTO v_pay
    FROM public.provider_payments p
   WHERE p.status IN ('captured', 'partially_refunded')
     AND ((p.subject_kind = 'job' AND p.subject_id = p_job_id)
          OR (p_source = 'cancellation_fee' AND p.subject_kind = 'recurring_visit'
              AND NULLIF(to_jsonb(p) ->> 'funds_job_id', '')::uuid = p_job_id))
   ORDER BY (p.subject_kind = 'job') DESC, p.created_at DESC
   LIMIT 1;
  IF NOT FOUND THEN
    -- Not a PayPal job (or its money is not settled): nothing here may queue it.
    RETURN jsonb_build_object('outcome', 'refused', 'reason', 'no_captured_paypal_payment');
  END IF;

  -- Already queued (or paid): the same answer every time, nothing new written.
  SELECT pt.id AS payout_transfer_id, pt.status AS transfer_status, pp.id AS payout_id, pp.status AS payout_status
    INTO v_live
    FROM public.payout_transfers pt
    LEFT JOIN public.provider_payouts pp ON pp.payout_transfer_id = pt.id
   WHERE pt.job_id = p_job_id AND pt.helper_id = p_helper_id
     AND pt.status IN ('pending', 'paid', 'reversed')
   LIMIT 1;
  IF FOUND THEN
    IF v_live.payout_id IS NULL THEN
      -- A claim no manual payout belongs to (a Stripe-era row): never pay on top of it.
      RETURN jsonb_build_object('outcome', 'refused', 'reason', 'other_payout_claim_exists',
                                'payout_transfer_id', v_live.payout_transfer_id);
    END IF;
    IF v_live.payout_status NOT IN ('pending', 'held', 'success') THEN
      -- A live claim whose payout row is canceled/failed/returned: nothing payable stands behind it.
      RETURN jsonb_build_object('outcome', 'refused', 'reason', 'claim_has_no_payable_payout',
                                'payout_id', v_live.payout_id, 'payout_status', v_live.payout_status);
    END IF;
    RETURN jsonb_build_object('outcome', 'already_queued', 'payout_id', v_live.payout_id,
                              'payout_status', v_live.payout_status, 'payout_transfer_id', v_live.payout_transfer_id);
  END IF;

  IF v_job.helper_id IS DISTINCT FROM p_helper_id THEN
    RETURN jsonb_build_object('outcome', 'refused', 'reason', 'not_the_jobs_helpr');
  END IF;
  -- An admin canceled this job's manual payout (admin_cancel_paypal_payout): the crons must not put it
  -- straight back. Only the admin's own "Queue now" re-queues it.
  IF COALESCE(p_source, '') <> 'admin_queue_now'
     AND EXISTS (SELECT 1 FROM public.payout_transfers x
                  WHERE x.job_id = p_job_id AND x.helper_id = p_helper_id AND x.status = 'canceled'
                    AND x.metadata ->> 'canceled_by_admin' IS NOT NULL) THEN
    RETURN jsonb_build_object('outcome', 'refused', 'reason', 'canceled_by_admin');
  END IF;
  IF v_job.is_group_job IS TRUE AND COALESCE(v_job.helpers_needed, 1) > 1 THEN
    -- A crew's frozen per-member shares are not built for PayPal yet.
    RETURN jsonb_build_object('outcome', 'refused', 'reason', 'crew_not_supported');
  END IF;

  IF p_source = 'cancellation_fee' THEN
    -- Phase 6 (lead 2026-10-23): the Helpr's share of a cancellation fee, queued while the cancelled
    -- job's money is still held ('escrow'), before phase 6 flips it.
    IF v_job.status <> 'cancelled' OR v_job.payment_status <> 'escrow' THEN
      RETURN jsonb_build_object('outcome', 'refused', 'reason', 'job_not_cancelled_with_held_money',
                                'status', v_job.status, 'payment_status', v_job.payment_status);
    END IF;
    IF v_job.disputed_at IS NOT NULL AND COALESCE(v_job.dispute_status, '') NOT IN ('resolved', 'auto_resolved') THEN
      RETURN jsonb_build_object('outcome', 'refused', 'reason', 'dispute_open');
    END IF;
  ELSIF p_source = 'refund_request_remainder' THEN
    -- Phase 5's agreed refund request (lead 2026-10-23): the poster's part was refunded first
    -- (partially_refunded), the job is completed with its money still held ('escrow'), and the
    -- job's ONE live dispute is the agreement being executed. The Helpr's remainder is queued here.
    IF v_job.status <> 'completed' OR v_job.payment_status <> 'escrow' THEN
      RETURN jsonb_build_object('outcome', 'refused', 'reason', 'job_not_approved',
                                'status', v_job.status, 'payment_status', v_job.payment_status);
    END IF;
    IF v_pay.status <> 'partially_refunded' THEN
      RETURN jsonb_build_object('outcome', 'refused', 'reason', 'remainder_needs_partial_refund');
    END IF;
    -- The poster's part must have reached them (completed), not only be on its way.
    IF NOT EXISTS (SELECT 1 FROM public.provider_refunds r WHERE r.provider_payment_id = v_pay.id AND r.status = 'completed') THEN
      RETURN jsonb_build_object('outcome', 'refused', 'reason', 'remainder_needs_completed_refund');
    END IF;
    SELECT count(*) AS live,
           count(*) FILTER (WHERE d.status = 'decided' AND d.decided_via = 'agreement' AND d.execution_status = 'executing') AS agreed
      INTO v_disputes
      FROM public.disputes d
     WHERE d.job_id = p_job_id
       AND (d.status = 'open' OR (d.status = 'decided' AND d.execution_status IS DISTINCT FROM 'executed'));
    IF v_disputes.live <> 1 OR v_disputes.agreed <> 1 THEN
      RETURN jsonb_build_object('outcome', 'refused', 'reason', 'remainder_needs_executing_agreement');
    END IF;
  ELSE
    IF v_job.status <> 'completed' OR v_job.payment_status <> 'payout_pending' THEN
      RETURN jsonb_build_object('outcome', 'refused', 'reason', 'job_not_approved',
                                'status', v_job.status, 'payment_status', v_job.payment_status);
    END IF;
    IF v_job.disputed_at IS NOT NULL AND COALESCE(v_job.dispute_status, '') NOT IN ('resolved', 'auto_resolved') THEN
      RETURN jsonb_build_object('outcome', 'refused', 'reason', 'dispute_open');
    END IF;
    -- A decided dispute owns the money until its split runs (release-payout's checkUnsettledDispute).
    IF EXISTS (SELECT 1 FROM public.disputes d
                WHERE d.job_id = p_job_id AND d.status = 'decided'
                  AND (d.execution_status IS NULL OR d.execution_status <> 'executed')) THEN
      RETURN jsonb_build_object('outcome', 'refused', 'reason', 'dispute_decided_not_settled');
    END IF;
  END IF;

  -- Lock the destination row for this transaction (phase 2 review 2026-10-23): an email change
  -- committing meanwhile waits for this INSERT, then holds the row it finds (set_paypal_payee_email),
  -- instead of this copying the old email into a payout left pending.
  PERFORM 1 FROM public.payee_accounts a
   WHERE a.user_id = p_helper_id AND a.provider = 'paypal' AND a.env = v_pay.env
     FOR SHARE;
  SELECT * INTO v_dest FROM public.paypal_payout_destination(p_helper_id, v_pay.env) LIMIT 1;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('outcome', 'waiting_for_payee', 'reason', 'no_payable_paypal_account');
  END IF;

  -- A destination changed after the Helpr was hired is not paid on its own say-so (a taken-over
  -- account changing the email mid-job, Phase 1 review condition P2 + P4): the row is written 'held'
  -- (money reserved, refunds blocked) and its claim records why, until an admin checks the change and
  -- re-queues it (admin_requeue_held_paypal_payout). No anchor at all is treated the same way.
  v_unconfirmed := v_job.anchor_at IS NULL OR v_dest.changed_at >= v_job.anchor_at;

  BEGIN
    INSERT INTO public.payout_transfers (job_id, helper_id, amount_cents, platform_fee_cents, status,
                                         initiated_by, initiated_by_user_id, metadata)
    VALUES (p_job_id, p_helper_id, p_amount_cents, p_platform_fee_cents, 'pending',
            p_initiated_by, p_initiated_by_user_id,
            jsonb_build_object('source', 'manual_paypal', 'queued_by', COALESCE(NULLIF(btrim(p_source), ''), 'release'),
                               'provider_payment_id', v_pay.id)
            || CASE WHEN v_unconfirmed THEN jsonb_build_object('held_reason', 'destination_changed_since_hire')
                    ELSE '{}'::jsonb END)
    RETURNING id INTO v_pt_id;

    INSERT INTO public.provider_payouts (provider_payment_id, payout_transfer_id, payee_user_id, provider, env,
                                         destination_kind, destination_value, amount_cents, status)
    VALUES (v_pay.id, v_pt_id, p_helper_id, 'manual_paypal', v_pay.env,
            v_dest.destination_kind, v_dest.destination_value, p_amount_cents,
            CASE WHEN v_unconfirmed THEN 'held' ELSE 'pending' END)
    RETURNING id INTO v_payout_id;
  EXCEPTION
    WHEN unique_violation THEN
      GET STACKED DIAGNOSTICS v_constraint = CONSTRAINT_NAME;
      IF v_constraint = 'payout_transfers_one_live_per_job_helper' THEN
        -- A concurrent writer queued it first: answer with ITS row, never a bare "done".
        SELECT pp.id, pp.status INTO v_live
          FROM public.payout_transfers pt JOIN public.provider_payouts pp ON pp.payout_transfer_id = pt.id
         WHERE pt.job_id = p_job_id AND pt.helper_id = p_helper_id AND pt.status IN ('pending', 'paid', 'reversed')
         LIMIT 1;
        IF FOUND THEN
          RETURN jsonb_build_object('outcome', 'already_queued', 'reason', 'concurrent_claim',
                                    'payout_id', v_live.id, 'payout_status', v_live.status);
        END IF;
      END IF;
      RAISE;
    WHEN check_violation THEN
      IF SQLERRM = 'payout_held' THEN
        -- payout_holds / ban review / job hold (refuse_payout_claim_while_held): queued when released.
        RETURN jsonb_build_object('outcome', 'held', 'reason', 'payout_held', 'detail', 'see payout holds');
      END IF;
      IF SQLERRM = 'payout_exceeds_payment' THEN
        RETURN jsonb_build_object('outcome', 'refused', 'reason', 'payout_exceeds_payment');
      END IF;
      RAISE;
  END;

  IF v_unconfirmed THEN
    RETURN jsonb_build_object('outcome', 'queued_held', 'reason', 'destination_changed_since_hire',
                              'payout_id', v_payout_id, 'payout_transfer_id', v_pt_id,
                              'amount_cents', p_amount_cents, 'env', v_pay.env);
  END IF;
  RETURN jsonb_build_object('outcome', 'queued', 'payout_id', v_payout_id, 'payout_transfer_id', v_pt_id,
                            'amount_cents', p_amount_cents, 'env', v_pay.env);
END;
$fn$;
REVOKE ALL ON FUNCTION public.paypal_queue_manual_payout(uuid, uuid, integer, integer, text, uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.paypal_queue_manual_payout(uuid, uuid, integer, integer, text, uuid, text) TO service_role;


-- ---------------------------------------------------------------------------------------------
-- 2. One PayPal transaction id names ONE payee and destination (lead contract 2026-10-23: the owner
--    pays a Helpr's job pay and tips in one Send Money, so several rows share one id). Replaces phase
--    1's UNIQUE(external_txn_id), which allowed only one row per id. The advisory lock serializes two
--    Mark paid presses that use the same id at once.
-- ---------------------------------------------------------------------------------------------
ALTER TABLE public.provider_payouts DROP CONSTRAINT IF EXISTS provider_payouts_external_txn_id_key;
CREATE INDEX IF NOT EXISTS provider_payouts_external_txn_idx
  ON public.provider_payouts (external_txn_id) WHERE external_txn_id IS NOT NULL;

-- THE rule, in one place: does this PayPal transaction id already mark a payout to someone else (or
-- another PayPal account, or the other env)? Read by the trigger (the backstop) and by Mark paid
-- (so the admin gets the plain refusal before anything is written).
CREATE OR REPLACE FUNCTION public.paypal_txn_names_other_payee(p_txn text, p_payee uuid, p_destination text, p_env text, p_except uuid DEFAULT NULL)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
  SELECT EXISTS (SELECT 1 FROM public.provider_payouts o
                  WHERE o.external_txn_id = p_txn
                    AND o.id IS DISTINCT FROM p_except
                    AND (o.payee_user_id IS DISTINCT FROM p_payee
                         OR o.destination_value IS DISTINCT FROM p_destination
                         OR o.env IS DISTINCT FROM p_env));
$fn$;
REVOKE ALL ON FUNCTION public.paypal_txn_names_other_payee(text, uuid, text, text, uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.provider_payouts_txn_names_one_payee()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
BEGIN
  IF NEW.external_txn_id IS NULL THEN
    RETURN NEW;
  END IF;
  PERFORM pg_advisory_xact_lock(hashtext('provider_payouts_txn:' || NEW.external_txn_id));
  IF public.paypal_txn_names_other_payee(NEW.external_txn_id, NEW.payee_user_id, NEW.destination_value, NEW.env, NEW.id) THEN
    RAISE EXCEPTION 'txn_id_already_used' USING ERRCODE = '23505',
      DETAIL = 'That PayPal transaction ID already marks a payout to a different person or PayPal account.';
  END IF;
  RETURN NEW;
END;
$fn$;
REVOKE ALL ON FUNCTION public.provider_payouts_txn_names_one_payee() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_provider_payouts_txn_names_one_payee ON public.provider_payouts;
CREATE TRIGGER trg_provider_payouts_txn_names_one_payee
  BEFORE INSERT OR UPDATE OF external_txn_id ON public.provider_payouts
  FOR EACH ROW EXECUTE FUNCTION public.provider_payouts_txn_names_one_payee();

-- ---------------------------------------------------------------------------------------------
-- 3. The admin queue: one line per manual payout row (job pay, or a tip once pp-tips adds tip_id),
--    pending / held / marked paid in the last 30 days, plus approved PayPal jobs with no live claim
--    and the reason in words. The screen groups pending lines by (payee, destination, env) into one
--    "send this total". tip_id is read through to_jsonb(row) so this compiles before and after the
--    tips migration.
--    NOT behind the switch (lead + lh-silent-failure review 2026-10-23): it only reads, it is admin
--    only, and money already owed must stay visible when paypal_payments is turned off. Recording a
--    payment (Mark paid, re-queue) stays behind the switch.
-- ---------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.paypal_pay_blocked(p_job_id uuid, p_helper_id uuid, p_payment_status text)
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
  -- The same hold sources refuse_payout_claim_while_held reads, plus the money's own state: a hold
  -- placed AFTER a payout was queued must still stop the admin sending it.
  SELECT CASE
    WHEN EXISTS (SELECT 1 FROM public.payout_holds h WHERE h.helper_id = p_helper_id) THEN 'payout_hold'
    WHEN EXISTS (SELECT 1 FROM public.job_payout_holds jh WHERE jh.job_id = p_job_id) THEN 'job_hold'
    WHEN EXISTS (SELECT 1 FROM public.ban_settlement_queue q JOIN public.jobs j ON j.id = p_job_id
                  WHERE q.review_state = 'open' AND q.user_id IN (j.customer_id, j.helper_id, p_helper_id)) THEN 'ban_review'
    WHEN p_payment_status IN ('disputed', 'reversed') THEN 'payment_disputed'
    WHEN p_payment_status IN ('refunded', 'voided', 'failed') THEN 'payment_refunded'
    ELSE NULL
  END;
$fn$;
REVOKE ALL ON FUNCTION public.paypal_pay_blocked(uuid, uuid, text) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.admin_paypal_payout_queue()
RETURNS TABLE (
  row_kind text,                -- 'payout' | 'not_queued'
  line_kind text,               -- 'job' | 'tip'
  payout_id uuid,
  status text,                  -- provider_payouts.status, or the not-queued reason
  job_id uuid,
  job_title text,
  helper_id uuid,
  helper_name text,
  destination_kind text,
  destination_value text,
  current_destination text,     -- the Helpr's payable PayPal destination NOW (differs on a held row)
  amount_cents bigint,
  env text,
  pay_on_or_after timestamptz,
  queued_at timestamptz,
  external_txn_id text,
  marked_paid_at timestamptz,
  marked_paid_by_name text,
  pay_blocked text,             -- payout_hold | job_hold | ban_review | payment_disputed | payment_refunded | null
  held_reason text,             -- 'destination_changed_since_hire' (written held) | 'email_changed_after_queue' | null
  tip_id uuid                   -- the tip a tip line (or an unqueued tip) pays out; null for job pay
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
BEGIN
  IF NOT COALESCE(public.has_role(auth.uid(), 'admin'::app_role), false) THEN
    RAISE EXCEPTION 'admin_only' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  WITH lines AS (
    SELECT pp.*, NULLIF(to_jsonb(pp) ->> 'tip_id', '')::uuid AS tip_ref
      FROM public.provider_payouts pp
     WHERE pp.provider = 'manual_paypal'
       AND (pp.status IN ('pending', 'held')
            OR (pp.status = 'success' AND pp.marked_paid_at > now() - interval '30 days'))
  )
  SELECT 'payout'::text,
         CASE WHEN l.tip_ref IS NOT NULL THEN 'tip' ELSE 'job' END,
         l.id, l.status, j.id, j.title::text, l.payee_user_id, pr.full_name::text,
         l.destination_kind, l.destination_value,
         (SELECT d.destination_value FROM public.paypal_payout_destination(l.payee_user_id, l.env) d LIMIT 1),
         -- A tip clears on its own clock: 3 days after it was queued, like job pay after approval.
         l.amount_cents, l.env,
         CASE WHEN l.tip_ref IS NOT NULL THEN l.created_at + interval '3 days' ELSE j.payout_scheduled_at END,
         l.created_at, l.external_txn_id, l.marked_paid_at,
         mp.full_name::text,
         CASE WHEN l.status = 'success' THEN NULL ELSE public.paypal_pay_blocked(j.id, l.payee_user_id, pay.status) END,
         CASE WHEN l.status <> 'held' THEN NULL
              WHEN pt.metadata ->> 'held_reason' IS NOT NULL THEN pt.metadata ->> 'held_reason'
              ELSE 'email_changed_after_queue' END,
         l.tip_ref
    FROM lines l
    JOIN public.provider_payments pay ON pay.id = l.provider_payment_id
    LEFT JOIN public.payout_transfers pt ON pt.id = l.payout_transfer_id
    LEFT JOIN public.tips t ON t.id = l.tip_ref
    LEFT JOIN public.jobs j ON j.id = COALESCE(pt.job_id, t.job_id)
    LEFT JOIN public.profiles pr ON pr.user_id = l.payee_user_id
    LEFT JOIN public.profiles mp ON mp.user_id = l.marked_paid_by
  UNION ALL
  -- Approved PayPal jobs with no live claim: the writer refused or has not run yet. Shown with the
  -- real reason so nothing owed is invisible; "Queue now" on the screen re-runs the writer.
  SELECT 'not_queued'::text, 'job'::text, NULL::uuid,
         CASE
           WHEN j.is_group_job IS TRUE AND COALESCE(j.helpers_needed, 1) > 1 THEN 'crew_not_supported'
           WHEN EXISTS (SELECT 1 FROM public.payout_transfers x WHERE x.job_id = j.id AND x.status = 'canceled'
                           AND x.metadata ->> 'canceled_by_admin' IS NOT NULL) THEN 'canceled_by_admin'
           WHEN public.paypal_pay_blocked(j.id, j.helper_id, p.status) IS NOT NULL THEN public.paypal_pay_blocked(j.id, j.helper_id, p.status)
           WHEN p.status NOT IN ('captured', 'partially_refunded') THEN 'payment_not_settled'
           WHEN j.payment_status::text = 'escrow' THEN 'remainder_not_queued'
           WHEN (j.disputed_at IS NOT NULL AND COALESCE(j.dispute_status::text, '') NOT IN ('resolved', 'auto_resolved'))
                OR EXISTS (SELECT 1 FROM public.disputes d WHERE d.job_id = j.id AND d.status = 'decided'
                              AND (d.execution_status IS NULL OR d.execution_status <> 'executed')) THEN 'dispute_open'
           WHEN NOT EXISTS (SELECT 1 FROM public.paypal_payout_destination(j.helper_id, p.env)) THEN 'no_payable_paypal_account'
           ELSE 'not_queued_yet'
         END,
         j.id, j.title::text, j.helper_id, pr.full_name::text, NULL::text, NULL::text,
         (SELECT d.destination_value FROM public.paypal_payout_destination(j.helper_id, p.env) d LIMIT 1),
         NULL::bigint, p.env, j.payout_scheduled_at, NULL::timestamptz, NULL::text, NULL::timestamptz, NULL::text,
         public.paypal_pay_blocked(j.id, j.helper_id, p.status),
         NULL::text, NULL::uuid
    FROM public.jobs j
    JOIN public.provider_payments p
      ON p.subject_kind = 'job' AND p.subject_id = j.id AND p.status NOT IN ('created', 'voided', 'failed')
    LEFT JOIN public.profiles pr ON pr.user_id = j.helper_id
   WHERE j.status::text = 'completed'
     AND (j.payment_status::text = 'payout_pending'
          -- phase 5's agreed refund request whose Helpr remainder is not queued yet
          OR (j.payment_status::text = 'escrow'
              AND EXISTS (SELECT 1 FROM public.disputes d WHERE d.job_id = j.id AND d.status = 'decided'
                             AND d.decided_via = 'agreement' AND d.execution_status = 'executing')))
     AND NOT EXISTS (SELECT 1 FROM public.payout_transfers x
                      WHERE x.job_id = j.id AND x.status IN ('pending', 'paid', 'reversed'))
  UNION ALL
  -- Tips paid through PayPal with no live payout line yet (most often: no PayPal email). tip_id on
  -- provider_payouts is read through to_jsonb (pp-tips adds the column).
  SELECT 'tip_not_queued'::text, 'tip'::text, NULL::uuid,
         CASE WHEN NOT EXISTS (SELECT 1 FROM public.paypal_payout_destination(t.helper_id, p.env)) THEN 'no_payable_paypal_account'
              ELSE 'not_queued_yet' END,
         t.job_id, tj.title::text, t.helper_id, pr.full_name::text, NULL::text, NULL::text,
         (SELECT d.destination_value FROM public.paypal_payout_destination(t.helper_id, p.env) d LIMIT 1),
         p.amount_cents, p.env, NULL::timestamptz, NULL::timestamptz, NULL::text, NULL::timestamptz, NULL::text,
         public.paypal_pay_blocked(t.job_id, t.helper_id, p.status), NULL::text, t.id
    FROM public.tips t
    JOIN public.provider_payments p
      ON p.subject_kind = 'tip' AND p.subject_id = t.id AND p.status IN ('captured', 'partially_refunded')
    LEFT JOIN public.jobs tj ON tj.id = t.job_id
    LEFT JOIN public.profiles pr ON pr.user_id = t.helper_id
   WHERE NOT EXISTS (SELECT 1 FROM public.provider_payouts o
                      WHERE NULLIF(to_jsonb(o) ->> 'tip_id', '')::uuid = t.id
                        AND o.status NOT IN ('canceled', 'failed', 'returned'))
   ORDER BY 1 DESC, 15 NULLS LAST;
END;
$fn$;
REVOKE ALL ON FUNCTION public.admin_paypal_payout_queue() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_paypal_payout_queue() TO authenticated, service_role;

-- ---------------------------------------------------------------------------------------------
-- 4. Mark paid: a LIST of payout rows (one Helpr's job pay and tips) and ONE PayPal transaction id.
--    Admin only. Evidence required. The total the admin sent must equal the rows' total, and each
--    job line's amount must equal its payout_transfers claim. Rows already marked with the SAME id
--    are skipped (a double press is a no-op); a row marked with a DIFFERENT id refuses the press.
-- ---------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_mark_paypal_payout_paid(
  p_payout_ids uuid[],
  p_external_txn_id text,
  p_total_cents bigint,
  p_sent_before_hold boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  v_admin uuid := auth.uid();
  v_txn text := upper(btrim(COALESCE(p_external_txn_id, '')));
  v_ids uuid[];
  v_rows public.provider_payouts[];
  v_pp public.provider_payouts;
  v_pt record;
  v_first public.provider_payouts;
  v_total bigint := 0;
  v_marked uuid[] := '{}';
  v_released uuid[] := '{}';
  v_was_held boolean := false;
  v_job_id uuid;
  v_title text;
  v_jobs uuid[] := '{}';
  v_queued_by text;
  v_not_released uuid[] := '{}';
  v_used uuid[];
  v_pay record;
  v_job record;
  v_block text;
  v_blocks jsonb := '[]'::jsonb;
BEGIN
  PERFORM public.require_feature('paypal_payments');
  IF v_admin IS NULL OR NOT COALESCE(public.has_role(v_admin, 'admin'::app_role), false) THEN
    RAISE EXCEPTION 'admin_only' USING ERRCODE = '42501';
  END IF;
  -- PayPal's transaction id (17 letters and digits on the Send Money receipt). Checked loosely on
  -- purpose: it is evidence the admin copies; a wrong-looking one is refused, never guessed at.
  IF v_txn = '' THEN
    RAISE EXCEPTION 'txn_id_required' USING ERRCODE = '22023',
      DETAIL = 'Paste the PayPal transaction ID from the Send Money receipt.';
  END IF;
  IF v_txn !~ '^[A-Z0-9]{8,32}$' THEN
    RAISE EXCEPTION 'txn_id_invalid' USING ERRCODE = '22023',
      DETAIL = 'A PayPal transaction ID is letters and numbers only (usually 17).';
  END IF;
  SELECT array_agg(DISTINCT x ORDER BY x) INTO v_ids FROM unnest(COALESCE(p_payout_ids, '{}')) x WHERE x IS NOT NULL;
  IF v_ids IS NULL OR cardinality(v_ids) = 0 THEN
    RAISE EXCEPTION 'payouts_required' USING ERRCODE = '22023';
  END IF;

  -- A PayPal transaction id is marked ONCE, with all the lines of that one Send Money together
  -- (lh-money-escrow review 2026-10-23: a stale id from an earlier Send Money must never mark a new,
  -- unpaid row). Pressing the identical set again is a no-op; any other use is refused.
  PERFORM pg_advisory_xact_lock(hashtext('provider_payouts_txn:' || v_txn));
  SELECT array_agg(o.id ORDER BY o.id) INTO v_used FROM public.provider_payouts o WHERE o.external_txn_id = v_txn;
  IF v_used IS NOT NULL THEN
    IF v_used = v_ids THEN
      -- The same press twice (a double tap, a retry after a lost answer): nothing changes.
      RETURN jsonb_build_object('outcome', 'already_paid', 'payout_ids', to_jsonb(v_ids), 'external_txn_id', v_txn);
    END IF;
    RAISE EXCEPTION 'txn_id_already_used' USING ERRCODE = '23505',
      DETAIL = 'That PayPal transaction ID was already used to mark other payouts. Each Send Money is marked once, with all its lines together.';
  END IF;

  -- Lock every row, in id order (two admins pressing at once cannot deadlock).
  SELECT array_agg(pp ORDER BY pp.id) INTO v_rows
    FROM (SELECT * FROM public.provider_payouts WHERE id = ANY (v_ids) ORDER BY id FOR UPDATE) pp;
  IF v_rows IS NULL OR cardinality(v_rows) <> cardinality(v_ids) THEN
    RAISE EXCEPTION 'payout_not_found' USING ERRCODE = 'P0002';
  END IF;
  v_first := v_rows[1];

  FOREACH v_pp IN ARRAY v_rows LOOP
    IF v_pp.provider <> 'manual_paypal' THEN
      RAISE EXCEPTION 'payout_not_found' USING ERRCODE = 'P0002';
    END IF;
    -- One Send Money goes to one person at one PayPal account.
    IF v_pp.payee_user_id IS DISTINCT FROM v_first.payee_user_id
       OR v_pp.destination_value IS DISTINCT FROM v_first.destination_value
       OR v_pp.env IS DISTINCT FROM v_first.env THEN
      RAISE EXCEPTION 'payouts_not_one_payee' USING ERRCODE = '22023',
        DETAIL = 'Mark paid one Helpr and one PayPal account at a time.';
    END IF;
    IF v_pp.status = 'success' THEN
      RAISE EXCEPTION 'payout_already_marked_paid' USING ERRCODE = '42501',
        DETAIL = format('A payout in this list was already marked paid with PayPal transaction %s.', v_pp.external_txn_id);
    ELSIF v_pp.status = 'held' THEN
      IF NOT COALESCE(p_sent_before_hold, false) THEN
        RAISE EXCEPTION 'payout_held_email_changed' USING ERRCODE = '42501',
          DETAIL = 'The Helpr changed their PayPal email after this was queued. Check the new email and re-queue it.';
      END IF;
      -- Written held because its destination is the unconfirmed NEW email: nothing can have been
      -- "sent before the change", so the only way out is the admin's check and re-queue.
      IF EXISTS (SELECT 1 FROM public.payout_transfers x
                  WHERE x.id = v_pp.payout_transfer_id AND x.metadata ->> 'held_reason' = 'destination_changed_since_hire') THEN
        RAISE EXCEPTION 'payout_needs_recheck' USING ERRCODE = '42501',
          DETAIL = 'This payout goes to a PayPal email changed after the Helpr was hired. Check it with them and re-queue it first.';
      END IF;
      v_was_held := true;
    ELSIF v_pp.status <> 'pending' THEN
      RAISE EXCEPTION 'payout_not_payable' USING ERRCODE = '42501', DETAIL = format('A payout in this list is %s.', v_pp.status);
    END IF;
    -- The money and the job must still be payable NOW (lh-money-escrow review 2026-10-23): holds and
    -- disputes placed after queueing, and a payment disputed/refunded since, stop the press. The
    -- payment row is locked: it is what refunds and payouts serialize on (phase 1 guards).
    SELECT p.status INTO v_pay FROM public.provider_payments p WHERE p.id = v_pp.provider_payment_id FOR UPDATE;
    v_block := NULL;
    v_queued_by := NULL;
    IF v_pp.payout_transfer_id IS NOT NULL THEN
      SELECT pt.id, pt.status, pt.amount_cents, pt.job_id, pt.metadata ->> 'queued_by' AS queued_by INTO v_pt
        FROM public.payout_transfers pt WHERE pt.id = v_pp.payout_transfer_id FOR UPDATE;
      IF NOT FOUND OR v_pt.status <> 'pending' THEN
        RAISE EXCEPTION 'payout_claim_not_pending' USING ERRCODE = '42501';
      END IF;
      IF v_pt.amount_cents <> v_pp.amount_cents THEN
        RAISE EXCEPTION 'payout_amount_mismatch' USING ERRCODE = '22023',
          DETAIL = 'The queued payout and its claim disagree on the amount. Nothing was marked.';
      END IF;
      SELECT j.status::text AS status, j.payment_status::text AS payment_status, j.disputed_at,
             j.dispute_status::text AS dispute_status
        INTO v_job FROM public.jobs j WHERE j.id = v_pt.job_id FOR SHARE;
      v_block := public.paypal_pay_blocked(v_pt.job_id, v_pp.payee_user_id, v_pay.status);
      IF v_block IS NULL AND v_pt.queued_by = 'cancellation_fee' THEN
        -- A cancellation fee pays out of a cancelled job; phase 6 settles the job's own state.
        IF v_job.status <> 'cancelled' THEN
          v_block := 'job_not_payable';
        END IF;
      ELSIF v_block IS NULL AND v_pt.queued_by = 'refund_request_remainder' THEN
        IF v_job.status <> 'completed' OR v_job.payment_status <> 'escrow' THEN
          v_block := 'job_not_payable';
        END IF;
      ELSIF v_block IS NULL THEN
        IF v_job.status <> 'completed' OR v_job.payment_status <> 'payout_pending' THEN
          v_block := 'job_not_payable';
        ELSIF (v_job.disputed_at IS NOT NULL AND COALESCE(v_job.dispute_status, '') NOT IN ('resolved', 'auto_resolved'))
              OR EXISTS (SELECT 1 FROM public.disputes d WHERE d.job_id = v_pt.job_id AND d.status = 'decided'
                            AND (d.execution_status IS NULL OR d.execution_status <> 'executed')) THEN
          v_block := 'dispute_open';
        END IF;
      END IF;
    ELSIF v_pay.status NOT IN ('captured', 'partially_refunded') THEN
      v_block := CASE WHEN v_pay.status IN ('disputed', 'reversed') THEN 'payment_disputed' ELSE 'payment_refunded' END;
    END IF;
    IF v_block IS NOT NULL THEN
      IF NOT COALESCE(p_sent_before_hold, false) THEN
        RAISE EXCEPTION 'payout_blocked' USING ERRCODE = '42501',
          DETAIL = format('Don''t send this payout: %s. If you already sent it before that, tick "I already sent it" to record it.', v_block);
      END IF;
      -- Recorded, not hidden: the admin says the money went out before the block.
      v_blocks := v_blocks || jsonb_build_object('payout_id', v_pp.id, 'reason', v_block);
    END IF;
    v_total := v_total + v_pp.amount_cents;
  END LOOP;

  -- One PayPal transaction id names one payee + destination (the trigger re-checks under its lock).
  IF public.paypal_txn_names_other_payee(v_txn, v_first.payee_user_id, v_first.destination_value, v_first.env) THEN
    RAISE EXCEPTION 'txn_id_already_used' USING ERRCODE = '23505',
      DETAIL = 'That PayPal transaction ID already marks a payout to a different person or PayPal account.';
  END IF;

  -- The amount the admin says they sent must be exactly the total of the lines.
  IF p_total_cents IS NULL OR p_total_cents <> v_total THEN
    RAISE EXCEPTION 'payout_amount_mismatch' USING ERRCODE = '22023',
      DETAIL = format('These payouts total %s cents; the amount entered was %s cents.', v_total, p_total_cents);
  END IF;

  FOREACH v_pp IN ARRAY v_rows LOOP
    UPDATE public.provider_payouts
       SET status = 'success', external_txn_id = v_txn, marked_paid_by = v_admin,
           marked_paid_at = now(), updated_at = now()
     WHERE id = v_pp.id;
    v_marked := v_marked || v_pp.id;
    IF v_pp.payout_transfer_id IS NOT NULL THEN
      UPDATE public.payout_transfers
         SET status = 'paid', paid_at = now(),
             metadata = metadata || jsonb_build_object('external_txn_id', v_txn, 'provider_payout_id', v_pp.id,
                                                       'marked_paid_by', v_admin)
       WHERE id = v_pp.payout_transfer_id
      RETURNING job_id, metadata ->> 'queued_by' INTO v_job_id, v_queued_by;
      v_jobs := v_jobs || v_job_id;
      IF v_queued_by = 'cancellation_fee' THEN
        -- A cancellation fee's job is cancelled; its state belongs to phase 6, never flipped here.
        NULL;
      ELSE
        -- The job reads released only now. A refund-request remainder was queued with the job still
        -- held ('escrow', phase 5's agreed split); its Helpr leg is paid here, so it is released too.
        UPDATE public.jobs SET payment_status = 'released'
         WHERE id = v_job_id
           AND (payment_status::text = 'payout_pending'
                OR (payment_status::text = 'escrow' AND v_queued_by = 'refund_request_remainder'));
        IF FOUND THEN
          v_released := v_released || v_job_id;
        ELSE
          -- The Helpr IS paid (recorded above), but the job is no longer where a payout leaves it
          -- (a chargeback, a dispute, a refund state). Answered, never silent: the screen warns.
          v_not_released := v_not_released || v_job_id;
        END IF;
      END IF;
    END IF;
  END LOOP;

  INSERT INTO public.admin_audit_log (admin_id, action, target_type, target_id, details)
  VALUES (v_admin, 'paypal_payout_marked_paid', 'provider_payouts', v_marked[1]::text,
          jsonb_build_object('external_txn_id', v_txn, 'total_cents', v_total, 'payout_ids', to_jsonb(v_marked),
                             'helper_id', v_first.payee_user_id, 'destination_kind', v_first.destination_kind,
                             'env', v_first.env, 'was_held', v_was_held, 'sent_before_block', v_blocks,
                             'jobs_released', to_jsonb(v_released), 'jobs_not_released', to_jsonb(v_not_released)));

  IF v_first.payee_user_id IS NOT NULL THEN
    SELECT j.title INTO v_title FROM public.jobs j WHERE cardinality(v_jobs) = 1 AND j.id = v_jobs[1] FOR SHARE;
    INSERT INTO public.notifications (user_id, title, message, type, link, job_id)
    VALUES (v_first.payee_user_id, 'You''ve been paid',
            format('$%s was sent to your PayPal%s.', to_char(v_total / 100.0, 'FM999999990.00'),
                   CASE WHEN v_title IS NOT NULL THEN format(' for "%s"', v_title) ELSE '' END),
            'payment',
            CASE WHEN cardinality(v_jobs) = 1 THEN '/jobs?job=' || v_jobs[1]::text ELSE '/jobs' END,
            CASE WHEN cardinality(v_jobs) = 1 THEN v_jobs[1] ELSE NULL END);
  END IF;

  RETURN jsonb_build_object('outcome', 'marked_paid', 'payout_ids', to_jsonb(v_marked), 'external_txn_id', v_txn,
                            'total_cents', v_total, 'jobs_released', to_jsonb(v_released),
                            'jobs_not_released', to_jsonb(v_not_released));
END;
$fn$;
REVOKE ALL ON FUNCTION public.admin_mark_paypal_payout_paid(uuid[], text, bigint, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_mark_paypal_payout_paid(uuid[], text, bigint, boolean) TO authenticated;

-- ---------------------------------------------------------------------------------------------
-- 5. Re-queue a held payout (the Helpr changed their PayPal email) to the CURRENT payable destination,
--    after the admin has checked the change. The held claim and row are canceled, never edited: a
--    payout row's destination is frozen (provider_payouts_guard). Job-pay rows only; a tip row's
--    re-queue belongs to the tips lane (it has no payout_transfers claim).
-- ---------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_requeue_held_paypal_payout(p_payout_id uuid, p_confirm_no_send_money boolean DEFAULT false)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  v_admin uuid := auth.uid();
  v_pp public.provider_payouts;
  v_pt record;
  v_dest record;
  v_new_pt uuid;
  v_new_pp uuid;
BEGIN
  PERFORM public.require_feature('paypal_payments');
  IF v_admin IS NULL OR NOT COALESCE(public.has_role(v_admin, 'admin'::app_role), false) THEN
    RAISE EXCEPTION 'admin_only' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_pp FROM public.provider_payouts WHERE id = p_payout_id FOR UPDATE;
  IF NOT FOUND OR v_pp.provider <> 'manual_paypal' THEN
    RAISE EXCEPTION 'payout_not_found' USING ERRCODE = 'P0002';
  END IF;
  IF v_pp.status <> 'held' THEN
    RAISE EXCEPTION 'payout_not_held' USING ERRCODE = '42501', DETAIL = format('This payout is %s.', v_pp.status);
  END IF;
  -- Cancelling the held row frees nothing for a refund (the new row re-reserves it), but a Send
  -- Money already made to the OLD destination would be paid again to the new one (Phase 1 review
  -- condition, P4): the admin must say none went out.
  IF NOT COALESCE(p_confirm_no_send_money, false) THEN
    RAISE EXCEPTION 'confirm_no_send_money' USING ERRCODE = '22023',
      DETAIL = 'Confirm that no PayPal Send Money went out for this payout. If one did, mark it paid instead.';
  END IF;
  IF v_pp.payout_transfer_id IS NULL THEN
    RAISE EXCEPTION 'payout_not_job_pay' USING ERRCODE = '22023';
  END IF;
  SELECT pt.* INTO v_pt FROM public.payout_transfers pt WHERE pt.id = v_pp.payout_transfer_id FOR UPDATE;
  IF NOT FOUND OR v_pt.status <> 'pending' THEN
    RAISE EXCEPTION 'payout_claim_not_pending' USING ERRCODE = '42501';
  END IF;

  PERFORM 1 FROM public.payee_accounts a
   WHERE a.user_id = v_pp.payee_user_id AND a.provider = 'paypal' AND a.env = v_pp.env
     FOR SHARE;
  SELECT * INTO v_dest FROM public.paypal_payout_destination(v_pp.payee_user_id, v_pp.env) LIMIT 1;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'no_payable_paypal_account' USING ERRCODE = '42501',
      DETAIL = 'The Helpr has no PayPal email that can be paid yet.';
  END IF;

  -- A hold placed since: the new claim would be refused by refuse_payout_claim_while_held; say so first.
  IF EXISTS (SELECT 1 FROM public.payout_holds h WHERE h.helper_id = v_pp.payee_user_id) THEN
    RAISE EXCEPTION 'payout_held' USING ERRCODE = '23514', DETAIL = 'This Helpr''s payouts are on hold. Release the hold first.';
  END IF;
  -- Nor re-queued onto money that is no longer payable (a ban review, a job hold, a disputed or
  -- refunded payment): lh-money-escrow review 2026-10-23.
  IF public.paypal_pay_blocked(v_pt.job_id, v_pp.payee_user_id,
                               (SELECT p.status FROM public.provider_payments p WHERE p.id = v_pp.provider_payment_id FOR UPDATE)) IS NOT NULL THEN
    RAISE EXCEPTION 'payout_blocked' USING ERRCODE = '42501',
      DETAIL = 'This payout can''t be queued again right now (a hold, a review or a payment dispute). Check the job first.';
  END IF;

  UPDATE public.provider_payouts SET status = 'canceled', updated_at = now() WHERE id = v_pp.id;
  UPDATE public.payout_transfers
     SET status = 'canceled', failure_reason = 'requeued: Helpr changed their PayPal email',
         metadata = metadata || jsonb_build_object('requeued_by', v_admin)
   WHERE id = v_pt.id;

  INSERT INTO public.payout_transfers (job_id, helper_id, amount_cents, platform_fee_cents, status,
                                       initiated_by, initiated_by_user_id, metadata)
  VALUES (v_pt.job_id, v_pt.helper_id, v_pt.amount_cents, v_pt.platform_fee_cents, 'pending', 'admin', v_admin,
          -- queued_by is carried over: Mark paid reads it (a refund-request remainder releases an
          -- 'escrow' job); the admin's re-check is recorded beside it.
          jsonb_build_object('source', 'manual_paypal', 'queued_by', COALESCE(v_pt.metadata ->> 'queued_by', 'release'),
                             'requeued_by', v_admin, 'provider_payment_id', v_pp.provider_payment_id,
                             'requeued_from', v_pp.id))
  RETURNING id INTO v_new_pt;
  INSERT INTO public.provider_payouts (provider_payment_id, payout_transfer_id, payee_user_id, provider, env,
                                       destination_kind, destination_value, amount_cents, status)
  VALUES (v_pp.provider_payment_id, v_new_pt, v_pp.payee_user_id, 'manual_paypal', v_pp.env,
          v_dest.destination_kind, v_dest.destination_value, v_pp.amount_cents, 'pending')
  RETURNING id INTO v_new_pp;

  INSERT INTO public.admin_audit_log (admin_id, action, target_type, target_id, details)
  VALUES (v_admin, 'paypal_payout_requeued', 'provider_payouts', v_pp.id::text,
          jsonb_build_object('new_payout_id', v_new_pp, 'job_id', v_pt.job_id, 'helper_id', v_pp.payee_user_id,
                             'amount_cents', v_pp.amount_cents, 'old_destination_kind', v_pp.destination_kind,
                             'new_destination_kind', v_dest.destination_kind));

  RETURN jsonb_build_object('outcome', 'requeued', 'payout_id', v_new_pp, 'previous_payout_id', v_pp.id);
END;
$fn$;
REVOKE ALL ON FUNCTION public.admin_requeue_held_paypal_payout(uuid, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_requeue_held_paypal_payout(uuid, boolean) TO authenticated;

-- ---------------------------------------------------------------------------------------------
-- 6. The Stripe "Payout Queue" lists Stripe jobs only: its Send Payout is a Stripe transfer. A job
--    paid through PayPal is paid from admin_paypal_payout_queue(). Verbatim from
--    20261015034233_payout_batches_flat_fee.sql plus the one NOT EXISTS below.
-- ---------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_payout_batches()
 RETURNS TABLE(helper_id uuid, helper_name text, helper_email text, stripe_account_id text, job_count integer, total_payout numeric, oldest_completed_at timestamp with time zone)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT
    j.helper_id,
    p.full_name AS helper_name,
    p.email AS helper_email,
    p.stripe_account_id,
    count(*)::int AS job_count,
    sum(
      CASE WHEN j.helper_fee_flat_cents IS NOT NULL THEN
        -- Roadmap F3: a flat-model job pays 5% + 70c (its stamp) on the
        -- per-Helpr share of budget + urgent bonus, never more than that
        -- share, exactly as _shared/helprFlatFee.ts helprFlatFeeCents.
        s.gross_share - LEAST(s.gross_share,
          (ROUND(ROUND(s.gross_share * 100) * COALESCE(j.helper_fee_percent, 5) / 100.0)
            + j.helper_fee_flat_cents) / 100.0)
      ELSE
      (j.budget / (CASE WHEN j.is_group_job AND j.helpers_needed IS NOT NULL AND j.helpers_needed > 0
                         THEN j.helpers_needed ELSE 1 END))
        * (1 - COALESCE(j.helper_fee_percent, 10) / 100.0)
      -- Q362: the whole urgent bonus goes to the Helpr (no card-fee netting).
      + COALESCE(j.urgent_fee, 0)
        / (CASE WHEN j.is_group_job AND j.helpers_needed IS NOT NULL AND j.helpers_needed > 0
                THEN j.helpers_needed ELSE 1 END)
      END
    )::numeric(10,2) AS total_payout,
    min(COALESCE(j.poster_completed_at, j.helper_completed_at, j.updated_at)) AS oldest_completed_at
  FROM public.jobs j
  JOIN public.profiles p ON p.user_id = j.helper_id
  CROSS JOIN LATERAL (
    SELECT (j.budget + COALESCE(j.urgent_fee, 0))
           / (CASE WHEN j.is_group_job AND j.helpers_needed IS NOT NULL AND j.helpers_needed > 0
                   THEN j.helpers_needed ELSE 1 END) AS gross_share
  ) s
  WHERE j.status = 'completed'
    AND j.payment_status IN ('escrow', 'payout_pending')
    AND j.helper_id IS NOT NULL
    -- A decided dispute owns this job's money until its split executes.
    AND NOT EXISTS (
      SELECT 1 FROM public.disputes d
       WHERE d.job_id = j.id
         AND d.status = 'decided'
         AND (d.execution_status IS NULL OR d.execution_status <> 'executed')
    )
    -- PayPal-paid jobs are paid from admin_paypal_payout_queue(), never by a Stripe transfer. A PayPal
    -- order that never got past created/voided/failed does not make a job PayPal's (phase 3's
    -- job_provider_payment_held rule): a poster who fell back to a card is still paid through Stripe.
    AND NOT EXISTS (SELECT 1 FROM public.provider_payments pp
                     WHERE pp.subject_kind = 'job' AND pp.subject_id = j.id
                       AND pp.status NOT IN ('created', 'voided', 'failed'))
    -- server-side admin authorization: non-admins get zero rows, not the data
    AND public.has_role(auth.uid(), 'admin')
  GROUP BY j.helper_id, p.full_name, p.email, p.stripe_account_id
  ORDER BY oldest_completed_at ASC;
$function$;

REVOKE ALL ON FUNCTION public.get_payout_batches() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_payout_batches() TO authenticated, service_role;

-- The job ids Send Payout / Bulk Approve turn into release-payout calls: must match get_payout_batches
-- (lh-silent-failure review 2026-10-23). Verbatim from 20260908024646 (md5 of prod's
-- pg_get_functiondef matched that text, 2026-10-23) plus the same PayPal NOT EXISTS.
CREATE OR REPLACE FUNCTION public.get_payout_batch_job_ids(p_helper_id uuid)
 RETURNS TABLE(job_id uuid)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT j.id
  FROM public.jobs j
  WHERE j.helper_id = p_helper_id
    AND j.status = 'completed'
    AND j.payment_status IN ('escrow', 'payout_pending')
    AND j.helper_id IS NOT NULL
    -- Must match get_payout_batches exactly: this is the list Bulk Approve
    -- turns into release-payout calls, so a job excluded from the total but
    -- present here would be paid anyway, silently.
    AND NOT EXISTS (
      SELECT 1 FROM public.disputes d
       WHERE d.job_id = j.id
         AND d.status = 'decided'
         AND (d.execution_status IS NULL OR d.execution_status <> 'executed')
    )
    -- PayPal-paid jobs (same rule as get_payout_batches, which this must match exactly): Send
    -- Payout is a Stripe transfer, and a PayPal job is paid from admin_paypal_payout_queue().
    AND NOT EXISTS (SELECT 1 FROM public.provider_payments pp
                     WHERE pp.subject_kind = 'job' AND pp.subject_id = j.id
                       AND pp.status NOT IN ('created', 'voided', 'failed'))
    -- Same server-side authorization as get_payout_batches: non-admins get
    -- zero rows, not the data and not an error.
    AND public.has_role(auth.uid(), 'admin')
  ORDER BY COALESCE(j.poster_completed_at, j.helper_completed_at, j.updated_at) ASC;
$function$;
REVOKE ALL ON FUNCTION public.get_payout_batch_job_ids(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_payout_batch_job_ids(uuid) TO authenticated, service_role;

-- ---------------------------------------------------------------------------------------------
-- 6. Cancel a pending or held manual job payout (lh-money-escrow review 2026-10-23: once queued,
--    refunds are blocked, so a hold or a dispute after queueing needs a way out). Admin only, behind
--    the switch, audited. Cancelling frees the money for a refund, so the admin must confirm no Send
--    Money went out (Phase 1 review condition P4): a cancel after a Send Money pays twice. The job
--    is left where it is (payout_pending); the crons do not re-queue an admin-canceled payout, only
--    the admin's "Queue now" does.
-- ---------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_cancel_paypal_payout(p_payout_id uuid, p_confirm_no_send_money boolean DEFAULT false, p_reason text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  v_admin uuid := auth.uid();
  v_pp public.provider_payouts;
  v_pt record;
BEGIN
  PERFORM public.require_feature('paypal_payments');
  IF v_admin IS NULL OR NOT COALESCE(public.has_role(v_admin, 'admin'::app_role), false) THEN
    RAISE EXCEPTION 'admin_only' USING ERRCODE = '42501';
  END IF;
  IF NOT COALESCE(p_confirm_no_send_money, false) THEN
    RAISE EXCEPTION 'confirm_no_send_money' USING ERRCODE = '22023',
      DETAIL = 'Confirm that no PayPal Send Money went out for this payout. If one did, mark it paid instead.';
  END IF;
  IF p_reason IS NULL OR length(btrim(p_reason)) < 5 THEN
    RAISE EXCEPTION 'reason_required' USING ERRCODE = '22023', DETAIL = 'Say why it is canceled (5 characters or more).';
  END IF;
  SELECT * INTO v_pp FROM public.provider_payouts WHERE id = p_payout_id FOR UPDATE;
  IF NOT FOUND OR v_pp.provider <> 'manual_paypal' THEN
    RAISE EXCEPTION 'payout_not_found' USING ERRCODE = 'P0002';
  END IF;
  IF v_pp.status NOT IN ('pending', 'held') THEN
    RAISE EXCEPTION 'payout_not_payable' USING ERRCODE = '42501', DETAIL = format('This payout is %s.', v_pp.status);
  END IF;
  IF v_pp.payout_transfer_id IS NULL THEN
    RAISE EXCEPTION 'payout_not_job_pay' USING ERRCODE = '22023';
  END IF;
  SELECT pt.* INTO v_pt FROM public.payout_transfers pt WHERE pt.id = v_pp.payout_transfer_id FOR UPDATE;
  IF NOT FOUND OR v_pt.status <> 'pending' THEN
    RAISE EXCEPTION 'payout_claim_not_pending' USING ERRCODE = '42501';
  END IF;

  UPDATE public.provider_payouts SET status = 'canceled', updated_at = now() WHERE id = v_pp.id;
  UPDATE public.payout_transfers
     SET status = 'canceled', failure_reason = 'canceled by an admin: ' || btrim(p_reason),
         metadata = metadata || jsonb_build_object('canceled_by_admin', v_admin, 'cancel_reason', btrim(p_reason))
   WHERE id = v_pt.id;

  INSERT INTO public.admin_audit_log (admin_id, action, target_type, target_id, details)
  VALUES (v_admin, 'paypal_payout_canceled', 'provider_payouts', v_pp.id::text,
          jsonb_build_object('job_id', v_pt.job_id, 'helper_id', v_pp.payee_user_id, 'amount_cents', v_pp.amount_cents,
                             'was_status', v_pp.status, 'reason', btrim(p_reason), 'confirmed_no_send_money', true));

  RETURN jsonb_build_object('outcome', 'canceled', 'payout_id', v_pp.id, 'job_id', v_pt.job_id);
END;
$fn$;
REVOKE ALL ON FUNCTION public.admin_cancel_paypal_payout(uuid, boolean, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_cancel_paypal_payout(uuid, boolean, text) TO authenticated;
