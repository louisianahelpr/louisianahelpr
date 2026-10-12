-- Q1418 (a) + (c), gift path loose ends (lh-money-escrow review, 2026-10-06).
--
-- (a) create-payment lets a job whose payment_status is 'abandoned' (a
-- checkout nobody paid, marked by void-cancelled-payments) or 'failed' (a
-- declined card) open a new payment, but redeem_gift_card refused both with
-- 'This job has already been funded': wrong words, and the gift could not be
-- used on a job that was in fact unfunded. Measured on prod by the review: 116
-- abandoned jobs carrying a session id. The gift now funds them like 'unpaid'.
-- Safe because the only caller (create-payment; EXECUTE is service_role only)
-- reads the prior Checkout Session from Stripe, refuses when it is complete or
-- its PaymentIntent is live, and expires it before calling, passing it as
-- p_retired_session; any OTHER open session still refuses (Q975 race 15).
-- jobs triggers fire on any not-yet-funded OLD state, so abandoned -> escrow
-- notifies exactly as unpaid -> escrow does.
--
-- (c) Two concurrent gift-shortfall taps: the second found the first tap's
-- difference checkout and said 'A card payment for this job is already open'.
-- It now says the gift is set aside and a checkout is open, without claiming
-- that checkout is the gift's own (a concurrent full-price card checkout
-- reads the same here).
--
-- The settled branch also clears jobs.stripe_session_id (the dead session the
-- gate let through), so a gift-funded job never carries a card checkout id
-- (lh-money-escrow review of this change, #1). 20261007032429's note that no
-- function assigns that column is superseded here; the poster lock it added
-- still holds (this runs as the service role).
--
-- Body = 20261006053059's (prosrc md5 e38c9903bb9cba79323638ce08a3bd0e, equal
-- to prod, read 2026-10-12) plus those changes. Same signature.
-- Replay-safe: CREATE OR REPLACE; grants restated.

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
begin
  -- Lock the job first (stable lock order: job before credit).
  -- urgent_fee joins the projection for F-GIFT-2.
  select id, customer_id, budget, urgent_fee, payment_status, status::text as status, stripe_session_id
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
  update jobs set payment_status = 'escrow', stripe_session_id = null where id = p_job_id;

  return jsonb_build_object(
    'outcome',        'settled',
    'applied_cents',  v_applied_cents,
    'leftover_cents', v_leftover_cents
  );
end;
$function$;

REVOKE ALL ON FUNCTION public.redeem_gift_card(uuid, uuid, uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.redeem_gift_card(uuid, uuid, uuid, text) TO service_role;
