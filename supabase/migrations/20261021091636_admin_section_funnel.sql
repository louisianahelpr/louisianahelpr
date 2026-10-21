-- Board 191 (spec v2 §9.35): the admin jobs funnel, and the same for Declutter.
--
-- One read, admin only, real data only (is_seed rows never count), over the last
-- p_days days, optionally one parish (Jobs only: Declutter items carry no parish).
-- Every number is counted here from the rows themselves; the client draws it and
-- hides a rate or median whose sample is below 5 (truth rule).
--
-- JOBS stages (a job is counted at the furthest stage it reached):
--   started   every job row created (any payment state: a checkout left
--             unpaid counts here), plus each (member, day) that opened Post a
--             job (post_job_entry_choice) without creating a job that day; so
--             started >= posted always (one unit: attempts)
--   posted    the job's payment was captured (escrow, payout_pending, released,
--             or refunded after capture)
--   applicant at least one application
--   hired     accepted_at set (an accepted offer)
--   done      status completed
--   reviewed  at least one review on the job
-- Drop reasons: started-not-posted; posted with no applicant in its first 24 h;
-- applicant never hired; hired then cancelled; done with no review.
-- Stats: posted -> hired (hired / posted); median minutes from the job's
-- creation (a job is paid as it is posted) to the first application; rehire rate
-- (ALL TIME, every parish: posters with 2+ hired jobs who hired the same Helpr
-- twice); released (sum of budgets of jobs completed and released in the window,
-- whenever they were posted).
--
-- DECLUTTER stages: listed (went live) -> first offer -> sold (order paid) ->
-- handed over -> reviewed; released = items_cents of orders handed over in the
-- window.

CREATE OR REPLACE FUNCTION public.admin_section_funnel(
  p_section text DEFAULT 'jobs',
  p_days integer DEFAULT 30,
  p_parish text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_since timestamptz;
  v_out jsonb;
BEGIN
  IF auth.uid() IS NULL OR NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'not_authorized' USING ERRCODE = '42501';
  END IF;
  IF p_days IS NULL OR p_days NOT IN (7, 30, 90) THEN
    RAISE EXCEPTION 'invalid_window' USING ERRCODE = '22023';
  END IF;
  v_since := now() - make_interval(days => p_days);

  IF p_section = 'jobs' THEN
    WITH j AS (
      SELECT jb.*
        FROM public.jobs jb
       WHERE jb.created_at >= v_since
         AND jb.is_seed IS NOT TRUE
         AND jb.parent_job_id IS NULL
         AND (p_parish IS NULL OR jb.parish = p_parish)
    ),
    posted AS (
      SELECT j.* FROM j
       WHERE j.payment_status IN ('escrow', 'payout_pending', 'released', 'refunded', 'partially_refunded')
    ),
    first_app AS (
      SELECT a.job_id, min(a.created_at) AS first_at
        FROM public.applications a JOIN posted p ON p.id = a.job_id
       GROUP BY a.job_id
    ),
    started AS (
      SELECT j.id::text AS k FROM j
      UNION ALL
      SELECT DISTINCT e.user_id::text || '@' || ((e.created_at AT TIME ZONE 'America/Chicago')::date)::text
        FROM public.analytics_events_real e
        JOIN public.profiles pr ON pr.user_id = e.user_id AND pr.is_seed IS NOT TRUE
       WHERE e.event = 'post_job_entry_choice' AND e.created_at >= v_since AND p_parish IS NULL
         AND NOT EXISTS (SELECT 1 FROM j WHERE j.customer_id = e.user_id
                           AND (j.created_at AT TIME ZONE 'America/Chicago')::date = (e.created_at AT TIME ZONE 'America/Chicago')::date)
    ),
    hires AS (
      SELECT customer_id, helper_id FROM public.jobs
       WHERE accepted_at IS NOT NULL AND helper_id IS NOT NULL AND customer_id IS NOT NULL AND is_seed IS NOT TRUE
    ),
    posters2 AS (
      SELECT customer_id,
             (count(*) > count(DISTINCT helper_id)) AS rehired
        FROM hires GROUP BY customer_id HAVING count(*) >= 2
    )
    SELECT jsonb_build_object(
      'section', 'jobs',
      'days', p_days,
      'parish', p_parish,
      'stages', jsonb_build_array(
        jsonb_build_object('key', 'started', 'count', (SELECT count(*) FROM started)),
        jsonb_build_object('key', 'posted', 'count', (SELECT count(*) FROM posted)),
        jsonb_build_object('key', 'applicant', 'count', (SELECT count(*) FROM first_app)),
        jsonb_build_object('key', 'hired', 'count', (SELECT count(*) FROM posted WHERE accepted_at IS NOT NULL)),
        jsonb_build_object('key', 'done', 'count', (SELECT count(*) FROM posted WHERE status::text = 'completed')),
        jsonb_build_object('key', 'reviewed', 'count', (SELECT count(*) FROM posted p WHERE p.status::text = 'completed'
                                                           AND EXISTS (SELECT 1 FROM public.reviews r WHERE r.job_id = p.id)))
      ),
      'drops', jsonb_build_object(
        'no_applicant_24h', (SELECT count(*) FROM posted p
                              WHERE p.created_at <= now() - interval '24 hours'
                                AND NOT EXISTS (SELECT 1 FROM first_app f WHERE f.job_id = p.id AND f.first_at <= p.created_at + interval '24 hours')),
        'never_hired', (SELECT count(*) FROM posted p JOIN first_app f ON f.job_id = p.id WHERE p.accepted_at IS NULL),
        'cancelled_after_hire', (SELECT count(*) FROM posted p WHERE p.accepted_at IS NOT NULL AND p.status::text = 'cancelled'),
        'no_review', (SELECT count(*) FROM posted p WHERE p.status::text = 'completed'
                        AND NOT EXISTS (SELECT 1 FROM public.reviews r WHERE r.job_id = p.id))
      ),
      'first_response_minutes', (SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY extract(epoch FROM f.first_at - p.created_at) / 60)
                                   FROM posted p JOIN first_app f ON f.job_id = p.id),
      'first_response_sample', (SELECT count(*) FROM first_app),
      'rehire', jsonb_build_object('posters', (SELECT count(*) FROM posters2),
                                   'rehired', (SELECT count(*) FROM posters2 WHERE rehired)),
      'released_cents', (SELECT COALESCE(sum(round(x.budget * 100)), 0)::bigint FROM public.jobs x
                          WHERE x.is_seed IS NOT TRUE AND x.payment_status = 'released' AND x.completed_at >= v_since
                            AND (p_parish IS NULL OR x.parish = p_parish)),
      'parishes', (SELECT COALESCE(jsonb_agg(DISTINCT x.parish ORDER BY x.parish), '[]'::jsonb)
                     FROM public.jobs x WHERE x.is_seed IS NOT TRUE AND x.parish IS NOT NULL AND x.created_at >= v_since)
    ) INTO v_out;
    RETURN v_out;
  ELSIF p_section = 'declutter' THEN
    WITH i AS (
      SELECT it.* FROM public.declutter_items it
       WHERE it.live_at >= v_since AND it.is_seed IS NOT TRUE
    ),
    first_offer AS (
      SELECT o.item_id, min(o.created_at) AS first_at
        FROM public.declutter_offers o JOIN i ON i.id = o.item_id
       WHERE o.is_seed IS NOT TRUE
       GROUP BY o.item_id
    ),
    ord AS (
      SELECT DISTINCT ON (oi.item_id) oi.item_id, o.id AS order_id, o.paid_at, o.handed_over_at, o.items_cents
        FROM public.declutter_cart_items oi
        JOIN public.declutter_orders o ON o.id = oi.order_id
        JOIN i ON i.id = oi.item_id
       WHERE o.is_seed IS NOT TRUE AND o.paid_at IS NOT NULL
       ORDER BY oi.item_id, o.paid_at
    )
    SELECT jsonb_build_object(
      'section', 'declutter',
      'days', p_days,
      'parish', NULL,
      'stages', jsonb_build_array(
        jsonb_build_object('key', 'listed', 'count', (SELECT count(*) FROM i)),
        jsonb_build_object('key', 'offer', 'count', (SELECT count(*) FROM first_offer)),
        jsonb_build_object('key', 'sold', 'count', (SELECT count(*) FROM ord)),
        jsonb_build_object('key', 'handed_over', 'count', (SELECT count(*) FROM ord WHERE handed_over_at IS NOT NULL)),
        jsonb_build_object('key', 'reviewed', 'count', (SELECT count(*) FROM ord WHERE handed_over_at IS NOT NULL
                                                           AND EXISTS (SELECT 1 FROM public.declutter_reviews r WHERE r.order_id = ord.order_id)))
      ),
      'drops', jsonb_build_object(
        'no_offer_24h', (SELECT count(*) FROM i WHERE i.live_at <= now() - interval '24 hours'
                           AND NOT EXISTS (SELECT 1 FROM first_offer f WHERE f.item_id = i.id AND f.first_at <= i.live_at + interval '24 hours')),
        'offer_not_sold', (SELECT count(*) FROM first_offer f WHERE NOT EXISTS (SELECT 1 FROM ord WHERE ord.item_id = f.item_id)),
        'not_handed_over', (SELECT count(*) FROM ord WHERE handed_over_at IS NULL),
        'no_review', (SELECT count(*) FROM ord WHERE handed_over_at IS NOT NULL
                        AND NOT EXISTS (SELECT 1 FROM public.declutter_reviews r WHERE r.order_id = ord.order_id))
      ),
      'first_response_minutes', (SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY extract(epoch FROM f.first_at - i.live_at) / 60)
                                   FROM i JOIN first_offer f ON f.item_id = i.id),
      'first_response_sample', (SELECT count(*) FROM first_offer),
      'rehire', NULL,
      'released_cents', (SELECT COALESCE(sum(o.items_cents), 0)::bigint FROM public.declutter_orders o
                          WHERE o.is_seed IS NOT TRUE AND o.handed_over_at >= v_since),
      'parishes', '[]'::jsonb
    ) INTO v_out;
    RETURN v_out;
  END IF;
  RAISE EXCEPTION 'invalid_section' USING ERRCODE = '22023';
END;
$fn$;

REVOKE ALL ON FUNCTION public.admin_section_funnel(text, integer, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_section_funnel(text, integer, text) TO authenticated;
