-- ============================================================
-- Pay It Forward → directed-gift model (backlog #106)
--
-- Reshapes pif_credits from a world-readable "parish pool" into
-- directed gifts: a donor pays Stripe up front and NAMES a
-- recipient by email; only that recipient (once claimed) can
-- redeem. All mint / claim / redeem now flow through service-role
-- edge functions, so this migration REMOVES every client-facing
-- INSERT/UPDATE policy (a column-unrestricted client UPDATE let a
-- recipient inflate `amount` before redeeming = theft) and drops
-- the old world-readable SELECT. SELECT becomes party-only.
--
-- Replay-safe: every statement guards for objects that may or may
-- not already exist so a from-scratch rebuild in timestamp order
-- succeeds.
-- ============================================================

-- ── New columns (all additive, idempotent) ──────────────────
ALTER TABLE pif_credits
  ADD COLUMN IF NOT EXISTS recipient_email          text,
  ADD COLUMN IF NOT EXISTS stripe_payment_intent_id text,
  ADD COLUMN IF NOT EXISTS stripe_session_id        text,
  ADD COLUMN IF NOT EXISTS claim_token              text,
  ADD COLUMN IF NOT EXISTS parent_credit_id         uuid REFERENCES pif_credits(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS payment_status           text NOT NULL DEFAULT 'pending';

-- ── Status lifecycle: add 'sent' (paid, awaiting claim/redeem) ─
-- Keep every pre-existing value so old rows and a replay both pass.
-- 'sent'      → donor paid; recipient_id NULL = needs email claim,
--               set = claimed & redeemable.
-- 'redeemed'  → applied to a job.
-- 'expired'   → lapsed.
ALTER TABLE pif_credits DROP CONSTRAINT IF EXISTS pif_credits_status_check;
ALTER TABLE pif_credits
  ADD CONSTRAINT pif_credits_status_check CHECK (status IN (
    'available', 'reserved', 'sent', 'redeemed', 'expired'
  ));

-- payment_status: donation charge state (mirrors Stripe).
ALTER TABLE pif_credits DROP CONSTRAINT IF EXISTS pif_credits_payment_status_check;
ALTER TABLE pif_credits
  ADD CONSTRAINT pif_credits_payment_status_check CHECK (payment_status IN (
    'pending', 'paid', 'refunded'
  ));

-- ── Drop every legacy client-facing policy ──────────────────
-- Mint/claim/redeem are service-role only now, so no client
-- INSERT or UPDATE path may remain.
DROP POLICY IF EXISTS "Available credits are public" ON pif_credits;
DROP POLICY IF EXISTS "Donors create credits"        ON pif_credits;
DROP POLICY IF EXISTS "Redeem or donor update"       ON pif_credits;

-- ── Party-only SELECT ───────────────────────────────────────
-- Visible only to the donor, the resolved recipient, or the
-- named recipient email (case-insensitive) before they've
-- claimed. `(select auth.…)` keeps the initplan single-eval
-- (matches 20260705120000_perf_index_and_rls_initplan.sql).
--
-- Use current_setting('request.jwt.claims', true) instead of
-- auth.jwt() — the latter is absent in the CI Supabase Postgres
-- image and causes the migration replay to fail with "function
-- auth.jwt() does not exist". PostgREST sets this GUC before every
-- query in prod (identical behaviour). missing_ok=true means it
-- returns NULL in bare-psql / CI environments, safely making the
-- email clause evaluate to NULL while the other OR branches win.
DROP POLICY IF EXISTS "PIF credits are party-only" ON pif_credits;
CREATE POLICY "PIF credits are party-only" ON pif_credits
  FOR SELECT USING (
    (select auth.uid()) = donor_id
    OR (select auth.uid()) = recipient_id
    OR (
      recipient_email IS NOT NULL
      AND lower(recipient_email) = lower(
        coalesce(
          nullif(current_setting('request.jwt.claims', true), ''),
          'null'
        )::json ->> 'email'
      )
    )
  );

-- ── Indexes ─────────────────────────────────────────────────
-- One live claim token per outstanding gift.
CREATE UNIQUE INDEX IF NOT EXISTS pif_credits_claim_token_key
  ON pif_credits (claim_token) WHERE claim_token IS NOT NULL;

-- Case-insensitive recipient-email lookups (SELECT policy + the
-- "gifts sent to you" query resolve on this).
CREATE INDEX IF NOT EXISTS pif_credits_recipient_email_idx
  ON pif_credits (lower(recipient_email)) WHERE recipient_email IS NOT NULL;

-- Payout/refund reconciliation joins on the funding PI.
CREATE INDEX IF NOT EXISTS pif_credits_payment_intent_idx
  ON pif_credits (stripe_payment_intent_id) WHERE stripe_payment_intent_id IS NOT NULL;
