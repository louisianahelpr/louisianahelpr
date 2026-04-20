
CREATE TABLE public.instant_payouts (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  helper_id UUID NOT NULL,
  gross_amount NUMERIC(10,2) NOT NULL,
  fee_amount NUMERIC(10,2) NOT NULL,
  net_amount NUMERIC(10,2) NOT NULL,
  stripe_payout_id TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  error_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_instant_payouts_helper ON public.instant_payouts(helper_id, created_at DESC);
CREATE INDEX idx_instant_payouts_status ON public.instant_payouts(status);

ALTER TABLE public.instant_payouts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Helpers view own instant payouts"
  ON public.instant_payouts FOR SELECT
  TO authenticated
  USING (auth.uid() = helper_id);

CREATE POLICY "Admins view all instant payouts"
  ON public.instant_payouts FOR SELECT
  TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role));

CREATE TRIGGER set_instant_payouts_updated_at
  BEFORE UPDATE ON public.instant_payouts
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
