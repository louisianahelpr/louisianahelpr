-- Q2160 (lh-authz-rls review of resubscribe v3, 2026-10-15; pairs with Q2159,
-- 20261102063312). profiles.promotions_before_unsubscribe is the unsubscribe
-- link's undo record: promotions_resubscribe restores exactly what it holds.
-- Only the link's own opt-out (promotions_unsubscribe, service role) may write
-- it. profiles_locked_update_columns() keeps it out of the client UPDATE grant,
-- and Q2159's triggers clear it on any later UPDATE of either flag, but
-- authenticated still holds table INSERT on profiles, and the 'Users can
-- insert their own profile' WITH CHECK did not name the column. A client
-- INSERT carrying a forged record would pass the policy and, because those
-- triggers fire on UPDATE only, survive until a Resubscribe restored it.
--
-- Unreachable today (handle_new_user creates every profile inside the
-- auth.users transaction, so a client INSERT collides with
-- profiles_user_id_key, and a forged own-row record could restore only the
-- forger's own consent). Defence in depth: the column must arrive NULL, like
-- every other column the policy pins to its zero-trust default.
--
-- The policy is restated whole from its newest definition (20260923172405,
-- identical to prod's pg_policy read 2026-11-02) with ONE added predicate.
-- handle_new_user (SECURITY DEFINER, table owner) is not subject to RLS and
-- never sets the column, so sign-up is unchanged.
--
-- REPLAY-SAFETY: DROP POLICY IF EXISTS then CREATE POLICY; COMMENT restated.

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
    AND promotions_before_unsubscribe IS NULL
  );

COMMENT ON POLICY "Users can insert their own profile" ON public.profiles IS
  'A member may create only their OWN profile, and only in its zero-trust state: '
  'every column that any gate reads must arrive at its default, and the '
  'unsubscribe undo record (promotions_before_unsubscribe) must arrive NULL '
  '(Q2160). No BEFORE INSERT trigger clears the undo record, so this WITH '
  'CHECK is what keeps a forged one out.';
