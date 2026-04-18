-- ============================================================
-- Restrict broad SELECT on jobs; expose safe browseable view instead
-- ============================================================

-- 1. Create authenticated-only safe view for browsing open jobs.
--    Includes customer_id (needed to look up poster name + reviews)
--    EXCLUDES: stripe_session_id, stripe_payment_intent_id,
--    platform_fee_amount, helper_fee_percent, customer_fee_amount,
--    sales_tax_amount, sales_tax_rate, commission_tax_amount,
--    cancellation_fee, cancellation_fee_status, cancellation_reason,
--    cancelled_at, cancelled_by, dispute_*, disputed_*,
--    flag_reasons, removal_reason, removed_at, removed_by,
--    latitude, longitude, zip_code, parish (precise geo data),
--    response_deadline, payout_scheduled_at, helper_id (private),
--    poster_*_at confirmation timestamps.

DROP VIEW IF EXISTS public.open_jobs_browse;

CREATE VIEW public.open_jobs_browse
WITH (security_invoker = true)
AS
SELECT
  id, title, description, category, budget, date_needed, location,
  is_urgent, urgent_fee, is_flexible_schedule, is_recurring,
  is_group_job, helpers_needed, estimated_hours, start_time,
  photos, special_requirements, status, created_at, updated_at,
  boosted_at, boost_expires_at, expires_at,
  recurrence_interval, recurrence_end_date, parent_job_id,
  payment_status,
  customer_id
FROM public.jobs
WHERE status = 'open';

GRANT SELECT ON public.open_jobs_browse TO authenticated;

-- 2. Drop the overly-broad SELECT policy on jobs.
--    Participants (customer_id, helper_id) and admins keep their existing
--    SELECT policies. Anyone browsing now uses the safe view.
DROP POLICY IF EXISTS "Authenticated users can view open jobs" ON public.jobs;