
-- Referral codes table: each user gets a unique code
CREATE TABLE public.referral_codes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL UNIQUE,
  code TEXT NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Referral credits table: tracks credits earned
CREATE TABLE public.referral_credits (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  amount NUMERIC NOT NULL DEFAULT 5,
  reason TEXT NOT NULL, -- 'referrer_bonus' or 'signup_bonus'
  referral_code_id UUID REFERENCES public.referral_codes(id),
  referred_user_id UUID,
  redeemed BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Referrals tracking: who referred whom
CREATE TABLE public.referrals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  referrer_id UUID NOT NULL,
  referred_id UUID NOT NULL UNIQUE, -- each user can only be referred once
  referral_code_id UUID REFERENCES public.referral_codes(id) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.referral_codes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.referral_credits ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.referrals ENABLE ROW LEVEL SECURITY;

-- RLS: Users can read their own referral code
CREATE POLICY "Users can read own referral code" ON public.referral_codes
  FOR SELECT TO authenticated USING (user_id = auth.uid());

-- RLS: Users can insert their own referral code
CREATE POLICY "Users can create own referral code" ON public.referral_codes
  FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());

-- RLS: Anyone authenticated can look up a referral code (for signup validation)
CREATE POLICY "Anyone can lookup referral codes" ON public.referral_codes
  FOR SELECT TO authenticated USING (true);

-- RLS: Users can read their own credits
CREATE POLICY "Users can read own credits" ON public.referral_credits
  FOR SELECT TO authenticated USING (user_id = auth.uid());

-- RLS: Users can read own referrals
CREATE POLICY "Users can read own referrals" ON public.referrals
  FOR SELECT TO authenticated USING (referrer_id = auth.uid() OR referred_id = auth.uid());

-- Function to process a referral on signup
CREATE OR REPLACE FUNCTION public.process_referral(p_referral_code TEXT, p_new_user_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_code_record RECORD;
BEGIN
  -- Look up the referral code
  SELECT id, user_id INTO v_code_record
  FROM public.referral_codes
  WHERE code = UPPER(p_referral_code);

  IF NOT FOUND THEN
    RETURN FALSE;
  END IF;

  -- Don't allow self-referral
  IF v_code_record.user_id = p_new_user_id THEN
    RETURN FALSE;
  END IF;

  -- Check if already referred
  IF EXISTS (SELECT 1 FROM public.referrals WHERE referred_id = p_new_user_id) THEN
    RETURN FALSE;
  END IF;

  -- Create referral record
  INSERT INTO public.referrals (referrer_id, referred_id, referral_code_id)
  VALUES (v_code_record.user_id, p_new_user_id, v_code_record.id);

  -- Credit the referrer ($5)
  INSERT INTO public.referral_credits (user_id, amount, reason, referral_code_id, referred_user_id)
  VALUES (v_code_record.user_id, 5, 'referrer_bonus', v_code_record.id, p_new_user_id);

  -- Credit the new user ($5)
  INSERT INTO public.referral_credits (user_id, amount, reason, referral_code_id, referred_user_id)
  VALUES (p_new_user_id, 5, 'signup_bonus', v_code_record.id, v_code_record.user_id);

  -- Notify the referrer
  INSERT INTO public.notifications (user_id, title, message, type, link)
  VALUES (v_code_record.user_id, 'Referral bonus!', 'Someone signed up with your referral code. You earned a $5 credit!', 'payment', '/profile');

  RETURN TRUE;
END;
$$;
