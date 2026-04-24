
-- Replace the permissive INSERT policy with one that enforces safe defaults
-- on sensitive fields. Privileged values must come from the backend (service role,
-- admin updates, or SECURITY DEFINER triggers like handle_new_user).
DROP POLICY IF EXISTS "Users can insert their own profile" ON public.profiles;

CREATE POLICY "Users can insert their own profile"
ON public.profiles
FOR INSERT
TO authenticated
WITH CHECK (
  auth.uid() = user_id
  AND role IN ('customer', 'helper')
  AND approval_status = 'pending'
  AND (ban_status IS NULL OR ban_status = 'active')
  AND idv_status IS NULL
  AND subscription_tier IS NULL
  AND stripe_account_id IS NULL
  AND onboarding_fee_paid = false
  AND email_verified = false
  AND legacy_manual_review = false
);
