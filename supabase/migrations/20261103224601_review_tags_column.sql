-- Q1088: one-tap review tags get their own column (reviews.tags) instead of being joined onto the end of
-- reviews.feedback as ", On time, Great work". Additive: rows written before this keep their tags inside feedback
-- (the review card still peels them with splitReviewTags); new rows hold the prose in feedback and the tags here.
-- Every reader shows public.review_text(feedback, tags), which rebuilds the text the form used to store
-- ("prose, Tag, Tag"), so no screen changes.
--
-- The CHECK names every tag the form has ever offered (src/components/reviewPanel/types.ts HELPER_QUICK_TAGS,
-- POSTER_QUICK_TAGS, RETIRED_QUICK_TAGS; guard src/test/reviewTagsColumn.test.ts keeps the two lists equal). A tag the
-- form stops offering stays in this list: stored rows hold it. Free text never goes here, so the contact-leak and
-- moderation checks that read feedback still see everything a member typed.

ALTER TABLE public.reviews ADD COLUMN IF NOT EXISTS tags text[] NOT NULL DEFAULT '{}'::text[];

ALTER TABLE public.reviews DROP CONSTRAINT IF EXISTS reviews_tags_known;
ALTER TABLE public.reviews ADD CONSTRAINT reviews_tags_known CHECK (
  cardinality(tags) <= 19
  AND array_position(tags, NULL) IS NULL
  AND tags <@ ARRAY['On time', 'Great work', 'Friendly', 'Fair price', 'Would hire again', 'Clear about the job', 'Approved quickly', 'Would work again', 'Great communicator', 'Quality work', 'Very professional', 'Highly recommend', 'Friendly & helpful', 'Clear instructions', 'Job as described', 'Respectful', 'Easy to work with', 'Would work with again', 'Paid fast']::text[]
);

COMMENT ON COLUMN public.reviews.tags IS
  'Q1088: the one-tap tags the reviewer picked, from the form''s fixed list (CHECK reviews_tags_known). Rows before 20261103 keep them at the end of feedback; show public.review_text(feedback, tags).';

-- The text a review shows: the prose, then its tags, joined by ", " (the shape the form stored before Q1088).
CREATE OR REPLACE FUNCTION public.review_text(p_feedback text, p_tags text[])
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public'
AS $fn$
  SELECT CASE
    WHEN coalesce(cardinality(p_tags), 0) = 0 THEN p_feedback
    ELSE concat_ws(', ', nullif(btrim(p_feedback), ''), array_to_string(p_tags, ', '))
  END;
$fn$;
REVOKE ALL ON FUNCTION public.review_text(text, text[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.review_text(text, text[]) TO anon, authenticated, service_role;

-- get_public_profile_reviews: restated verbatim from 20261021131322_member_names_first_and_initial.sql (prod prosrc
-- md5 edcf53d77dba361c34dbfb967e0fda1f, 2026-11-03); feedback -> public.review_text(r.feedback, r.tags).
CREATE OR REPLACE FUNCTION public.get_public_profile_reviews(p_user_id uuid, p_limit integer DEFAULT 20, p_offset integer DEFAULT 0)
 RETURNS TABLE(id uuid, rating integer, feedback text, created_at timestamp with time zone, reviewer_name text, job_category text, response_text text, response_at timestamp with time zone, total_count bigint)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  WITH target AS (
    SELECT p.user_id
    FROM public.profiles p
    WHERE (p.user_id = p_user_id OR p.id = p_user_id)
      AND (
        (
          p.email_verified
          AND (p.ban_status IS NULL OR p.ban_status NOT IN ('temp_banned', 'permanently_banned'))
          -- Q552: the same seed clause get_safe_profiles carries.
          AND (p.is_seed IS NOT TRUE OR NOT (SELECT public.seed_hidden_from_caller()))
        )
        OR p.user_id = auth.uid()
      )
    -- DISAMBIGUATE, don't take row 0 blind. `user_id` and `id` are two key
    -- spaces over one table, and on prod today a single uuid is one member's
    -- auth id AND a different member's profiles.id (20260828030738 fixed the
    -- same trap in get_safe_profiles). A user_id hit always wins; the id hit
    -- is only the fallback Messages needs.
    ORDER BY (p.user_id = p_user_id) DESC
    LIMIT 1
  ),
  visible AS (
    SELECT
      r.id, r.rating,
      public.review_text(r.feedback, r.tags) AS feedback, r.created_at, r.reviewer_id, r.response_text, r.response_at,
      j.category AS job_category
    FROM target t
    JOIN public.reviews r ON r.reviewee_id = t.user_id
    JOIN public.jobs j ON j.id = r.job_id
    WHERE r.status = 'published'
      AND r.feedback_visible_at IS NOT NULL
      AND r.feedback_visible_at <= now()
      AND j.status <> 'cancelled'
      -- Q552: the reviews read policy's seed clause (your own list keeps them).
      AND (t.user_id = auth.uid() OR NOT public.seed_review_hidden(r.reviewer_id, r.reviewee_id, r.job_id))
  )
  SELECT
    v.id,
    v.rating,
    v.feedback,
    v.created_at,
    -- Reviewer identity is masked by the SAME rule get_safe_profiles applies:
    -- approved and not banned, else NULL and the client renders "a neighbor".
    -- Only the display name crosses; no avatar, no id, no contact field.
    (
      SELECT public.display_name_for_viewer(rp.full_name, rp.user_id) FROM public.profiles rp
      WHERE rp.user_id = v.reviewer_id
        AND rp.email_verified
        AND (rp.ban_status IS NULL OR rp.ban_status NOT IN ('temp_banned', 'permanently_banned'))
      LIMIT 1
    ) AS reviewer_name,
    -- CATEGORY, never the job title. Titles are free text and routinely carry
    -- a street, a business or a surname; "lawn_care" carries none of that and
    -- is what the reviews filter groups by anyway.
    v.job_category,
    v.response_text,
    v.response_at,
    -- Window count so pagination has a true denominator without a second
    -- round trip that would hit the same RLS wall.
    COUNT(*) OVER () AS total_count
  FROM visible v
  ORDER BY v.created_at DESC
  LIMIT GREATEST(COALESCE(p_limit, 20), 0)
  OFFSET GREATEST(COALESCE(p_offset, 0), 0);
$function$;
REVOKE ALL ON FUNCTION public.get_public_profile_reviews(uuid, integer, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_public_profile_reviews(uuid, integer, integer) TO authenticated, service_role;

-- public_profile_by_handle: restated verbatim from 20261101041833_public_profile_by_handle.sql (prod prosrc md5
-- 33d09658955f33759b773ce71276b395, 2026-11-03); the review list's feedback -> public.review_text(rv.feedback, rv.tags).
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
BEGIN
  IF v_handle = '' OR length(v_handle) > 30 THEN
    RETURN NULL;
  END IF;

  SELECT p.user_id, p.full_name, p.avatar_url, p.created_at, p.handle INTO v_p
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
       LIMIT 24
    ) l;

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
         AND public.job_offer_cutoff(j.date_needed, j.start_time) > now()
         AND (j.expires_at IS NULL OR j.expires_at > now())
         AND (j.offered_to_helper_id IS NULL OR j.direct_offer_status IS DISTINCT FROM 'pending')
         AND NOT EXISTS (SELECT 1 FROM public.ban_settlement_queue q
                          WHERE q.user_id = j.customer_id AND q.review_state = 'open')
       ORDER BY j.date_needed
       LIMIT 24
    ) o;

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
       ORDER BY rv.created_at DESC
       LIMIT 10
    ) r;

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
       LIMIT 24
    ) wq;

  RETURN jsonb_build_object(
    'handle', v_p.handle,
    'name', public.member_display_name(v_p.full_name),
    'photo_url', v_p.avatar_url,
    'member_since', v_p.created_at,
    'stats', coalesce(v_stats, '{}'::jsonb),
    'listings', v_listings,
    'jobs', v_jobs,
    'helpr', jsonb_build_object('jobs_done', v_done, 'categories', v_categories, 'reviews', v_reviews),
    'wanted', v_wanted);
END;
$function$;

REVOKE ALL ON FUNCTION public.public_profile_by_handle(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.public_profile_by_handle(text) TO anon, authenticated, service_role;
