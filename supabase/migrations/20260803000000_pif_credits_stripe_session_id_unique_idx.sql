-- Enforce uniqueness on pif_credits.stripe_session_id for non-null values.
-- Without this, a race-condition double-insert for the same Stripe session
-- would produce two rows, causing .maybeSingle() to return an error on every
-- subsequent idempotency check — permanently blocking the mint for that session.
-- Partial index (WHERE stripe_session_id IS NOT NULL) leaves unset rows unconstrained.
CREATE UNIQUE INDEX IF NOT EXISTS pif_credits_stripe_session_id_unique_idx
  ON pif_credits (stripe_session_id)
  WHERE stripe_session_id IS NOT NULL;
