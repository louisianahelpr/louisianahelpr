-- Saved-helpers private note (handoff item #23).
--
-- A poster's personal note about a saved helpr — never shown to the
-- helpr or any other user, only to the poster who saved them. Lets
-- posters jot reminders like "great with painting, ask for Tuesdays".
--
-- The underlying table is `favorite_helpers` (named for historical
-- reasons; the UI calls them "saved helprs"). RLS already restricts
-- read/write to `auth.uid() = customer_id`, so adding the column
-- inherits the existing "owner-only" semantics without further policy
-- changes.
--
-- Replay-safe: ADD COLUMN IF NOT EXISTS guards a from-scratch rebuild.

ALTER TABLE public.favorite_helpers
  ADD COLUMN IF NOT EXISTS private_note text;

COMMENT ON COLUMN public.favorite_helpers.private_note IS
  'Poster-only note about this saved helpr. Never shown to the helpr; readable only by the customer who saved them (RLS scopes to customer_id).';

-- Surface the new column on the get_my_saved_helpers() RPC so the UI
-- can render the note inline on the Saved Helprs list without a
-- second round-trip. The RPC was defined in
-- 20260423025644_8e120f3a-2254-48db-8dad-fc1e91830df3.sql; we
-- recreate it here with the additional column. CREATE OR REPLACE
-- keeps existing grants intact.

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
  private_note text
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
    fh.private_note
  FROM public.favorite_helpers fh
  JOIN public.profiles p ON p.user_id = fh.helper_id
  WHERE fh.customer_id = auth.uid()
    AND p.approval_status = 'approved'
    AND COALESCE(p.ban_status, 'active') = 'active'
  ORDER BY fh.created_at DESC;
$$;

GRANT EXECUTE ON FUNCTION public.get_my_saved_helpers() TO authenticated;
