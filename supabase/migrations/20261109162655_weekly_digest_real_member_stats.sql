-- Weekly admin digest counted test data (owner's admin email, 2026-11-09: "Open reports 2", both seed fixtures from
-- 2026-09-13 whose reporters are test subjects).
--
-- engagement-automations' Monday digest read its five numbers straight from the tables: open reports with no test
-- filter at all, and sign-ups, jobs posted, jobs completed and revenue with is_seed only (so unmarked test accounts
-- counted). The daily summary already reads every count from owner_daily_summary_stats (20261031224638), which
-- leaves out is_seed rows AND test subjects (is_test_subject). The digest now reads the same function with a
-- 7-day p_since, so both emails use one real-member rule.
--
-- The digest also shows revenue (platform fees on completed jobs), which the function did not answer. This adds
-- ONE key, job_fee_revenue: the sum of jobs.platform_fee_amount (dollars) over the jobs the jobs_completed count
-- keeps (completed, updated since p_since, not seed, neither poster nor Helpr a test subject). Every other key is
-- unchanged, byte for byte.
--
-- REPLAY-SAFETY: CREATE OR REPLACE only, same signature and return type; every object it names predates
-- 20261031224638. Grants re-stated: service_role only (REVOKE FROM PUBLIC, anon, authenticated).

CREATE OR REPLACE FUNCTION public.owner_daily_summary_stats(p_since timestamptz)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
  SELECT jsonb_build_object(
    'new_users', (
      SELECT count(*) FROM public.profiles p
       WHERE p.created_at >= p_since AND p.is_seed IS NOT TRUE AND NOT public.is_test_subject(p.user_id)),
    'jobs_posted', (
      SELECT count(*) FROM public.jobs j
       WHERE j.created_at >= p_since AND j.is_seed IS NOT TRUE AND NOT public.is_test_subject(j.customer_id)),
    'items_posted', (
      SELECT count(*) FROM public.declutter_items i
       WHERE i.live_at >= p_since AND i.is_seed IS NOT TRUE AND NOT public.is_test_subject(i.seller_id)),
    'jobs_completed', (
      SELECT count(*) FROM public.jobs j
       WHERE j.status = 'completed' AND j.updated_at >= p_since AND j.is_seed IS NOT TRUE
         AND NOT public.is_test_subject(j.customer_id) AND NOT public.is_test_subject(j.helper_id)),
    'job_fee_revenue', (
      SELECT coalesce(sum(j.platform_fee_amount), 0)::numeric(12,2) FROM public.jobs j
       WHERE j.status = 'completed' AND j.updated_at >= p_since AND j.is_seed IS NOT TRUE
         AND NOT public.is_test_subject(j.customer_id) AND NOT public.is_test_subject(j.helper_id)),
    'items_sold', (
      SELECT count(*) FROM public.declutter_orders o
       WHERE o.paid_at >= p_since AND o.is_seed IS NOT TRUE
         AND NOT public.is_test_subject(o.buyer_id) AND NOT public.is_test_subject(o.seller_id)),
    'sales_cents', (
      SELECT coalesce(sum(o.total_cents), 0) FROM public.declutter_orders o
       WHERE o.paid_at >= p_since AND o.is_seed IS NOT TRUE
         AND NOT public.is_test_subject(o.buyer_id) AND NOT public.is_test_subject(o.seller_id)),
    'open_reports', (
      SELECT count(*) FROM public.reports r
       WHERE r.status = 'pending'
         AND NOT public.is_test_subject(r.reporter_id)
         AND NOT (r.reported_type = 'user' AND public.is_test_subject(r.reported_id))
         AND NOT (r.reported_type = 'job' AND EXISTS (
               SELECT 1 FROM public.jobs j WHERE j.id = r.reported_id
                  AND (j.is_seed IS TRUE OR public.is_test_subject(j.customer_id))))
         AND NOT (r.reported_type = 'message' AND EXISTS (
               SELECT 1 FROM public.messages m WHERE m.id = r.reported_id AND public.is_test_subject(m.sender_id)))),
    'failed_payouts', (
      SELECT count(*) FROM public.declutter_payouts d
       WHERE d.status = 'failed' AND d.is_seed IS NOT TRUE AND NOT public.is_test_subject(d.seller_id)),
    'member_errors', (
      SELECT count(*) FROM public.error_logs e
       WHERE e.created_at >= p_since AND e.severity IN ('error', 'fatal') AND e.user_id IS NOT NULL
         AND NOT (jsonb_typeof(e.tags) = 'object'
                  AND (coalesce(e.tags ->> 'seed', '') = 'true'
                       OR coalesce(e.tags ->> 'source', e.tags ->> 'area', '') LIKE '%-seed'))
         AND NOT public.is_test_subject(e.user_id)),
    'members_with_errors', (
      SELECT count(DISTINCT e.user_id) FROM public.error_logs e
       WHERE e.created_at >= p_since AND e.severity IN ('error', 'fatal') AND e.user_id IS NOT NULL
         AND NOT (jsonb_typeof(e.tags) = 'object'
                  AND (coalesce(e.tags ->> 'seed', '') = 'true'
                       OR coalesce(e.tags ->> 'source', e.tags ->> 'area', '') LIKE '%-seed'))
         AND NOT public.is_test_subject(e.user_id)),
    'top_sources', (
      SELECT coalesce(jsonb_agg(jsonb_build_object('source', t.source, 'signups', t.signups)
                                ORDER BY t.signups DESC, t.source), '[]'::jsonb)
        FROM (SELECT s.source, count(*) AS signups
                FROM public.member_signup_sources s
               WHERE s.recorded_at >= p_since AND NOT public.is_test_subject(s.user_id)
                 AND NOT EXISTS (SELECT 1 FROM public.profiles p WHERE p.user_id = s.user_id AND p.is_seed IS TRUE)
               GROUP BY s.source
               ORDER BY count(*) DESC, s.source
               LIMIT 5) t)
  );
$fn$;

REVOKE ALL ON FUNCTION public.owner_daily_summary_stats(timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.owner_daily_summary_stats(timestamptz) TO service_role;
