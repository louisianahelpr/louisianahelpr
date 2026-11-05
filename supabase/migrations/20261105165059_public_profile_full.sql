-- Owner requests 11-05 on the shareable profile (/u/<handle>): "the link doesn't show all items listed", "not my full
-- profile", "a full profile showing everything".
--   - public_profile_by_handle returns EVERY live listing (500 at most) and listing_count, open jobs and Wanted up to
--     100, and the public-safe profile fields get_safe_profiles already gives anon (bio, town, skills, Recent work
--     photos, verified license/insurance badges, the business name only with one).
-- Body: the newest definition (20261104084501_apply_and_notices_read_date_window.sql) verbatim plus those changes.
--   - L4 (owner 11-05): a review between two accounts of one person (the same phone) never shows on the page and never
--     counts in its review count or stars; M2: helpr.review_total and up to 100 reviews.
--   - L7 (owner 11-05: search engines OPT-IN per person, default off): profiles.show_in_search, the member's own switch
--     (column-level GRANT UPDATE, like share_job_photos and show_near_you); public_profile_by_handle returns it.
-- REPLAY-SAFE: ADD COLUMN IF NOT EXISTS; CREATE OR REPLACE; grants restated.

ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS show_in_search boolean NOT NULL DEFAULT false;
COMMENT ON COLUMN public.profiles.show_in_search IS
  'Owner 11-05: the member opts in to search engines indexing /u/<handle>. Default false (noindex). Self-writable.';
GRANT UPDATE (show_in_search) ON public.profiles TO authenticated;


-- L4 (owner 11-05): two accounts of one person = the same phone (normalize_phone_for_ban, the ban-evasion rule's own
-- match). Measured 2026-11-05: lexi-l's only published review came from her own admin account with the same phone.
CREATE OR REPLACE FUNCTION public.profile_review_same_person(p_reviewer uuid, p_reviewee uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO public, pg_temp
AS $function$
  SELECT EXISTS (
    SELECT 1
      FROM public.profiles a
      JOIN public.profiles b ON b.user_id = p_reviewee
     WHERE a.user_id = p_reviewer
       AND a.phone IS NOT NULL
       AND b.phone IS NOT NULL
       AND public.normalize_phone_for_ban(a.phone) <> ''
       AND public.normalize_phone_for_ban(a.phone) = public.normalize_phone_for_ban(b.phone));
$function$;

REVOKE ALL ON FUNCTION public.profile_review_same_person(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.profile_review_same_person(uuid, uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.public_profile_by_handle(p_handle text)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
SET "TimeZone" TO 'America/Chicago'
AS $function$
DECLARE
  v_handle text := lower(btrim(coalesce(p_handle, '')));
  v_p record;
  v_stats jsonb;
  v_listings jsonb;
  v_jobs jsonb;
  v_reviews jsonb;
  v_categories jsonb;
  v_done integer;
  v_wanted jsonb;
  v_declutter boolean;
  v_wanted_on boolean;
  v_listing_count integer;
  v_job_count integer;
  v_review_total integer;
  v_review_avg numeric;
BEGIN
  IF v_handle = '' OR length(v_handle) > 30 THEN
    RETURN NULL;
  END IF;

  SELECT p.user_id, p.full_name, p.avatar_url, p.created_at, p.handle, p.show_in_search,
         p.bio, p.location, p.skills, p.portfolio_urls,
         p.is_licensed, p.license_status, p.is_insured, p.insurance_status, p.business_name INTO v_p
    FROM public.profiles p
   WHERE p.handle = v_handle
      OR (p.handle IS NOT NULL
          AND p.user_id = (SELECT r.user_id FROM public.profile_handles_retired r
                            WHERE r.handle = v_handle AND r.user_id IS NOT NULL))
   ORDER BY (p.handle = v_handle) DESC
   LIMIT 1;
  IF v_p.user_id IS NULL THEN
    RETURN NULL;
  END IF;
  -- Review 2026-11-01: banned in any form, restricted (out of Declutter), deleted, unverified,
  -- seed, test or under 18 -> no page.
  IF NOT EXISTS (SELECT 1 FROM public.profiles p
                  WHERE p.user_id = v_p.user_id
                    AND p.email_verified
                    AND p.ban_status IS DISTINCT FROM 'banned'
                    AND p.ban_status IS DISTINCT FROM 'temp_banned'
                    AND p.ban_status IS DISTINCT FROM 'permanently_banned'
                    AND p.is_seed IS NOT TRUE
                    AND p.anonymized_at IS NULL)
     OR public.declutter_member_out(v_p.user_id)
     OR COALESCE(public.member_under_18(v_p.user_id), true)
     OR public.is_test_member(v_p.user_id) THEN
    RETURN NULL;
  END IF;

  SELECT jsonb_build_object(
           'review_count', s.review_count,
           'avg_rating', s.avg_rating,
           'completed_jobs_as_helper', s.completed_jobs_as_helper,
           'completed_jobs_total', s.completed_jobs_total,
           'posted_jobs_total', s.posted_jobs_total,
           'on_time_rate', s.on_time_rate,
           'repeat_hire_percent', s.repeat_hire_percent,
           'is_id_verified', s.is_id_verified,
           'is_background_checked', s.is_background_checked)
    INTO v_stats
    FROM public.get_public_profile_stats(ARRAY[v_p.user_id]) s
   WHERE s.user_id = v_p.user_id
   LIMIT 1;

  v_declutter := public.declutter_open_to_guests();
  -- Wanted posts only while their own switch is open to everyone too (it is testers-only until then).
  v_wanted_on := v_declutter AND EXISTS (SELECT 1 FROM public.feature_switches s
                                          WHERE s.key = 'declutter_wanted' AND s.audience = 'everyone');

  SELECT coalesce(jsonb_agg(x ORDER BY x->>'live_at' DESC), '[]'::jsonb) INTO v_listings
    FROM (
      SELECT jsonb_build_object(
               'id', i.id,
               'title', i.title,
               'price_cents', i.current_price_cents,
               'area_label', i.area_label,
               'live_at', coalesce(i.live_at, i.created_at),
               'photo_id', (SELECT ph.id FROM public.declutter_item_photos ph
                             WHERE ph.item_id = i.id ORDER BY ph.position LIMIT 1)) AS x
        FROM public.declutter_items i
       WHERE v_declutter
         AND i.seller_id = v_p.user_id
         AND i.status = 'live'
         AND NOT i.seller_hidden
         AND i.is_seed IS NOT TRUE
         AND NOT public.declutter_seller_out(v_p.user_id)
       ORDER BY coalesce(i.live_at, i.created_at) DESC
       LIMIT 500
    ) l;

  -- Owner request 11-05 ("the link doesn't show all items listed"): the page said nothing past the first 24. Every
  -- live item now comes back (500 at most; 201 measured at 4 ms on prod), and the true count under the same rules.
  SELECT count(*)::integer INTO v_listing_count
    FROM public.declutter_items i
   WHERE v_declutter
     AND i.seller_id = v_p.user_id
     AND i.status = 'live'
     AND NOT i.seller_hidden
     AND i.is_seed IS NOT TRUE
     AND NOT public.declutter_seller_out(v_p.user_id);

  SELECT coalesce(jsonb_agg(x ORDER BY x->>'date_needed'), '[]'::jsonb) INTO v_jobs
    FROM (
      SELECT jsonb_build_object(
               'id', j.id,
               'title', j.title,
               'category', j.category::text,
               'town', public.mask_job_location(j.location),
               'budget', j.budget,
               'date_needed', j.date_needed) AS x
        FROM public.jobs j
       WHERE j.customer_id = v_p.user_id
         AND j.status = 'open'
         AND j.parent_job_id IS NULL
         AND j.is_seed IS NOT TRUE
         AND j.payment_status = ANY (ARRAY['escrow'::text, 'payout_pending'::text, 'released'::text, 'held'::text])
         AND COALESCE(j.credential_tier, 0) = 0
         AND j.date_needed IS NOT NULL
         AND public.job_offer_cutoff(COALESCE(j.date_window_end, j.date_needed), j.start_time) > now()
         AND (j.expires_at IS NULL OR j.expires_at > now())
         AND (j.offered_to_helper_id IS NULL OR j.direct_offer_status IS DISTINCT FROM 'pending')
         AND NOT EXISTS (SELECT 1 FROM public.ban_settlement_queue q
                          WHERE q.user_id = j.customer_id AND q.review_state = 'open')
       ORDER BY j.date_needed
       LIMIT 100
    ) o;
  v_job_count := jsonb_array_length(v_jobs);

  SELECT count(*)::integer,
         coalesce(jsonb_agg(DISTINCT j.category::text) FILTER (WHERE j.category IS NOT NULL), '[]'::jsonb)
    INTO v_done, v_categories
    FROM public.jobs j
   WHERE j.helper_id = v_p.user_id
     AND j.status = 'completed'
     AND j.is_seed IS NOT TRUE
     AND NOT public.is_test_member(j.customer_id);

  -- Re-review 2026-11-01: the list is read here, not through get_public_profile_reviews, whose seed rule reads the
  -- caller (seed_hidden_from_caller), so test reviews showed to an admin, to test accounts, and to everyone while
  -- the seed switch is off. Same rules as the stats' review count (get_public_profile_stats.visible_reviews):
  -- published and visible, not on a cancelled or seed job, not from or about a test member; for every caller.
  SELECT coalesce(jsonb_agg(jsonb_build_object(
           'rating', r.rating,
           'feedback', r.feedback,
           'created_at', r.created_at,
           'reviewer_name', public.member_display_name(r.reviewer_full_name),
           'job_category', r.job_category,
           'response_text', r.response_text,
           'response_at', r.response_at) ORDER BY r.created_at DESC), '[]'::jsonb)
    INTO v_reviews
    FROM (
      SELECT rv.rating, public.review_text(rv.feedback, rv.tags) AS feedback, rv.created_at, rv.response_text, rv.response_at, j.category::text AS job_category,
             -- The reviewer's public name only under the same rules as a page of their own (review 2026-11-01):
             -- verified, never banned in any form, not out of Declutter, not deleted, not under 18; else "A neighbor".
             (SELECT rp.full_name FROM public.profiles rp
               WHERE rp.user_id = rv.reviewer_id
                 AND rp.email_verified
                 AND rp.ban_status IS DISTINCT FROM 'banned'
                 AND rp.ban_status IS DISTINCT FROM 'temp_banned'
                 AND rp.ban_status IS DISTINCT FROM 'permanently_banned'
                 AND rp.anonymized_at IS NULL
                 AND NOT public.declutter_member_out(rp.user_id)
                 AND NOT COALESCE(public.member_under_18(rp.user_id), true)
               LIMIT 1) AS reviewer_full_name
        FROM public.reviews rv
        JOIN public.jobs j ON j.id = rv.job_id
       WHERE rv.reviewee_id = v_p.user_id
         AND rv.status = 'published'
         AND rv.feedback_visible_at IS NOT NULL
         AND rv.feedback_visible_at <= now()
         AND j.status <> 'cancelled'
         AND j.is_seed IS NOT TRUE
         AND NOT public.is_test_member(rv.reviewer_id)
         AND NOT public.is_test_member(rv.reviewee_id)
         AND NOT public.profile_review_same_person(rv.reviewer_id, rv.reviewee_id)
       ORDER BY rv.created_at DESC
       LIMIT 100
    ) r;

  -- Owner 11-05 (L4): a review between two accounts of one person (the same phone) never shows and never counts.
  -- M2: the true total under the list's own rules, and the stars from the same rows, so count, stars and list agree.
  SELECT count(*)::integer, round(avg(rt.rating)::numeric, 2)
    INTO v_review_total, v_review_avg
    FROM public.reviews rt
    JOIN public.jobs jt ON jt.id = rt.job_id
   WHERE rt.reviewee_id = v_p.user_id
     AND rt.status = 'published'
     AND rt.feedback_visible_at IS NOT NULL
     AND rt.feedback_visible_at <= now()
     AND jt.status <> 'cancelled'
     AND jt.is_seed IS NOT TRUE
     AND NOT public.is_test_member(rt.reviewer_id)
     AND NOT public.is_test_member(rt.reviewee_id)
     AND NOT public.profile_review_same_person(rt.reviewer_id, rt.reviewee_id);

  SELECT coalesce(jsonb_agg(x ORDER BY x->>'created_at' DESC), '[]'::jsonb) INTO v_wanted
    FROM (
      SELECT jsonb_build_object(
               'id', w.id,
               'what', w.what,
               'category', w.category,
               'max_price_cents', w.max_price_cents,
               'created_at', w.created_at) AS x
        FROM public.declutter_wanted w
       WHERE v_wanted_on
         AND w.user_id = v_p.user_id
         AND w.status = 'open'
         AND w.public
         AND w.removed_at IS NULL
         AND w.expires_at > now()
         AND w.is_seed IS NOT TRUE
         -- The same poster rules as the Wanted browse (20261030225143).
         AND NOT public.declutter_member_out(w.user_id)
         AND NOT public.member_under_18(w.user_id)
         AND NOT public.declutter_seller_hidden(w.user_id)
       ORDER BY w.created_at DESC
       LIMIT 100
    ) wq;

  RETURN jsonb_build_object(
    'handle', v_p.handle,
    'name', public.member_display_name(v_p.full_name),
    'photo_url', v_p.avatar_url,
    'member_since', v_p.created_at,
    -- Owner request 11-05 ("it should be a full profile showing everything"): the fields get_safe_profiles already
    -- gives any caller, signed out included, under the same rules: bio, town (profiles.location holds a town name),
    -- skills, Recent work photos (public avatars bucket), and the license/insurance badges; the business name only
    -- with a verified badge, exactly as get_safe_profiles.
    'bio', nullif(btrim(coalesce(v_p.bio, '')), ''),
    'town', nullif(btrim(coalesce(v_p.location, '')), ''),
    'skills', nullif(btrim(coalesce(v_p.skills, '')), ''),
    'portfolio_urls', to_jsonb(coalesce(v_p.portfolio_urls, ARRAY[]::text[])),
    'licensed', (v_p.is_licensed AND v_p.license_status = 'verified'),
    'insured', (v_p.is_insured AND v_p.insurance_status = 'verified'),
    'business_name', CASE
                       WHEN (v_p.is_licensed AND v_p.license_status = 'verified')
                         OR (v_p.is_insured AND v_p.insurance_status = 'verified')
                       THEN v_p.business_name
                     END,
    'listing_count', coalesce(v_listing_count, 0),
    'show_in_search', coalesce(v_p.show_in_search, false),
    'job_count', coalesce(v_job_count, 0),
    -- The page's count and stars are this page's reviews (same-person ones out), not get_public_profile_stats' own.
    'stats', coalesce(v_stats, '{}'::jsonb)
             || jsonb_build_object('review_count', coalesce(v_review_total, 0), 'avg_rating', v_review_avg),
    'listings', v_listings,
    'jobs', v_jobs,
    'helpr', jsonb_build_object('jobs_done', v_done, 'categories', v_categories, 'reviews', v_reviews,
                               'review_total', coalesce(v_review_total, 0)),
    'wanted', v_wanted);
END;
$function$;

REVOKE ALL ON FUNCTION public.public_profile_by_handle(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.public_profile_by_handle(text) TO anon, authenticated, service_role;
