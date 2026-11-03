-- Q2276 (b) and (c): a payout failure's notice survives a failed first try,
-- and one Stripe payout account links at most one profile.
--
-- WHAT WAS BROKEN (handler read 2026-11-03, Builder 36; board 143a review
-- lh-money-escrow@3a2b2b5d53#5):
--   (b) stripe-webhook payoutFailed.ts recorded the payout_failures row, then
--       sent the notice; when the notice failed it DELETED the row so the
--       redelivery would write both again. When that delete failed too, the
--       redelivery found the row, answered "already recorded", and the member
--       was never told their payout bounced. Now the row carries notified_at:
--       the handler stamps it after the notice, and a redelivery that finds
--       the row with notified_at NULL sends the notice then. No delete.
--   (c) profiles.stripe_account_id had no unique index, so two profiles on one
--       account made payoutFailed's maybeSingle() lookup fail and every
--       delivery answer 500. Measured on prod 2026-11-03: 0 accounts on more
--       than one profile, 0 payout_failures rows, no index on the column.
--
-- Backfill: rows that exist when the column is first added were all told
-- (the old handler deleted any row whose notice failed), so they get
-- notified_at = created_at. Only on the run that adds the column, so a replay
-- never stamps a row still waiting for its notice.
-- Proof: src/test/pglite/payoutFailureNotifiedAt.pglite.mjs (3x ALL PASS;
-- NEW_MIGRATION=skip FAILs). Handler: src/test/edge/payoutFailedNotice.test.ts.

DO $$
BEGIN
  IF to_regclass('public.payout_failures') IS NOT NULL
     AND NOT EXISTS (
       SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'payout_failures' AND column_name = 'notified_at'
     ) THEN
    ALTER TABLE public.payout_failures ADD COLUMN notified_at timestamptz;
    UPDATE public.payout_failures SET notified_at = created_at WHERE notified_at IS NULL;
  END IF;
END
$$;

CREATE UNIQUE INDEX IF NOT EXISTS profiles_stripe_account_id_unique
  ON public.profiles (stripe_account_id)
  WHERE stripe_account_id IS NOT NULL;
