-- A refund notice whose EMAIL failed is retried, a bounded number of times.
--
-- _shared/refundNotice.ts writes the in-app notice, then sends the email
-- through send-notification-email and records the outcome on the claim
-- (refund_notices.emailed, email_error). Nothing ever retried a failed email:
-- on 2026-10-12 the two one-time notices for the 10-11 refunds (jobs 5d43debf
-- and 1e16c281) were written in-app, but both emails failed with
-- "send-notification-email answered 401", and the hourly untold-refund sweep
-- only looks for refunds with NO finished notice, so those emails would never
-- go.
--
-- email_attempts counts the sends tried for a notice. The first send counts as
-- 1 (the column default, so rows that already exist read as one attempt made),
-- and void-cancelled-payments' retry claims each further attempt by a
-- compare-and-set on this column, so two runs never send the same retry twice.
-- The retry stops at 3 attempts, and it never retries an email the person's
-- own switches held back ("skipped: ...").
--
-- Replay-safe: ADD COLUMN IF NOT EXISTS, guarded on the table existing.
-- Server-only, like the table (RLS on, no client grant; nothing to re-grant
-- for a new column).

DO $$
BEGIN
  IF to_regclass('public.refund_notices') IS NOT NULL THEN
    ALTER TABLE public.refund_notices
      ADD COLUMN IF NOT EXISTS email_attempts integer NOT NULL DEFAULT 1;
    IF NOT EXISTS (
      SELECT 1 FROM pg_constraint
       WHERE conname = 'refund_notices_email_attempts_nonneg'
         AND conrelid = 'public.refund_notices'::regclass
    ) THEN
      ALTER TABLE public.refund_notices
        ADD CONSTRAINT refund_notices_email_attempts_nonneg CHECK (email_attempts >= 0);
    END IF;
    COMMENT ON COLUMN public.refund_notices.email_attempts IS
      'Email sends tried for this notice (the first send is 1). void-cancelled-payments retries a failed one up to 3, under 7 days old.';
  END IF;
END
$$;

DO $$
BEGIN
  IF to_regclass('public.refund_notices') IS NOT NULL THEN
    REVOKE ALL ON TABLE public.refund_notices FROM PUBLIC, anon, authenticated;
    GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.refund_notices TO service_role;
  END IF;
END
$$;
