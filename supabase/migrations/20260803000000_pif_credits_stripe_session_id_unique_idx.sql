-- Pay-It-Forward credits: one credit per Stripe Checkout session.
--
-- This index already EXISTS in production — it was applied out-of-band on
-- 2026-08-03 and recorded in supabase_migrations.schema_migrations as version
-- 20260803000000 with no matching file in this repo. That drift meant prod was
-- guarded but every from-scratch rebuild, Preview branch, and fresh local stack
-- was NOT: without this unique index a replayed or double-delivered Stripe
-- webhook can mint the same PIF credit twice, which is real money in the credit
-- economy.
--
-- This file backfills the missing migration under the EXACT version string the
-- prod ledger already holds, so filename and ledger version match and
-- `supabase migration list --linked` reports zero drift. It is deliberately
-- idempotent (IF NOT EXISTS) so re-applying against prod, where the index is
-- already present, is a no-op rather than an error.
--
-- Partial (WHERE stripe_session_id IS NOT NULL) because credits minted through
-- non-Stripe paths (admin grant, referral, parent-credit split) legitimately
-- carry a NULL session id and must not collide with each other.
CREATE UNIQUE INDEX IF NOT EXISTS pif_credits_stripe_session_id_unique_idx
  ON public.pif_credits USING btree (stripe_session_id)
  WHERE (stripe_session_id IS NOT NULL);
