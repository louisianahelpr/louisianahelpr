-- Q2807: three more job reads hide jobs across a block, in both directions: the landing teaser, a member's public
-- profile page, and the instant job match.
--
-- 20261115063613 made "Jobs near you" and the Browse map drop a job whose poster blocked the viewer or whom the viewer
-- blocked. Its lh-authz-rls review found three more reads that never looked at user_blocks:
--   1. get_public_open_jobs (the landing teaser; signed-in members call it too). Returns no poster id, so no client
--      can drop the row.
--   2. public_profile_by_handle (/u/<handle>): listed the page owner's open jobs to a member the owner had blocked.
--      Only the open-jobs list (and job_count, its length) is filtered; the page itself stays public, as before.
--   3. enqueue_instant_job_match (service role, called by the instant-job-match edge function and the webhook).
--      The edge function filters blocks before it calls, and deliver_job_match drops a blocked pair at send time,
--      but the SQL itself queued the row and spent one of its 20 slots on it. Now a blocked pair is skipped before
--      anything is queued, so a blocked pair is never matched whoever the caller is.
--
-- Change: each function restated from its NEWEST definition (1 and 2: 20261114234033_guests_read_masked_job_text.sql,
-- guest title masking kept; 3: 20261009171601_job_alerts_reach_every_member.sql) with ONE added condition each. The
-- signatures, return shapes, REVOKE/GRANT lines and settings are byte-identical; COMMENTs survive CREATE OR REPLACE.
-- A guest (auth.uid() NULL) matches no user_blocks row, so the guest teaser and guest profile page are unchanged.
--
-- Proof: src/test/pglite/teaserProfileMatchHideBlocked.pglite.mjs (applied 3x; NEW_MIGRATION=skip is red).
-- Guard: src/test/rankedJobsHideBlocked.test.ts.
-- REPLAY-SAFETY: CREATE OR REPLACE FUNCTION with the same signatures; REVOKE/GRANT are idempotent. Every table and
-- function these bodies read exists before 20261009171601 / 20261114234033, which sort earlier.

-- 1. get_public_open_jobs: 20261114234033's definition (guest title mask kept), plus the block filter.
CREATE OR REPLACE FUNCTION public.get_public_open_jobs(p_limit integer DEFAULT 6)
 RETURNS TABLE(id uuid, title text, category text, location text, budget numeric, date_needed date, is_urgent boolean, is_boosted boolean)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
 SET "TimeZone" TO 'America/Chicago'
AS $function$
  SELECT j.id,
         -- Guest copy (20261114234033): a signed-out caller reads the title with contact details masked.
         CASE WHEN (SELECT auth.uid()) IS NULL THEN public.mask_guest_contact(j.title) ELSE j.title END AS title,
         j.category::text,
         public.mask_job_location(j.location) AS location,
         j.budget, j.date_needed, j.is_urgent,
         (j.boost_expires_at IS NOT NULL AND j.boost_expires_at > now()) AS is_boosted
  FROM public.jobs j
  WHERE (j.status = 'open' OR (j.status = 'accepted' AND j.is_group_job IS TRUE AND public.crew_spots_open(j.id) > 0))
    -- A series visit is re-offered only inside its series (20260927015010).
    AND j.parent_job_id IS NULL
    -- Ownership. Mirrors open_jobs_browse (20260902152714).
    AND j.customer_id IS NOT NULL
    -- Funding. Mirrors open_jobs_browse / get_ranked_open_jobs /
    -- get_open_jobs_for_map.
    AND j.payment_status = ANY (ARRAY['escrow'::text, 'payout_pending'::text, 'released'::text, 'held'::text])
    -- Credentials, on the shared rule. A signed-out visitor is tier 0.
    AND (
      COALESCE(j.credential_tier, 0) = 0
      OR COALESCE((SELECT public.get_user_credential_tier((SELECT auth.uid()))), 0) >= j.credential_tier
    )
    -- The seed switch. Same expression the other three surfaces use.
    AND (NOT j.is_seed OR NOT public.seed_jobs_hidden_publicly())
    AND j.date_needed IS NOT NULL
    -- Q2408: a window job stays on the landing teaser until its window's LAST day.
    AND public.job_offer_cutoff(COALESCE(j.date_window_end, j.date_needed), j.start_time) > now()
    AND (j.offered_to_helper_id IS NULL OR j.direct_offer_status <> 'pending')
    -- BD-002: Early Access, on the SAME shared authority the other three
    -- discovery surfaces use. No offered_to_helper_id escape hatch here: the
    -- line above already withholds every job under a live direct offer.
    AND j.created_at <= public.early_access_cutoff()
    -- Q1411: not while the poster is under an open ban settlement review.
    AND NOT EXISTS (SELECT 1 FROM public.ban_settlement_queue q WHERE q.user_id = j.customer_id AND q.review_state = 'open')
    -- Blocks, either direction (20261115064940): a signed-in member never sees a job whose poster blocked them or
    -- whom they blocked. The teaser returns no poster id, so the client cannot drop it. A guest (auth.uid() NULL)
    -- matches no row, so the guest teaser and its masked title are unchanged.
    AND NOT EXISTS (
      SELECT 1 FROM public.user_blocks b
       WHERE (b.blocker_id = (SELECT auth.uid()) AND b.blocked_id = j.customer_id)
          OR (b.blocker_id = j.customer_id AND b.blocked_id = (SELECT auth.uid()))
    )
  ORDER BY
    (j.boost_expires_at IS NOT NULL AND j.boost_expires_at > now()) DESC,
    j.created_at DESC
  LIMIT GREATEST(COALESCE(p_limit, 6), 1);
$function$;

REVOKE ALL ON FUNCTION public.get_public_open_jobs(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_public_open_jobs(integer) TO anon, authenticated, service_role;

-- 2. public_profile_by_handle: 20261114234033's definition (guest title mask kept), plus the block filter on its open jobs.
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
               -- Guest copy (20261114234033): a signed-out caller reads the title with contact details masked.
               'title', CASE WHEN (SELECT auth.uid()) IS NULL THEN public.mask_guest_contact(j.title) ELSE j.title END,
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
         -- Blocks, either direction (20261115064940): a signed-in viewer the page's owner blocked, or who blocked the
         -- owner, gets no open jobs (and job_count 0, counted from this list). A guest matches no row.
         AND NOT EXISTS (
           SELECT 1 FROM public.user_blocks b
            WHERE (b.blocker_id = (SELECT auth.uid()) AND b.blocked_id = j.customer_id)
               OR (b.blocker_id = j.customer_id AND b.blocked_id = (SELECT auth.uid()))
         )
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

-- 3. enqueue_instant_job_match: 20261009171601's definition, plus the block skip.
CREATE OR REPLACE FUNCTION public.enqueue_instant_job_match(p_job_id uuid, p_matches jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_job public.jobs%ROWTYPE;
  m jsonb;
  v_uid uuid;
  v_id uuid;
  v_eligible integer := 0;
  v_queued integer := 0;
  v_already integer := 0;
  v_sent integer := 0;
  v_limit CONSTANT integer := 20;
BEGIN
  IF p_matches IS NULL OR jsonb_typeof(p_matches) <> 'array' THEN
    RAISE EXCEPTION 'p_matches must be a JSON array';
  END IF;

  -- FOR SHARE: the gate below decides what is queued, so the job cannot be
  -- hired, cancelled or unfunded mid-scan. The webhook calls this after the
  -- funding transaction has committed; a sweep that meets this lock gets
  -- lock_not_available (NOWAIT) and retries its row next minute.
  SELECT * INTO v_job FROM public.jobs WHERE id = p_job_id FOR SHARE;
  -- FOUND must be read here: PERFORM below resets it to true.
  IF NOT FOUND THEN
    RETURN jsonb_build_object('eligible', 0, 'queued', 0, 'already', 0, 'sent_now', 0);
  END IF;
  -- Two runs for one job (a Stripe redelivery racing the webhook, or the
  -- poster's own call) insert the same (user, job) keys in an order the
  -- scorer does not fix; FOR SHARE does not serialise them. One at a time.
  PERFORM pg_advisory_xact_lock(hashtextextended('enqueue_instant_job_match:' || p_job_id::text, 0));

  FOR m IN
    SELECT e.value FROM jsonb_array_elements(p_matches) WITH ORDINALITY AS e(value, ord) ORDER BY e.ord
  LOOP
    EXIT WHEN v_eligible >= v_limit;
    v_uid := NULLIF(m->>'user_id', '')::uuid;
    CONTINUE WHEN v_uid IS NULL OR NOT public.job_announceable_to(v_job, v_uid);
    -- Blocks, either direction (20261115064940): a member in a block with the poster is never matched. Before, the
    -- row was queued (taking one of the 20 slots) and only dropped at delivery by deliver_job_match.
    CONTINUE WHEN EXISTS (
      SELECT 1 FROM public.user_blocks b
       WHERE (b.blocker_id = v_job.customer_id AND b.blocked_id = v_uid)
          OR (b.blocker_id = v_uid AND b.blocked_id = v_job.customer_id)
    );
    -- An in-app path only: '/x...', never '//host' or '/\host' (both read as
    -- protocol-relative by browsers) or a URL.
    IF NULLIF(m->>'title', '') IS NULL OR NULLIF(m->>'message', '') IS NULL
       OR COALESCE(m->>'link', '') !~ '^/[A-Za-z0-9]' OR strpos(m->>'link', '://') > 0 THEN
      RAISE EXCEPTION 'match for % has no title, message or in-app link', v_uid;
    END IF;
    v_eligible := v_eligible + 1;

    v_id := NULL;
    INSERT INTO public.job_match_queue (user_id, job_id, source, notify_at, title, message, link, send_email)
    VALUES (v_uid, v_job.id, 'instant', public.early_access_visible_at(v_uid, v_job.created_at),
            m->>'title', m->>'message', m->>'link', true)
    -- Q723: a row an error dropped is queued again with this copy; any other
    -- row (queued, sent, digested, or dropped for a reason) still wins.
    ON CONFLICT (user_id, job_id) DO UPDATE
       SET source = 'instant', notify_at = EXCLUDED.notify_at, title = EXCLUDED.title,
           message = EXCLUDED.message, link = EXCLUDED.link, send_email = true,
           status = 'queued', drop_reason = NULL, settled_at = NULL, attempts = 0, retry_after = NULL
     WHERE public.job_match_queue.status = 'dropped'
       AND public.job_match_queue.drop_reason LIKE 'error:%'
    RETURNING id INTO v_id;

    IF v_id IS NULL THEN
      -- Q392 dedupe: already queued or settled for this (job, user).
      v_already := v_already + 1;
      CONTINUE;
    END IF;
    v_queued := v_queued + 1;

    -- Already in this user's feed: send now. A send that cannot get its locks
    -- (or raises) leaves the row queued for the every-minute sweep.
    IF public.early_access_visible_at(v_uid, v_job.created_at) <= now() THEN
      BEGIN
        IF public.deliver_job_match(v_id) THEN
          v_sent := v_sent + 1;
        END IF;
      EXCEPTION
        WHEN lock_not_available OR deadlock_detected OR serialization_failure THEN
          -- Transient: not an attempt. The sweep sends it next minute.
          NULL;
        WHEN OTHERS THEN
          -- Q723: this is attempt 1. The sweep retries after 5 minutes.
          UPDATE public.job_match_queue
             SET attempts = attempts + 1,
                 retry_after = now() + interval '5 minutes'
           WHERE id = v_id AND status = 'queued';
          INSERT INTO public.error_logs (severity, message, tags)
          VALUES ('warning', 'job match send failed, will retry: ' || SQLERRM,
                  jsonb_build_object('source', 'job-match-queue' || CASE WHEN COALESCE(v_job.is_seed, false) THEN '-seed' ELSE '' END,
                                     'area', 'notifications', 'seed', COALESCE(v_job.is_seed, false),
                                     'attempt', 1, 'job_id', p_job_id, 'user_id', v_uid));
      END;
    END IF;
  END LOOP;

  RETURN jsonb_build_object('eligible', v_eligible, 'queued', v_queued, 'already', v_already, 'sent_now', v_sent);
END;
$function$;

REVOKE ALL ON FUNCTION public.enqueue_instant_job_match(uuid, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.enqueue_instant_job_match(uuid, jsonb) TO service_role;
