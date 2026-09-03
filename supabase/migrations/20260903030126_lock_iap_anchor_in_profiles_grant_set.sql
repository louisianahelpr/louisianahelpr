-- CORRECTS 20260903022948 A SECOND TIME. The UPDATE revoke worked, and then
-- was undone by a cron.
--
-- WHAT HAPPENED. `profiles` does not hand out UPDATE grants by hand. Migration
-- 20260901011254 derives them from the catalog as the COMPLEMENT of an explicit
-- locked set — `profiles_locked_update_columns()` — applied by
-- `sync_profiles_update_grants()`, which a cron re-runs so that a column added
-- by a later migration self-heals into a grant instead of becoming a 42501 in
-- production. That is a good design and it did exactly what it says.
--
-- `apple_original_transaction_id` was never in the locked set. So my hand-written
-- `REVOKE UPDATE (apple_original_transaction_id)` took effect — I measured it
-- gone right after deploy — and the next sync handed it straight back. Measured
-- again an hour later:
--
--     authenticated  INSERT, REFERENCES, SELECT, UPDATE   <- UPDATE returned
--
-- The migration that revoked it says, verbatim, three lines from the top of the
-- file it should have been reading: "To lock another profiles column, add it
-- here and re-run the sync — do not hand-write GRANT statements elsewhere."
-- I hand-wrote one elsewhere. Twice on this column now: the first attempt was a
-- column-level REVOKE that could not bite against a table-level grant, the
-- second bit and was reverted by a scheduled job. Both read as done.
--
-- THE COLUMN BELONGS IN THE LOCKED SET ON ITS MERITS, not just to make the
-- revoke stick. The existing six are the billing group — subscription tier and
-- expiry plus the four Stripe linkage columns — locked because they are what
-- the reconciler trusts to decide whether a tier was paid for. The Apple IAP
-- original transaction id is precisely the same thing for the other payment
-- rail: the unmerged `feat/apple-iap` branch's `verify-apple-iap` keys
-- `subscription_tier` off it. It is the Stripe linkage's Apple twin and should
-- have been added the day the column was created.
--
-- WHAT WAS NEVER WRONG: the column has been defended throughout by
-- `prevent_self_escalation` (pinned since 20260903022948) and by the RLS INSERT
-- policy (20260903023314). A non-admin UPDATE succeeds with no error and
-- changes nothing — the zero-row-write shape, which is why the regression was
-- invisible. The verifier proved that independently with a rolled-back probe
-- and flagged the grant as still present; they were right, and this closes the
-- gap between what the ledger said and what the catalog held.
--
-- Replay-safe: CREATE OR REPLACE plus an idempotent sync.

-- The `ADD COLUMN IF NOT EXISTS` that makes this replayable lives in
-- 20260903022948, the earliest migration to touch this column as DDL. See the
-- note there for the schema drift it repairs.

CREATE OR REPLACE FUNCTION public.profiles_locked_update_columns()
RETURNS text[]
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT ARRAY[
    'subscription_tier',
    'subscription_expires_at',
    'stripe_customer_id',
    'stripe_subscription_id',
    'subscription_billing_cycle',
    'subscription_cancel_at_period_end',
    -- ADDED 20260903030126. The Apple IAP receipt anchor — the Stripe
    -- linkage's twin on the other payment rail. `verify-apple-iap` keys
    -- subscription_tier off it, so a member who could write it could forge the
    -- evidence of their own subscription.
    'apple_original_transaction_id'
  ]::text[];
$$;

COMMENT ON FUNCTION public.profiles_locked_update_columns() IS
  'Single source of truth for which public.profiles columns authenticated may NOT '
  'update. Consumed by sync_profiles_update_grants(), which a cron re-runs — so a '
  'hand-written REVOKE elsewhere is undone on the next tick. Add the column here.';

-- Apply it now rather than waiting for the cron tick.
SELECT public.sync_profiles_update_grants();
