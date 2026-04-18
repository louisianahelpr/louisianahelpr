-- Add multi-category rating columns to reviews
ALTER TABLE public.reviews
  ADD COLUMN IF NOT EXISTS punctuality smallint,
  ADD COLUMN IF NOT EXISTS quality smallint,
  ADD COLUMN IF NOT EXISTS communication smallint;

-- Validate ranges (1–5) when provided. Allow NULL for legacy rows.
ALTER TABLE public.reviews
  ADD CONSTRAINT reviews_punctuality_range CHECK (punctuality IS NULL OR (punctuality BETWEEN 1 AND 5)),
  ADD CONSTRAINT reviews_quality_range CHECK (quality IS NULL OR (quality BETWEEN 1 AND 5)),
  ADD CONSTRAINT reviews_communication_range CHECK (communication IS NULL OR (communication BETWEEN 1 AND 5));