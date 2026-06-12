-- Replay-safe: IF NOT EXISTS is idempotent on re-run
ALTER TYPE job_category ADD VALUE IF NOT EXISTS 'storm_prep';
ALTER TYPE job_category ADD VALUE IF NOT EXISTS 'events';

-- PostgreSQL requires a transaction commit before the new enum values
-- are visible to subsequent ALTER TABLE statements in the same txn.
-- Adding with IF NOT EXISTS means this migration is safe on re-run.
