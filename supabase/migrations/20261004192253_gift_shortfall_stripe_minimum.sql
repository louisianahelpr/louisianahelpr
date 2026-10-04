-- Q1213: a gift card that covers all but 1-49 cents of a job can no longer
-- strand the post behind a shortfall card payment Stripe refuses.
--
-- WHAT WAS BROKEN. redeem_gift_card reserves a gift that does not fully cover
-- the job and returns the shortfall (difference_cents), and create-payment then
-- opens a Stripe Checkout for exactly that shortfall. It put no minimum on the
-- shortfall, and Stripe refuses any charge under 0.50 USD (docs.stripe.com/
-- currencies, "Minimum charge amount by currency": 0.50 USD). So a gift
-- covering all but 1-49 cents reserved the gift against the job and then
-- failed to open the checkout: the poster could not finish posting, and the
-- gift sat 'reserved' on the abandoned job (found by the lh-money-escrow
-- review of Q454, 2026-10-03).
--
-- THE DECISION. Refuse that redemption, before anything is reserved, with a
-- sentence the poster can act on (change the job's pay so the gift covers all
-- of it, or leaves at least $0.50 for the card). The other option the item
-- named, rounding the shortfall into the gift's side, would have the platform
-- pay up to 49 cents of every such job; refusing moves no money.
--
-- Everything else is the live definition (pg_get_functiondef, 2026-10-04)
-- unchanged. The check sits before the reserve UPDATE, so a refused call
-- leaves the gift and the job exactly as they were.
--
-- REPLAY-SAFETY: CREATE OR REPLACE of a function earlier migrations create;
-- privileges restated to the live ACL ({postgres, service_role} only).

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
