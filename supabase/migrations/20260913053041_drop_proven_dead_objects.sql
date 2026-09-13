-- Drop database objects proven dead on prod (fncmgoasalhdgfwzhsqa) on
-- 2026-09-12. Inventory: docs/audit/naming-and-dead-code-2026-09-13.md (B10,
-- B11, B13-B15, B18).
--
-- Proof, per object, taken live before this was written:
--   * functions: to_regprocedure resolves; zero callers in src/,
--     supabase/functions/, e2e/, scripts/ (outside the generated write-contract
--     snapshot); zero pg_proc.prosrc mentions in any other function; zero
--     pg_views definitions; zero pg_policies qual/with_check; zero cron.job
--     commands; not a trigger function.
--   * tables: 0 rows; no reader or writer in code, functions, views, policies
--     or cron; no inbound foreign keys; only their own RI / ban-gate triggers.
--   * jobs.scope_video_thumbnail_url: 0 non-null rows; no reader in code,
--     functions, views or policies.
--
-- Deliberately KEPT (not dropped here): cron_dispatch_health() (operator
-- reporter for cron failures), user_strikes (read by purge_user_data), and
-- every non-empty column (listed for the owner in docs/OPEN.md).
--
-- No CASCADE: if a dependency appeared since the proof, this fails loudly
-- instead of silently taking it along. IF EXISTS keeps the file replay-safe.

DROP FUNCTION IF EXISTS public.get_public_avg_rating();
DROP FUNCTION IF EXISTS public.get_public_completed_job_count();
DROP FUNCTION IF EXISTS public.get_public_job_stories(integer);
DROP FUNCTION IF EXISTS public.get_platform_benchmarks();
DROP FUNCTION IF EXISTS public.get_marketplace_activity_count();
DROP FUNCTION IF EXISTS public.get_hero_parishes();
DROP FUNCTION IF EXISTS public.get_helper_parish_badges(uuid);
DROP FUNCTION IF EXISTS public.get_approved_helpers(integer);
DROP FUNCTION IF EXISTS public.review_helper_credential(uuid, text, text, date);
DROP FUNCTION IF EXISTS public.count_profiles();
DROP FUNCTION IF EXISTS public.get_recent_public_payouts(integer);
DROP FUNCTION IF EXISTS public.get_platform_impact_stats();
DROP FUNCTION IF EXISTS public.get_monthly_profile_view_count(uuid);

-- DESTRUCTIVE-DDL-ACK: DROP TABLE public.pet_report_cards
-- ACK-REASON: no reader or writer in src, edge functions, views, triggers or cron (verified on prod 2026-09-13)
-- ACK-DATA-LOSS: none: the table held 0 rows on prod when checked
DROP TABLE IF EXISTS public.pet_report_cards;
-- DESTRUCTIVE-DDL-ACK: DROP TABLE public.subscription_cancel_reasons
-- ACK-REASON: nothing ever writes to it and nothing reads it (verified on prod 2026-09-13)
-- ACK-DATA-LOSS: none: the table held 0 rows on prod when checked
DROP TABLE IF EXISTS public.subscription_cancel_reasons;

-- DESTRUCTIVE-DDL-ACK: DROP COLUMN public.jobs.scope_video_thumbnail_url
-- ACK-REASON: leftover from the retired time-banking migration; no reader anywhere
-- ACK-DATA-LOSS: none: 0 non-null values on prod when checked
ALTER TABLE IF EXISTS public.jobs DROP COLUMN IF EXISTS scope_video_thumbnail_url;
