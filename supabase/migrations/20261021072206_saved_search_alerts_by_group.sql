-- Saved-search alerts match the Browse GROUPS (owner 2026-10-21).
--
-- The Jobs filter sheet now offers the 8 groups Post a job opens on
-- (src/lib/jobCategoryGroups.ts JOB_CATEGORY_GROUPS: home, yard,
-- moving_errands, auto, pets, events, trades, other), so a saved search can
-- hold a GROUP id in saved_searches.category, not only one category. The two
-- Jobs readers compared it with `s.category = NEW.category::text`, which no
-- job of a multi-category group ever equals: a "Home" search would save,
-- re-apply and never alert, a silent failure.
--
-- 1. public.job_category_group(job_category): the group a category sits in,
--    the same table as GROUP_OF in src/lib/jobCategoryGroups.ts
--    (src/test/savedSearchAlertsByGroup.test.ts holds the two equal, both
--    ways, for every enum value). A value missing from the table gets NULL,
--    so it still matches a search for that exact category and no group.
-- 2. public.saved_search_category_matches(search_category, job_category): NULL
--    (any category), the exact category (every row saved before the groups:
--    prod held 2, 'handyman' and 'storm_prep', 2026-10-21), or the category's
--    group. 'events' and 'other' are both a group id and a category value;
--    each of those groups holds exactly that category, so either reading is
--    the same.
-- 3. notify_saved_searches_on_new_job and saved_search_new_counts are the
--    live bodies of 20261021042132 with ONLY their category line changed to
--    that rule. Their grants are restated as they were.
--
-- Both helpers are plain STABLE SQL (an enum-to-text cast is STABLE) over their arguments (no table read,
-- not SECURITY DEFINER), called from the two definer functions; members never
-- need them, so EXECUTE is revoked FROM PUBLIC, anon, authenticated.
-- Replay-safe: CREATE OR REPLACE only.

CREATE OR REPLACE FUNCTION public.job_category_group(p_category public.job_category)
RETURNS text
LANGUAGE sql
STABLE
SET search_path TO 'public', 'pg_temp'
AS $fn$
  SELECT CASE
    WHEN p_category::text IN ('cleaning', 'handyman', 'assembly', 'painting', 'pressure_washing', 'declutter_help', 'storm_prep') THEN 'home'
    WHEN p_category::text IN ('yard_work') THEN 'yard'
    WHEN p_category::text IN ('moving', 'errands', 'delivery') THEN 'moving_errands'
    WHEN p_category::text IN ('auto_repair') THEN 'auto'
    WHEN p_category::text IN ('pet_care') THEN 'pets'
    WHEN p_category::text IN ('events') THEN 'events'
    WHEN p_category::text IN ('electrical', 'plumbing', 'hvac', 'roofing', 'welding', 'carpentry', 'flooring', 'concrete_masonry', 'fencing', 'appliance_repair') THEN 'trades'
    WHEN p_category::text IN ('other') THEN 'other'
  END
$fn$;
REVOKE ALL ON FUNCTION public.job_category_group(public.job_category) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.job_category_group(public.job_category) TO service_role;

CREATE OR REPLACE FUNCTION public.saved_search_category_matches(p_search_category text, p_category public.job_category)
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path TO 'public', 'pg_temp'
AS $fn$
  SELECT p_search_category IS NULL
      OR p_search_category = p_category::text
      OR p_search_category = public.job_category_group(p_category)
$fn$;
REVOKE ALL ON FUNCTION public.saved_search_category_matches(text, public.job_category) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.saved_search_category_matches(text, public.job_category) TO service_role;

CREATE OR REPLACE FUNCTION public.notify_saved_searches_on_new_job()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  match_record RECORD;
  v_visible_at TIMESTAMPTZ;
BEGIN
  IF NEW.status <> 'open'
     -- A series visit is re-offered only inside its series (20260927015010):
     -- a vacated visit going accepted -> open while funded fires this
     -- trigger's UPDATE path and must not alert saved searches.
     OR NEW.parent_job_id IS NOT NULL
     OR COALESCE(NEW.payment_status, '') <> ALL (ARRAY['escrow'::text, 'payout_pending'::text, 'released'::text])
  THEN
    RETURN NEW;
  END IF;

  IF NEW.offered_to_helper_id IS NOT NULL
     AND COALESCE(NEW.direct_offer_status, 'pending') NOT IN ('declined', 'expired')
  THEN
    RETURN NEW;
  END IF;

  IF COALESCE(NEW.is_seed, false) AND public.seed_jobs_hidden_publicly() THEN
    RETURN NEW;
  END IF;

  FOR match_record IN
    SELECT
      s.user_id,
      (ARRAY_AGG(s.name ORDER BY s.created_at DESC))[1] AS search_name,
      ARRAY_AGG(s.id)                                   AS matched_search_ids
    FROM public.saved_searches s
    JOIN public.profiles p ON p.user_id = s.user_id
    LEFT JOIN public.notification_preferences np ON np.user_id = s.user_id
    WHERE s.notify_enabled = true
      -- Q2275: one table holds every section's saved searches; only the
      -- Jobs ones match a job.
      AND s.section = 'jobs'
      AND p.email_verified
      AND COALESCE(p.ban_status, 'active') = 'active'
      AND s.user_id <> NEW.customer_id
      -- These rows are type 'job_match'; the category switch is the master
      -- over every saved search. Unset means on.
      AND COALESCE(np.job_matches, true) IS TRUE
      -- Q2275: "Pause all alerts" keeps the searches and stops every alert.
      AND NOT COALESCE(np.saved_searches_paused, false)
      -- A search's category is a Browse group id ("home", the 8 groups Post a
      -- job and the filter sheet share) or, from before the groups, one
      -- category. Either matches through the one rule below.
      AND public.saved_search_category_matches(s.category, NEW.category)
      AND (s.parish IS NULL OR s.parish = NEW.parish)
      AND (s.max_budget IS NULL OR NEW.budget <= s.max_budget)
      AND (s.min_budget IS NULL OR NEW.budget >= s.min_budget)
      AND (
        s.query IS NULL
        OR btrim(s.query) = ''
        OR strpos(lower(NEW.title), lower(btrim(s.query))) > 0
        OR strpos(lower(COALESCE(NEW.description, '')), lower(btrim(s.query))) > 0
      )
      AND (
        s.location_keyword IS NULL
        OR s.location_keyword ~ '^nearby:'
        OR strpos(lower(COALESCE(NEW.location, '')), lower(s.location_keyword)) > 0
      )
      AND (
        s.radius_miles IS NULL
        OR (
          p.latitude IS NOT NULL AND p.longitude IS NOT NULL
          AND NEW.latitude IS NOT NULL AND NEW.longitude IS NOT NULL
          AND public.miles_between(p.latitude, p.longitude, NEW.latitude, NEW.longitude) <= s.radius_miles
        )
        OR (
          (p.latitude IS NULL OR p.longitude IS NULL
           OR NEW.latitude IS NULL OR NEW.longitude IS NULL)
          AND p.parish IS NOT NULL
          AND NEW.parish IS NOT NULL
          AND p.parish = NEW.parish
        )
      )
      -- ST-011: the hourly throttle stops notification spam. The digest that
      -- once bypassed it is retired (Q1657), so it binds every match.
      AND (
        s.last_notified_at IS NULL
        OR s.last_notified_at < now() - interval '1 hour'
      )
    GROUP BY s.user_id
  LOOP
    -- V-008: queued, never sent here, even when already visible. This
    -- runs inside the funding write; the sweep sends once the job is in
    -- THIS user's feed.
    v_visible_at := public.early_access_visible_at(match_record.user_id, NEW.created_at);
    INSERT INTO public.saved_search_alert_queue (user_id, job_id, notify_at, search_name, matched_search_ids)
    VALUES (match_record.user_id, NEW.id, v_visible_at, match_record.search_name, match_record.matched_search_ids)
    ON CONFLICT (user_id, job_id) DO NOTHING;
  END LOOP;

  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.notify_saved_searches_on_new_job() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.notify_saved_searches_on_new_job() TO service_role;

CREATE OR REPLACE FUNCTION public.saved_search_new_counts()
RETURNS TABLE (search_id uuid, new_count integer)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
  SELECT
    s.id,
    CASE s.section
      WHEN 'jobs' THEN (
        SELECT count(*)::integer
          FROM public.open_jobs_browse j
         WHERE j.created_at > COALESCE(s.last_seen_at, s.created_at)
           AND j.customer_id IS DISTINCT FROM s.user_id
           AND NOT EXISTS (SELECT 1 FROM public.user_blocks b
                            WHERE (b.blocker_id = s.user_id AND b.blocked_id = j.customer_id)
                               OR (b.blocker_id = j.customer_id AND b.blocked_id = s.user_id))
           AND public.saved_search_category_matches(s.category, j.category)
           AND (s.parish IS NULL OR s.parish = j.parish)
           AND (s.max_budget IS NULL OR j.budget <= s.max_budget)
           AND (s.min_budget IS NULL OR j.budget >= s.min_budget)
           AND (s.query IS NULL OR btrim(s.query) = ''
                OR strpos(lower(j.title), lower(btrim(s.query))) > 0
                OR strpos(lower(COALESCE(j.description, '')), lower(btrim(s.query))) > 0)
           AND (s.location_keyword IS NULL OR s.location_keyword ~ '^nearby:'
                OR strpos(lower(COALESCE(j.location, '')), lower(s.location_keyword)) > 0)
           AND (s.radius_miles IS NULL
                OR (p.latitude IS NOT NULL AND p.longitude IS NOT NULL
                    AND j.latitude IS NOT NULL AND j.longitude IS NOT NULL
                    AND public.miles_between(p.latitude, p.longitude, j.latitude, j.longitude) <= s.radius_miles)
                OR ((p.latitude IS NULL OR p.longitude IS NULL OR j.latitude IS NULL OR j.longitude IS NULL)
                    AND p.parish IS NOT NULL AND j.parish IS NOT NULL AND p.parish = j.parish))
      )
      WHEN 'declutter' THEN (
        SELECT count(*)::integer
          FROM public.declutter_items i
         WHERE i.status = 'live'
           AND i.live_at > COALESCE(s.last_seen_at, s.created_at)
           AND i.seller_id <> s.user_id
           -- The declutter_items SELECT policy (20261020033623), for the caller:
           AND (SELECT public.feature_enabled_for('declutter'))
           AND NOT public.declutter_seller_hidden(i.seller_id)
           AND (NOT i.is_seed OR NOT (SELECT public.seed_hidden_in_discovery()))
           AND NOT EXISTS (SELECT 1 FROM public.user_blocks b
                            WHERE (b.blocker_id = s.user_id AND b.blocked_id = i.seller_id)
                               OR (b.blocker_id = i.seller_id AND b.blocked_id = s.user_id))
           AND (s.category IS NULL OR s.category = i.category)
           AND (s.max_budget IS NULL OR i.current_price_cents <= s.max_budget * 100)
           AND (s.min_budget IS NULL OR i.current_price_cents >= s.min_budget * 100)
           AND (s.query IS NULL OR btrim(s.query) = ''
                OR strpos(lower(i.title), lower(btrim(s.query))) > 0)
           AND (s.radius_miles IS NULL
                OR (p.latitude IS NOT NULL AND p.longitude IS NOT NULL
                    AND public.miles_between(p.latitude, p.longitude, i.area_lat::numeric, i.area_lng::numeric) <= s.radius_miles))
      )
      ELSE 0
    END
  FROM public.saved_searches s
  LEFT JOIN public.profiles p ON p.user_id = s.user_id
  WHERE s.user_id = (SELECT auth.uid());
$fn$;
REVOKE ALL ON FUNCTION public.saved_search_new_counts() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.saved_search_new_counts() TO authenticated;
