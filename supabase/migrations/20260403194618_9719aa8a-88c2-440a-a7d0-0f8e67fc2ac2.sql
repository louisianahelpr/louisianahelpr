
-- ============================================================
-- 1. SECURE open_jobs_safe VIEW — drop and recreate without customer_id
-- ============================================================

DROP VIEW IF EXISTS public.open_jobs_safe;

CREATE VIEW public.open_jobs_safe
WITH (security_invoker = true)
AS
SELECT
  id, title, description, category, budget, date_needed, location,
  is_urgent, urgent_fee, is_flexible_schedule, is_recurring,
  is_group_job, helpers_needed, estimated_hours, start_time,
  photos, special_requirements, status, created_at,
  boosted_at, boost_expires_at, expires_at
FROM public.jobs
WHERE status = 'open';

-- Grant access for anon and authenticated
GRANT SELECT ON public.open_jobs_safe TO anon;
GRANT SELECT ON public.open_jobs_safe TO authenticated;
