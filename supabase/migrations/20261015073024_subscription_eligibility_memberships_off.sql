-- Roadmap F4/F4a (owner 2026-10-14/15): memberships are OFF for members. The
-- 'memberships' hidden switch (20261015033658, created at 'testers') already
-- stops create-pro-checkout (requireFeature) and hides every upgrade entry point
-- in the current client. Build 1.0.4 (7119), in App Review, cannot change: its
-- Apple purchase path (src/lib/iap.ts assertMayPurchase) asks
-- subscription_purchase_eligibility('apple') BEFORE the StoreKit sheet opens and
-- refuses on allowed = false, showing `reason`. That RPC did not read the switch,
-- so a member on 7119 could pay Apple for Pro and get no perks (lh-authz-rls
-- review of the switch, 2026-10-15, note 1, MEDIUM). Refusing HERE is the only
-- place 7119 can be stopped before Apple takes the money: verify-apple-iap must
-- never refuse a grant Apple already charged for, and is not touched.
--
-- Change: one first decision, after the existing input checks, before the
-- unconfirmed-email refusal (an unconfirmed member is told the true reason, not
-- to confirm an email for a purchase that would still be refused):
--   NOT feature_enabled_for_user('memberships', auth.uid())
--     -> allowed false, code 'memberships_off', and a reason 7119 shows as is.
-- feature_enabled_for_user is service_role only; this function is SECURITY
-- DEFINER (owner postgres), asks it for auth.uid() only, and returns nothing
-- that says whether the caller is a tester. Testers (admins + test_accounts,
-- incl. the App Review account) see exactly the previous answers. A missing
-- switch row reads as OFF (fails closed: nobody can buy).
--
-- Restated from its newest definition, 20261005065813 (md5(prosrc) live
-- 2026-10-15 6a74e3893026b6d2e3c8bcaa788456ec = that file), plus the one check.
-- Grants restated exactly as live (proacl 2026-10-15: postgres, authenticated,
-- service_role). Replay-safe: CREATE OR REPLACE.
-- Proof: src/test/pglite/iapEligibilityMembershipsOff.pglite.mjs.

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

  -- Roadmap F4/F4a: memberships are off for everyone the 'memberships' switch
  -- is off for. Build 7119 shows `reason` verbatim and opens no Apple sheet.
  IF NOT public.feature_enabled_for_user('memberships', v_user) THEN
    RETURN jsonb_build_object(
      'allowed', false,
      'code', 'memberships_off',
      'reason', 'Memberships are not available right now. Nothing was charged.');
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
