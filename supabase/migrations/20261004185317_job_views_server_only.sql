-- Q1230 (docs/OPEN.md): a poster could read WHO viewed their job.
--
-- Read live 2026-10-04: policy "Posters read views on own jobs" (SELECT, TO
-- public, qual: the caller owns the job) with table-level SELECT for anon and
-- authenticated (relacl arwdxm) handed the poster every viewer's user id
-- through PostgREST, while the product shows counts only.
--
-- No client reads or writes job_views directly (src/: no .from("job_views")):
--   * the view is recorded by record_job_view(uuid)       SECURITY DEFINER
--   * the poster's count comes from get_job_view_counts() SECURITY DEFINER
--   * export_my_data / prune_retention_tables / the purge run server-side.
-- So the table becomes server-only: every client privilege is revoked and the
-- two row policies, which no longer admit anything, are dropped. The definer
-- functions run as their owner and keep working; service_role keeps its grant.
--
-- Replay-safe: REVOKE is idempotent; DROP POLICY IF EXISTS.
REVOKE ALL ON public.job_views FROM PUBLIC, anon, authenticated;
DROP POLICY IF EXISTS "Posters read views on own jobs" ON public.job_views;
DROP POLICY IF EXISTS "Helpers insert own views" ON public.job_views;
