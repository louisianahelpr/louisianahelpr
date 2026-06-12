-- Job view tracking — one row per (job_id, viewer_id) pair.
-- UNIQUE constraint dedupes repeated opens; ON CONFLICT DO NOTHING
-- so record_job_view is idempotent.
CREATE TABLE IF NOT EXISTS job_views (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id uuid NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  viewer_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  first_viewed_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (job_id, viewer_id)
);

CREATE INDEX IF NOT EXISTS job_views_job_id_idx ON job_views(job_id);

ALTER TABLE job_views ENABLE ROW LEVEL SECURITY;
-- Viewers can insert their own views (helper opening a job)
CREATE POLICY "Helpers insert own views" ON job_views
  FOR INSERT WITH CHECK (auth.uid() = viewer_id);
-- Posters can read view counts on their own jobs
CREATE POLICY "Posters read views on own jobs" ON job_views
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM jobs WHERE jobs.id = job_views.job_id AND jobs.customer_id = auth.uid())
  );

-- record_job_view — idempotent upsert. Called when a helper views a job detail.
-- SECURITY DEFINER so it runs without the caller needing INSERT on job_views.
-- Returns 'inserted' or 'already_seen'.
CREATE OR REPLACE FUNCTION record_job_view(p_job_id uuid)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  INSERT INTO job_views (job_id, viewer_id)
  VALUES (p_job_id, auth.uid())
  ON CONFLICT (job_id, viewer_id) DO NOTHING;
  IF FOUND THEN RETURN 'inserted'; ELSE RETURN 'already_seen'; END IF;
END;
$$;
GRANT EXECUTE ON FUNCTION record_job_view(uuid) TO authenticated;

-- get_job_view_counts — batch lookup for a poster's jobs.
-- Returns one row per job_id that has at least 1 view.
CREATE OR REPLACE FUNCTION get_job_view_counts(p_job_ids uuid[])
RETURNS TABLE(job_id uuid, view_count bigint)
LANGUAGE sql
STABLE
SECURITY DEFINER
AS $$
  SELECT jv.job_id, COUNT(DISTINCT jv.viewer_id)::bigint
  FROM job_views jv
  WHERE jv.job_id = ANY(p_job_ids)
  GROUP BY jv.job_id;
$$;
GRANT EXECUTE ON FUNCTION get_job_view_counts(uuid[]) TO authenticated;
