-- Instant book flag on jobs
-- Allows a poster to flag a job so any qualified helper can accept
-- and immediately confirm the booking without poster review.
ALTER TABLE public.jobs
  ADD COLUMN IF NOT EXISTS instant_book boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.jobs.instant_book IS
  'When true, a helper who applies is auto-confirmed without poster review — mirrors the direct-offer accept path.';
