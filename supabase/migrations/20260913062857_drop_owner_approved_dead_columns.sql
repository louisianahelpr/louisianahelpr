-- Owner-approved (2026-09-12) drops of non-empty but unread columns.
-- Proof taken live on prod fncmgoasalhdgfwzhsqa 2026-09-12: zero mentions in
-- pg_proc.prosrc, view definitions, pg_policies, trigger definitions and
-- pg_depend; no reader in src/, supabase/functions/ or scripts/ (the one
-- writer, scripts/audit/prod-seed.mjs is_evacuation_registered, is removed in
-- the same change). No CASCADE, so a new dependency fails loudly.

-- DESTRUCTIVE-DDL-ACK: DROP COLUMN public.pet_profiles.is_evacuation_registered
-- ACK-REASON: evacuation feature removed; owner approved the drop 2026-09-13
-- ACK-DATA-LOSS: 2 true values across 4 rows, all seed or test pets
ALTER TABLE IF EXISTS public.pet_profiles DROP COLUMN IF EXISTS is_evacuation_registered;
-- DESTRUCTIVE-DDL-ACK: DROP COLUMN public.jobs.protection_opted_in
-- ACK-REASON: no reader in code, views, functions or policies; owner approved 2026-09-13
-- ACK-DATA-LOSS: 245 non-null values, none of them true
ALTER TABLE IF EXISTS public.jobs DROP COLUMN IF EXISTS protection_opted_in;
-- DESTRUCTIVE-DDL-ACK: DROP COLUMN public.profiles.push_consent
-- ACK-REASON: unread since push preferences moved elsewhere; owner approved the drop 2026-09-13
-- ACK-DATA-LOSS: 60 non-null consent flags that nothing reads
ALTER TABLE IF EXISTS public.profiles DROP COLUMN IF EXISTS push_consent;
-- DESTRUCTIVE-DDL-ACK: DROP COLUMN public.profiles.sms_consent
-- ACK-REASON: no SMS feature reads it; owner approved the drop 2026-09-13
-- ACK-DATA-LOSS: 60 non-null consent flags that nothing reads
ALTER TABLE IF EXISTS public.profiles DROP COLUMN IF EXISTS sms_consent;
-- DESTRUCTIVE-DDL-ACK: DROP COLUMN public.platform_settings.latest_build
-- ACK-REASON: no reader in app, functions or scripts; owner approved 2026-09-13
-- ACK-DATA-LOSS: 1 stored build string in the single settings row
ALTER TABLE IF EXISTS public.platform_settings DROP COLUMN IF EXISTS latest_build;
