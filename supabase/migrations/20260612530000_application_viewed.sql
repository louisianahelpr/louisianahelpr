-- Application viewed tracking: lets helpers see when the poster has opened their application.

ALTER TABLE public.applications
  ADD COLUMN IF NOT EXISTS poster_viewed_at TIMESTAMPTZ;

-- Mark all pending applications for a job as viewed (called when poster expands the applicant list).
-- Idempotent: only sets poster_viewed_at when NULL, never overwrites.
-- Security definer guards that only the job's poster can mark their own jobs.
CREATE OR REPLACE FUNCTION public.mark_applications_viewed(p_job_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.applications
  SET poster_viewed_at = NOW()
  WHERE job_id = p_job_id
    AND poster_viewed_at IS NULL
    AND status IN ('pending', 'countered')
    AND p_job_id IN (
      SELECT id FROM public.jobs WHERE customer_id = auth.uid()
    );
END;
$$;

REVOKE ALL ON FUNCTION public.mark_applications_viewed(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.mark_applications_viewed(uuid) TO authenticated;
