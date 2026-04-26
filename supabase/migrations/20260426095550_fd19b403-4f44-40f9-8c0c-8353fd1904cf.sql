-- Public count of completed jobs (no PII)
CREATE OR REPLACE FUNCTION public.get_public_completed_job_count()
RETURNS bigint
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT count(*) FROM public.jobs WHERE status = 'completed';
$$;

GRANT EXECUTE ON FUNCTION public.get_public_completed_job_count() TO anon, authenticated;

-- Public success stories: recent completed jobs with after photos
CREATE OR REPLACE FUNCTION public.get_public_job_stories(p_limit integer DEFAULT 10)
RETURNS TABLE(
  id uuid,
  title text,
  category text,
  proof_before_urls text[],
  proof_after_urls text[],
  helper_id uuid,
  poster_completed_at timestamptz
)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT j.id, j.title, j.category::text, j.proof_before_urls, j.proof_after_urls,
         j.helper_id, j.poster_completed_at
  FROM public.jobs j
  WHERE j.status = 'completed'
    AND j.proof_after_urls IS NOT NULL
    AND array_length(j.proof_after_urls, 1) > 0
  ORDER BY j.poster_completed_at DESC NULLS LAST
  LIMIT GREATEST(COALESCE(p_limit, 10), 1);
$$;

GRANT EXECUTE ON FUNCTION public.get_public_job_stories(integer) TO anon, authenticated;

-- Public open jobs preview (safe fields only)
CREATE OR REPLACE FUNCTION public.get_public_open_jobs(p_limit integer DEFAULT 6)
RETURNS TABLE(
  id uuid,
  title text,
  category text,
  location text,
  budget numeric,
  date_needed date,
  is_urgent boolean
)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT j.id, j.title, j.category::text, j.location, j.budget, j.date_needed, j.is_urgent
  FROM public.jobs j
  WHERE j.status = 'open'
    AND j.date_needed >= CURRENT_DATE
    AND (j.offered_to_helper_id IS NULL OR j.direct_offer_status <> 'pending')
  ORDER BY j.created_at DESC
  LIMIT GREATEST(COALESCE(p_limit, 6), 1);
$$;

GRANT EXECUTE ON FUNCTION public.get_public_open_jobs(integer) TO anon, authenticated;