-- Test data never counts in any number (owner rule, via lead 2026-10-29, builder 62).
--
-- What was broken: the stat and count functions below counted test records.
-- Test accounts (profiles.is_seed, public.test_accounts) and the jobs they post
-- (jobs.is_seed) were part of every "jobs done", on-time %, repeat-hire %,
-- view count, reach count, admin leaderboard and admin total. On prod
-- (read-only, 2026-10-29) 469 of 488 jobs are test jobs, and 58 job views come
-- from test accounts, so a real member's job showed views from test accounts.
-- The only exclusion that existed (get_public_profile_stats' review clause) hung
-- off the launch switch seed_jobs_hidden_publicly, so with the switch off test
-- reviews still counted, and a member's own stats always kept them.
--
-- The rule: a test record never counts in a TOTAL, whoever is asking, whatever
-- the launch switch says. A test member may still see their own items in their
-- own LISTS (lists are not touched here: the admin "recent texts" list, the
-- pending shop items list and the rental listings list still show everything;
-- only their totals drop test rows).
--
-- How: one helper, public.is_test_member(uuid), says whether a user is a test
-- account (profiles.is_seed or a public.test_accounts row). Every aggregate
-- below drops a row when its job is_seed or a counted party is a test member.
-- Each body is restated from the EFFECTIVE prod definition
-- (pg_get_functiondef, 2026-10-29), changing only the exclusion. Signatures and
-- grants are unchanged (CREATE OR REPLACE keeps the ACL).
--
-- Guard: src/test/statAggregatesExcludeTestData.test.ts (every aggregate in a
-- public or admin stat function references is_seed / is_test_member or carries
-- an allowlisted reason). PGlite: src/test/pglite/testDataNeverCounts.pglite.mjs.

-- ---------------------------------------------------------------------------
-- The helper. SECURITY INVOKER and no client grant: it is called only from the
-- SECURITY DEFINER functions below, which run as their owner.
CREATE OR REPLACE FUNCTION public.is_test_member(p_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path TO 'public'
AS $fn$
  SELECT p_user_id IS NOT NULL AND (
    EXISTS (SELECT 1 FROM public.profiles p WHERE p.user_id = p_user_id AND p.is_seed IS TRUE)
    OR EXISTS (SELECT 1 FROM public.test_accounts t WHERE t.user_id = p_user_id)
  );
$fn$;
REVOKE ALL ON FUNCTION public.is_test_member(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.is_test_member(uuid) TO service_role;

-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_helper_completed_counts(p_user_ids uuid[])
 RETURNS TABLE(user_id uuid, completed_jobs bigint)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  -- A job counts for the Helpr who did it: the single Helpr (jobs.helper_id)
  -- or, on a crew (no lead, Q407), every member on its roster (Q728). A user
  -- with none is absent, as before. Test data never counts (b62): not a test
  -- job, not a test poster's job, and a test Helpr has no count.
  SELECT u.id, COUNT(DISTINCT j.id)::bigint
  FROM unnest(p_user_ids) AS u(id)
  JOIN public.jobs j
    ON j.status = 'completed'
   AND (j.helper_id = u.id
        OR (j.is_group_job IS TRUE AND EXISTS (
              SELECT 1 FROM public.group_job_helpers g WHERE g.job_id = j.id AND g.helper_id = u.id)))
  WHERE j.is_seed IS NOT TRUE
    AND NOT public.is_test_member(j.customer_id)
    AND NOT public.is_test_member(u.id)
  GROUP BY u.id;
$function$;

-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_helper_on_time_percents(p_user_ids uuid[])
 RETURNS TABLE(user_id uuid, on_time_percent numeric)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  WITH timing_rows AS (
    SELECT
      helper_id,
      helper_arrived_at,
      (date_needed + COALESCE(start_time, '00:00:00'::time))::timestamp AS scheduled_start
    FROM jobs
    WHERE helper_id = ANY(p_user_ids)
      AND status = 'completed'
      AND helper_arrived_at IS NOT NULL
      AND date_needed IS NOT NULL
      -- Test data never counts (b62).
      AND is_seed IS NOT TRUE
      AND NOT public.is_test_member(customer_id)
      AND NOT public.is_test_member(helper_id)
  ),
  helper_stats AS (
    SELECT
      helper_id,
      COUNT(*) AS total_with_timing,
      COUNT(*) FILTER (
        WHERE helper_arrived_at::timestamp - scheduled_start <= INTERVAL '10 minutes'
      ) AS on_time_count
    FROM timing_rows
    GROUP BY helper_id
    HAVING COUNT(*) >= 5
  )
  SELECT
    helper_id AS user_id,
    ROUND(100.0 * on_time_count / NULLIF(total_with_timing, 0)) AS on_time_percent
  FROM helper_stats;
$function$;

-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_helper_repeat_hire_percents(p_user_ids uuid[])
 RETURNS TABLE(user_id uuid, repeat_hire_percent numeric)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  WITH customer_counts AS (
    SELECT helper_id, customer_id, COUNT(*) AS jobs_together
    FROM jobs
    WHERE helper_id = ANY(p_user_ids)
      AND status = 'completed'
      -- Test data never counts (b62).
      AND is_seed IS NOT TRUE
      AND NOT public.is_test_member(customer_id)
      AND NOT public.is_test_member(helper_id)
    GROUP BY helper_id, customer_id
  ),
  helper_stats AS (
    SELECT
      helper_id,
      COUNT(*) AS total_unique_customers,
      COUNT(*) FILTER (WHERE jobs_together > 1) AS repeat_customers
    FROM customer_counts
    GROUP BY helper_id
    HAVING COUNT(*) >= 3
  )
  SELECT
    helper_id AS user_id,
    ROUND(100.0 * repeat_customers / NULLIF(total_unique_customers, 0)) AS repeat_hire_percent
  FROM helper_stats;
$function$;

-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_user_repeat_hire_percent(p_user_id uuid)
 RETURNS numeric
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  WITH customer_counts AS (
    SELECT customer_id, COUNT(*) AS jobs_together
    FROM jobs
    WHERE helper_id = p_user_id
      AND status = 'completed'
      -- Test data never counts (b62).
      AND is_seed IS NOT TRUE
      AND NOT public.is_test_member(customer_id)
      AND NOT public.is_test_member(helper_id)
    GROUP BY customer_id
  )
  SELECT CASE
    WHEN COUNT(*) = 0 THEN NULL
    ELSE ROUND(100.0 * COUNT(*) FILTER (WHERE jobs_together > 1) / COUNT(*))
  END
  FROM customer_counts;
$function$;

-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_helper_tiers(p_limit integer DEFAULT 25)
 RETURNS TABLE(user_id uuid, full_name text, parish text, avatar_url text, total_reviews integer, recent_reviews integer, avg_rating numeric, recent_avg_rating numeric, completed_jobs integer, growth_score numeric, tier text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  WITH visible_reviews AS (
    -- The reviews that count toward a public rating (Q321): the same three
    -- predicates as get_public_profile_stats.visible_reviews. Test data never
    -- counts (b62): not on a test job, not from a test reviewer.
    SELECT r.id, r.reviewee_id, r.rating, r.created_at
    FROM public.reviews r
    JOIN public.jobs j ON j.id = r.job_id
    WHERE r.status = 'published'
      AND r.feedback_visible_at IS NOT NULL
      AND r.feedback_visible_at <= now()
      AND j.status <> 'cancelled'
      AND j.is_seed IS NOT TRUE
      AND NOT public.is_test_member(r.reviewer_id)
  ),
  stats AS (
    SELECT p.user_id, p.full_name, p.parish, p.avatar_url,
      COUNT(DISTINCT r.id)::int AS total_reviews,
      COUNT(DISTINCT r.id) FILTER (WHERE r.created_at > now() - interval '30 days')::int AS recent_reviews,
      COALESCE(AVG(r.rating)::numeric(10,2), 0) AS avg_rating,
      COALESCE(AVG(r.rating) FILTER (WHERE r.created_at > now() - interval '30 days')::numeric(10,2), 0) AS recent_avg_rating,
      COUNT(DISTINCT j.id) FILTER (WHERE j.status = 'completed' AND j.is_seed IS NOT TRUE
                                     AND NOT public.is_test_member(j.customer_id))::int AS completed_jobs
    FROM public.profiles p
    LEFT JOIN visible_reviews r ON r.reviewee_id = p.user_id
    -- Q729: the single Helpr's jobs and (a crew has no lead) the crew jobs this
    -- person is on.
    LEFT JOIN public.jobs j
      ON j.helper_id = p.user_id
      OR (j.is_group_job IS TRUE AND EXISTS (
            SELECT 1 FROM public.group_job_helpers g WHERE g.job_id = j.id AND g.helper_id = p.user_id))
    WHERE (EXISTS (SELECT 1 FROM public.jobs jj WHERE jj.helper_id = p.user_id)
           OR EXISTS (SELECT 1 FROM public.group_job_helpers gg WHERE gg.helper_id = p.user_id))
      AND p.email_verified
      AND COALESCE(p.ban_status, 'active') = 'active'
      -- Test data never counts (b62): a test account is not on the leaderboard.
      AND p.is_seed IS NOT TRUE
      AND NOT public.is_test_member(p.user_id)
      -- server-side admin authorization: non-admins get zero rows, not the data
      AND public.has_role(auth.uid(), 'admin')
    GROUP BY p.user_id, p.full_name, p.parish, p.avatar_url
  )
  SELECT user_id, full_name, parish, avatar_url, total_reviews, recent_reviews, avg_rating, recent_avg_rating, completed_jobs,
    (recent_reviews * COALESCE(recent_avg_rating, 0))::numeric(10,2) AS growth_score,
    CASE
      WHEN total_reviews >= 25 AND avg_rating >= 4.7 THEN 'Elite'
      WHEN total_reviews >= 10 AND avg_rating >= 4.5 THEN 'Verified'
      WHEN recent_reviews >= 3 AND recent_avg_rating >= 4.5 THEN 'Rising Star'
      WHEN total_reviews >= 1 THEN 'Active'
      ELSE 'New'
    END AS tier
  FROM stats ORDER BY growth_score DESC, total_reviews DESC LIMIT p_limit;
$function$;

-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_job_view_counts(p_job_ids uuid[])
 RETURNS TABLE(job_id uuid, view_count bigint)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  -- Test data never counts (b62): a test account's view is not a view.
  SELECT jv.job_id, COUNT(DISTINCT jv.viewer_id)::bigint
  FROM job_views jv
  JOIN jobs j ON j.id = jv.job_id
  WHERE jv.job_id = ANY(p_job_ids)
    AND j.customer_id = auth.uid()
    AND NOT public.is_test_member(jv.viewer_id)
  GROUP BY jv.job_id;
$function$;

-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_neighbor_hire_count(p_helper_id uuid, p_job_id uuid)
 RETURNS integer
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  WITH scope AS (
    SELECT a.job_latitude AS latitude, a.job_longitude AS longitude
    FROM public.applications a
    JOIN public.jobs j ON j.id = a.job_id
    WHERE a.job_id = p_job_id
      AND a.helper_id = p_helper_id
      AND j.customer_id = auth.uid()
      AND a.job_latitude  IS NOT NULL
      AND a.job_longitude IS NOT NULL
  ), hits AS (
    SELECT COUNT(DISTINCT j.customer_id)::integer AS n
    FROM public.jobs j
    JOIN public.profiles p ON p.user_id = j.customer_id
    CROSS JOIN scope s
    WHERE (j.helper_id = p_helper_id
           -- Q729: a crew member's completed crew jobs count too.
           OR (j.is_group_job IS TRUE AND EXISTS (
                 SELECT 1 FROM public.group_job_helpers g WHERE g.job_id = j.id AND g.helper_id = p_helper_id)))
      AND j.status = 'completed'
      -- Test data never counts (b62): no test job, no test neighbour, no test Helpr.
      AND j.is_seed IS NOT TRUE
      AND p.is_seed IS NOT TRUE
      AND NOT public.is_test_member(j.customer_id)
      AND NOT public.is_test_member(p_helper_id)
      AND p.latitude  IS NOT NULL
      AND p.longitude IS NOT NULL
      AND public.miles_between(p.latitude, p.longitude, s.latitude, s.longitude) <= 1
  )
  SELECT CASE WHEN COALESCE((SELECT n FROM hits), 0) >= 2
              THEN (SELECT n FROM hits)
              ELSE 0 END;
$function$;

-- ---------------------------------------------------------------------------
-- Replay-safe: require_feature() arrives in 20261012031120; a from-scratch
-- rebuild always has it by now, but plpgsql resolves it at call time anyway.
CREATE OR REPLACE FUNCTION public.get_applicant_category_counts(p_job_id uuid)
 RETURNS TABLE(helper_id uuid, category_completed bigint)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  PERFORM public.require_feature('applicant_proof');
  RETURN QUERY
  WITH job AS (
    SELECT j.id, j.category
    FROM public.jobs j
    WHERE j.id = p_job_id AND (SELECT auth.uid()) IS NOT NULL AND j.customer_id = (SELECT auth.uid())
  ),
  applicants AS (
    SELECT DISTINCT a.helper_id AS hid
    FROM public.applications a JOIN job ON a.job_id = job.id
    WHERE a.helper_id IS NOT NULL
  )
  SELECT ap.hid, COUNT(DISTINCT d.id)::bigint
  FROM applicants ap
  CROSS JOIN job
  JOIN public.jobs d
    ON d.status = 'completed'
   AND d.category = job.category
   AND (d.helper_id = ap.hid
        OR (d.is_group_job IS TRUE AND EXISTS (
              SELECT 1 FROM public.group_job_helpers g WHERE g.job_id = d.id AND g.helper_id = ap.hid)))
   -- Test data never counts (b62).
   AND d.is_seed IS NOT TRUE
   AND NOT public.is_test_member(d.customer_id)
   AND NOT public.is_test_member(ap.hid)
  GROUP BY ap.hid;
END;
$function$;

-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_job_match_reach(p_job_id uuid)
 RETURNS integer
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_uid uuid := (SELECT auth.uid());
BEGIN
  PERFORM public.require_feature('job_reach');
  IF v_uid IS NULL OR NOT EXISTS (SELECT 1 FROM public.jobs j WHERE j.id = p_job_id AND j.customer_id = v_uid) THEN
    RETURN 0;
  END IF;
  -- Test data never counts (b62): a test account reached is not reach.
  RETURN (SELECT count(DISTINCT q.user_id)::integer
            FROM public.job_match_queue q
           WHERE q.job_id = p_job_id AND q.status = 'sent'
             AND NOT public.is_test_member(q.user_id));
END;
$function$;

-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_sms_status()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF auth.uid() IS NULL OR NOT COALESCE(public.has_role(auth.uid(), 'admin'::app_role), false) THEN
    RAISE EXCEPTION 'admin_only' USING ERRCODE = '42501';
  END IF;
  -- Test data never counts (b62): the totals drop test accounts; the
  -- "recent" list still shows every text.
  RETURN jsonb_build_object(
    'audience', (SELECT audience FROM public.feature_switches WHERE key = 'sms_alerts'),
    'opted_in', (SELECT count(*) FROM public.sms_consent WHERE sms_opt_in AND NOT public.is_test_member(user_id)),
    'pending', (SELECT count(*) FROM public.sms_consent WHERE pending_phone IS NOT NULL AND pending_since > now() - interval '24 hours' AND NOT public.is_test_member(user_id)),
    'waiting', (SELECT count(*) FROM public.sms_messages WHERE status = 'pending' AND NOT public.is_test_member(user_id)),
    'sent_24h', (SELECT count(*) FROM public.sms_messages WHERE status = 'sent' AND created_at > now() - interval '24 hours' AND NOT public.is_test_member(user_id)),
    'failed_24h', (SELECT count(*) FROM public.sms_messages WHERE status = 'failed' AND created_at > now() - interval '24 hours' AND NOT public.is_test_member(user_id)),
    'recent', COALESCE((
      SELECT jsonb_agg(r ORDER BY r.created_at DESC) FROM (
        SELECT created_at, category, kind, status, reason, provider_error_code AS error_code
          FROM public.sms_messages ORDER BY created_at DESC LIMIT 20) r), '[]'::jsonb)
  );
END;
$function$;

-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_list_signup_leads()
 RETURNS TABLE(email text, created_at timestamptz, reminder_sent_at timestamptz, completed_at timestamptz, total_count bigint)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path = ''
AS $function$
BEGIN
  IF NOT COALESCE(public.has_role(auth.uid(), 'admin'::public.app_role), false) THEN
    RAISE EXCEPTION 'admin_only' USING ERRCODE = '42501';
  END IF;

  -- Test data never counts (b62): the list keeps every lead, the total drops
  -- a test account's email (is_seed_email: a profile with is_seed).
  RETURN QUERY
  SELECT l.email,
         l.created_at,
         l.reminder_sent_at,
         l.completed_at,
         count(*) FILTER (WHERE NOT public.is_seed_email(l.email)) OVER () AS total_count
    FROM public.signup_leads l
   ORDER BY l.created_at DESC, l.id
   LIMIT 500;
END;
$function$;

-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_list_category_suggestions(p_status text DEFAULT 'pending'::text)
 RETURNS TABLE(id uuid, area text, suggestion text, status text, created_at timestamp with time zone, suggester_name text, same_count bigint, reviewed_at timestamp with time zone, admin_note text)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  PERFORM public.require_feature('suggest_category');
  IF NOT COALESCE(public.has_role((SELECT auth.uid()), 'admin'::app_role), false) THEN
    RAISE EXCEPTION 'not_authorized' USING ERRCODE = '42501';
  END IF;
  IF p_status IS NULL OR p_status NOT IN ('pending', 'approved', 'declined') THEN
    RAISE EXCEPTION 'invalid_status' USING ERRCODE = '22023';
  END IF;
  -- Test data never counts (b62): "N people asked for this" drops test accounts.
  RETURN QUERY
    SELECT s.id, s.suggested_in, s.suggestion, s.status, s.created_at,
           p.full_name::text,
           (SELECT count(*) FROM public.category_suggestions o
             WHERE o.suggested_in = s.suggested_in AND o.normalized = s.normalized
               AND NOT public.is_test_member(o.user_id)),
           s.reviewed_at, s.admin_note
      FROM public.category_suggestions s
      LEFT JOIN public.profiles p ON p.user_id = s.user_id
     WHERE s.status = p_status
     ORDER BY s.created_at DESC
     LIMIT 200;
END;
$function$;

-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.rentals_admin_listings(p_query text DEFAULT NULL::text, p_open_offset integer DEFAULT 0, p_taken_offset integer DEFAULT 0)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_uid uuid := (SELECT auth.uid());
  v_q text := lower(btrim(coalesce(p_query, '')));
  v_open_off integer := greatest(coalesce(p_open_offset, 0), 0);
  v_taken_off integer := greatest(coalesce(p_taken_offset, 0), 0);
BEGIN
  IF v_uid IS NULL OR NOT public.has_role(v_uid, 'admin'::public.app_role) THEN
    RAISE EXCEPTION 'not_authorized' USING ERRCODE = '42501';
  END IF;
  IF char_length(v_q) > 100 THEN
    RAISE EXCEPTION 'bad_query' USING ERRCODE = '22023';
  END IF;
  -- Test data never counts (b62): the lists keep every row, the two totals
  -- drop a test owner's listings and properties.
  RETURN (
    WITH open_rows AS (
      SELECT l.id, l.kind, l.status, l.headline, l.slug, l.published_at, rp.label AS property_label, rp.city, rp.zip_code,
             public.is_test_member(l.owner_id) AS is_test
        FROM public.rental_listings l
        JOIN public.rental_properties rp ON rp.id = l.property_id
       WHERE l.status IN ('live', 'paused')
         AND (v_q = '' OR l.slug = v_q OR rp.zip_code = v_q
              OR strpos(lower(l.headline), v_q) > 0 OR strpos(lower(rp.label), v_q) > 0)
    ), taken_rows AS (
      SELECT rp.id AS property_id, rp.label AS property_label, rp.city, rp.zip_code,
             rp.listings_taken_down_reason AS reason, rp.listings_taken_down_at AS taken_down_at,
             public.is_test_member(rp.owner_id) AS is_test
        FROM public.rental_properties rp
       WHERE rp.listings_taken_down_at IS NOT NULL
         AND (v_q = '' OR rp.zip_code = v_q OR strpos(lower(rp.label), v_q) > 0
              OR EXISTS (SELECT 1 FROM public.rental_listings l
                          WHERE l.property_id = rp.id AND (l.slug = v_q OR strpos(lower(l.headline), v_q) > 0)))
    )
    SELECT jsonb_build_object(
      'page_size', 25,
      'open_total', (SELECT count(*) FROM open_rows WHERE NOT is_test),
      'open', COALESCE((SELECT jsonb_agg(to_jsonb(x) - 'is_test' ORDER BY x.published_at DESC NULLS LAST, x.id)
                          FROM (SELECT * FROM open_rows ORDER BY published_at DESC NULLS LAST, id
                                 OFFSET v_open_off LIMIT 25) x), '[]'::jsonb),
      'taken_down_total', (SELECT count(*) FROM taken_rows WHERE NOT is_test),
      'taken_down', COALESCE((SELECT jsonb_agg(to_jsonb(y) - 'is_test' ORDER BY y.taken_down_at DESC, y.property_id)
                                FROM (SELECT * FROM taken_rows ORDER BY taken_down_at DESC, property_id
                                       OFFSET v_taken_off LIMIT 25) y), '[]'::jsonb)));
END;
$function$;

-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.shops_admin_pending_items()
 RETURNS TABLE(item_id uuid, shop_id uuid, shop_name text, owner_id uuid, kind text, subtype text, title text, description text, price_cents integer, submitted_at timestamptz, ai_checked_at timestamptz, ai_flag_reason text, text_flag_reason text, approved_items integer, photo_paths text[], owner_last_rejected_at timestamptz, owner_last_rejection_note text)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  PERFORM public.require_feature('shops');
  IF NOT public.has_role((SELECT auth.uid()), 'admin'::public.app_role) THEN
    RAISE EXCEPTION 'not_admin' USING ERRCODE = '42501';
  END IF;
  IF public.is_caller_banned() THEN
    RAISE EXCEPTION 'account_restricted' USING ERRCODE = '42501';
  END IF;
  -- Test data never counts (b62): "approved items" drops test items; the
  -- pending list itself keeps every item.
  RETURN QUERY
    SELECT i.id, i.shop_id, s.name, i.owner_id, i.kind, i.subtype, i.title, i.description, i.price_cents,
           i.submitted_at, p.ai_checked_at, p.ai_flag_reason, p.text_flag_reason,
           (SELECT count(*)::integer FROM public.shop_items a
             WHERE a.shop_id = i.shop_id AND a.admin_approved_at IS NOT NULL AND a.is_seed IS NOT TRUE),
           (SELECT COALESCE(array_agg(ph.storage_path ORDER BY ph.position), ARRAY[]::text[])
              FROM public.shop_item_photos ph WHERE ph.item_id = i.id),
           rj.created_at, rj.details->>'note'
      FROM public.shop_items i
      JOIN public.shops s ON s.id = i.shop_id
      LEFT JOIN public.shop_item_private p ON p.item_id = i.id
      LEFT JOIN LATERAL (
        SELECT l.created_at, l.details FROM public.admin_audit_log l
         WHERE l.action = 'shop_item_rejected' AND l.details->>'owner_id' = i.owner_id::text
           AND l.created_at > now() - interval '30 days'
         ORDER BY l.created_at DESC LIMIT 1) rj ON true
     WHERE i.status = 'pending_review'
     ORDER BY i.submitted_at NULLS LAST, i.id
     LIMIT 200;
END;
$function$;


-- ---------------------------------------------------------------------------
-- Restated from 20261021074131 (identical to prod's pg_get_functiondef, read
-- 2026-10-29) with the exclusions above. The public gate on `target` is kept:
-- a test profile is still visible to whom it was, its numbers are now real only.
CREATE OR REPLACE FUNCTION public.get_public_profile_stats(p_user_ids uuid[])
 RETURNS TABLE(user_id uuid, review_count integer, avg_rating numeric, poster_review_count integer, poster_avg_rating numeric, completed_jobs_as_helper integer, completed_jobs_total integer, posted_jobs_total integer, jobs_total integer, cancelled_jobs integer, cancellation_rate numeric, on_time_sample integer, on_time_rate numeric, revision_sample integer, revision_rate numeric, repeat_client_sample integer, repeat_hire_percent numeric, is_id_verified boolean, has_stripe_account boolean, is_background_checked boolean, has_pending_credentials boolean)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  WITH target AS (
    SELECT p.user_id, p.idv_status,
           p.stripe_account_id, p.background_check_status
    FROM public.profiles p
    WHERE (p.user_id = ANY(p_user_ids) OR p.id = ANY(p_user_ids))
      AND (
        -- Public gate, character-for-character the one get_safe_profiles uses.
        (
          p.email_verified
          AND (p.ban_status IS NULL OR p.ban_status NOT IN ('temp_banned', 'permanently_banned'))
          -- Q552: the same seed clause get_safe_profiles carries.
          AND (p.is_seed IS NOT TRUE OR NOT (SELECT public.seed_hidden_from_caller()))
        )
        -- …or it is your own row. Your own preview must not lie to you while
        -- your email is unverified, which is the same reason the client keeps a
        -- self-select fallback next to get_safe_profiles.
        OR p.user_id = auth.uid()
      )
  ),
  -- Reviews this person RECEIVED that are genuinely public: published, past
  -- the anti-retaliation reveal, and not attached to a job that ended up
  -- cancelled. That last clause is the one the client used to express as
  -- `jobs!inner(status)` — a join through a table no visitor can read, which
  -- is why it silently returned zero reviews for everyone. It is a real guard,
  -- not a no-op: the status machine in 20260504152414 allows
  -- completed -> disputed -> cancelled, so an admin resolving a
  -- post-completion dispute for the poster leaves a live review on a cancelled
  -- job. Enforced here, where `jobs` is readable, instead of there.
  visible_reviews AS (
    SELECT t.user_id, r.rating, (j.customer_id = t.user_id) AS as_poster
    FROM target t
    JOIN public.reviews r ON r.reviewee_id = t.user_id
    JOIN public.jobs j ON j.id = r.job_id
    WHERE r.status = 'published'
      AND r.feedback_visible_at IS NOT NULL
      AND r.feedback_visible_at <= now()
      AND j.status <> 'cancelled'
      -- Test data never counts (b62; replaces Q552's switch-gated clause): not on a
      -- test job, not from or about a test account, for every caller, own stats too.
      AND j.is_seed IS NOT TRUE
      AND NOT public.is_test_member(r.reviewer_id)
      AND NOT public.is_test_member(r.reviewee_id)
    UNION ALL
    -- Declutter slice 4 (row 45, lead 2026-10-15): ONE star rating across job
    -- reviews and Declutter reviews. A Declutter review counts once it is
    -- public (both sides reviewed, or 14 days after the handover: the blind
    -- rule of declutter_visible_reviews); it is never a poster review.
    SELECT t.user_id, dr.stars::integer, false
    FROM target t
    JOIN public.declutter_reviews dr ON dr.reviewee_id = t.user_id
    JOIN public.declutter_orders o ON o.id = dr.order_id
    WHERE o.status = 'handed_over'
      AND (o.handed_over_at <= now() - interval '14 days'
           OR (SELECT count(*) FROM public.declutter_reviews d2 WHERE d2.order_id = dr.order_id) = 2)
      -- Test data never counts (b62; replaces Q552's switch-gated clause).
      AND dr.is_seed IS NOT TRUE
      AND o.is_seed IS NOT TRUE
      AND NOT public.is_test_member(dr.reviewer_id)
      AND NOT public.is_test_member(dr.reviewee_id)
  ),
  review_agg AS (
    SELECT
      t.user_id,
      COUNT(v.rating)::integer AS review_count,
      ROUND(AVG(v.rating)::numeric, 2) AS avg_rating,
      COUNT(v.rating) FILTER (WHERE v.as_poster)::integer AS poster_review_count,
      ROUND(AVG(v.rating) FILTER (WHERE v.as_poster)::numeric, 2) AS poster_avg_rating
    FROM target t
    LEFT JOIN visible_reviews v ON v.user_id = t.user_id
    GROUP BY t.user_id
  ),
  -- Job counts. `jobs_total` / `cancelled_jobs` deliberately span BOTH sides
  -- of the marketplace, matching the combined denominator the profile card has
  -- always shown ("Cancelled · 3 of 12 jobs").
  job_agg AS (
    SELECT
      t.user_id,
      -- The Helpr side: the single Helpr, or (Q728) a crew member, who is joined
      -- below through the roster and is never the job's poster.
      COUNT(*) FILTER (WHERE j.customer_id IS DISTINCT FROM t.user_id AND j.status = 'completed')::integer AS completed_as_helper,
      COUNT(DISTINCT j.id) FILTER (WHERE j.status = 'completed')::integer AS completed_total,
      COUNT(*) FILTER (WHERE j.customer_id = t.user_id)::integer AS posted_total,
      COUNT(*)::integer AS jobs_total,
      COUNT(*) FILTER (WHERE j.status = 'cancelled')::integer AS cancelled_jobs
    FROM target t
    LEFT JOIN public.jobs j
      ON (j.customer_id = t.user_id OR j.helper_id = t.user_id
      -- Q728: a crew has no lead (Q407), so a crew member's jobs are found
      -- through the roster.
      OR (j.is_group_job IS TRUE AND EXISTS (
            SELECT 1 FROM public.group_job_helpers g WHERE g.job_id = j.id AND g.helper_id = t.user_id)))
      -- Test data never counts (b62). Inside the ON, so a member with no real
      -- jobs still gets their row.
      AND j.is_seed IS NOT TRUE
      AND NOT public.is_test_member(j.customer_id)
      AND NOT public.is_test_member(t.user_id)
    GROUP BY t.user_id
  ),
  -- Timing, over this person's ENTIRE completed helper history. The client
  -- version capped its sample at the 50 most recent rows purely because that
  -- was one page of a `select`; there is no reason to throw away the rest here.
  -- Q731(a), 2026-10-05: every completed job this person WORKED, the single
  -- Helpr's and (a crew has no lead, Q407) each crew job they were on, with
  -- the member's OWN arrival stamp from the roster. Timing and repeat-client
  -- both read this one set, so neither can drop crews again.
  worked AS (
    SELECT t.user_id, j.id AS job_id, j.customer_id, j.revision_count, j.helper_arrived_at,
           j.date_needed, j.start_time
    FROM target t
    JOIN public.jobs j ON j.helper_id = t.user_id AND j.status = 'completed'
      -- Test data never counts (b62).
      AND j.is_seed IS NOT TRUE AND NOT public.is_test_member(j.customer_id) AND NOT public.is_test_member(t.user_id)
    UNION ALL
    SELECT t.user_id, j.id, j.customer_id, j.revision_count, g.helper_arrived_at,
           j.date_needed, j.start_time
    FROM target t
    JOIN public.group_job_helpers g ON g.helper_id = t.user_id
    JOIN public.jobs j ON j.id = g.job_id AND j.is_group_job IS TRUE AND j.status = 'completed'
      AND j.is_seed IS NOT TRUE AND NOT public.is_test_member(j.customer_id) AND NOT public.is_test_member(t.user_id)
  ),
  -- Timing, over this person's ENTIRE completed helper history. The client
  -- version capped its sample at the 50 most recent rows purely because that
  -- was one page of a `select`; there is no reason to throw away the rest here.
  timing AS (
    SELECT
      w.user_id,
      w.revision_count,
      w.helper_arrived_at,
      -- date_needed + start_time are wall-clock LOUISIANA time, not UTC.
      ((w.date_needed::date + COALESCE(w.start_time::text, '00:00')::time)
        AT TIME ZONE 'America/Chicago') AS scheduled_at
    FROM worked w
  ),
  timing_agg AS (
    SELECT
      t.user_id,
      COUNT(ti.revision_count)::integer AS revision_sample,
      COUNT(*) FILTER (WHERE COALESCE(ti.revision_count, 0) > 0)::integer AS revised,
      COUNT(*) FILTER (WHERE ti.helper_arrived_at IS NOT NULL AND ti.scheduled_at IS NOT NULL)::integer AS on_time_sample,
      -- 10-minute grace, carried over verbatim: "on time" is a humane window,
      -- not a stopwatch.
      COUNT(*) FILTER (
        WHERE ti.helper_arrived_at IS NOT NULL
          AND ti.scheduled_at IS NOT NULL
          AND ti.helper_arrived_at <= ti.scheduled_at + interval '10 minutes'
      )::integer AS on_time_hits
    FROM target t
    LEFT JOIN timing ti ON ti.user_id = t.user_id
    GROUP BY t.user_id
  ),
  -- Repeat hire: share of this helper's distinct completed-job clients who
  -- came back. Same arithmetic as get_user_repeat_hire_percent (20260612470000),
  -- now with a sample size attached so the caller can refuse to publish it.
  repeat_clients AS (
    SELECT w.user_id, w.customer_id, COUNT(*) AS jobs_together
    FROM worked w
    WHERE w.customer_id IS NOT NULL
    GROUP BY w.user_id, w.customer_id
  ),
  repeat_agg AS (
    SELECT
      t.user_id,
      COUNT(rc.customer_id)::integer AS client_sample,
      COUNT(rc.customer_id) FILTER (WHERE rc.jobs_together > 1)::integer AS returning_clients
    FROM target t
    LEFT JOIN repeat_clients rc ON rc.user_id = t.user_id
    GROUP BY t.user_id
  ),
  cred_agg AS (
    SELECT t.user_id,
           EXISTS (
             SELECT 1 FROM public.helper_credentials hc
             WHERE hc.user_id = t.user_id AND hc.status = 'submitted'
           ) AS has_pending
    FROM target t
  )
  SELECT
    t.user_id,
    ra.review_count,
    -- NULL, never 0.0, when there is nothing to average. A zero average is a
    -- terrible review; "no reviews" is not.
    CASE WHEN ra.review_count > 0 THEN ra.avg_rating END,
    ra.poster_review_count,
    -- 3 poster reviews minimum — the floor the card already applied.
    CASE WHEN ra.poster_review_count >= 3 THEN ra.poster_avg_rating END,
    ja.completed_as_helper,
    ja.completed_total,
    ja.posted_total,
    ja.jobs_total,
    ja.cancelled_jobs,
    CASE WHEN ja.jobs_total >= 5
      THEN ROUND(100.0 * ja.cancelled_jobs / ja.jobs_total, 1) END,
    ta.on_time_sample,
    CASE WHEN ta.on_time_sample >= 5
      THEN ROUND(100.0 * ta.on_time_hits / ta.on_time_sample, 1) END,
    ta.revision_sample,
    CASE WHEN ta.revision_sample >= 5
      THEN ROUND(100.0 * ta.revised / ta.revision_sample, 1) END,
    rpa.client_sample,
    -- The 100%-from-one-client fix. 0% here is a genuine measurement across at
    -- least three clients and is published as such.
    CASE WHEN rpa.client_sample >= 3
      THEN ROUND(100.0 * rpa.returning_clients / rpa.client_sample) END,
    -- The "ID verified" BADGE (owner 2026-10-21): Stripe Identity only, the
    -- same expression get_safe_profiles.is_id_verified uses. A badge, not a gate.
    (t.idv_status IS NOT DISTINCT FROM 'verified'),
    (t.stripe_account_id IS NOT NULL),
    (t.background_check_status = 'verified'),
    ca.has_pending
  FROM target t
  JOIN review_agg ra ON ra.user_id = t.user_id
  JOIN job_agg    ja ON ja.user_id = t.user_id
  JOIN timing_agg ta ON ta.user_id = t.user_id
  JOIN repeat_agg rpa ON rpa.user_id = t.user_id
  JOIN cred_agg   ca ON ca.user_id = t.user_id;
$function$;
