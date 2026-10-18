-- Gift first on the jobs poster fee (owner 2026-10-18, Q1996 slice 3b).
--
-- The poster pays 5% + 70c on every job funded on the poster-fee model, a
-- gift-funded one too: the gift pays first (job price + fee) and any rest is
-- one card checkout. redeem_gift_card priced only budget + urgent bonus, so
-- create-payment kept gift checkouts on the flat model (jobFeeModelFor's
-- giftFunded). Now, on a job carrying the poster stamp (poster_fee_flat_cents),
-- the cost includes the fee stamped in customer_fee_amount by the same
-- create-payment request, and a full-gift settle keeps that stamp instead of
-- zeroing it. A flat-model job is unchanged (fee 0, stamp zeroed).
--
-- Body = 20261012231646's (equal to prod pg_get_functiondef, read 2026-10-18)
-- plus the fee. Same signature. Replay-safe: CREATE OR REPLACE; grants restated.
-- restore_gift_card_for_job is unchanged here: what a refund keeps of a
-- gift-paid fee is slice 4 (refunds), and the switch stays OFF until then.

CREATE OR REPLACE FUNCTION public.redeem_gift_card(p_credit_id uuid, p_job_id uuid, p_user_id uuid, p_retired_session text DEFAULT NULL)
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
  v_fee_cents        int;
begin
  -- Lock the job first (stable lock order: job before credit).
  -- urgent_fee joins the projection for F-GIFT-2.
  -- poster_fee_flat_cents / customer_fee_amount join it for the jobs poster
  -- fee (owner 2026-10-18): gift first, the fee included.
  select id, customer_id, budget, urgent_fee, payment_status, status::text as status, stripe_session_id,
         poster_fee_flat_cents, customer_fee_amount
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
  -- Q1418 (a): 'abandoned' and 'failed' are unfunded too (a checkout nobody
  -- paid, a declined card), the same re-mintable set create-payment's gate
  -- uses. Refusing them said "already been funded" about a job that was not.
  -- create-payment has already asked Stripe that the job's prior session is
  -- dead and expired it before calling here (passed as p_retired_session).
  if coalesce(v_job.payment_status, 'unpaid') not in ('unpaid', 'abandoned', 'failed') then
    raise exception 'This job has already been funded' using errcode = 'P0001';
  end if;
  -- Q975 race 15: a card checkout opened for this job, other than the one this
  -- request just closed, is still payable. Funding the job with the gift now
  -- would let that checkout charge the poster a second time.
  if v_job.stripe_session_id is not null
     and v_job.stripe_session_id is distinct from p_retired_session then
    -- Q1418 (c): when that open checkout is this gift's own difference payment
    -- (a second gift tap racing the first), say so instead of naming a card
    -- payment the poster never started. A plain read: the credit is locked below.
    if exists (select 1 from gift_cards g
                where g.id = p_credit_id and g.status = 'reserved' and g.job_id = p_job_id) then
      raise exception 'Your gift is already set aside for this job and a checkout for it is open. If that checkout asks only for what is left after your gift, finish it; otherwise wait a moment and try again.' using errcode = 'P0001';
    end if;
    raise exception 'A card payment for this job is already open. Finish it or wait a moment, then use the gift.' using errcode = 'P0001';
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

  -- The poster-side cost of a gift-funded job: budget + urgent fee, plus the
  -- poster's service fee when the job is on the poster-fee model (owner
  -- 2026-10-18: the poster pays 5% + 70c on every job, a gift-funded one
  -- too, taken from the gift first and any rest by card). create-payment
  -- stamps that fee (customer_fee_amount, with poster_fee_flat_cents) on this
  -- job in the same request, just before it calls here, so the fee is read
  -- from the stamp and never recomputed. A poster-fee job without a positive
  -- fee stamp is refused (fail closed: funding it would charge no fee).
  -- A flat-model job (poster_fee_flat_cents null) pays no service fee, as
  -- before: the donor covered the processing floor at donate time. No sales
  -- tax on either (the settled branch never touches Stripe, so there is no
  -- automatic_tax calculation to attach; the shortfall line is non-taxable).
  if v_job.poster_fee_flat_cents is not null then
    v_fee_cents := round(coalesce(v_job.customer_fee_amount, 0) * 100)::int;
    if v_fee_cents <= 0 then
      raise exception 'This job''s service fee is missing. Please try again.' using errcode = 'P0001';
    end if;
  else
    v_fee_cents := 0;
  end if;
  v_cost_cents       := round((v_job.budget + coalesce(v_job.urgent_fee, 0)) * 100)::int + v_fee_cents;
  v_credit_cents     := round(v_credit.amount * 100)::int;
  v_applied_cents    := least(v_cost_cents, v_credit_cents);
  v_leftover_cents   := v_credit_cents - v_applied_cents;
  v_difference_cents := v_cost_cents - v_applied_cents;

  -- Q1213: the shortfall is collected by a Stripe Checkout, and Stripe refuses
  -- a charge under 0.50 USD. Refuse here, BEFORE the gift is reserved, so the
  -- poster gets a sentence they can act on instead of a reserved gift and a
  -- checkout that never opens.
  if v_difference_cents > 0 and v_difference_cents < 50 then
    raise exception 'Your gift covers all but $%.% of this job, and a card payment has to be at least $0.50. Change the job''s pay so the gift covers all of it, or leaves at least $0.50 to pay by card.',
      v_difference_cents / 100, lpad((v_difference_cents % 100)::text, 2, '0')
      using errcode = 'P0001';
  end if;

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

  -- Q1418 review #1: clear the dead checkout id. The gate above guarantees it
  -- is null or p_retired_session (create-payment proved it dead and expired
  -- it, or it is a test-mode object nothing can pay). Left on a gift-funded
  -- escrow job it reads as "paid by card": void-cancelled-payments, the
  -- dispute split and auto-resolve then look for a capturable PaymentIntent
  -- behind it, skip the job, and the gift is never returned.
  -- A card checkout opened earlier and then abandoned stamped its card fee in
  -- customer_fee_amount (create-payment's stampSession). A fully gift-funded
  -- job pays no card fee, so a stale stamp would tell every refund path and
  -- notice that a fee was charged and kept. Clear it with the session id.
  -- On the poster-fee model the stamp IS what the gift paid (v_fee_cents, in
  -- the cost above), so it is kept; on the flat model v_fee_cents is 0.
  update jobs set payment_status = 'escrow', stripe_session_id = null, customer_fee_amount = v_fee_cents::numeric / 100 where id = p_job_id;

  return jsonb_build_object(
    'outcome',        'settled',
    'applied_cents',  v_applied_cents,
    'leftover_cents', v_leftover_cents
  );
end;
$function$;

REVOKE ALL ON FUNCTION public.redeem_gift_card(uuid, uuid, uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.redeem_gift_card(uuid, uuid, uuid, text) TO service_role;
