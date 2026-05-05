-- 6 duplicate index pairs flagged by Supabase performance advisor.
-- Each pair has identical column lists + opclass. Drop the redundant
-- shorter-named versions and keep the more-descriptive `_id` suffix.
-- For user_roles, both copies were constraint-backed (one auto-named by
-- Postgres, one manually named); drop the manual one as a CONSTRAINT
-- (auto-drops its backing index) and keep the auto-generated `_key`.
--
-- Saves ~6 indexes worth of write amplification + storage. No read-path
-- impact since the remaining index in each pair is identical.

DROP INDEX IF EXISTS public.idx_applications_helper;       -- keeps idx_applications_helper_id
DROP INDEX IF EXISTS public.idx_applications_job;          -- keeps idx_applications_job_id
DROP INDEX IF EXISTS public.idx_jobs_customer;             -- keeps idx_jobs_customer_id
DROP INDEX IF EXISTS public.idx_profiles_user;             -- keeps idx_profiles_user_id
DROP INDEX IF EXISTS public.idx_reviews_reviewee;          -- keeps idx_reviews_reviewee_id
ALTER TABLE public.user_roles DROP CONSTRAINT IF EXISTS user_roles_user_id_role_unique;
-- The constraint user_roles_user_id_role_key (Postgres auto-generated
-- name from the column-level UNIQUE) continues to enforce uniqueness
-- on (user_id, role).
