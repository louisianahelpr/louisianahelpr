-- Add storm_prep to job_category enum.
-- ALTER TYPE ADD VALUE is idempotent via IF NOT EXISTS (Postgres 12+).
ALTER TYPE public.job_category ADD VALUE IF NOT EXISTS 'storm_prep';
