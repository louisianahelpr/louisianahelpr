-- Q1200 (docs/OPEN.md; lh-authz-rls review of Q837, 2026-10-03): refuse an
-- Apple in-app purchase from an unconfirmed-email session BEFORE the purchase
-- sheet opens. subscription_purchase_eligibility (which src/lib/iap.ts calls
-- before StoreKit, and create-pro-checkout before Stripe) now answers
-- allowed = false, code email_unconfirmed, when public.session_email_unconfirmed()
-- (the Q807 predicate) is true. Live 2026-10-03: 0 unconfirmed accounts.
--
-- Restated from its newest definition, 20260905204037 (md5(prosrc) live
-- 2026-10-05 eeaf8d132648bfe05183a444c4a27660 = that file), plus the one check.
-- Grants restated. Replay-safe: CREATE OR REPLACE.
-- Guard: src/test/iapEligibilityRequiresConfirmedEmail.test.ts +
-- src/test/pglite/iapEligibilityRequiresConfirmedEmail.pglite.mjs.

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

  -- Q1200: an unconfirmed-email session may not buy. verify-apple-iap cannot
  -- refuse a purchase Apple has already charged (Q837 exempts it on purpose),
  -- so the gate is HERE, before the sheet opens: iap.ts and
  -- create-pro-checkout both refuse on allowed = false and show the reason.
  IF public.session_email_unconfirmed() THEN
    RETURN jsonb_build_object(
      'allowed', false,
      'code', 'email_unconfirmed',
      'reason', 'Confirm your email address before subscribing. Open the link we sent to your inbox, then try again.');
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
GRANT EXECUTE ON FUNCTION public.subscription_purchase_eligibility(text) TO authenticated, service_role;
