
-- Platform settings table (singleton for admin-configurable values)
CREATE TABLE public.platform_settings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  platform_fee_percent NUMERIC(5,2) NOT NULL DEFAULT 15.00 CHECK (platform_fee_percent >= 0 AND platform_fee_percent <= 100),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by UUID REFERENCES auth.users(id)
);

ALTER TABLE public.platform_settings ENABLE ROW LEVEL SECURITY;

-- Everyone can read settings
CREATE POLICY "Anyone can read platform settings"
  ON public.platform_settings FOR SELECT USING (true);

-- Only admins can update
CREATE POLICY "Admins can update platform settings"
  ON public.platform_settings FOR UPDATE
  USING (public.has_role(auth.uid(), 'admin'));

-- Insert default row
INSERT INTO public.platform_settings (platform_fee_percent) VALUES (15.00);

-- Add payment tracking columns to jobs
ALTER TABLE public.jobs ADD COLUMN stripe_session_id TEXT;
ALTER TABLE public.jobs ADD COLUMN stripe_payment_intent_id TEXT;
ALTER TABLE public.jobs ADD COLUMN payment_status TEXT DEFAULT 'unpaid' CHECK (payment_status IN ('unpaid', 'escrow', 'released', 'refunded'));
ALTER TABLE public.jobs ADD COLUMN platform_fee_percent NUMERIC(5,2);
ALTER TABLE public.jobs ADD COLUMN platform_fee_amount NUMERIC(10,2);

-- Admin policies: admins can view and update all jobs
CREATE POLICY "Admins can view all jobs"
  ON public.jobs FOR SELECT
  USING (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Admins can update all jobs"
  ON public.jobs FOR UPDATE
  USING (public.has_role(auth.uid(), 'admin'));

-- Admin policies: admins can view all profiles
CREATE POLICY "Admins can view all profiles"
  ON public.profiles FOR SELECT
  USING (public.has_role(auth.uid(), 'admin'));

-- Admin policies: admins can view all applications
CREATE POLICY "Admins can view all applications"
  ON public.applications FOR SELECT
  USING (public.has_role(auth.uid(), 'admin'));

-- Admin policies: admins can view all reviews
CREATE POLICY "Admins can view all reviews"
  ON public.reviews FOR SELECT
  USING (public.has_role(auth.uid(), 'admin'));

-- Admin can insert platform settings
CREATE POLICY "Admins can insert platform settings"
  ON public.platform_settings FOR INSERT
  WITH CHECK (public.has_role(auth.uid(), 'admin'));
