-- Apple IAP groundwork: where a tier came from, and one place that answers
-- "may this person start a purchase here?"
--
-- Three things, all prerequisites for the verify-apple-iap function.
--
-- 1. subscription_source. Today `profiles.subscription_tier` records WHAT
--    someone has and nothing records WHO CHARGED THEM. That is survivable while
--    Stripe is the only seller and fatal the moment Apple is a second one,
--    because subscription-reconciliation (668 lines) re-derives the tier from
--    STRIPE for every row where `subscription_tier IS NOT NULL OR
--    stripe_subscription_id IS NOT NULL`. An Apple subscriber matches that
--    filter — tier set, no Stripe subscription — so the nightly sweep would
--    conclude "no Stripe subscription, therefore no subscription" and strip the
--    tier of every iOS member, every night. The column is what lets that sweep
--    skip rows it is not the authority for. Teaching the sweep is a separate
--    change; this is the column it will read.
--
-- 2. A UNIQUE index on apple_original_transaction_id. Apple's
--    originalTransactionId is the stable identity of a subscription across
--    every renewal, and it is how the notifications webhook — which carries no
--    user identity at all — finds the buyer. Two things need it to be unique:
--    that lookup must not be ambiguous, and one Apple subscription must not be
--    redeemable against two accounts. Partial (WHERE NOT NULL) because ~all
--    rows are NULL and a full unique index would collide on them.
--
-- 3. subscription_purchase_eligibility(). The owner's rule for the both-
--    subscriptions case is PREVENT IT AT PURCHASE TIME (decided 2026-09-05).
--    This is the single place that answers it, so the iOS client, the web
--    storefront and create-pro-checkout cannot disagree about who is allowed to
--    buy.
--
--    WHAT THIS DELIBERATELY DOES NOT DO. It does not refuse a purchase that has
--    ALREADY been paid for. verify-apple-iap runs AFTER Apple has taken the
--    money, so a check that returned "not eligible" there would leave a member
--    charged and unentitled — turning a rare double-subscription into a
--    guaranteed theft. Prevention belongs strictly BEFORE the purchase sheet;
--    afterwards the only safe move is to grant and flag. That asymmetry is the
--    whole reason this is a query and not a trigger.

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS subscription_source text;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.profiles'::regclass
      AND conname = 'profiles_subscription_source_check'
  ) THEN
    ALTER TABLE public.profiles
      ADD CONSTRAINT profiles_subscription_source_check
      CHECK (subscription_source IS NULL OR subscription_source IN ('stripe', 'apple'));
  END IF;
END $$;

COMMENT ON COLUMN public.profiles.subscription_source IS
  'Which billing system is the AUTHORITY for subscription_tier on this row: '
  '''stripe'' or ''apple''. NULL means legacy/manual — see the backfill note in '
  'migration 20260905204037. subscription-reconciliation must not re-derive a '
  'row it is not the authority for.';

-- Backfill. Only rows with an actual Stripe subscription are claimed for
-- Stripe. The other three paid-tier rows in prod have NO stripe_subscription_id
-- (measured 2026-09-05: 4 paid tiers, 1 with a subscription id) — they were
-- granted manually or in testing, and calling them 'stripe' would tell the
-- reconciliation sweep to go looking in Stripe for something that was never
-- there. They stay NULL, which reads correctly as "nobody's system of record".
UPDATE public.profiles
   SET subscription_source = 'stripe'
 WHERE subscription_source IS NULL
   AND stripe_subscription_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS profiles_apple_original_transaction_id_key
  ON public.profiles (apple_original_transaction_id)
  WHERE apple_original_transaction_id IS NOT NULL;

-- ── The pre-purchase gate ──────────────────────────────────────────────────
-- Returns {allowed, reason, code, current_tier, current_source}. Callable by
-- the signed-in user for THEMSELVES only; there is no user parameter, so it
-- cannot be used to probe anyone else's billing state.
CREATE OR REPLACE FUNCTION public.subscription_purchase_eligibility(p_platform text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_user uuid := auth.uid();
  v_tier text;
  v_source text;
  v_expires timestamptz;
  v_stripe_sub text;
  v_apple_anchor text;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;

  IF p_platform IS NULL OR p_platform NOT IN ('apple', 'stripe') THEN
    RAISE EXCEPTION 'invalid_platform';
  END IF;

  SELECT subscription_tier, subscription_source, subscription_expires_at,
         stripe_subscription_id, apple_original_transaction_id
    INTO v_tier, v_source, v_expires, v_stripe_sub, v_apple_anchor
    FROM public.profiles
   WHERE user_id = v_user;

  -- An EXPIRED subscription is not a conflict — it is exactly who we want to
  -- sell to. Only a live one blocks, and `subscription_expires_at` being NULL
  -- on a set tier is treated as live, because a null expiry is how a
  -- never-reconciled or lifetime grant looks and refusing is the safe side of
  -- that ambiguity for a DOUBLE charge.
  IF v_tier IS NULL OR v_tier = 'free'
     OR (v_expires IS NOT NULL AND v_expires <= now()) THEN
    RETURN jsonb_build_object('allowed', true, 'code', 'no_active_subscription');
  END IF;

  -- Same platform: not a double subscription, it is an upgrade/downgrade, and
  -- both stores handle that natively (Stripe proration, Apple's subscription
  -- group). Allow it.
  IF (p_platform = 'apple'  AND v_apple_anchor IS NOT NULL)
     OR (p_platform = 'stripe' AND v_stripe_sub IS NOT NULL) THEN
    RETURN jsonb_build_object(
      'allowed', true, 'code', 'same_platform_change',
      'current_tier', v_tier, 'current_source', v_source);
  END IF;

  -- Cross-platform with something live. This is the case the owner chose to
  -- prevent outright.
  RETURN jsonb_build_object(
    'allowed', false,
    'code', 'active_subscription_elsewhere',
    'reason', CASE
      WHEN p_platform = 'apple'
        THEN 'You already have a membership billed through our website. Manage or cancel it there before subscribing through the App Store, so you are never charged twice.'
      ELSE 'You already have a membership billed through the App Store. Manage it in your Apple subscription settings before subscribing here, so you are never charged twice.'
    END,
    'current_tier', v_tier,
    'current_source', v_source);
END;
$function$;

REVOKE ALL ON FUNCTION public.subscription_purchase_eligibility(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.subscription_purchase_eligibility(text)
  TO authenticated, service_role;
