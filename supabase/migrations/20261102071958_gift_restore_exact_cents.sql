-- Q1914 (lh-money-escrow review of Q1806): restore_gift_card_for_job only took a whole-basis-point share, so
-- void-cancelled-payments' restorePifGift, giving back a gift less a fee the poster owes, picked the largest bps that
-- does not overshoot and the poster lost the rounding (measured: a $330 gift less a $150 fee kept $150.02 and the notice
-- said $179.98 was back). Now the function also takes p_restore_cents, an exact number of cents (capped to what the
-- gift paid toward the job), and the edge passes applied - fee.
-- Restated from 20260922165121 (the newest definition, also on main) with that parameter only. The old 3-argument
-- signature is DROPPED first: a 4-argument overload beside it would make every named-argument call (PostgREST)
-- ambiguous. Every caller passes named arguments (p_job_id, p_share_bps, p_dry_run), which the new signature takes
-- unchanged; no SQL function calls it. Grants restated (service_role only, as live).
-- Replay-safe: DROP ... IF EXISTS of the old signature, CREATE OR REPLACE of the new.
-- Proof: src/test/pglite/giftRestoreExactCents.pglite.mjs.

DROP FUNCTION IF EXISTS public.restore_gift_card_for_job(uuid, integer, boolean);

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
