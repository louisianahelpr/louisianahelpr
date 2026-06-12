-- Add Job Protection opt-in fields to jobs table.
-- Replay-safe: both columns use IF NOT EXISTS guards so a from-scratch
-- rebuild that re-runs this migration does not error.

ALTER TABLE jobs
  ADD COLUMN IF NOT EXISTS protection_opted_in boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS protection_fee numeric(10,2);
