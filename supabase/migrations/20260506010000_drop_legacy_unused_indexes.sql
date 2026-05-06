-- Drop two indexes backing the deprecated legacy-user-migration flag.
-- The `is_legacy_user` and `legacy_manual_review` columns on profiles are
-- being deprecated (per TODO.md: "Still TODO: deprecate legacy_manual_review
-- flag"). pg_stat_user_indexes shows zero scans on either index across all
-- of production traffic to date.
--
-- Conservatively limited to these two — the broader unused_index advisor
-- list (44 entries) includes many indexes that are just cold because
-- production traffic is still ramping. Re-audit in ~30 days when "0 scans"
-- becomes a strong signal rather than "no traffic yet."

DROP INDEX IF EXISTS public.idx_profiles_is_legacy_user;
DROP INDEX IF EXISTS public.idx_profiles_legacy_manual;
