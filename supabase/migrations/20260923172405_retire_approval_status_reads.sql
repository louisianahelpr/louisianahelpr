-- Q205 (b): retire the last meaning of profiles.approval_status.
--
-- Owner decisions 2026-09-23: the approval-pending and account-denied screens
-- are gone, bans are automated, and EMAIL VERIFICATION IS THE ONLY ENTRY GATE.
-- 'denied' was retired by 20260923153703. What 'approved' still meant is
-- worked out below from its writers, not assumed:
--
--   writer                               sets 'approved' when
--   sync_email_verified(_on_insert)      the auth email is confirmed (every
--                                        account holds the 'customer' role —
--                                        handle_new_user inserts it)
--   complete-signup                      the signup form is submitted
--   stripe-webhook account.updated       Connect verified + email_verified
--   stripe-idv-webhook                   Stripe Identity verified
--   admin-user-actions                   an admin action
--
-- So 'pending' = "email not confirmed AND none of the others ran yet", i.e. a
-- brand-new account that has not passed the entry gate. Every reader that
-- filtered on `= 'approved'` was asking "has this account passed the entry
-- gate?", and the fact that answers it is profiles.email_verified, the
-- trigger-maintained mirror of auth.users.email_confirmed_at — the same thing
-- ProtectedRoute gates on (user.email_confirmed_at). email_verified cannot be
-- self-written: prevent_self_escalation pins it on UPDATE and the INSERT policy
-- below pins it to false.
--
-- The one population whose visibility changes: an account that submitted the
-- signup form but never confirmed its email. It was 'approved' (so listed in
-- search, saved helpers, notification fan-outs) while ProtectedRoute kept it
-- out of every protected screen. It is now hidden until it confirms — the
-- owner's rule, applied consistently. The count is RAISEd as a NOTICE below
-- so the deploy log states it.
--
-- WHY THE COLUMN IS NOT DROPPED HERE. Three artifacts deploy independently on
-- merge (db-deploy, functions-deploy, Vercel), and the code being replaced in
-- this same commit SELECTs the column: useProfile's shared select (every
-- signed-in screen), WorkRecord, the stripe-webhook account.updated handler,
-- cleanup-abandoned-accounts, admin-delete-user. Dropping it now 400s all of
-- them for the length of the deploy window. This migration removes every SQL
-- READ and WRITE of it (functions, triggers, the INSERT policy); the column is
-- left inert and is dropped by a follow-up migration once the new edge
-- functions and bundle are live (queued in docs/OPEN.md).
--
-- Every function below is restated from its NEWEST definition with only the
-- approval_status lines changed, and its ACL restated as that definition's
-- migration left it (CREATE OR REPLACE keeps the ACL; restating it is a no-op
-- on a replay and a correction if anything drifted).

-- ── 0. Make the mirror exact before anything gates on it ──
-- email_verified has been trigger-maintained since 20260418222915, which also
-- backfilled it; this re-derives it from auth.users so a drifted row cannot
-- change anybody's visibility. No trigger reacts to email_verified.
DO $$
DECLARE
  v_fixed int := 0;
  v_hidden int := 0;
BEGIN
  IF to_regclass('auth.users') IS NOT NULL THEN
    UPDATE public.profiles p
       SET email_verified = (u.email_confirmed_at IS NOT NULL)
      FROM auth.users u
     WHERE u.id = p.user_id
       AND p.email_verified IS DISTINCT FROM (u.email_confirmed_at IS NOT NULL);
    GET DIAGNOSTICS v_fixed = ROW_COUNT;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns
              WHERE table_schema = 'public' AND table_name = 'profiles'
                AND column_name = 'approval_status') THEN
    EXECUTE $q$SELECT count(*) FROM public.profiles
                WHERE approval_status = 'approved' AND NOT email_verified$q$
       INTO v_hidden;
  END IF;
  RAISE NOTICE 'Q205b: email_verified re-derived on % row(s); % approved-but-unconfirmed row(s) leave public surfaces',
    v_fixed, v_hidden;
END $$;

-- ── public.get_safe_profiles(uuid[]) ──
CREATE OR REPLACE FUNCTION public.get_safe_profiles(user_ids uuid[])
 RETURNS TABLE(user_id uuid, full_name text, avatar_url text, bio text, location text, skills text, hourly_rate numeric, role text, subscription_tier text, portfolio_urls text[], created_at timestamp with time zone, is_id_verified boolean, is_payout_ready boolean, profile_id uuid, is_licensed boolean, license_status text, is_insured boolean, insurance_status text, business_name text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT
    p.user_id, p.full_name, p.avatar_url, p.bio, p.location,
    p.skills, p.hourly_rate,
    (
      SELECT CASE
               -- Only an admin caller may learn that someone else is an admin.
               WHEN ur.role = 'admin'::app_role
                    AND auth.uid() IS NOT NULL
                    AND has_role(auth.uid(), 'admin')
                 THEN 'admin'
               ELSE 'member'
             END
      FROM public.user_roles ur WHERE ur.user_id = p.user_id
      ORDER BY CASE ur.role WHEN 'admin'::app_role THEN 1 ELSE 2 END LIMIT 1
    ) AS role,
    -- The tier as it stands TODAY, not as the column last remembers it.
    -- This is the only route by which one member learns another's tier, and
    -- it drives Priority Placement's ranking bump plus the Pro/Elite chip and
    -- halo on the applicant card. `expire-subscriptions` nulls the column on
    -- a cron, so the raw value keeps paying out after the plan ended.
    CASE
      WHEN p.subscription_expires_at IS NOT NULL
           AND p.subscription_expires_at <= now() THEN NULL
      ELSE p.subscription_tier
    END AS subscription_tier,
    p.portfolio_urls, p.created_at,
    -- THE identity verdict, shared with get_public_profile_stats and the gates.
    public.identity_is_verified(p.idv_status, p.stripe_identity_verified) AS is_id_verified,
    -- Restored. Same expression 20260828030738 shipped.
    (p.stripe_account_id IS NOT NULL AND p.stripe_payouts_enabled) AS is_payout_ready,
    p.id AS profile_id,
    p.is_licensed, p.license_status,
    p.is_insured, p.insurance_status,
    -- Never emit an unvetted business name. The badge is the trust signal
    -- and the name is part of it, so the two go public together or not at all.
    CASE
      WHEN (p.is_licensed AND p.license_status = 'verified')
        OR (p.is_insured AND p.insurance_status = 'verified')
      THEN p.business_name
    END AS business_name
  FROM public.profiles p
  WHERE (p.user_id = ANY(user_ids) OR p.id = ANY(user_ids))
    AND p.email_verified
    AND (p.ban_status IS NULL OR p.ban_status NOT IN ('temp_banned', 'permanently_banned'));
$function$;
REVOKE ALL ON FUNCTION public.get_safe_profiles(uuid[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_safe_profiles(uuid[]) TO anon, authenticated, service_role;

-- ── public.get_public_profile_reviews(uuid,integer,integer) ──
CREATE OR REPLACE FUNCTION public.get_public_profile_reviews(
  p_user_id uuid,
  p_limit integer DEFAULT 20,
  p_offset integer DEFAULT 0
)
RETURNS TABLE(
  id uuid,
  rating integer,
  feedback text,
  created_at timestamp with time zone,
  reviewer_name text,
  job_category text,
  response_text text,
  response_at timestamp with time zone,
  total_count bigint
)
LANGUAGE sql
STABLE
SECURITY DEFINER
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
      r.feedback, r.created_at, r.reviewer_id, r.response_text, r.response_at,
      j.category AS job_category
    FROM target t
    JOIN public.reviews r ON r.reviewee_id = t.user_id
    JOIN public.jobs j ON j.id = r.job_id
    WHERE r.status = 'published'
      AND r.feedback_visible_at IS NOT NULL
      AND r.feedback_visible_at <= now()
      AND j.status <> 'cancelled'
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
      SELECT rp.full_name FROM public.profiles rp
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

-- ── public.search_profiles_by_name(text) ──
CREATE OR REPLACE FUNCTION public.search_profiles_by_name(query text)
RETURNS TABLE(
  user_id uuid,
  full_name text,
  avatar_url text
)
LANGUAGE plpgsql
VOLATILE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _uid uuid := auth.uid();
  _minute_count int;
  _day_count int;
BEGIN
  IF _uid IS NULL THEN
    RETURN;
  END IF;

  -- Log the attempt first (including short queries), then check the window
  -- — so the rate limit itself can't be bypassed by staying under the
  -- 2-character floor.
  INSERT INTO public.profile_search_rate_log (searcher_id) VALUES (_uid);

  SELECT count(*) INTO _minute_count
  FROM public.profile_search_rate_log
  WHERE searcher_id = _uid AND created_at >= now() - interval '1 minute';
  IF _minute_count > 20 THEN
    RAISE EXCEPTION 'rate_limit_minute' USING HINT = 'Too many searches — try again in a minute';
  END IF;

  SELECT count(*) INTO _day_count
  FROM public.profile_search_rate_log
  WHERE searcher_id = _uid AND created_at >= now() - interval '1 day';
  IF _day_count > 200 THEN
    RAISE EXCEPTION 'rate_limit_day' USING HINT = 'Daily search limit reached — try again tomorrow';
  END IF;

  IF length(trim(coalesce(query, ''))) < 2 THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT p.user_id, p.full_name, p.avatar_url
  FROM public.profiles p
  WHERE p.user_id <> _uid
    AND p.full_name IS NOT NULL
    AND p.full_name ILIKE '%' || trim(query) || '%'
    AND p.email_verified
    AND (p.ban_status IS NULL OR p.ban_status NOT IN ('temp_banned', 'permanently_banned'))
  ORDER BY p.full_name ASC
  LIMIT 10;
END;
$function$;
REVOKE ALL ON FUNCTION public.search_profiles_by_name(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.search_profiles_by_name(text) TO authenticated, service_role;

-- ── public.get_my_saved_helpers() ──
CREATE OR REPLACE FUNCTION public.get_my_saved_helpers()
RETURNS TABLE (
  helper_id uuid,
  full_name text,
  avatar_url text,
  bio text,
  parish text,
  skills text,
  hourly_rate numeric,
  saved_at timestamptz,
  completed_jobs_together integer,
  last_job_at timestamptz,
  private_note text,
  available_until timestamptz   -- non-null and future = helper is available right now
)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    fh.helper_id,
    p.full_name,
    p.avatar_url,
    p.bio,
    p.parish,
    p.skills,
    p.hourly_rate,
    fh.created_at AS saved_at,
    COALESCE((
      SELECT count(*)::int
      FROM public.jobs j
      WHERE j.customer_id = fh.customer_id
        AND j.helper_id = fh.helper_id
        AND j.status = 'completed'
    ), 0) AS completed_jobs_together,
    (SELECT max(COALESCE(j.poster_completed_at, j.helper_completed_at, j.updated_at))
       FROM public.jobs j
      WHERE j.customer_id = fh.customer_id
        AND j.helper_id = fh.helper_id
        AND j.status = 'completed') AS last_job_at,
    fh.private_note,
    p.available_until
  FROM public.favorite_helpers fh
  JOIN public.profiles p ON p.user_id = fh.helper_id
  WHERE fh.customer_id = auth.uid()
    AND p.email_verified
    AND COALESCE(p.ban_status, 'active') = 'active'
  ORDER BY fh.created_at DESC;
$$;
REVOKE ALL ON FUNCTION public.get_my_saved_helpers() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_my_saved_helpers() TO authenticated, service_role;

-- ── public.get_helper_tiers(integer) ──
CREATE OR REPLACE FUNCTION public.get_helper_tiers(p_limit integer DEFAULT 25)
 RETURNS TABLE(user_id uuid, full_name text, parish text, avatar_url text, total_reviews integer, recent_reviews integer, avg_rating numeric, recent_avg_rating numeric, completed_jobs integer, growth_score numeric, tier text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  WITH stats AS (
    SELECT p.user_id, p.full_name, p.parish, p.avatar_url,
      COUNT(DISTINCT r.id)::int AS total_reviews,
      COUNT(DISTINCT r.id) FILTER (WHERE r.created_at > now() - interval '30 days')::int AS recent_reviews,
      COALESCE(AVG(r.rating)::numeric(10,2), 0) AS avg_rating,
      COALESCE(AVG(r.rating) FILTER (WHERE r.created_at > now() - interval '30 days')::numeric(10,2), 0) AS recent_avg_rating,
      COUNT(DISTINCT j.id) FILTER (WHERE j.status = 'completed' AND j.helper_id = p.user_id)::int AS completed_jobs
    FROM public.profiles p
    LEFT JOIN public.reviews r ON r.reviewee_id = p.user_id
    LEFT JOIN public.jobs j ON j.helper_id = p.user_id
    WHERE EXISTS (SELECT 1 FROM public.jobs jj WHERE jj.helper_id = p.user_id)
      AND p.email_verified
      AND COALESCE(p.ban_status, 'active') = 'active'
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

-- ── public.get_parish_activity(integer) ──
CREATE OR REPLACE FUNCTION public.get_parish_activity(p_limit integer DEFAULT 5)
RETURNS TABLE(parish text, active_jobs integer, completed_jobs_30d integer, revenue_30d numeric, helper_count integer)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  WITH job_stats AS (
    SELECT COALESCE(j.parish, 'Unknown') AS parish,
      COUNT(*) FILTER (WHERE j.status IN ('open','accepted','in_progress'))::int AS active_jobs,
      COUNT(*) FILTER (WHERE j.status = 'completed' AND COALESCE(j.poster_completed_at, j.helper_completed_at, j.updated_at) > now() - interval '30 days')::int AS completed_jobs_30d,
      COALESCE(SUM(CASE WHEN j.status = 'completed' AND COALESCE(j.poster_completed_at, j.helper_completed_at, j.updated_at) > now() - interval '30 days' THEN COALESCE(j.platform_fee_amount, 0) + COALESCE(j.customer_fee_amount, 0) ELSE 0 END), 0)::numeric(10,2) AS revenue_30d
    FROM public.jobs j WHERE j.parish IS NOT NULL GROUP BY COALESCE(j.parish, 'Unknown')
  ),
  helper_stats AS (
    SELECT p.parish, COUNT(*)::int AS helper_count
    FROM public.profiles p
    WHERE EXISTS (SELECT 1 FROM public.jobs jj WHERE jj.helper_id = p.user_id)
      AND p.parish IS NOT NULL AND p.email_verified AND COALESCE(p.ban_status, 'active') = 'active'
    GROUP BY p.parish
  )
  SELECT js.parish, js.active_jobs, js.completed_jobs_30d, js.revenue_30d, COALESCE(hs.helper_count, 0) AS helper_count
  FROM job_stats js LEFT JOIN helper_stats hs ON hs.parish = js.parish
  WHERE (js.active_jobs + js.completed_jobs_30d) > 0
  ORDER BY (js.active_jobs * 2 + js.completed_jobs_30d) DESC, js.revenue_30d DESC LIMIT p_limit;
$function$;

-- ── public.notify_helpers_on_job_post() ──
CREATE OR REPLACE FUNCTION public.notify_helpers_on_job_post()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  helper_record RECORD;
  v_title TEXT;
  v_message TEXT;
  v_link TEXT;
BEGIN
  IF NEW.parish IS NULL OR NEW.status <> 'open' THEN
    RETURN NEW;
  END IF;

  -- The triggers' WHEN clauses already guarantee funded, so this is a
  -- belt-and-braces re-assertion for any future direct call.
  IF COALESCE(NEW.payment_status, '') <> ALL (ARRAY['escrow'::text, 'payout_pending'::text, 'released'::text]) THEN
    RETURN NEW;
  END IF;

  -- A job under a LIVE direct offer is addressed mail, not open-pool work.
  IF NEW.offered_to_helper_id IS NOT NULL
     AND COALESCE(NEW.direct_offer_status, 'pending') NOT IN ('declined', 'expired')
  THEN
    RETURN NEW;
  END IF;

  -- Fixtures, on the same authority the browse surfaces use.
  IF COALESCE(NEW.is_seed, false) AND public.seed_jobs_hidden_publicly() THEN
    RETURN NEW;
  END IF;

  v_title := 'New job in your parish';
  v_message := 'A new ' || COALESCE(NEW.category::text, 'job') || ' job just posted in ' || NEW.parish || ' Parish: "' || NEW.title || '"';
  v_link := '/dashboard?job=' || NEW.id::text;

  FOR helper_record IN
    WITH candidates AS (
      SELECT p2.user_id
      FROM public.profiles p2
      WHERE p2.parish = NEW.parish
        AND (
          EXISTS (SELECT 1 FROM public.applications a WHERE a.helper_id = p2.user_id)
          OR EXISTS (SELECT 1 FROM public.jobs j2 WHERE j2.helper_id = p2.user_id)
        )
    )
    SELECT DISTINCT c.user_id AS helper_id
    FROM candidates c
    JOIN public.profiles p ON p.user_id = c.user_id
    LEFT JOIN public.notification_preferences np ON np.user_id = c.user_id
    WHERE p.email_verified
      AND COALESCE(p.ban_status, 'active') = 'active'
      AND c.user_id <> NEW.customer_id
      -- CHANGED 2026-09-11. This read `np.new_offers`, which is the switch
      -- labelled "Job Offers" on the prefs screen and belongs to DIRECT
      -- offers. A helper muting direct offers silently muted parish matches
      -- too, and a helper wanting to mute matches had no way to. Unset still
      -- means on: most accounts have no preferences row.
      AND COALESCE(np.job_matches, true) IS TRUE
      -- Digest mode is an explicit "batch these, don't ping me". This producer
      -- has no queue to route into, so it stands down and sweep_daily_job_digest
      -- covers them.
      AND COALESCE(np.match_digest_mode, false) IS FALSE
      -- CREDENTIAL GATE (20260905201818).
      AND (
        COALESCE(NEW.credential_tier, 0) = 0
        OR COALESCE(public.get_user_credential_tier(c.user_id), 0) >= NEW.credential_tier
      )
  LOOP
    INSERT INTO public.notifications (user_id, title, message, type, link, job_id)
    VALUES (helper_record.helper_id, v_title, v_message, 'job_match', v_link, NEW.id);

    PERFORM net.http_post(
      url := (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'supabase_url' LIMIT 1) || '/functions/v1/send-notification-email',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'service_role_key' LIMIT 1)
      ),
      body := jsonb_build_object(
        'user_id', helper_record.helper_id,
        'title', v_title,
        'message', v_message,
        'type', 'job_match',
        'link', v_link
      )
    );
  END LOOP;

  RETURN NEW;
END;
$function$;
REVOKE ALL ON FUNCTION public.notify_helpers_on_job_post() FROM PUBLIC, anon, authenticated;

-- ── public.notify_saved_searches_on_new_job() ──
CREATE OR REPLACE FUNCTION public.notify_saved_searches_on_new_job()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  match_record RECORD;
  v_title TEXT;
  v_message TEXT;
  v_link TEXT;
  v_is_urgent BOOLEAN;
BEGIN
  IF NEW.status <> 'open'
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

  v_is_urgent := COALESCE(NEW.is_urgent, false);
  v_title := 'New job matches your saved search';
  v_link  := '/dashboard?job=' || NEW.id::text;

  FOR match_record IN
    SELECT
      s.user_id,
      (ARRAY_AGG(s.name ORDER BY s.created_at DESC))[1] AS search_name,
      ARRAY_AGG(s.id)                                   AS matched_search_ids,
      COALESCE(BOOL_OR(np.match_digest_mode), false)    AS digest_mode
    FROM public.saved_searches s
    JOIN public.profiles p ON p.user_id = s.user_id
    LEFT JOIN public.notification_preferences np ON np.user_id = s.user_id
    WHERE s.notify_enabled = true
      AND p.email_verified
      AND COALESCE(p.ban_status, 'active') = 'active'
      AND s.user_id <> NEW.customer_id
      -- ADDED 2026-09-11. These rows are type 'job_match'; the category switch
      -- is the master over every saved search. Unset means on.
      AND COALESCE(np.job_matches, true) IS TRUE
      AND (s.category IS NULL OR s.category = NEW.category::text)
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
      AND (s.last_notified_at IS NULL OR s.last_notified_at < now() - interval '1 hour')
    GROUP BY s.user_id
  LOOP
    UPDATE public.saved_searches
       SET last_notified_at = now()
     WHERE id = ANY(match_record.matched_search_ids);

    IF match_record.digest_mode AND NOT v_is_urgent THEN
      INSERT INTO public.match_digest_queue (user_id, job_id)
      VALUES (match_record.user_id, NEW.id)
      ON CONFLICT (user_id, job_id) DO NOTHING;
    ELSE
      v_message :=
        'A new job matches "' || match_record.search_name || '": '
        || NEW.title || ' ($' || NEW.budget || ')'
        || CASE WHEN v_is_urgent THEN ' · Urgent' ELSE '' END;

      INSERT INTO public.notifications (user_id, title, message, type, link)
      VALUES (match_record.user_id, v_title, v_message, 'job_match', v_link);

      PERFORM net.http_post(
        url := (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'supabase_url' LIMIT 1) || '/functions/v1/send-notification-email',
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'service_role_key' LIMIT 1)
        ),
        body := jsonb_build_object(
          'user_id', match_record.user_id,
          'title', v_title,
          'message', v_message,
          'type', 'job_match',
          'link', v_link
        )
      );
    END IF;
  END LOOP;

  RETURN NEW;
END;
$function$;
REVOKE ALL ON FUNCTION public.notify_saved_searches_on_new_job() FROM PUBLIC, anon, authenticated;

-- ── public.sweep_daily_job_digest() ──
CREATE OR REPLACE FUNCTION public.sweep_daily_job_digest()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  rec RECORD;
  total_sent integer := 0;
  budget_lo integer;
  budget_hi integer;
BEGIN
  FOR rec IN
    WITH new_jobs AS (
      SELECT j.id, j.parish, j.budget, j.credential_tier, COALESCE(j.is_seed, false) AS is_seed
      FROM public.jobs j
      WHERE j.status = 'open'
        AND j.created_at > NOW() - INTERVAL '24 hours'
        AND j.parish IS NOT NULL
        AND (NOT j.is_seed OR NOT public.seed_jobs_hidden_publicly())
    )
    SELECT
      p.user_id,
      p.parish,
      pc.cnt,
      pc.min_budget,
      pc.max_budget
    FROM public.profiles p
    LEFT JOIN public.notification_preferences np ON np.user_id = p.user_id
    CROSS JOIN LATERAL (
      SELECT COALESCE(public.get_user_credential_tier(p.user_id), 0) AS tier
    ) ut
    CROSS JOIN LATERAL (
      SELECT
        COUNT(*)        AS cnt,
        MIN(nj.budget)  AS min_budget,
        MAX(nj.budget)  AS max_budget
      FROM new_jobs nj
      WHERE nj.parish = p.parish
        AND (COALESCE(nj.credential_tier, 0) = 0 OR ut.tier >= nj.credential_tier)
        -- Q137: a seed job is news only to a seed account.
        AND (NOT nj.is_seed OR COALESCE(p.is_seed, false))
    ) pc
    WHERE p.parish IS NOT NULL
      AND pc.cnt > 0
      AND p.email_verified
      AND (p.ban_status IS NULL OR p.ban_status NOT IN ('banned', 'temp_banned', 'permanently_banned'))
      AND (np.user_id IS NULL OR COALESCE(np.job_matches, true) IS TRUE)
      AND EXISTS (
        SELECT 1 FROM public.applications WHERE helper_id = p.user_id
        UNION ALL
        SELECT 1 FROM public.jobs WHERE customer_id = p.user_id
      )
      AND NOT EXISTS (
        SELECT 1 FROM public.notifications n
        WHERE n.user_id = p.user_id
          AND n.title LIKE 'New jobs in%'
          AND n.created_at > NOW() - INTERVAL '23 hours'
      )
  LOOP
    BEGIN
      budget_lo := FLOOR(rec.min_budget)::integer;
      budget_hi := CEIL(rec.max_budget)::integer;
      INSERT INTO public.notifications (user_id, type, title, message, link, read)
      VALUES (
        rec.user_id,
        'job_match',
        format('New jobs in %s', rec.parish),
        format(
          '%s new %s posted in the last 24 hours — %s. Tap to browse.',
          rec.cnt,
          CASE WHEN rec.cnt = 1 THEN 'job' ELSE 'jobs' END,
          CASE
            WHEN budget_lo = budget_hi THEN format('$%s', budget_lo)
            ELSE format('$%s to $%s', budget_lo, budget_hi)
          END
        ),
        '/dashboard',
        false
      );
      total_sent := total_sent + 1;
    EXCEPTION WHEN OTHERS THEN
      PERFORM public.log_cron_defect(
        'sweep_daily_job_digest', rec.user_id::text, SQLERRM,
        jsonb_build_object('user_id', rec.user_id, 'parish', rec.parish));
      RAISE NOTICE 'sweep_daily_job_digest: user % failed: %', rec.user_id, SQLERRM;
    END;
  END LOOP;
  RETURN total_sent;
EXCEPTION WHEN OTHERS THEN
  PERFORM public.log_cron_defect(
    'sweep_daily_job_digest', 'run', SQLERRM,
    jsonb_build_object('phase', 'scan', 'sent_before_failure', total_sent));
  RETURN total_sent;
END;
$fn$;
REVOKE ALL ON FUNCTION public.sweep_daily_job_digest() FROM PUBLIC, anon, authenticated;

-- ── public.get_public_profile_stats(uuid[]) ──
DROP FUNCTION IF EXISTS public.get_public_profile_stats(uuid[]);
CREATE FUNCTION public.get_public_profile_stats(p_user_ids uuid[])
 RETURNS TABLE(user_id uuid, review_count integer, avg_rating numeric, poster_review_count integer, poster_avg_rating numeric, completed_jobs_as_helper integer, completed_jobs_total integer, posted_jobs_total integer, jobs_total integer, cancelled_jobs integer, cancellation_rate numeric, on_time_sample integer, on_time_rate numeric, revision_sample integer, revision_rate numeric, repeat_client_sample integer, repeat_hire_percent numeric, is_id_verified boolean, has_stripe_account boolean, is_background_checked boolean, has_pending_credentials boolean)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  WITH target AS (
    SELECT p.user_id, p.stripe_identity_verified, p.idv_status,
           p.stripe_account_id, p.background_check_status
    FROM public.profiles p
    WHERE (p.user_id = ANY(p_user_ids) OR p.id = ANY(p_user_ids))
      AND (
        -- Public gate, character-for-character the one get_safe_profiles uses.
        (
          p.email_verified
          AND (p.ban_status IS NULL OR p.ban_status NOT IN ('temp_banned', 'permanently_banned'))
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
      COUNT(*) FILTER (WHERE j.helper_id = t.user_id AND j.status = 'completed')::integer AS completed_as_helper,
      COUNT(DISTINCT j.id) FILTER (WHERE j.status = 'completed')::integer AS completed_total,
      COUNT(*) FILTER (WHERE j.customer_id = t.user_id)::integer AS posted_total,
      COUNT(*)::integer AS jobs_total,
      COUNT(*) FILTER (WHERE j.status = 'cancelled')::integer AS cancelled_jobs
    FROM target t
    LEFT JOIN public.jobs j
      ON j.customer_id = t.user_id OR j.helper_id = t.user_id
    GROUP BY t.user_id
  ),
  -- Timing, over this person's ENTIRE completed helper history. The client
  -- version capped its sample at the 50 most recent rows purely because that
  -- was one page of a `select`; there is no reason to throw away the rest here.
  timing AS (
    SELECT
      t.user_id,
      j.revision_count,
      j.helper_arrived_at,
      -- date_needed + start_time are wall-clock LOUISIANA time, not UTC. The
      -- client built this comparison with `new Date("YYYY-MM-DDTHH:MM:SS")`,
      -- which resolves in the VIEWER's timezone — so the same helper was
      -- "on time" in Baton Rouge and five hours late in London. Pin the zone.
      ((j.date_needed::date + COALESCE(j.start_time::text, '00:00')::time)
        AT TIME ZONE 'America/Chicago') AS scheduled_at
    FROM target t
    JOIN public.jobs j ON j.helper_id = t.user_id AND j.status = 'completed'
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
    SELECT t.user_id, j.customer_id, COUNT(*) AS jobs_together
    FROM target t
    JOIN public.jobs j ON j.helper_id = t.user_id AND j.status = 'completed'
    GROUP BY t.user_id, j.customer_id
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
    -- THE identity verdict. Was `(t.stripe_identity_verified IS TRUE)` — the
    -- Connect verdict alone, false for 3 of the 4 idv-verified people.
    public.identity_is_verified(t.idv_status, t.stripe_identity_verified),
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
REVOKE ALL ON FUNCTION public.get_public_profile_stats(uuid[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_public_profile_stats(uuid[]) TO anon, authenticated, service_role;

-- ── public.prevent_self_escalation() ──
CREATE OR REPLACE FUNCTION public.prevent_self_escalation()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_billing_attempt boolean;
  v_attempted_tier text;
BEGIN
  IF public.is_server_context() OR has_role(auth.uid(), 'admin') THEN
    RETURN NEW;
  END IF;

  IF current_setting('app.trusted_ladder_write', true) = 'on' THEN
    RETURN NEW;
  END IF;

  v_billing_attempt :=
       NEW.subscription_tier                 IS DISTINCT FROM OLD.subscription_tier
    OR NEW.subscription_expires_at           IS DISTINCT FROM OLD.subscription_expires_at
    OR NEW.stripe_customer_id                IS DISTINCT FROM OLD.stripe_customer_id
    OR NEW.stripe_subscription_id            IS DISTINCT FROM OLD.stripe_subscription_id
    OR NEW.subscription_billing_cycle        IS DISTINCT FROM OLD.subscription_billing_cycle
    OR NEW.subscription_cancel_at_period_end IS DISTINCT FROM OLD.subscription_cancel_at_period_end
    OR NEW.apple_original_transaction_id     IS DISTINCT FROM OLD.apple_original_transaction_id;
  v_attempted_tier := NEW.subscription_tier;

  NEW.ban_status := OLD.ban_status;
  NEW.stripe_account_id := OLD.stripe_account_id;
  NEW.subscription_tier := OLD.subscription_tier;
  NEW.subscription_expires_at := OLD.subscription_expires_at;
  NEW.denial_reason := OLD.denial_reason;
  NEW.denial_email_count := OLD.denial_email_count;
  NEW.last_denial_email_at := OLD.last_denial_email_at;
  NEW.approval_email_count := OLD.approval_email_count;
  NEW.last_approval_email_at := OLD.last_approval_email_at;
  NEW.drip_step := OLD.drip_step;
  NEW.last_drip_at := OLD.last_drip_at;

  NEW.idv_status := OLD.idv_status;
  NEW.idv_session_id := OLD.idv_session_id;
  NEW.idv_attempted_at := OLD.idv_attempted_at;
  NEW.idv_attempt_count := OLD.idv_attempt_count;
  NEW.idv_confidence := OLD.idv_confidence;
  NEW.idv_failure_reason := OLD.idv_failure_reason;
  NEW.legacy_manual_review := OLD.legacy_manual_review;

  NEW.id_verification_status := OLD.id_verification_status;
  NEW.has_applied_before := OLD.has_applied_before;

  NEW.background_check_status := OLD.background_check_status;
  NEW.is_legacy_user := OLD.is_legacy_user;

  NEW.onboarding_fee_paid := OLD.onboarding_fee_paid;
  NEW.onboarding_fee_charged_at := OLD.onboarding_fee_charged_at;
  NEW.email_verified := OLD.email_verified;
  NEW.verification_email_count := OLD.verification_email_count;
  NEW.last_verification_email_at := OLD.last_verification_email_at;

  NEW.application_count := OLD.application_count;
  NEW.auto_suspended_until := OLD.auto_suspended_until;

  NEW.license_status := OLD.license_status;
  NEW.insurance_status := OLD.insurance_status;
  NEW.license_reviewed_at := OLD.license_reviewed_at;
  NEW.insurance_reviewed_at := OLD.insurance_reviewed_at;
  NEW.license_reviewed_by := OLD.license_reviewed_by;
  NEW.insurance_reviewed_by := OLD.insurance_reviewed_by;
  NEW.license_rejection_reason := OLD.license_rejection_reason;
  NEW.insurance_rejection_reason := OLD.insurance_rejection_reason;

  -- ADDED 20260903012612. An expiry the member can push out is not an expiry;
  -- with step 3 reading these to decide the credential tier, writing your own
  -- would be the profiles-side version of the helper_credentials self-grant.
  NEW.license_expires_at := OLD.license_expires_at;
  NEW.insurance_expires_at := OLD.insurance_expires_at;

  NEW.is_licensed := OLD.is_licensed;
  NEW.is_insured := OLD.is_insured;

  NEW.stripe_identity_verified := OLD.stripe_identity_verified;
  NEW.stripe_identity_verified_at := OLD.stripe_identity_verified_at;
  NEW.stripe_charges_enabled := OLD.stripe_charges_enabled;
  NEW.stripe_payouts_enabled := OLD.stripe_payouts_enabled;
  NEW.is_seed := OLD.is_seed;

  NEW.stripe_customer_id := OLD.stripe_customer_id;
  NEW.stripe_subscription_id := OLD.stripe_subscription_id;
  NEW.subscription_billing_cycle := OLD.subscription_billing_cycle;
  NEW.subscription_cancel_at_period_end := OLD.subscription_cancel_at_period_end;

  -- ADDED 20260903022948. The Apple IAP receipt anchor, for the same reason as
  -- the Stripe linkage directly above: it is what the verifier trusts to decide
  -- whether a tier was paid for.
  NEW.apple_original_transaction_id := OLD.apple_original_transaction_id;

  IF v_billing_attempt THEN
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM public.error_logs e
         WHERE e.tags->>'source' = 'rls-escalation-refused'
           AND e.tags->>'user_id' = auth.uid()::text
           AND e.created_at > now() - interval '1 hour'
      ) THEN
        INSERT INTO public.error_logs (severity, message, tags, context)
        VALUES (
          'warning',
          'Refused a non-admin write to the profiles billing columns',
          jsonb_build_object('source', 'rls-escalation-refused',
                             'area', 'security',
                             'user_id', auth.uid()::text),
          jsonb_build_object(
            'current_tier',   OLD.subscription_tier,
            'attempted_tier', v_attempted_tier,
            'row_user_id',    OLD.user_id::text));
      END IF;
    EXCEPTION WHEN OTHERS THEN
      NULL;
    END;
  END IF;

  RETURN NEW;
END;
$function$;
REVOKE ALL ON FUNCTION public.prevent_self_escalation() FROM PUBLIC, anon;

-- ── public.log_verification_change() ──
CREATE OR REPLACE FUNCTION public.log_verification_change()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor uuid := auth.uid();
BEGIN
  IF NEW.idv_status IS DISTINCT FROM OLD.idv_status THEN
    INSERT INTO public.helper_verifications (user_id, changed_by, field, old_value, new_value)
    VALUES (NEW.user_id, v_actor, 'idv_status', OLD.idv_status, NEW.idv_status);
  END IF;

  IF NEW.idv_confidence IS DISTINCT FROM OLD.idv_confidence THEN
    INSERT INTO public.helper_verifications (user_id, changed_by, field, old_value, new_value)
    VALUES (NEW.user_id, v_actor, 'idv_confidence', OLD.idv_confidence::text, NEW.idv_confidence::text);
  END IF;

  IF NEW.idv_failure_reason IS DISTINCT FROM OLD.idv_failure_reason THEN
    INSERT INTO public.helper_verifications (user_id, changed_by, field, old_value, new_value)
    VALUES (NEW.user_id, v_actor, 'idv_failure_reason', OLD.idv_failure_reason, NEW.idv_failure_reason);
  END IF;

  IF NEW.idv_session_id IS DISTINCT FROM OLD.idv_session_id THEN
    INSERT INTO public.helper_verifications (user_id, changed_by, field, old_value, new_value)
    VALUES (NEW.user_id, v_actor, 'idv_session_id', OLD.idv_session_id, NEW.idv_session_id);
  END IF;

  IF NEW.legacy_manual_review IS DISTINCT FROM OLD.legacy_manual_review THEN
    INSERT INTO public.helper_verifications (user_id, changed_by, field, old_value, new_value)
    VALUES (NEW.user_id, v_actor, 'legacy_manual_review', OLD.legacy_manual_review::text, NEW.legacy_manual_review::text);
  END IF;

  RETURN NEW;
END;
$$;

-- ── public.sync_email_verified() ──
CREATE OR REPLACE FUNCTION public.sync_email_verified()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF (OLD.email_confirmed_at IS NULL) IS DISTINCT FROM (NEW.email_confirmed_at IS NULL) THEN
    UPDATE public.profiles
       SET email_verified = (NEW.email_confirmed_at IS NOT NULL)
     WHERE user_id = NEW.id;
  END IF;
  RETURN NEW;
END;
$function$;

-- ── public.sync_email_verified_on_insert() ──
CREATE OR REPLACE FUNCTION public.sync_email_verified_on_insert()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.email_confirmed_at IS NOT NULL THEN
    UPDATE public.profiles
       SET email_verified = true
     WHERE user_id = NEW.id;
  END IF;
  RETURN NEW;
END;
$function$;

-- ── The profiles INSERT policy ──
-- Restated from 20260903023314 with only `AND approval_status = 'pending'`
-- removed: nothing reads the column any more, so pinning its value on the way
-- in protects nothing. Every column a gate DOES read stays pinned, including
-- email_verified = false, which is now what the public surfaces gate on.
DROP POLICY IF EXISTS "Users can insert their own profile" ON public.profiles;

CREATE POLICY "Users can insert their own profile"
  ON public.profiles
  FOR INSERT
  TO authenticated
  WITH CHECK (
    (SELECT auth.uid()) = user_id
    AND (ban_status IS NULL OR ban_status = 'active')
    AND idv_status IS NULL
    AND subscription_tier IS NULL
    AND stripe_account_id IS NULL
    AND onboarding_fee_paid = false
    AND email_verified = false
    AND legacy_manual_review = false
    AND license_status = 'none'
    AND insurance_status = 'none'
    AND license_expires_at IS NULL
    AND insurance_expires_at IS NULL
    AND is_licensed = false
    AND is_insured = false
    AND background_check_status = 'none'
    AND stripe_identity_verified = false
    AND apple_original_transaction_id IS NULL
    AND is_seed = false
  );

COMMENT ON POLICY "Users can insert their own profile" ON public.profiles IS
  'A member may create only their OWN profile, and only in its zero-trust state: '
  'every column that any gate reads must arrive at its default. There is no '
  'BEFORE INSERT trigger on this table, so this WITH CHECK is the only thing '
  'standing between an insert and the trust columns.';

-- ── Indexes over the column ──
-- idx_profiles_pending_verified (20260418222915) is a partial index
-- `WHERE approval_status = 'pending'`, built for the retired admin pending
-- queue. idx_profiles_role_approval (20260312230239) went with profiles.role;
-- dropped here too in case any environment still has it.
DROP INDEX IF EXISTS public.idx_profiles_pending_verified;
DROP INDEX IF EXISTS public.idx_profiles_role_approval;
