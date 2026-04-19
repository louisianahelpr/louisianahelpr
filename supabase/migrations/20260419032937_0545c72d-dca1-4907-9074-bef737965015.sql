-- 1. Lock down sensitive storage buckets (was public, now private)
UPDATE storage.buckets SET public = false WHERE id IN ('user-documents', 'job-photos');

-- 2. Restrict reviews reads to authenticated users only (hide internal UUIDs from anonymous visitors)
DROP POLICY IF EXISTS "Anyone can view reviews" ON public.reviews;

CREATE POLICY "Authenticated users can view reviews"
ON public.reviews
FOR SELECT
TO authenticated
USING (true);

-- 3. Defense-in-depth: tighten profile UPDATE policy to forbid touching privileged columns
--    (the prevent_self_escalation trigger already enforces this; this is a second safety net)
DROP POLICY IF EXISTS "Users can update their own safe fields" ON public.profiles;

CREATE POLICY "Users can update their own safe fields"
ON public.profiles
FOR UPDATE
TO authenticated
USING (auth.uid() = user_id)
WITH CHECK (
  auth.uid() = user_id
  -- Block any attempt to change privileged fields. If a user tries to change one,
  -- the WITH CHECK will fail because the new value won't match the existing one.
  AND role = (SELECT role FROM public.profiles WHERE user_id = auth.uid())
  AND approval_status = (SELECT approval_status FROM public.profiles WHERE user_id = auth.uid())
  AND COALESCE(ban_status, '') = COALESCE((SELECT ban_status FROM public.profiles WHERE user_id = auth.uid()), '')
  AND COALESCE(subscription_tier, '') = COALESCE((SELECT subscription_tier FROM public.profiles WHERE user_id = auth.uid()), '')
  AND COALESCE(stripe_account_id, '') = COALESCE((SELECT stripe_account_id FROM public.profiles WHERE user_id = auth.uid()), '')
  AND COALESCE(idv_status, '') = COALESCE((SELECT idv_status FROM public.profiles WHERE user_id = auth.uid()), '')
);
