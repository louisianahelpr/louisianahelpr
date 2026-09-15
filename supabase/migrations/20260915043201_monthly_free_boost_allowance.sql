-- The monthly free Job Boost becomes a COUNT, so Plus can get more than Pro
-- (owner, 2026-09-14, VN-44: Plus gets "more free boosts", above Pro's 1).
--
-- WHY THE OLD METER CANNOT DO IT
-- The perk was metered by one column, `profiles.boost_credit_used_month`
-- (20260824255000): create-boost-payment stamped 'YYYY-MM' with a conditional
-- UPDATE "... WHERE month IS NULL OR month <> this month". That is a boolean per
-- month — used or not — so the only allowance it can express is exactly one.
-- Selling Plus "2 free Job Boosts every month" on top of it would advertise a
-- perk the server does not grant: the second boost would go to Stripe Checkout.
--
-- WHAT THIS ADDS
--   1. `profiles.boost_credit_used_count` — how many of this month's free boosts
--      are spent. Meaningful only while `boost_credit_used_month` is the current
--      month; a new month resets it on the next claim.
--   2. `claim_monthly_free_boost(user, allowance)` — the claim, as ONE UPDATE so
--      two same-moment boosts cannot both ride the last credit. Under READ
--      COMMITTED the second writer blocks on the row lock and Postgres
--      re-evaluates the WHERE (and the SET) against the row the first writer
--      committed, so the count check sees the spent credit. This is the same
--      guarantee the old conditional month stamp relied on, extended to N.
--   3. `refund_monthly_free_boost(user, month)` — hands one credit back when the
--      boost flip fails after the claim, conditional on the month still being
--      the one claimed so a later month's meter is never touched.
--   4. The count joins `profiles_locked_update_columns()`, beside the month it
--      qualifies, then the grants are re-synced. A member who could write it
--      could reset their own meter — unlimited free paid placement — which is
--      precisely why the month column was locked in 20260903070258.
--
-- THE ALLOWANCE IS A PARAMETER, NOT A TIER TABLE
-- MONTHLY_FREE_BOOSTS (supabase/functions/_shared/tierPerks.ts) is the one place
-- that says Pro 1 / Plus 2, and SQL cannot import it. So the caller —
-- create-boost-payment, running as service_role after it has resolved the
-- member's ACTIVE tier — passes the number, and this function knows only how to
-- meter. Same division of labour as admin_support_queue's p_priority_tiers.
-- Neither function is callable by authenticated or anon: the allowance is an
-- argument, so exposing the claim would let a member pass any number they like.
--
-- LEGACY ROWS: `GREATEST(count, 1)` WHILE THE MONTH IS CURRENT
-- A row stamped with this month by the pre-allowance edge code has count 0 (the
-- column default) — and that member HAS spent a boost. Reading 0 literally
-- would hand every Pro member who boosted earlier this month a second free one.
-- So while the stamped month is the current month, "used" is never less than 1.
-- This also covers the deploy window: functions-deploy and db-deploy run as
-- separate workflows on the same push, so the old edge code may keep stamping
-- the month alone for a few minutes after this lands, and those stamps must
-- count. The client twin (`monthlyFreeBoostsRemaining`) applies the same rule.
-- A refund that takes the count to zero clears the month too, so "month current
-- AND nothing spent" is only ever represented as month NULL / a past month.
--
-- MONTH BOUNDARY: UTC 'YYYY-MM', matching `new Date().toISOString().slice(0,7)`
-- in create-boost-payment and JobBoostDialog.
--
-- REPLAY-SAFE: ADD COLUMN IF NOT EXISTS; CREATE OR REPLACE for the functions
-- (new signatures, unchanged return types on replay); the locked-columns
-- function is replaced wholesale from its LIVE body (read with
-- pg_get_functiondef on 2026-09-15) with one entry added; the re-sync is
-- idempotent (it no-ops when grants already match).

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS boost_credit_used_count integer NOT NULL DEFAULT 0;

COMMENT ON COLUMN public.profiles.boost_credit_used_count IS
  'Free monthly Job Boosts spent in boost_credit_used_month. Written only by '
  'claim_monthly_free_boost / refund_monthly_free_boost (service_role). While '
  'the month is current, used = GREATEST(count, 1). Allowance per tier: '
  'MONTHLY_FREE_BOOSTS in supabase/functions/_shared/tierPerks.ts.';

-- ── The claim ────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.claim_monthly_free_boost(
  p_user_id uuid,
  p_allowance integer
)
RETURNS TABLE(claimed boolean, credit_month text, credits_used integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_month text := to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM');
  v_used  integer;
BEGIN
  -- No allowance, no claim. A non-positive or NULL allowance is a caller that
  -- resolved no entitlement; it must never stamp the meter.
  IF p_user_id IS NULL OR coalesce(p_allowance, 0) < 1 THEN
    RETURN QUERY SELECT false, v_month, NULL::integer;
    RETURN;
  END IF;

  UPDATE public.profiles p
     SET boost_credit_used_month = v_month,
         boost_credit_used_count =
           CASE
             WHEN p.boost_credit_used_month = v_month
               THEN greatest(p.boost_credit_used_count, 1) + 1
             ELSE 1
           END
   WHERE p.user_id = p_user_id
     AND (
       p.boost_credit_used_month IS DISTINCT FROM v_month
       OR greatest(p.boost_credit_used_count, 1) < p_allowance
     )
  RETURNING p.boost_credit_used_count INTO v_used;

  RETURN QUERY SELECT (v_used IS NOT NULL), v_month, v_used;
END;
$function$;

REVOKE ALL ON FUNCTION public.claim_monthly_free_boost(uuid, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_monthly_free_boost(uuid, integer) TO service_role;

COMMENT ON FUNCTION public.claim_monthly_free_boost(uuid, integer) IS
  'Atomically spends one of the caller-resolved monthly free Job Boosts '
  '(allowance from MONTHLY_FREE_BOOSTS). claimed=false when the month is spent '
  'or the allowance is < 1. service_role only.';

-- ── The refund ───────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.refund_monthly_free_boost(
  p_user_id uuid,
  p_month text
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_hit uuid;
BEGIN
  IF p_user_id IS NULL OR p_month IS NULL THEN
    RETURN false;
  END IF;

  UPDATE public.profiles p
     SET boost_credit_used_count = greatest(p.boost_credit_used_count, 1) - 1,
         -- Back to zero spent: clear the month, so the GREATEST(count, 1)
         -- legacy rule cannot read the empty meter as one used.
         boost_credit_used_month =
           CASE WHEN greatest(p.boost_credit_used_count, 1) - 1 = 0
                THEN NULL
                ELSE p.boost_credit_used_month
           END
   WHERE p.user_id = p_user_id
     AND p.boost_credit_used_month = p_month
  RETURNING p.user_id INTO v_hit;

  RETURN v_hit IS NOT NULL;
END;
$function$;

REVOKE ALL ON FUNCTION public.refund_monthly_free_boost(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.refund_monthly_free_boost(uuid, text) TO service_role;

COMMENT ON FUNCTION public.refund_monthly_free_boost(uuid, text) IS
  'Returns one monthly free Job Boost credit when the boost it paid for failed '
  'to apply. Conditional on the claimed month. service_role only.';

-- ── Lock the new meter column ────────────────────────────────────────────────
-- Rebuilt from the LIVE body; the only change is 'boost_credit_used_count'.
-- sync_profiles_update_grants() re-derives the column grants from this list
-- every 10 minutes and silently undoes a hand-written REVOKE, so this list is
-- the only place a lock can live.
CREATE OR REPLACE FUNCTION public.profiles_locked_update_columns()
RETURNS text[]
LANGUAGE sql
IMMUTABLE
SET search_path TO 'public'
AS $function$
  SELECT ARRAY[
    'subscription_tier',
    'subscription_expires_at',
    'stripe_customer_id',
    'stripe_subscription_id',
    'subscription_billing_cycle',
    'subscription_cancel_at_period_end',
    -- ADDED 20260903030126. The Apple IAP receipt anchor — the Stripe
    -- linkage's twin on the other payment rail. `verify-apple-iap` keys
    -- subscription_tier off it, so a member who could write it could forge the
    -- evidence of their own subscription.
    'apple_original_transaction_id',
    -- ADDED 20260903070258, all three proven writable by a non-admin.
    'boost_credit_used_month',
    'created_at',
    'email',
    -- ADDED 20260903072540. The idempotency guard on account deletion's
    -- PII-stripping step. Writable by the person being deleted, which removes
    -- the "already stripped if deleteUser fails" property that the purge
    -- ordering exists to provide.
    'anonymized_at',
    -- ADDED 20260915043201. The count half of the free monthly boost meter;
    -- resetting it re-grants spent boosts, same as the month beside it.
    'boost_credit_used_count'
  ]::text[];
$function$;

REVOKE ALL ON FUNCTION public.profiles_locked_update_columns() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.profiles_locked_update_columns() TO service_role;

SELECT public.sync_profiles_update_grants();
