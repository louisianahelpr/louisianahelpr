-- Add photo_urls column to reviews table.
-- Reviewers can attach 1–3 photos to a review.
-- Idempotent (IF NOT EXISTS) so a replay-safe migration.
ALTER TABLE public.reviews
  ADD COLUMN IF NOT EXISTS photo_urls text[];
