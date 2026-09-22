-- revoke_gift_card_for_refund — make a refunded or charged-back gift donation
-- stop being spendable credit.
--
-- THE HOLE THIS CLOSES (audited 2026-09-22, gift_cards was empty so nothing was
-- lost yet — this is a launch blocker, not an incident):
--
--   `stripe-webhook`'s charge.refunded / charge.dispute.created handlers resolve
--   the affected record by `jobs.stripe_payment_intent_id`. A gift purchase's
--   PaymentIntent is written ONLY to `gift_cards.stripe_payment_intent_id` and
--   never to `jobs`, so both handlers found no row and no-op'd. The credit kept
--   `payment_status = 'paid'` — exactly what `redeem_gift_card` requires — so a
--   donor could charge back $500 and the recipient could still spend it. And a
--   gift-funded job has no Stripe charge behind it, so `release-payout` pays the
--   helper from the PLATFORM BALANCE with no `source_transaction`. Net result:
--   the platform funds the helper out of its own money, plus the chargeback fee,
--   with no alert and no ledger row.
--
-- WHY AN RPC AND NOT PostgREST CALLS FROM THE HANDLER:
--   The value to revoke is a TREE, not a row. When a gift is bigger than the job
--   it funds, `redeem_gift_card` consumes the cost and mints the remainder as a
--   CHILD row (`parent_credit_id`), and `restore_gift_card_for_job` mints another
--   child when a gift-funded job is cancelled. Those children are unspent value
--   derived from the same donation. Revoking only the row that carries the
--   PaymentIntent would leave them spendable and defeat most of the refund on
--   exactly the large gifts where it matters most. A recursive walk under one
--   lock is the only way to do that atomically.
--
-- THE DESIGN CALL — a credit that was ALREADY SPENT is NOT clawed back.
--   Money that already reached a job is the helper's. Reversing their escrow
--   because the donor disputed the donation makes an innocent third party pay for
--   a fight they are not in — the same "wrong party is debited" class as the
--   platform-drain payout bug. So: unspent value is revoked, spent value is
--   REPORTED (counts + cents + job ids) so the caller can page ops and a human
--   can decide. This function never touches `jobs`, never touches a payout, and
--   never moves money.
--
-- Idempotent: a second call finds nothing still 'paid' and returns
-- revoked_count = 0 while STILL reporting what was spent, so a webhook
-- re-delivery is a no-op that keeps telling the truth.

create or replace function public.revoke_gift_card_for_refund(
  p_payment_intent_id text,
  p_reason            text default 'refund'
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_root_id       uuid;
  v_revoked_count int := 0;
  v_revoked_cents int := 0;
  v_spent_count   int := 0;
  v_spent_cents   int := 0;
  v_spent_jobs    uuid[];
  v_tree          uuid[];
begin
  if p_payment_intent_id is null or btrim(p_payment_intent_id) = '' then
    return jsonb_build_object('outcome', 'no_gift');
  end if;

  -- Is this PaymentIntent a gift donation at all? The overwhelmingly common
  -- case is "no" (it is a job escrow PI), and that must be cheap and silent.
  -- Locked because everything below depends on the tree not moving.
  select id into v_root_id
    from gift_cards
   where stripe_payment_intent_id = p_payment_intent_id
   limit 1
   for update;

  if not found then
    return jsonb_build_object('outcome', 'no_gift');
  end if;

  -- The whole derived tree: the donation plus every credit minted FROM it,
  -- transitively. `parent_credit_id` is set by both minting paths
  -- (redeem_gift_card's leftover, restore_gift_card_for_job's replacement).
  --
  -- `cycle` is not paranoia dressed as SQL: parent_credit_id is a self-FK with
  -- no constraint preventing a loop, and an unguarded recursive CTE over a
  -- cyclic graph does not return a wrong answer, it hangs — inside a webhook
  -- holding a row lock. Postgres's CYCLE clause ends it deterministically.
  with recursive tree as (
    select id from gift_cards where id = v_root_id
    union
    select g.id
      from gift_cards g
      join tree t on g.parent_credit_id = t.id
  ) cycle id set is_cycle using path
  select array_agg(distinct id) into v_tree from tree;

  -- Lock the descendants too, in id order so two concurrent revocations of
  -- overlapping trees can never deadlock against each other.
  perform 1 from gift_cards
   where id = any(v_tree)
   order by id
     for update;

  -- ── Revoke what is still spendable ──────────────────────────────────────
  -- 'reserved' is included deliberately: it is held against a job whose
  -- shortfall checkout has not completed, so no money has moved for it yet and
  -- `redeem_gift_card` would happily let the recipient re-enter and spend it.
  -- `status` is left alone on purpose — the status CHECK has no 'revoked' value
  -- and StatusPill renders an unknown status as "Available", so inventing one
  -- here would read as MORE spendable, not less. `payment_status` is the gate
  -- both `redeem_gift_card` and (as of this change) `claim-gift-card` enforce.
  with revoked as (
    update gift_cards
       set payment_status = 'refunded'
     where id = any(v_tree)
       and payment_status = 'paid'
       and status in ('sent', 'available', 'reserved')
    returning amount
  )
  select count(*)::int, coalesce(sum(round(amount * 100)::int), 0)
    into v_revoked_count, v_revoked_cents
    from revoked;

  -- ── Report what is already gone ─────────────────────────────────────────
  -- Not clawed back (see the header). Counted so the caller can page ops with
  -- a real number instead of "something may have happened".
  select count(*)::int,
         coalesce(sum(round(amount * 100)::int), 0),
         coalesce(array_agg(job_id) filter (where job_id is not null), '{}')
    into v_spent_count, v_spent_cents, v_spent_jobs
    from gift_cards
   where id = any(v_tree)
     and status = 'redeemed';

  return jsonb_build_object(
    'outcome',       'revoked',
    'reason',        coalesce(p_reason, 'refund'),
    'credit_id',     v_root_id,
    'tree_size',     coalesce(array_length(v_tree, 1), 0),
    'revoked_count', v_revoked_count,
    'revoked_cents', v_revoked_cents,
    'spent_count',   v_spent_count,
    'spent_cents',   v_spent_cents,
    'spent_job_ids', to_jsonb(v_spent_jobs)
  );
end;
$function$;

-- Same posture as redeem_gift_card / restore_gift_card_for_job: service_role
-- only. A client that could call this could revoke a gift it does not own.
-- Revoke FROM PUBLIC **and** anon by name — `FROM PUBLIC` alone leaves anon's
-- own explicit grant in place (verified in pg_proc.proacl).
revoke all on function public.revoke_gift_card_for_refund(text, text) from public;
revoke all on function public.revoke_gift_card_for_refund(text, text) from anon;
revoke all on function public.revoke_gift_card_for_refund(text, text) from authenticated;
grant execute on function public.revoke_gift_card_for_refund(text, text) to service_role;

comment on function public.revoke_gift_card_for_refund(text, text) is
  'Revoke the unspent portion of a gift-card donation tree after the donor''s charge was refunded or disputed. Reports already-spent value rather than clawing it back from the helper who earned it. Service-role only; called by stripe-webhook.';
