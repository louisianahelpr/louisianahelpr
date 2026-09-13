-- Owner-approved (2026-09-12) drops of non-empty but unread columns.
-- Proof taken live on prod fncmgoasalhdgfwzhsqa 2026-09-12: zero mentions in
-- pg_proc.prosrc, view definitions, pg_policies, trigger definitions and
-- pg_depend; no reader in src/, supabase/functions/ or scripts/ (the one
-- writer, scripts/audit/prod-seed.mjs is_evacuation_registered, is removed in
-- the same change). No CASCADE, so a new dependency fails loudly.

ALTER TABLE IF EXISTS public.pet_profiles DROP COLUMN IF EXISTS is_evacuation_registered;
ALTER TABLE IF EXISTS public.jobs DROP COLUMN IF EXISTS protection_opted_in;
ALTER TABLE IF EXISTS public.profiles DROP COLUMN IF EXISTS push_consent;
ALTER TABLE IF EXISTS public.profiles DROP COLUMN IF EXISTS sms_consent;
ALTER TABLE IF EXISTS public.platform_settings DROP COLUMN IF EXISTS latest_build;
