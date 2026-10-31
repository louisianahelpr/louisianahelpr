-- REBUILT 2026-10-31 (LEAD-B49-REBUILD, Builder 31) from Builder 49's 20261031051341 (never landed): same SQL, new
-- timestamp, after 20261031220849.
-- The poster's "Your Helpr hasn't verified their ID yet" notice reaches no test data.
--
-- identity_notify_posters_before_start (20261031220849, Builder 49's 20261030225327 rebuilt) had no skip, so once the switch is
-- on a seed job, or a job with a test account on either side, would write a notification
-- (owner: test data reaches nobody). payout_waits_on_identity exempts only a member who is
-- both is_seed and enrolled, so it does not stand in for this.
--
-- Skips: jobs.is_seed, and public.is_test_subject on the poster and on the Helpr, which
-- covers profiles.is_seed, test_accounts and the fixture and example mail domains (read live
-- 2026-10-31). A crew is judged per member: a test member's row earns no notice, and a
-- real unverified member on the same crew still does.
--
-- The function is not on prod yet, so there is no live body to match: the base is
-- 20261031220849 (byte-identical body to B49's 20261030225327, md5 of the normalised body
-- a591ec14f6b903931197d3570078c19b). Replay-safe:
-- CREATE OR REPLACE only.
CREATE OR REPLACE FUNCTION public.identity_notify_posters_before_start(p_limit integer DEFAULT 100)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_title constant text := 'Your Helpr hasn''t verified their ID yet';
  v_count integer;
BEGIN
  WITH hired AS (
    SELECT j.id, j.title, j.customer_id, j.date_needed, j.start_time, j.helper_id AS uid,
           j.helper_on_the_way_at AS otw, j.helper_arrived_at AS arrived, j.is_seed AS job_seed
      FROM public.jobs j
     WHERE j.helper_id IS NOT NULL AND j.status::text = 'accepted' AND j.customer_id IS NOT NULL
    UNION ALL
    SELECT j.id, j.title, j.customer_id, j.date_needed, j.start_time, g.helper_id,
           g.helper_on_the_way_at, g.helper_arrived_at, j.is_seed
      FROM public.group_job_helpers g JOIN public.jobs j ON j.id = g.job_id
     WHERE g.helper_id IS NOT NULL AND j.status::text IN ('open', 'accepted') AND j.customer_id IS NOT NULL
  ), due AS (
    SELECT DISTINCT ON (h.id) h.id, h.title, h.customer_id
      FROM hired h
     WHERE h.otw IS NULL AND h.arrived IS NULL
       AND h.job_seed IS NOT TRUE
       AND NOT public.is_test_subject(h.customer_id)
       AND NOT public.is_test_subject(h.uid)
       AND public.job_hours_until_start(h.date_needed, h.start_time, now()) BETWEEN 0 AND 24
       AND public.payout_waits_on_identity(h.uid)
       AND NOT EXISTS (SELECT 1 FROM public.notifications n
                        WHERE n.user_id = h.customer_id AND n.job_id = h.id AND n.title = v_title)
     ORDER BY h.id
     LIMIT GREATEST(COALESCE(p_limit, 100), 0)
  ), ins AS (
    INSERT INTO public.notifications (user_id, title, message, type, link, job_id)
    SELECT d.customer_id, v_title,
           format('They can''t head out to "%s" until they do. You can cancel without paying for their time and hire someone else, or wait for them. You''ll see what comes back to you before you confirm. Nothing changes unless you choose.', COALESCE(d.title, 'your job')),
           'warning', '/jobs?job=' || d.id::text, d.id
      FROM due d
    RETURNING 1
  )
  SELECT count(*) INTO v_count FROM ins;
  RETURN v_count;
END;
$fn$;
REVOKE ALL ON FUNCTION public.identity_notify_posters_before_start(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.identity_notify_posters_before_start(integer) TO service_role;
