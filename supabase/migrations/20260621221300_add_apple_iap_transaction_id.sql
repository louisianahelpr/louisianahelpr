-- Apple In-App Purchase (StoreKit 2) support.
--
-- App Store Server Notifications (ASSN v2) identify a subscription by its
-- `originalTransactionId` — a stable id that stays constant across every
-- renewal of the same subscription. We persist it on the buyer's profile so
-- that renewal / expiry / refund webhooks (which carry NO user identity, only
-- the transaction) can be mapped back to the right user.
--
-- Nullable: only native iOS purchasers ever get one; web (Stripe) and
-- not-yet-subscribed users leave it NULL.
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS apple_original_transaction_id text;

-- The webhook path looks a user up *by* this id, so it needs to be indexed.
-- Partial index keeps it tiny — only rows that actually have an Apple sub.
-- UNIQUE because one Apple subscription maps to exactly one profile; a second
-- profile claiming the same original transaction id is a bug we want to reject.
CREATE UNIQUE INDEX IF NOT EXISTS profiles_apple_original_transaction_id_key
  ON public.profiles (apple_original_transaction_id)
  WHERE apple_original_transaction_id IS NOT NULL;
