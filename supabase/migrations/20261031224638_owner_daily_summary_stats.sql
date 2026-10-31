-- OPS-1 review fix (lead 10-31): the owner's daily summary counted test accounts.
--
-- The daily summary in engagement-automations read each count straight from its table with is_seed = false.
-- That leaves out seeded rows, but not the unmarked test accounts the owner rule names (public.is_test_subject:
-- a test_accounts row, a seed profile, or a fixture or example.com login). A test run's sign-ups, jobs, items,
-- sales, payouts, reports and errors therefore showed up in the owner's numbers. reports has no is_seed at all,
-- so every test report counted.
--
-- Fix: one read-only function gives every count in one answer, and each count leaves out test subjects
-- (is_test_subject) as well as is_seed rows:
--   new_users           profiles made since p_since, not seed, not a test subject
--   jobs_posted         jobs made since p_since, not seed, poster not a test subject
--   items_posted        Declutter items gone live since p_since, not seed, seller not a test subject
--   jobs_completed      jobs completed (updated) since p_since, not seed, neither poster nor Helpr a test subject
--   items_sold / sales_cents  Declutter orders paid since p_since, not seed, neither buyer nor seller a test subject
--   open_reports        pending reports whose reporter is not a test subject and whose target (the user, the job's
--                       poster or the message's sender) is not one either; a seeded job's report is left out
--   failed_payouts      failed Declutter payouts, not seed, seller not a test subject
--   member_errors / members_with_errors  error and fatal rows since p_since from a signed-in member who is not a
--                       test subject, minus test runs' own rows (tags.seed = 'true' or a source/area ending in
--                       '-seed', the rule the edge function used)
--   top_sources         the top 5 sign-up sources since p_since (member_signup_sources), real members only
-- The edge function calls it as service_role; no one else may. STABLE, SECURITY DEFINER (it reads auth.users
-- through is_test_subject), search_path pinned.
--
-- REPLAY-SAFETY: CREATE OR REPLACE only. Every table and function it names exists before this timestamp
-- (member_signup_sources: 20261031220447; is_test_subject: 20261030143141). A sql function body is checked when it
-- is created, so this file must run after those, which timestamp order guarantees.

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
