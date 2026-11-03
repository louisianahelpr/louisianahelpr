-- Q1728 option (A) (owner 11-03 "charge the tax on the card"; lead 11-03 approved the shape and the caveat fix).
-- A taxable job that a gift card covers IN FULL paid no sales tax: redeem_gift_card's settled branch funds the job
-- with no Stripe call. Now create-payment passes the job-site tax (p_tax_cents) and, when the gift covers the whole
-- job and the tax is due, redeem_gift_card reserves the gift and answers 'tax_due'; create-payment opens a card
-- checkout for the tax alone, and the webhook's existing consume funds the job once it is paid.
-- A tax under 0.50 USD (Stripe's card minimum) is refused with a sentence before anything is reserved (lead 11-03).
--
-- The leftover is split off at reserve time. The settled branch keeps the original's amount whole beside its
-- leftover child; doing the same here would DOUBLE the gift whenever the tax checkout is abandoned, because seven
-- paths put a reserved or redeemed gift back to 'sent' at its stored amount (checkoutSessionExpired,
-- restore_gift_card_for_job 'unreserved', void-cancelled-payments x2, execute-dispute-split, return_bounced_gift_card,
-- the webhook's duplicate-funding put-back). So the original is LOWERED to the cents it pays toward the job; the child
-- keeps parent_credit_id (revoke_gift_card_for_refund's tree still reaches it) and carries the new split_for_job_id,
-- which restore_gift_card_for_job's leftover sum skips. None of the seven paths needed a change.
--
-- redeem_gift_card: restated from 20261018031451 (prod md5 prosrc 62c5b631..., functiondef 82ce6b75...). The old
-- 4-argument signature is DROPPED first: a 5-argument overload beside it makes named calls ambiguous.
-- restore_gift_card_for_job: restated from 20261102071958 (prod md5 prosrc 1b752d5b..., functiondef f5c52bcc...).
-- Grants restated (service_role only, as live). Replay-safe: ADD COLUMN IF NOT EXISTS, DROP ... IF EXISTS,
-- CREATE OR REPLACE. Proof: src/test/pglite/giftTaxDueSplitConservesValue.pglite.mjs.

ALTER TABLE public.gift_cards ADD COLUMN IF NOT EXISTS split_for_job_id uuid;
COMMENT ON COLUMN public.gift_cards.split_for_job_id IS
  'Set on a leftover split off when its parent was reserved for a tax-only checkout on this job (Q1728). The parent''s amount was lowered by it, so restore_gift_card_for_job does not subtract it again. No FK: a deleted job must not turn it back into an unmarked child.';

DROP FUNCTION IF EXISTS public.redeem_gift_card(uuid, uuid, uuid, text);

CREATE OR REPLACE FUNCTION public.redeem_gift_card(p_credit_id uuid, p_job_id uuid, p_user_id uuid, p_retired_session text DEFAULT NULL::text,
  -- CHANGED (Q1728 option A): the job-site sales tax create-payment worked out on the job's full taxable price.
  -- 0 (the default) for an untaxed job: every branch below is then exactly as before.
  p_tax_cents integer DEFAULT 0)
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

  -- CHANGED (Q1728 option A): a taxable job the gift covers in full still owes its sales tax, which a gift
  -- card does not pay. Refuse a bad tax figure, and a tax under Stripe's 0.50 USD card minimum (lead 11-03:
  -- refuse before anything is reserved, so the platform never owes tax it did not collect).
  if coalesce(p_tax_cents, 0) < 0 then
    raise exception 'p_tax_cents must be 0 or more' using errcode = '22023';
  end if;
  if v_difference_cents = 0 and p_tax_cents > 0 and p_tax_cents < 50 then
    raise exception 'This job''s sales tax is too small to charge by card, so it can''t be paid with a gift card alone. Add a card or a little more to the job.'
      using errcode = 'P0001';
  end if;

  -- CHANGED (Q1728 option A): fully covered but taxed → reserve the gift for the part it pays and send the
  -- poster to a card checkout for the tax alone; the webhook's existing consume (reserved -> redeemed) funds
  -- the job once the tax is paid. The job is NOT funded here.
  -- The leftover is split off NOW, so the poster can use it while the tax checkout is open. To keep every
  -- path that later puts this gift back ('sent' at its stored amount: an expired or abandoned checkout,
  -- restore_gift_card_for_job, a bounced debit, a duplicate-funding refund, a dispute split) from handing back
  -- the leftover a second time, the original's amount is LOWERED to exactly what it pays toward this job.
  -- The split-off child keeps parent_credit_id (a donor refund or chargeback still revokes it) and carries
  -- split_for_job_id, so restore_gift_card_for_job does not subtract it from the lowered amount again.
  -- A retry for the same job finds the gift already lowered: leftover 0, nothing split twice.
  if v_difference_cents = 0 and p_tax_cents > 0 then
    update gift_cards
       set status = 'reserved', job_id = p_job_id, amount = v_applied_cents::numeric / 100
     where id = p_credit_id;
    if v_leftover_cents > 0 then
      insert into gift_cards (
        donor_id, recipient_id, recipient_email, amount,
        status, payment_status, category, message, parent_credit_id, split_for_job_id
      ) values (
        v_credit.donor_id, v_credit.recipient_id, v_credit.recipient_email,
        v_leftover_cents::numeric / 100,
        'sent', 'paid', v_credit.category, v_credit.message, p_credit_id, p_job_id
      );
    end if;
    return jsonb_build_object(
      'outcome',        'tax_due',
      'tax_cents',      p_tax_cents,
      'applied_cents',  v_applied_cents,
      'leftover_cents', v_leftover_cents,
      'fee_cents',      v_fee_cents
    );
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
      'applied_cents',    v_applied_cents,
      -- The fee this redeem priced, so create-payment can refuse a shortfall
      -- whose fee is not the one it quoted (review of gift-first, #3).
      'fee_cents',        v_fee_cents
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
    'leftover_cents', v_leftover_cents,
    'fee_cents',      v_fee_cents
  );
end;
$function$;

REVOKE ALL ON FUNCTION public.redeem_gift_card(uuid, uuid, uuid, text, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.redeem_gift_card(uuid, uuid, uuid, text, integer) TO service_role;

create or replace function public.restore_gift_card_for_job(
  p_job_id uuid,
  p_share_bps integer default 10000,
  p_dry_run boolean default false,
  -- CHANGED (Q1914): an exact number of cents to give back, when the caller knows it (applied - a fee the gift pays).
  -- NULL keeps the basis-point share. Capped to what the gift paid toward the job; never below 0.
  p_restore_cents integer default null
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
DECLARE
  v_job_id          uuid;
  v_credit          record;
  v_existing        record;
  v_share_bps       integer;
  v_credit_cents    integer;
  v_leftover_cents  integer;
  v_applied_cents   integer;
  v_restore_cents   integer;
  v_new_id          uuid;
  v_unreserved      integer;
BEGIN
  IF p_job_id IS NULL THEN
    RAISE EXCEPTION 'p_job_id is required' USING errcode = '22023';
  END IF;

  v_share_bps := least(greatest(coalesce(p_share_bps, 10000), 0), 10000);

  SELECT id INTO v_job_id FROM public.jobs WHERE id = p_job_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('outcome', 'job_not_found');
  END IF;

  -- `payment_status` joins the projection so the mint below can inherit it.
  SELECT id, donor_id, recipient_id, recipient_email, amount, status,
         category, message, occasion, design_id, expires_at, payment_status
    INTO v_credit
    FROM public.gift_cards
   WHERE job_id = p_job_id
     AND status IN ('redeemed', 'reserved')
   ORDER BY (status = 'redeemed') DESC, created_at
   LIMIT 1
   FOR UPDATE;
  IF NOT FOUND THEN
    SELECT id, amount INTO v_existing
      FROM public.gift_cards
     WHERE restored_from_job_id = p_job_id
     LIMIT 1;
    IF FOUND THEN
      RETURN jsonb_build_object(
        'outcome',       'already_restored',
        'credit_id',     v_existing.id,
        'restore_cents', round(v_existing.amount * 100)::int
      );
    END IF;
    RETURN jsonb_build_object('outcome', 'no_credit');
  END IF;

  IF v_credit.status = 'reserved' THEN
    -- CHANGED (Q1914): an exact amount below the whole gift is a partial unreserve too.
    IF v_share_bps < 10000 OR (p_restore_cents IS NOT NULL AND p_restore_cents < round(v_credit.amount * 100)::int) THEN
      RETURN jsonb_build_object(
        'outcome',   'partial_unreserve_unsupported',
        'credit_id', v_credit.id
      );
    END IF;
    IF p_dry_run THEN
      RETURN jsonb_build_object(
        'outcome',       'would_unreserve',
        'credit_id',     v_credit.id,
        'applied_cents', 0,
        'restore_cents', 0
      );
    END IF;
    UPDATE public.gift_cards
       SET status = 'sent', job_id = NULL
     WHERE id = v_credit.id
       AND status = 'reserved';
    GET DIAGNOSTICS v_unreserved = ROW_COUNT;
    IF v_unreserved = 0 THEN
      RETURN jsonb_build_object('outcome', 'no_credit', 'credit_id', v_credit.id);
    END IF;
    RETURN jsonb_build_object(
      'outcome',      'unreserved',
      'credit_id',    v_credit.id,
      'recipient_id', v_credit.recipient_id,
      'restore_cents', round(v_credit.amount * 100)::int
    );
  END IF;

  v_credit_cents := round(v_credit.amount * 100)::int;
  SELECT coalesce(sum(round(amount * 100)::int), 0)
    INTO v_leftover_cents
    FROM public.gift_cards
   WHERE parent_credit_id = v_credit.id
     AND restored_from_job_id IS NULL
     -- CHANGED (Q1728 option A): a leftover split off when the gift was reserved for a tax checkout is
     -- already taken out of this gift's (lowered) amount; subtracting it again would undervalue the gift.
     AND split_for_job_id IS NULL;
  v_applied_cents := greatest(v_credit_cents - v_leftover_cents, 0);

  SELECT id, amount INTO v_existing
    FROM public.gift_cards
   WHERE restored_from_job_id = p_job_id
   LIMIT 1;
  IF FOUND THEN
    RETURN jsonb_build_object(
      'outcome',       'already_restored',
      'credit_id',     v_existing.id,
      'applied_cents', v_applied_cents,
      'restore_cents', round(v_existing.amount * 100)::int
    );
  END IF;

  -- CHANGED (Q1914): the exact cents when given (the poster loses no rounding), else the basis-point share.
  v_restore_cents := CASE WHEN p_restore_cents IS NOT NULL THEN least(greatest(p_restore_cents, 0), v_applied_cents)
                          ELSE (v_applied_cents::bigint * v_share_bps / 10000)::int END;

  IF v_restore_cents <= 0 THEN
    RETURN jsonb_build_object(
      'outcome',       CASE WHEN p_dry_run THEN 'would_restore' ELSE 'nothing_to_restore' END,
      'credit_id',     v_credit.id,
      'applied_cents', v_applied_cents,
      'restore_cents', 0
    );
  END IF;

  IF p_dry_run THEN
    -- Dry run still VALUES a revoked donation. `release-payout` uses this to
    -- size the escrow it is about to pay a helper from, and that helper earned
    -- their money whatever the donor's bank later did.
    RETURN jsonb_build_object(
      'outcome',       'would_restore',
      'credit_id',     v_credit.id,
      'applied_cents', v_applied_cents,
      'restore_cents', v_restore_cents
    );
  END IF;

  BEGIN
    INSERT INTO public.gift_cards (
      donor_id, recipient_id, recipient_email, amount,
      status, payment_status, category, message, occasion, design_id,
      parent_credit_id, restored_from_job_id, expires_at
    ) VALUES (
      v_credit.donor_id, v_credit.recipient_id, v_credit.recipient_email,
      v_restore_cents::numeric / 100,
      -- INHERITED, not hardcoded 'paid'. When the donation behind this credit
      -- was refunded or charged back, `revoke_gift_card_for_refund` stamped the
      -- parent 'refunded'; minting the replacement as 'paid' would turn money
      -- that went back to the donor into fresh spendable credit. The row is
      -- still written so the gift -> job -> cancellation -> replacement trail
      -- stays readable in one query; it simply cannot be spent.
      'sent', coalesce(v_credit.payment_status, 'paid'),
      v_credit.category, v_credit.message, v_credit.occasion, v_credit.design_id,
      v_credit.id, p_job_id,
      greatest(coalesce(v_credit.expires_at, now() + interval '90 days'),
               now() + interval '90 days')
    )
    RETURNING id INTO v_new_id;
  EXCEPTION WHEN unique_violation THEN
    SELECT id, amount INTO v_existing
      FROM public.gift_cards
     WHERE restored_from_job_id = p_job_id
     LIMIT 1;
    RETURN jsonb_build_object(
      'outcome',       'already_restored',
      'credit_id',     v_existing.id,
      'restore_cents', round(v_existing.amount * 100)::int
    );
  END;

  RETURN jsonb_build_object(
    'outcome',            'restored',
    'credit_id',          v_new_id,
    'parent_credit_id',   v_credit.id,
    'recipient_id',       v_credit.recipient_id,
    'applied_cents',      v_applied_cents,
    'restore_cents',      v_restore_cents,
    -- So a caller can tell a live restoration from an audit-only one.
    'payment_status',     coalesce(v_credit.payment_status, 'paid')
  );
END;
$function$;
REVOKE ALL ON FUNCTION public.restore_gift_card_for_job(uuid, integer, boolean, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.restore_gift_card_for_job(uuid, integer, boolean, integer) TO service_role;
