-- Q1856: a member's own profile INSERT could carry billing values.
--
-- WHAT WAS OPEN. The RLS policy "Users can insert their own profile"
-- (authenticated, FOR INSERT) is the only check on a member-written profile
-- row: authenticated holds table-level INSERT on profiles, and
-- prevent_self_escalation() is an UPDATE trigger, so it does not run on
-- insert. Its WITH CHECK pinned subscription_tier, stripe_account_id,
-- onboarding_fee_paid, stripe_identity_verified and
-- apple_original_transaction_id to their defaults, but left ten other billing
-- columns free (pg_policies on prod, 2026-10-21):
--
--   subscription_source, subscription_expires_at, subscription_billing_cycle,
--   stripe_customer_id, stripe_subscription_id        (the five Q1856 named)
--   subscription_cancel_at_period_end, stripe_charges_enabled,
--   stripe_payouts_enabled, stripe_identity_verified_at,
--   onboarding_fee_charged_at                         (same class, found by
--                                                      the guard below)
--
-- subscription_source = 'apple' takes a row out of the daily Stripe
-- reconciliation (the Q1794 finding, closed on UPDATE by 20261015005850), and
-- stripe_customer_id / stripe_subscription_id are the handles the webhook and
-- reconciliation match a payer by. Arriving with any of them set is a forged
-- billing state.
--
-- HOW REACHABLE: barely. profiles.user_id has a unique index, all 109
-- auth.users rows have a profile (prod, 2026-10-21), the row is made by
-- handle_new_user() (SECURITY DEFINER, owned by postgres, which has
-- BYPASSRLS, so this policy never applies to it), there is no DELETE policy,
-- and nothing in src/ or supabase/functions/ inserts or upserts profiles
-- (complete-signup only UPDATEs). A member could reach this only with no row
-- of their own. LOW, closed because it is the same list the policy already
-- keeps.
--
-- THE FIX: the same policy, the same conditions, plus the ten columns at their
-- own column DEFAULT (prod information_schema.columns, 2026-10-21: the
-- timestamps and ids default NULL, the four booleans default false and are NOT
-- NULL). An insert that names none of them still passes, so handle_new_user
-- and any honest path are unaffected. No BEFORE INSERT trigger on profiles
-- writes a billing column (prod pg_trigger + prosrc, 2026-10-21), so nothing
-- sets one between the insert and this check.
--
-- REPLAY-SAFE: DROP POLICY IF EXISTS + CREATE POLICY; every column named here
-- exists before this timestamp. Applied 3x in PGlite.
--
-- GUARD: src/test/billingColumnsArePinned.test.ts reads the newest surviving
-- INSERT policy on profiles and fails on any billing column it leaves free.

DROP POLICY IF EXISTS "Users can insert their own profile" ON public.profiles;

CREATE POLICY "Users can insert their own profile"
  ON public.profiles
  FOR INSERT
  TO authenticated
  WITH CHECK (
    (SELECT auth.uid()) = user_id
    AND (ban_status IS NULL OR ban_status = 'active')
    AND idv_status IS NULL
    AND subscription_tier IS NULL
    AND stripe_account_id IS NULL
    AND onboarding_fee_paid = false
    AND email_verified = false
    AND legacy_manual_review = false
    AND license_status = 'none'
    AND insurance_status = 'none'
    AND license_expires_at IS NULL
    AND insurance_expires_at IS NULL
    AND is_licensed = false
    AND is_insured = false
    AND background_check_status = 'none'
    AND stripe_identity_verified = false
    AND apple_original_transaction_id IS NULL
    AND is_seed = false
    -- ADDED 20261021064512 (Q1856): the rest of the billing columns.
    AND subscription_source IS NULL
    AND subscription_expires_at IS NULL
    AND subscription_billing_cycle IS NULL
    AND stripe_customer_id IS NULL
    AND stripe_subscription_id IS NULL
    AND subscription_cancel_at_period_end = false
    AND stripe_charges_enabled = false
    AND stripe_payouts_enabled = false
    AND stripe_identity_verified_at IS NULL
    AND onboarding_fee_charged_at IS NULL
  );

COMMENT ON POLICY "Users can insert their own profile" ON public.profiles IS
  'A member may create only their OWN profile, and only in its zero-trust state: '
  'every trust and billing column must arrive at its default. prevent_self_escalation '
  'runs on UPDATE only, so this WITH CHECK is what stands between a member-written '
  'insert and those columns. Guard: src/test/billingColumnsArePinned.test.ts.';
