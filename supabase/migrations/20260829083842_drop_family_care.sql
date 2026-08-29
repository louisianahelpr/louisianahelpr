-- Permanently remove the Family & Care feature (care-relationship dashboard
-- at /family). Soft-disabled behind FAMILY_ENABLED = false on 2026-08-23;
-- owner has now confirmed a full removal since the app has no role model and
-- posting a job already covers the "manage jobs for someone else" use case.
--
-- This drops ONLY the care_relationships table (created in
-- 20260612280000_senior_help.sql) and its indexes/policy. It does NOT touch
-- the unrelated `senior_mode` / `preferred_helper_id` columns added on
-- `profiles` in that same migration — Senior Mode is a separate, still-live
-- feature (see Profile → Accessibility, help-center content).
--
-- Guarded with IF EXISTS throughout so this replays safely regardless of
-- whether a later migration already touched these objects.

DROP INDEX IF EXISTS public.care_relationships_caregiver_idx;
DROP INDEX IF EXISTS public.care_relationships_recipient_idx;

DROP POLICY IF EXISTS "Parties manage their relationships" ON public.care_relationships;

DROP TABLE IF EXISTS public.care_relationships;
