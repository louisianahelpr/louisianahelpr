-- Three holes found by a silent-failure review of 20260922162458, the migration
-- that made a refunded/charged-back gift stop being spendable. The first is the
-- serious one: that migration CREATED it.
--
-- ── 1. A revoked donation could be re-minted into fresh spendable credit ────
--
-- `revoke_gift_card_for_refund` deliberately leaves already-REDEEMED rows alone
-- (the design call: money that reached a helper who did the work is not clawed
-- back to settle the donor's dispute). But it left them at
-- `payment_status = 'paid'`, and `restore_gift_card_for_job` selects exactly
-- those rows:
--
--     WHERE job_id = p_job_id AND status IN ('redeemed', 'reserved')
--
-- and mints a replacement at `status='sent', payment_status='paid'` when the
-- job is later cancelled or a dispute is split. It could not have known better
-- — the redeemed parent still read as funded.
--
-- So: donor charges back $500 → revoke runs, reports the spent job, pages ops
-- → that job is cancelled a week later → a brand-new, fully spendable $500
-- credit is minted out of money that already went back to the donor, with no
-- alert at mint time. `release-payout` then pays out of the platform balance
-- again. That is minting value from nothing, which is the one thing every other
-- path in this system is built to prevent.
--
-- Fixed on BOTH sides:
--   (a) revoke now stamps the consumed rows `payment_status='refunded'` too.
--       They are already spent, so this moves no money and changes nothing for
--       the helper — it only records that the donation behind them was
--       reversed, which is the fact restore needs and could not see.
--   (b) the replacement restore mints INHERITS the parent's payment_status
--       instead of hardcoding 'paid'. A revoked donation therefore restores to
--       a non-spendable row: the audit trail survives, the value does not.
--
-- Inheriting is deliberately chosen over refusing. `void-cancelled-payments`
-- accepts a fixed set of outcomes and leaves the job in escrow to retry hourly
-- on anything else, so a new "refused" outcome would spin forever; and
-- `release-payout` values gift-funded escrow through this function's dry run,
-- so refusing would block paying a helper who earned it. Inheriting keeps every
-- caller working and still creates nothing spendable.
--
-- ── 2. `expired` rows fell through both arms of the report ──────────────────
--
-- The status CHECK allows five values. The revoke UPDATE covered three and the
-- spent report covered `redeemed`; an `expired` row was in neither, so it kept
-- `payment_status='paid'` and appeared nowhere in the returned JSON —
-- `tree_size` did not equal `revoked_count + spent_count` and ops could not
-- reconcile the payload against the tree. Not exploitable (both the claim and
-- redeem paths block on `expires_at`), but "the numbers look complete" is
-- exactly the failure this report exists to prevent.
--
-- ── 3. One PaymentIntent, one gift — now enforced ──────────────────────────
--
-- `stripe_payment_intent_id` carried only a plain partial index. Two rows on
-- one PI would make the handler's `.maybeSingle()` lookups throw PGRST116 while
-- this function's `limit 1` quietly revoked only ONE tree — two paths, opposite
-- failure modes, on an invariant nothing enforced.

-- Replay-safe: partial unique index, created only if absent. Guarded rather
-- than CREATE UNIQUE INDEX IF NOT EXISTS so a pre-existing non-unique index of
-- the same shape cannot make this silently pass.
do $$
begin
  if to_regclass('public.gift_cards_payment_intent_unique_idx') is null then
    create unique index gift_cards_payment_intent_unique_idx
      on public.gift_cards (stripe_payment_intent_id)
      where stripe_payment_intent_id is not null;
  end if;
end $$;

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
  v_other_count   int := 0;
  v_spent_jobs    uuid[];
  v_tree          uuid[];
begin
  if p_payment_intent_id is null or btrim(p_payment_intent_id) = '' then
    return jsonb_build_object('outcome', 'no_gift');
  end if;

  select id into v_root_id
    from gift_cards
   where stripe_payment_intent_id = p_payment_intent_id
   limit 1
   for update;

  if not found then
    return jsonb_build_object('outcome', 'no_gift');
  end if;

  with recursive tree as (
    select id from gift_cards where id = v_root_id
    union
    select g.id
      from gift_cards g
      join tree t on g.parent_credit_id = t.id
  ) cycle id set is_cycle using path
  select array_agg(distinct id) into v_tree from tree;

  -- Defence in depth: `id = any(NULL)` is NULL for every row, so a NULL tree
  -- would update nothing, count nothing, and still return 'revoked' with
  -- all-zero counts — which the caller reports as the reassuring "nothing had
  -- been spent". Unreachable today (the base term always holds the locked
  -- root), and now impossible rather than merely improbable.
  if v_tree is null or array_length(v_tree, 1) is null then
    raise exception 'revoke_gift_card_for_refund: empty tree for root %', v_root_id
      using errcode = 'P0001';
  end if;

  perform 1 from gift_cards
   where id = any(v_tree)
   order by id
     for update;

  -- ── Revoke everything still spendable ───────────────────────────────────
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

  -- ── Report what was already spent, and STAMP it ─────────────────────────
  -- Reported, never clawed back. The stamp is new and is the fix for the
  -- re-mint hole: `restore_gift_card_for_job` reads this row when the funded
  -- job is later cancelled, and without a marker it minted a fresh spendable
  -- credit from money that had already gone back to the donor. Flipping
  -- payment_status on an already-consumed row moves nothing and takes nothing
  -- from the helper; it only records that the donation was reversed.
  select count(*)::int,
         coalesce(sum(round(amount * 100)::int), 0),
         coalesce(array_agg(job_id) filter (where job_id is not null), '{}')
    into v_spent_count, v_spent_cents, v_spent_jobs
    from gift_cards
   where id = any(v_tree)
     and status = 'redeemed';

  update gift_cards
     set payment_status = 'refunded'
   where id = any(v_tree)
     and status = 'redeemed'
     and payment_status = 'paid';

  -- ── Everything else in the tree (today: 'expired') ──────────────────────
  -- Stamped as well, so no member of a reversed donation is left reading
  -- 'paid', and counted so tree_size reconciles against the payload.
  update gift_cards
     set payment_status = 'refunded'
   where id = any(v_tree)
     and payment_status = 'paid'
     and status not in ('sent', 'available', 'reserved', 'redeemed');
  get diagnostics v_other_count = row_count;

  return jsonb_build_object(
    'outcome',       'revoked',
    'reason',        coalesce(p_reason, 'refund'),
    'credit_id',     v_root_id,
    'tree_size',     coalesce(array_length(v_tree, 1), 0),
    'revoked_count', v_revoked_count,
    'revoked_cents', v_revoked_cents,
    'spent_count',   v_spent_count,
    'spent_cents',   v_spent_cents,
    'other_count',   v_other_count,
    'spent_job_ids', to_jsonb(v_spent_jobs)
  );
end;
$function$;

revoke all on function public.revoke_gift_card_for_refund(text, text) from public;
revoke all on function public.revoke_gift_card_for_refund(text, text) from anon;
revoke all on function public.revoke_gift_card_for_refund(text, text) from authenticated;
grant execute on function public.revoke_gift_card_for_refund(text, text) to service_role;

-- restore_gift_card_for_job — unchanged except that the replacement it mints
-- inherits the parent's `payment_status` instead of hardcoding 'paid', and the
-- SELECT that loads the parent now projects that column. Everything else is
-- byte-for-byte the live definition.
create or replace function public.restore_gift_card_for_job(
  p_job_id uuid,
  p_share_bps integer default 10000,
  p_dry_run boolean default false
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
    IF v_share_bps < 10000 THEN
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
     AND restored_from_job_id IS NULL;
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

  v_restore_cents := (v_applied_cents::bigint * v_share_bps / 10000)::int;

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

revoke all on function public.restore_gift_card_for_job(uuid, integer, boolean) from public;
revoke all on function public.restore_gift_card_for_job(uuid, integer, boolean) from anon;
revoke all on function public.restore_gift_card_for_job(uuid, integer, boolean) from authenticated;
grant execute on function public.restore_gift_card_for_job(uuid, integer, boolean) to service_role;
