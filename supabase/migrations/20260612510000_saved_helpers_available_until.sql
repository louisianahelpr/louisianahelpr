-- Surface available_until on get_my_saved_helpers() so the YourHelpersRow
-- strip can show a green "Available Now" badge dot on helper avatars.
--
-- The profiles.available_until column was added in
-- 20260612430000_helper_availability_status.sql.
-- This migration re-creates get_my_saved_helpers (last defined in
-- 20260609110000_saved_helpers_private_note.sql) to include that column.
--
-- Replay-safe: DROP IF EXISTS before CREATE OR REPLACE avoids the 42P13
-- "cannot change return type" error on rebuilds.

DROP FUNCTION IF EXISTS public.get_my_saved_helpers();

CREATE OR REPLACE FUNCTION public.get_my_saved_helpers()
RETURNS TABLE (
  helper_id uuid,
  full_name text,
  avatar_url text,
  bio text,
  parish text,
  skills text,
  hourly_rate numeric,
  saved_at timestamptz,
  completed_jobs_together integer,
  last_job_at timestamptz,
  private_note text,
  available_until timestamptz   -- non-null and future = helper is available right now
)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    fh.helper_id,
    p.full_name,
    p.avatar_url,
    p.bio,
    p.parish,
    p.skills,
    p.hourly_rate,
    fh.created_at AS saved_at,
    COALESCE((
      SELECT count(*)::int
      FROM public.jobs j
      WHERE j.customer_id = fh.customer_id
        AND j.helper_id = fh.helper_id
        AND j.status = 'completed'
    ), 0) AS completed_jobs_together,
    (SELECT max(COALESCE(j.poster_completed_at, j.helper_completed_at, j.updated_at))
       FROM public.jobs j
      WHERE j.customer_id = fh.customer_id
        AND j.helper_id = fh.helper_id
        AND j.status = 'completed') AS last_job_at,
    fh.private_note,
    p.available_until
  FROM public.favorite_helpers fh
  JOIN public.profiles p ON p.user_id = fh.helper_id
  WHERE fh.customer_id = auth.uid()
    AND p.approval_status = 'approved'
    AND COALESCE(p.ban_status, 'active') = 'active'
  ORDER BY fh.created_at DESC;
$$;

GRANT EXECUTE ON FUNCTION public.get_my_saved_helpers() TO authenticated;
