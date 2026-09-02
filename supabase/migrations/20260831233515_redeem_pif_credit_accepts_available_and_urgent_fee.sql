-- ============================================================
-- Gift cards: the credit that could never be spent.
--
-- F-GIFT-1 (BLOCKER — this is the reported "I clicked to use my gift
--   card and the money doesn't transfer"): the directed-gift migration
--   20260705190000 ADDED the 'sent' status and deliberately KEPT the
--   legacy 'available' one in the CHECK constraint ("so old rows and a
--   replay both pass"). The gift-card UI was written to match: the
--   redeem button in src/pages/payItForward/CreditCard.tsx surfaces on
--   `status === "sent" || status === "available"`, and StatusPill
--   renders both. `redeem_pif_credit` (20260705200000) was the one
--   layer that never got the memo — its state gate is
--
--       elsif v_credit.status <> 'sent' then
--         raise exception 'This gift is no longer available';
--
--   so every 'available' credit shows a live "Use This Gift" button
--   that walks the recipient into a hard server-side refusal. The job
--   they just posted is then DELETED by the client's orphan cleanup
--   (src/pages/postjob/useJobSubmit.ts) and they are told
--   "Couldn't start payment: This gift is no longer available."
--   Verified against prod on 2026-08-31: all three pif_credits rows
--   carry status='available', payment_status='paid' — including the
--   $75 and $25 gifts held by the account that filed the report. Every
--   spendable gift card in the database was unspendable.
--
--   Fixed on both sides: the gate now accepts 'available' (identical
--   risk profile to 'sent' — the ownership, funding and expiry checks
--   above it are unchanged, and a legacy pool credit has
--   recipient_id IS NULL so it is still rejected by the ownership
--   check), AND the paid, already-directed rows are normalised to
--   'sent' so the whole system speaks one vocabulary going forward.
--
-- F-GIFT-2 (money leak): the redemption amount was computed from
--   `jobs.budget` alone, but nothing stops a recipient marking the job
--   urgent, and release-payout / process-scheduled-payouts pay the
--   helper `budget + netUrgentFeeDollars(urgent_fee)`. On the PIF path
--   the poster is charged NOTHING outside this function (create-payment
--   short-circuits before the fee/urgent/tax line items), so the urgent
--   fee was paid out to the helper and collected from nobody — the
--   platform ate it. The gift now applies against
--   `budget + urgent_fee`, which is exactly the poster-side cost of a
--   PIF job (the service fee is waived by design: create-pif-donation
--   already charged the DONOR the processing-cost floor via
--   posterServiceFeeCents(amount, 0)).
--
-- Replay-safe: CREATE OR REPLACE and a WHERE-guarded UPDATE are both
-- idempotent, and this runs after 20260705190000 (which adds
-- payment_status / recipient_email) and 20260705200000 (the original
-- function).
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
  v_cost_cents       int;
  v_credit_cents     int;
  v_applied_cents    int;
  v_leftover_cents   int;
  v_difference_cents int;
begin
  -- Lock the job first (stable lock order: job before credit).
  -- urgent_fee joins the projection for F-GIFT-2.
  select id, customer_id, budget, urgent_fee, payment_status
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

  -- The poster-side cost of a PIF job: budget + urgent fee. No service
  -- fee (waived — the donor covered the processing floor at donate time)
  -- and no sales tax (the settled branch never touches Stripe, so there
  -- is no automatic_tax calculation to attach; only assembly labour is
  -- taxable in LA and PIF volume is small — tracked separately).
  v_cost_cents       := round((v_job.budget + coalesce(v_job.urgent_fee, 0)) * 100)::int;
  v_credit_cents     := round(v_credit.amount * 100)::int;
  v_applied_cents    := least(v_cost_cents, v_credit_cents);
  v_leftover_cents   := v_credit_cents - v_applied_cents;
  v_difference_cents := v_cost_cents - v_applied_cents;

  -- Credit doesn't fully cover the cost → reserve it; the caller collects
  -- the shortfall via Stripe and the webhook finishes the job.
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

  -- Any remainder (credit > cost) becomes a fresh, already-claimed gift to
  -- the same recipient so no donated value is lost. No claim token: the
  -- recipient is already resolved.
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

-- Service-role only — never callable by a client token. Re-asserted here
-- because CREATE OR REPLACE preserves the existing ACL and this keeps the
-- guarantee visible next to the function it protects.
revoke all on function redeem_pif_credit(uuid, uuid, uuid) from public, anon, authenticated;

-- ── Normalise the legacy status spelling ────────────────────────────
-- Paid gifts that are already bound to a recipient are directed gifts in
-- every respect except the word in the column. Move them onto 'sent' so
-- StatusPill says "Ready to use", the RPC's primary branch matches, and
-- nothing downstream has to keep remembering that two spellings exist.
--
-- Scoped deliberately: an 'available' row with recipient_id IS NULL is an
-- unclaimed legacy pool credit which has no recipient_email either, so
-- claim-pif-credit refuses it by design — flipping it to 'sent' would
-- dress up an unusable row as a live gift. Those are left exactly as they
-- are. The WHERE clause makes a re-run a no-op.
update pif_credits
   set status = 'sent'
 where status = 'available'
   and payment_status = 'paid'
   and recipient_id is not null;
