-- Trade job categories (owner decision T1, 2026-10-14, docs/specs/louisiana-hub-roadmap.md):
-- "add all common trades ... 'Other: anything else' stays".
--
-- ADD VALUE IF NOT EXISTS is replay-safe (a second run is a no-op). Since PG 12
-- it may run inside the migration's transaction block; the one restriction is
-- that a value added in a transaction cannot be USED in that same transaction,
-- so this migration only adds values and nothing below references them.
-- Old clients (iOS 1.0.4 build 7119) render an unknown category through their
-- fallbacks (getCategoryIcon -> Briefcase, categoryColors.other, formatCategory
-- for the label), so a job in a new category does not break them.
ALTER TYPE public.job_category ADD VALUE IF NOT EXISTS 'electrical';
ALTER TYPE public.job_category ADD VALUE IF NOT EXISTS 'plumbing';
ALTER TYPE public.job_category ADD VALUE IF NOT EXISTS 'hvac';
ALTER TYPE public.job_category ADD VALUE IF NOT EXISTS 'roofing';
ALTER TYPE public.job_category ADD VALUE IF NOT EXISTS 'welding';
ALTER TYPE public.job_category ADD VALUE IF NOT EXISTS 'carpentry';
ALTER TYPE public.job_category ADD VALUE IF NOT EXISTS 'auto_repair';
ALTER TYPE public.job_category ADD VALUE IF NOT EXISTS 'appliance_repair';
ALTER TYPE public.job_category ADD VALUE IF NOT EXISTS 'flooring';
ALTER TYPE public.job_category ADD VALUE IF NOT EXISTS 'concrete_masonry';
ALTER TYPE public.job_category ADD VALUE IF NOT EXISTS 'fencing';
ALTER TYPE public.job_category ADD VALUE IF NOT EXISTS 'pressure_washing';
