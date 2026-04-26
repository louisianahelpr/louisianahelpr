-- Helper: strip street, return "City, State" only
CREATE OR REPLACE FUNCTION public.mask_job_location(loc text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path TO 'public'
AS $$
  SELECT CASE
    WHEN loc IS NULL OR loc = '' THEN loc
    WHEN array_length(string_to_array(loc, ','), 1) >= 2 THEN
      trim(split_part(loc, ',', array_length(string_to_array(loc, ','), 1) - 1))
      || ', '
      || regexp_replace(
           trim(split_part(loc, ',', array_length(string_to_array(loc, ','), 1))),
           '\s*\d{5}(-\d{4})?\s*$', ''
         )
    ELSE loc
  END;
$$;

-- Public landing-page RPC: only City, State
CREATE OR REPLACE FUNCTION public.get_public_open_jobs(p_limit integer DEFAULT 6)
RETURNS TABLE(id uuid, title text, category text, location text, budget numeric, date_needed date, is_urgent boolean)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT j.id, j.title, j.category::text,
         public.mask_job_location(j.location) AS location,
         j.budget, j.date_needed, j.is_urgent
  FROM public.jobs j
  WHERE j.status = 'open'
    AND j.date_needed >= CURRENT_DATE
    AND (j.offered_to_helper_id IS NULL OR j.direct_offer_status <> 'pending')
  ORDER BY j.created_at DESC
  LIMIT GREATEST(COALESCE(p_limit, 6), 1);
$$;

-- Open jobs browse view: mask street unless viewer is the directly-offered helper
CREATE OR REPLACE VIEW public.open_jobs_browse AS
SELECT
  id,
  title,
  description,
  category,
  budget,
  date_needed,
  CASE
    WHEN offered_to_helper_id = auth.uid() THEN location
    ELSE public.mask_job_location(location)
  END AS location,
  is_urgent,
  urgent_fee,
  is_flexible_schedule,
  is_recurring,
  is_group_job,
  helpers_needed,
  estimated_hours,
  start_time,
  photos,
  special_requirements,
  status,
  created_at,
  updated_at,
  boosted_at,
  boost_expires_at,
  expires_at,
  recurrence_interval,
  recurrence_end_date,
  parent_job_id,
  payment_status,
  customer_id,
  offered_to_helper_id,
  direct_offer_status,
  direct_offer_expires_at
FROM jobs
WHERE status = 'open'::job_status
  AND (
    offered_to_helper_id IS NULL
    OR direct_offer_status = ANY (ARRAY['declined'::text, 'expired'::text])
    OR offered_to_helper_id = auth.uid()
  );