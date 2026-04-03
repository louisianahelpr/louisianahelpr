
-- Recreate view with security_invoker = true
CREATE OR REPLACE VIEW public.open_jobs_safe 
WITH (security_invoker = true)
AS
SELECT 
  id, title, description, category, budget, date_needed, start_time,
  location, is_urgent, urgent_fee, is_flexible_schedule, is_recurring,
  is_group_job, helpers_needed, estimated_hours, photos, special_requirements,
  created_at, status, customer_id, expires_at, boosted_at, boost_expires_at
FROM public.jobs
WHERE status = 'open';
