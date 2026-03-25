
-- Allow admins to read all referral_codes
CREATE POLICY "Admins can view all referral codes"
ON public.referral_codes FOR SELECT TO authenticated
USING (public.has_role(auth.uid(), 'admin'));

-- Allow admins to read all referral_credits
CREATE POLICY "Admins can view all referral credits"
ON public.referral_credits FOR SELECT TO authenticated
USING (public.has_role(auth.uid(), 'admin'));

-- Allow admins to read all referrals
CREATE POLICY "Admins can view all referrals"
ON public.referrals FOR SELECT TO authenticated
USING (public.has_role(auth.uid(), 'admin'));
