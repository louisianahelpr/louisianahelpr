-- Profile view tracking — record authenticated views of user profiles.
-- Each authenticated user can record one view per viewed_user per hour
-- (enforced via ON CONFLICT DO NOTHING on the composite unique index) so
-- a page refresh or back/forward navigation doesn't inflate counts.

CREATE TABLE IF NOT EXISTS public.profile_views (
  id         bigserial PRIMARY KEY,
  viewed_user_id  uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  viewer_user_id  uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  -- timestamp (no tz) keeps date_trunc IMMUTABLE, which Postgres requires for
  -- generated columns. Supabase runs UTC so local ≡ UTC throughout.
  viewed_at       timestamp NOT NULL DEFAULT LOCALTIMESTAMP,
  -- Bucket into 1-hour windows so ON CONFLICT handles dedup
  hour_bucket     timestamp NOT NULL GENERATED ALWAYS AS (
    date_trunc('hour', viewed_at)
  ) STORED
);

-- Unique per viewer+viewed per hour → dedup without a separate lookup
CREATE UNIQUE INDEX IF NOT EXISTS profile_views_dedup_idx
  ON public.profile_views (viewed_user_id, viewer_user_id, hour_bucket);

-- Fast monthly count for HelperAnalytics
CREATE INDEX IF NOT EXISTS profile_views_viewed_at_idx
  ON public.profile_views (viewed_user_id, viewed_at DESC);

-- RLS: only authenticated users may insert; only the viewed user may read their own views
ALTER TABLE public.profile_views ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can record views"
  ON public.profile_views FOR INSERT
  TO authenticated
  WITH CHECK (viewer_user_id = auth.uid() AND viewed_user_id <> auth.uid());

CREATE POLICY "Users can read their own view counts"
  ON public.profile_views FOR SELECT
  TO authenticated
  USING (viewed_user_id = auth.uid());

-- ── record_profile_view ──────────────────────────────────────────────────────
-- Fire-and-forget: inserts a row; silently skips on conflict (same viewer
-- already recorded a view in this hour). Also skips gracefully if the
-- viewed_user_id doesn't exist (REFERENCES constraint) — just catches the
-- exception and returns false.
CREATE OR REPLACE FUNCTION public.record_profile_view(p_viewed_user_id uuid)
RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
BEGIN
  IF p_viewed_user_id IS NULL OR p_viewed_user_id = auth.uid() THEN
    RETURN false;
  END IF;
  INSERT INTO public.profile_views (viewed_user_id, viewer_user_id)
  VALUES (p_viewed_user_id, auth.uid())
  ON CONFLICT (viewed_user_id, viewer_user_id, hour_bucket) DO NOTHING;
  RETURN true;
EXCEPTION WHEN OTHERS THEN
  RETURN false;
END;
$$;

-- ── get_monthly_profile_view_count ───────────────────────────────────────────
-- Returns the count of distinct viewers in the last 30 days.
-- Returns 0 for self (auth.uid() = p_user_id) or if no rows exist.
CREATE OR REPLACE FUNCTION public.get_monthly_profile_view_count(p_user_id uuid)
RETURNS integer
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$
  SELECT COUNT(DISTINCT viewer_user_id)::integer
  FROM public.profile_views
  WHERE viewed_user_id = p_user_id
    AND viewed_at > now() - INTERVAL '30 days';
$$;

GRANT EXECUTE ON FUNCTION public.record_profile_view(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_monthly_profile_view_count(uuid) TO authenticated;
