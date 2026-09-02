-- Replay-safe fix: 20260311011131 created "Anyone can view user documents"
-- on storage.objects with a basic USING clause.
-- Migration 20260412075131 re-creates the same policy (bucket made public)
-- without a DROP guard, so on a clean replay the CREATE POLICY fails because
-- the policy already exists from the earlier migration.
-- Drop it here so the next migration can create it cleanly.
DROP POLICY IF EXISTS "Anyone can view user documents" ON storage.objects;
