-- ============================================================
-- redeem_pif_credit — atomic Pay It Forward redemption (backlog #106)
--
-- Settles a directed gift against a job the recipient just posted.
-- SECURITY DEFINER because the directed-gift migration removed every
-- client INSERT/UPDATE on pif_credits (a column-unrestricted client
-- UPDATE let a recipient inflate `amount` before redeeming = theft),
-- so the ONLY path that moves this money is a service-role RPC.
--
-- Locks the job then the credit FOR UPDATE (fixed lock order → no
-- deadlock), validates ownership/funding/expiry, then either:
--   • settles inline (credit >= budget): consume the credit, mint a
--     leftover gift to the same recipient for the remainder, and flip
--     the job to 'escrow' (funded from the prepaid platform balance —
--     no Stripe charge for the recipient), OR
--   • reserves (credit < budget): hold the credit against the job and
--     tell the caller to collect the shortfall via Stripe; the
--     difference-payment webhook consumes the reservation + funds the
--     job. Re-entry with an already-reserved credit for the SAME job
--     is a retry, not an error, so an abandoned difference payment can
--     be resumed.
--
-- Replay-safe: CREATE OR REPLACE + REVOKE are idempotent, and it runs
-- after 20260705190000 which adds the columns it reads.
-- ============================================================

create or replace function redeem_pif_credit(
  p_credit_id uuid,
  p_job_id    uuid,
  p_user_id   uuid
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_job              record;
  v_credit           record;
  v_budget_cents     int;
  v_credit_cents     int;
  v_applied_cents    int;
  v_leftover_cents   int;
  v_difference_cents int;
begin
  -- Lock the job first (stable lock order: job before credit).
  select id, customer_id, budget, payment_status
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

  -- Lock the credit.
  select id, donor_id, recipient_id, recipient_email, amount, status,
         payment_status, category, message, job_id, expires_at
    into v_credit
    from pif_credits
   where id = p_credit_id
   for update;
  if not found then
    raise exception 'Gift not found' using errcode = 'P0002';
  end if;

  -- Ownership: only the named, claimed recipient may redeem.
  if v_credit.recipient_id is null or v_credit.recipient_id <> p_user_id then
    raise exception 'This gift is not yours to redeem' using errcode = '42501';
  end if;
  if v_credit.payment_status <> 'paid' then
    raise exception 'This gift has not been funded yet' using errcode = 'P0001';
  end if;
  if v_credit.expires_at is not null and v_credit.expires_at < now() then
    raise exception 'This gift has expired' using errcode = 'P0001';
  end if;

  -- State gate. 'sent' = fresh, redeemable. 'reserved' tied to THIS job =
  -- a retry of an abandoned difference payment (allowed). Anything else
  -- (reserved for a different job, already redeemed, expired) is blocked.
  if v_credit.status = 'reserved' then
    if v_credit.job_id is distinct from p_job_id then
      raise exception 'This gift is reserved for another job' using errcode = 'P0001';
    end if;
  elsif v_credit.status <> 'sent' then
    raise exception 'This gift is no longer available' using errcode = 'P0001';
  end if;

  v_budget_cents     := round(v_job.budget * 100)::int;
  v_credit_cents     := round(v_credit.amount * 100)::int;
  v_applied_cents    := least(v_budget_cents, v_credit_cents);
  v_leftover_cents   := v_credit_cents - v_applied_cents;
  v_difference_cents := v_budget_cents - v_applied_cents;

  -- Credit doesn't fully cover the budget → reserve it; the caller
  -- collects the shortfall via Stripe and the webhook finishes the job.
  if v_difference_cents > 0 then
    update pif_credits
       set status = 'reserved', job_id = p_job_id
     where id = p_credit_id;
    return jsonb_build_object(
      'outcome',          'needs_payment',
      'difference_cents', v_difference_cents,
      'applied_cents',    v_applied_cents
    );
  end if;

  -- Fully covered → consume the credit and fund the job now (no Stripe).
  update pif_credits
     set status = 'redeemed', job_id = p_job_id, redeemed_at = now()
   where id = p_credit_id;

  -- Any remainder (credit > budget) becomes a fresh, already-claimed
  -- gift to the same recipient so no donated value is lost. No claim
  -- token: the recipient is already resolved.
  if v_leftover_cents > 0 then
    insert into pif_credits (
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
$$;

-- Service-role only — never callable by a client token.
revoke all on function redeem_pif_credit(uuid, uuid, uuid) from public, anon, authenticated;
