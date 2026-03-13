
CREATE TABLE public.email_tracking (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  email_type text NOT NULL,
  event_type text NOT NULL DEFAULT 'open',
  created_at timestamptz NOT NULL DEFAULT now(),
  ip_address text,
  user_agent text
);

ALTER TABLE public.email_tracking ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role can insert tracking" ON public.email_tracking
  FOR INSERT TO public WITH CHECK (auth.role() = 'service_role');

CREATE POLICY "Admins can view tracking" ON public.email_tracking
  FOR SELECT TO authenticated USING (has_role(auth.uid(), 'admin'::app_role));

CREATE INDEX idx_email_tracking_user_id ON public.email_tracking(user_id);
CREATE INDEX idx_email_tracking_email_type ON public.email_tracking(email_type);
