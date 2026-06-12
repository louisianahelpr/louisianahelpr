-- Add pricing mode columns to jobs table.
-- Replay-safe: all ALTER TABLE statements use IF NOT EXISTS / IF to_regprocedure checks.

ALTER TABLE jobs
  ADD COLUMN IF NOT EXISTS pricing_mode text NOT NULL DEFAULT 'set_price'
    CHECK (pricing_mode IN ('set_price', 'accept_bids', 'smart_price'));

-- For accept_bids jobs: optional ceiling, bid deadline, and sealed toggle.
ALTER TABLE jobs
  ADD COLUMN IF NOT EXISTS bid_deadline timestamptz,
  ADD COLUMN IF NOT EXISTS bid_ceiling numeric(10,2),
  ADD COLUMN IF NOT EXISTS bids_sealed boolean NOT NULL DEFAULT false;
