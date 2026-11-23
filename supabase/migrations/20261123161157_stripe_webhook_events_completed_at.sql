-- MON-1123-02 (backend-ops audit 2026-11-23): a killed stripe-webhook run must
-- not lose its paid event.
--
-- stripe-webhook inserts its dedupe row BEFORE the handler runs and deletes it
-- only from its catch block. When the Edge worker is killed mid-handler (CPU,
-- memory or wall-clock limit, a redeploy), the catch never runs: the row stays,
-- Stripe's retry hits the unique key and is answered 200 "duplicate", and the
-- event (a gift card purchase, a Declutter checkout, a tip, a job's escrow) is
-- never applied. processed_at defaults to now() at INSERT, so nothing could
-- tell a finished run from a dead one.
--
-- completed_at says the handler FINISHED. stripe-webhook now inserts it as NULL
-- and sets it after the handler returns; a redelivery that finds a NULL row
-- older than the stale window takes the row over and re-runs the (idempotent)
-- handler, and stuck-payment-check pages on a NULL row older than an hour.
--
-- DEFAULT now(), not NULL: every other writer of this table (stripe-idv-webhook)
-- and every row already in it means "done at insert", exactly as before. Only
-- stripe-webhook opts into the unfinished state by inserting NULL explicitly.
-- ADD COLUMN with a constant-at-statement default fills existing rows with the
-- migration's time: they are all finished events.
--
-- No grant or policy changes: the table stays service-role only (its RLS
-- policy is USING (false)).

ALTER TABLE public.stripe_webhook_events
  ADD COLUMN IF NOT EXISTS completed_at timestamptz DEFAULT now();

-- The detector reads only the unfinished rows; normally there are none.
CREATE INDEX IF NOT EXISTS idx_stripe_webhook_events_unfinished
  ON public.stripe_webhook_events (processed_at)
  WHERE completed_at IS NULL;

COMMENT ON COLUMN public.stripe_webhook_events.completed_at IS
  'When stripe-webhook''s handler finished this event. NULL = a run started and has not finished (or died); a redelivery past the stale window re-runs it, and stuck-payment-check pages after an hour. MON-1123-02.';
