
-- Stripe webhook idempotency: track processed event IDs to prevent double-processing
-- on Stripe retries (network blips, timeouts, etc.).
CREATE TABLE IF NOT EXISTS public.stripe_webhook_events (
  event_id TEXT PRIMARY KEY,
  event_type TEXT NOT NULL,
  processed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.stripe_webhook_events ENABLE ROW LEVEL SECURITY;

-- No client access — only service role (edge functions) can read/write.
CREATE POLICY "Service role only — webhook events"
  ON public.stripe_webhook_events
  FOR ALL
  USING (false)
  WITH CHECK (false);

CREATE INDEX IF NOT EXISTS idx_stripe_webhook_events_processed_at
  ON public.stripe_webhook_events (processed_at);

-- Cleanup function to prune events older than 30 days
CREATE OR REPLACE FUNCTION public.cleanup_stripe_webhook_events()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  DELETE FROM public.stripe_webhook_events
  WHERE processed_at < now() - INTERVAL '30 days';
END;
$$;
