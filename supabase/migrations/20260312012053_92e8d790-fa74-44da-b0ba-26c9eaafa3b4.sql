-- Allow service_role to update referral_credits (for the cash-out edge function)
CREATE POLICY "Service role can update credits"
ON public.referral_credits
FOR UPDATE
TO public
USING (auth.role() = 'service_role')
WITH CHECK (auth.role() = 'service_role');
