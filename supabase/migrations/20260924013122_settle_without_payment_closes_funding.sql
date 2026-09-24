-- Q235 follow-up: four findings from the REVIEW-ONLY lh-money-escrow pass on
-- rpc_settle_dispute_without_payment (20260923205812).
--
-- 1. (MEDIUM) The $0 close left the job payment_status='unpaid', so the job
--    was still FUNDABLE: create-payment's escrow action gates on payment_status
--    alone (unpaid/abandoned/failed), and redeem_gift_card gates on 'unpaid'
--    alone. A checkout opened before the close and stamped after it, or a gift
--    redeemed after it, put money into escrow on a job whose dispute is already
--    recorded as settled: no sweep pages it (the dispute reads executed with a
--    reason) and no path pays it out. Fixed in two layers:
--      (a) this RPC moves a fundable payment_status (NULL, unpaid, abandoned,
--          failed) to 'cancelled' in the same transaction. 'cancelled' is in
--          jobs_payment_status_check and every reader already treats it as
--          settled-with-no-money: create-payment's RE_MINTABLE set excludes it,
--          redeem_gift_card refuses anything but 'unpaid',
--          void-cancelled-payments writes it for "no payment found",
--          money-reconciliation counts it settled, PaymentSuccess lists it as
--          not held, and useUnpaidJobDrafts / UnfundedJobNotice stop offering
--          "Finish paying". It is also what stamps checkout's conditional write
--          out: create-payment's stampSession only matches unpaid/abandoned/
--          failed, so a session minted before this commit is never recorded or
--          handed to the poster.
--      (b) redeem_gift_card (below) and create-payment's escrow action refuse a
--          job that is completed or cancelled or carries a decided dispute.
-- 2. (LOW-MED) The RPC now also refuses unless payment_status is NULL or one of
--    unpaid/abandoned/failed/cancelled, and refuses when any payout_transfers or
--    payment_refunds row, or a gift restored from this job, exists (the "moved"
--    test from rpc_supersede_dispute_decision, stricter: ANY transfer row, not
--    only pending/paid/reversed, because a $0 close has no business on a job
--    that ever tried to move money). payment_status goes into the audit row.
-- 3. (LOW) 'executing' blocked forever. It now blocks only while the run is
--    inside dispute_settlement_claim_ttl(), exactly as
--    rpc_supersede_dispute_decision reads it; a dead run falls to the claim and
--    payment checks.
-- 4. (UI) AdminDisputes.closeWithoutPayment gets a catch (not in this file).
--
-- Replay-safe: CREATE OR REPLACE both functions; the tables read only on some
-- deploys are guarded with to_regclass at call time.

CREATE OR REPLACE FUNCTION public.rpc_settle_dispute_without_payment(_dispute_id uuid, _note text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  _uid uuid := auth.uid();
  _note_clean text := left(NULLIF(btrim(COALESCE(_note, '')), ''), 500);
  _job_id uuid;
  _job record;
  _dispute record;
  _written int;
  _moved boolean;
  _new_payment_status text;
BEGIN
  IF _uid IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;

  IF NOT public.has_role(_uid, 'admin') THEN
    RAISE EXCEPTION 'admin only';
  END IF;

  IF _note_clean IS NULL THEN
    RAISE EXCEPTION 'settle_note_required'
      USING HINT = 'Say why there is no payment to move. It is the only record of this close.';
  END IF;

  SELECT job_id INTO _job_id FROM public.disputes WHERE id = _dispute_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'dispute not found';
  END IF;

  SELECT id, customer_id, helper_id, stripe_payment_intent_id, stripe_session_id, payment_status
    INTO _job
    FROM public.jobs
   WHERE id = _job_id
     FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'job not found';
  END IF;

  SELECT id, status, execution_status, execution_started_at
    INTO _dispute
    FROM public.disputes
   WHERE id = _dispute_id
     FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'dispute not found';
  END IF;

  IF _dispute.status IS DISTINCT FROM 'decided' THEN
    RAISE EXCEPTION 'dispute_not_decided'
      USING HINT = 'Only a decided dispute can have its settlement closed.';
  END IF;

  IF _dispute.execution_status = 'executed' THEN
    RAISE EXCEPTION 'dispute_already_settled';
  END IF;

  IF _uid = _job.customer_id OR _uid = _job.helper_id THEN
    RAISE EXCEPTION 'admin_is_party'
      USING HINT = 'You are a party to this job, so another admin has to close its settlement.';
  END IF;

  -- An 'executing' split inside the TTL may be between its execution claim and
  -- its settlement claim, where no claim row exists yet. One older than any
  -- edge invocation can live is dead; the claim and money checks decide.
  IF (_dispute.execution_status = 'executing'
      AND COALESCE(_dispute.execution_started_at, now()) >= now() - public.dispute_settlement_claim_ttl())
     OR (to_regclass('public.dispute_settlement_claims') IS NOT NULL AND EXISTS (
          SELECT 1 FROM public.dispute_settlement_claims c
           WHERE c.job_id = _job.id
             AND (c.claimed_at >= now() - public.dispute_settlement_claim_ttl()
                  OR c.money_step_at IS NOT NULL)))
  THEN
    RAISE EXCEPTION 'dispute_settlement_in_progress';
  END IF;

  IF _job.stripe_payment_intent_id IS NOT NULL
     OR _job.stripe_session_id IS NOT NULL
     OR (to_regclass('public.gift_cards') IS NOT NULL AND EXISTS (
          SELECT 1 FROM public.gift_cards g
           WHERE g.job_id = _job.id
             AND g.status IN ('redeemed', 'reserved')))
  THEN
    RAISE EXCEPTION 'dispute_has_payment'
      USING HINT = 'This job has a payment on file, so the split has to move it. Use Retry settlement.';
  END IF;

  -- Escrow, payout_pending, released, refunded, chargeback and cancelling all
  -- say money moved or is moving. Only a job that never held money closes here.
  IF _job.payment_status IS NOT NULL
     AND _job.payment_status NOT IN ('unpaid', 'abandoned', 'failed', 'cancelled')
  THEN
    RAISE EXCEPTION 'dispute_payment_not_unfunded'
      USING HINT = 'This job''s payment record says money moved, so it cannot be closed as unpaid. Reconcile it against Stripe.';
  END IF;

  _moved := (to_regclass('public.payout_transfers') IS NOT NULL
             AND EXISTS (SELECT 1 FROM public.payout_transfers t WHERE t.job_id = _job.id))
         OR (to_regclass('public.payment_refunds') IS NOT NULL
             AND EXISTS (SELECT 1 FROM public.payment_refunds r WHERE r.job_id = _job.id));
  IF NOT _moved AND to_regclass('public.gift_cards') IS NOT NULL THEN
    _moved := EXISTS (SELECT 1 FROM public.gift_cards g WHERE g.restored_from_job_id = _job.id);
  END IF;
  IF _moved THEN
    RAISE EXCEPTION 'dispute_money_moved'
      USING HINT = 'A transfer, refund or restored gift exists for this job, so it cannot be closed as unpaid. Reconcile it against Stripe.';
  END IF;

  UPDATE public.disputes
     SET execution_status       = 'executed',
         executed_at            = now(),
         execution_transfer_id  = NULL,
         execution_refund_id    = NULL,
         execution_helper_cents = 0,
         execution_refund_cents = 0,
         execution_error        = 'closed by an admin, no payment on file: ' || _note_clean
   WHERE id = _dispute_id
     AND status = 'decided'
     AND execution_status IS DISTINCT FROM 'executed';
  GET DIAGNOSTICS _written = ROW_COUNT;
  IF _written <> 1 THEN
    RAISE EXCEPTION 'dispute_already_settled';
  END IF;

  -- Close funding in the same transaction: a job whose dispute is recorded as
  -- settled with nothing moved must never take money afterwards.
  _new_payment_status := COALESCE(_job.payment_status, 'unpaid');
  IF _new_payment_status IN ('unpaid', 'abandoned', 'failed') THEN
    UPDATE public.jobs
       SET payment_status = 'cancelled'
     WHERE id = _job.id
       AND (payment_status IS NULL OR payment_status IN ('unpaid', 'abandoned', 'failed'));
    GET DIAGNOSTICS _written = ROW_COUNT;
    IF _written <> 1 THEN
      RAISE EXCEPTION 'dispute_payment_not_unfunded';
    END IF;
    _new_payment_status := 'cancelled';
  END IF;

  INSERT INTO public.admin_audit_log (admin_id, action, target_id, target_type, details)
  VALUES (
    _uid,
    'settle_dispute_without_payment',
    _dispute_id,
    'dispute',
    jsonb_build_object(
      'job_id', _job.id,
      'previous_execution_status', _dispute.execution_status,
      'payment_status', _job.payment_status,
      'new_payment_status', _new_payment_status,
      'note', _note_clean
    )
  );
END;
$fn$;

REVOKE ALL ON FUNCTION public.rpc_settle_dispute_without_payment(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rpc_settle_dispute_without_payment(uuid, text) TO authenticated;

-- redeem_gift_card: the live body (pg_get_functiondef, 2026-09-23) with one
-- addition after the funding check: a job that is completed or cancelled, or
-- that carries a decided dispute, cannot be funded. The dispute read is under
-- the job lock this function already takes, which is the lock
-- rpc_settle_dispute_without_payment and rpc_decide_dispute take first.
CREATE OR REPLACE FUNCTION public.redeem_gift_card(p_credit_id uuid, p_job_id uuid, p_user_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_job              record;
  v_credit           record;
  v_cost_cents       int;
  v_credit_cents     int;
  v_applied_cents    int;
  v_leftover_cents   int;
  v_difference_cents int;
begin
  -- Lock the job first (stable lock order: job before credit).
  -- urgent_fee joins the projection for F-GIFT-2.
  select id, customer_id, budget, urgent_fee, payment_status, status::text as status
    into v_job
    from jobs
   where id = p_job_id
   for update;
  if not found then
    raise exception 'Job not found' using errcode = 'P0002';
  end if;
  if v_job.customer_id <> p_user_id then
    raise exception 'You are not the poster of this job' using errcode = '42501';
  end if;
  if v_job.payment_status is distinct from 'unpaid' then
    raise exception 'This job has already been funded' using errcode = 'P0001';
  end if;

  -- Q235 follow-up: a closed job, or one whose dispute has been decided, is
  -- settled; money put in now would sit in escrow that nothing pays out.
  if v_job.status in ('completed', 'cancelled') then
    raise exception 'This job is closed, so it can no longer be funded' using errcode = 'P0001';
  end if;
  if to_regclass('public.disputes') is not null and exists (
       select 1 from public.disputes d
        where d.job_id = p_job_id and d.status = 'decided') then
    raise exception 'This job''s dispute has been decided, so it can no longer be funded' using errcode = 'P0001';
  end if;

  -- Lock the credit.
  select id, donor_id, recipient_id, recipient_email, amount, status,
         payment_status, category, message, job_id, expires_at
    into v_credit
    from gift_cards
   where id = p_credit_id
   for update;
  if not found then
    raise exception 'Gift not found' using errcode = 'P0002';
  end if;

  -- Ownership: only the named, claimed recipient may redeem. This is what
  -- keeps 'available' safe to accept below — a legacy world-readable pool
  -- credit has recipient_id IS NULL and dies right here.
  if v_credit.recipient_id is null or v_credit.recipient_id <> p_user_id then
    raise exception 'This gift is not yours to redeem' using errcode = '42501';
  end if;
  if v_credit.payment_status <> 'paid' then
    raise exception 'This gift has not been funded yet' using errcode = 'P0001';
  end if;
  if v_credit.expires_at is not null and v_credit.expires_at < now() then
    raise exception 'This gift has expired' using errcode = 'P0001';
  end if;

  -- State gate. 'sent' = fresh directed gift; 'available' = the legacy
  -- spelling of the same thing, still permitted by the status CHECK and
  -- still shown as redeemable by CreditCard.tsx — refusing it here was
  -- F-GIFT-1. 'reserved' tied to THIS job = a retry of an abandoned
  -- difference payment (allowed). Anything else (reserved for a different
  -- job, already redeemed, expired) is blocked.
  if v_credit.status = 'reserved' then
    if v_credit.job_id is distinct from p_job_id then
      raise exception 'This gift is reserved for another job' using errcode = 'P0001';
    end if;
  elsif v_credit.status not in ('sent', 'available') then
    raise exception 'This gift is no longer available' using errcode = 'P0001';
  end if;

  -- The poster-side cost of a gift-funded job: budget + urgent fee. No service
  -- fee (waived — the donor covered the processing floor at donate time)
  -- and no sales tax (the settled branch never touches Stripe, so there
  -- is no automatic_tax calculation to attach; only assembly labour is
  -- taxable in LA and gift card volume is small — tracked separately).
  v_cost_cents       := round((v_job.budget + coalesce(v_job.urgent_fee, 0)) * 100)::int;
  v_credit_cents     := round(v_credit.amount * 100)::int;
  v_applied_cents    := least(v_cost_cents, v_credit_cents);
  v_leftover_cents   := v_credit_cents - v_applied_cents;
  v_difference_cents := v_cost_cents - v_applied_cents;

  -- Credit doesn't fully cover the cost → reserve it; the caller collects
  -- the shortfall via Stripe and the webhook finishes the job.
  if v_difference_cents > 0 then
    update gift_cards
       set status = 'reserved', job_id = p_job_id
     where id = p_credit_id;
    return jsonb_build_object(
      'outcome',          'needs_payment',
      'difference_cents', v_difference_cents,
      'applied_cents',    v_applied_cents
    );
  end if;

  -- Fully covered → consume the credit and fund the job now (no Stripe).
  update gift_cards
     set status = 'redeemed', job_id = p_job_id, redeemed_at = now()
   where id = p_credit_id;

  -- Any remainder (credit > cost) becomes a fresh, already-claimed gift to
  -- the same recipient so no donated value is lost. No claim token: the
  -- recipient is already resolved.
  if v_leftover_cents > 0 then
    insert into gift_cards (
      donor_id, recipient_id, recipient_email, amount,
      status, payment_status, category, message, parent_credit_id
    ) values (
      v_credit.donor_id, v_credit.recipient_id, v_credit.recipient_email,
      v_leftover_cents::numeric / 100,
      'sent', 'paid', v_credit.category, v_credit.message, p_credit_id
    );
  end if;

  update jobs set payment_status = 'escrow' where id = p_job_id;

  return jsonb_build_object(
    'outcome',        'settled',
    'applied_cents',  v_applied_cents,
    'leftover_cents', v_leftover_cents
  );
end;
$function$;

REVOKE ALL ON FUNCTION public.redeem_gift_card(uuid, uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.redeem_gift_card(uuid, uuid, uuid) TO service_role;
