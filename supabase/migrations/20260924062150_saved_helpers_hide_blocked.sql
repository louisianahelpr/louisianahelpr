-- TS-011: Saved Helprs listed a Helpr you had blocked (or who blocked you):
-- get_my_saved_helpers filtered verification and bans but not blocks, and
-- block_user_and_settle keeps the favorite_helpers row (so an unblock restores
-- it). Filter blocks in either direction here; OfferToSavedHelpr reads the
-- same RPC. Body is the live definition (2026-09-24) plus one predicate.

CREATE OR REPLACE FUNCTION public.get_my_saved_helpers()
 RETURNS TABLE(helper_id uuid, full_name text, avatar_url text, bio text, parish text, skills text, hourly_rate numeric, saved_at timestamp with time zone, completed_jobs_together integer, last_job_at timestamp with time zone, private_note text, available_until timestamp with time zone)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
    AND p.email_verified
    AND COALESCE(p.ban_status, 'active') = 'active'
    AND NOT public.are_users_blocked(fh.customer_id, fh.helper_id)  -- TS-011 block filter
  ORDER BY fh.created_at DESC;
$function$;

