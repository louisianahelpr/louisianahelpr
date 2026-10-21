-- Members never see each other's last names, not even in a network response (owner rule 2026-10-21).
--
-- WHAT WAS BROKEN. Q2292 shortened the names in stored notifications, but the read paths still sent
-- profiles.full_name raw to any signed-in member, and the client only shortened it on screen
-- (formatName -> "First L."), so the surname sat in every response body. Inventory taken from LIVE
-- prod on 2026-10-21 (pg_proc where pg_get_functiondef mentions full_name, has_function_privilege for
-- authenticated/anon; views and tables checked too: no view reads full_name, and profiles' own RLS
-- returns only the caller's row or, for an admin, every row):
--   get_safe_profiles(uuid[])            anon + authenticated  full_name of any verified member
--   search_profiles_by_name(text)        authenticated         full_name, AND it matched the query
--                                                              against the full name and sorted by it,
--                                                              so searching a surname proved it
--   get_my_saved_helpers()               authenticated         the saved Helprs' full names
--   get_quotes_for_request(uuid)         authenticated         each quoter's full name
--   get_public_profile_reviews(uuid,..)  authenticated         each reviewer's full name
-- Three first-name-only readers and one notification builder split the name on ' ' only, so a name
-- written with a tab or a no-break space came out whole (0 prod profiles carry one today; measured):
--   helpr_task_view(uuid) (returns it), nudge_confirm(uuid) and record_backout_notice() (write it
--   into the other party's notification / back-out notice), notify_message_recipient() (hand-rolled
--   "First L." on ' ').
-- And member_display_name itself split on the locale's \s. Measured on prod over the whole BMP: 29
-- code points, against formatName's 25 (it also splits on U+001C-U+001F and U+0085, and misses
-- U+FEFF, so "First<U+FEFF>Last" came out whole where formatName says "First L."). The same text in
-- PGlite's C locale gives yet another set. The explicit class below gives formatName's 25 on prod
-- (measured with a read-only SELECT of this exact pattern) and in PGlite.
--
-- FIX. One rule, two helpers:
--  1. public.member_display_name(full_name, fallback): restated with formatName's EXACT whitespace
--     set (JavaScript's \s: tab, LF, VT, FF, CR, space, U+00A0, U+1680, U+2000-U+200A, U+2028,
--     U+2029, U+202F, U+205F, U+3000, U+FEFF), written out so the locale cannot change it. Output
--     for every other input is unchanged.
--  2. public.display_name_for_viewer(full_name, owner_id): the full name for the caller's own row,
--     for an admin (has_role(auth.uid(), 'admin')) and for a trusted server context (service role,
--     cron: public.is_server_context()); everyone else gets member_display_name(full_name, NULL)
--     ("First L.", a blank name -> NULL, which formatName renders as its fallback).
--  3. The five readers return display_name_for_viewer(...) in the SAME column with the SAME type, so
--     every installed client keeps working: formatName("Lexi L.") is "Lexi L.". search_profiles_by_name
--     now matches and sorts on that same display name (an admin still searches full names).
--  4. The first-name readers take the first word of member_display_name(...), and
--     notify_message_recipient uses member_display_name directly.
-- Kept full on purpose: admin-only RPCs (each gated on has_role(..., 'admin')), staff-only fan-outs,
-- and the caller's own name. The guard src/test/memberNamesMaskedInResponses.test.ts lists each
-- with its reason; behaviour, 3x replay: src/test/pglite/memberNamesMaskedInResponses.pglite.mjs.
--
-- Every restated body is its live definition copied verbatim (md5(prosrc) matched prod on
-- 2026-10-21 for all nine); only the name lines change.
--
-- REPLAY-SAFETY: CREATE OR REPLACE only, of functions earlier migrations define, with unchanged
-- signatures and return types (so their grants and triggers stay); every function the bodies call
-- (auth.uid, auth.role, has_role, is_server_context, are_users_blocked, ...) exists before this
-- file. Grants are restated to match prod's proacl.

-- 1. The rule (formatName in SQL).
CREATE OR REPLACE FUNCTION public.member_display_name(p_full_name text, p_fallback text DEFAULT 'A neighbor')
RETURNS text
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
SET search_path = ''
AS $fn$
  SELECT CASE
           WHEN v.t = '' THEN p_fallback
           WHEN array_length(v.parts, 1) > 1
             THEN v.parts[1] || ' ' || left(v.parts[array_length(v.parts, 1)], 1) || '.'
           ELSE v.parts[1]
         END
    FROM (SELECT x.t,
                 regexp_split_to_array(x.t, '[\t\n\v\f\r \u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff]+') AS parts
            FROM (SELECT regexp_replace(coalesce(p_full_name, ''),
                                        '^[\t\n\v\f\r \u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff]+|[\t\n\v\f\r \u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff]+$',
                                        '', 'g') AS t) x) v
$fn$;
REVOKE ALL ON FUNCTION public.member_display_name(text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.member_display_name(text, text) TO authenticated, service_role;

-- 2. Who may see the full name.
CREATE OR REPLACE FUNCTION public.display_name_for_viewer(p_full_name text, p_owner_id uuid)
RETURNS text
LANGUAGE sql
STABLE
SET search_path = ''
AS $fn$
  SELECT CASE
           WHEN p_owner_id IS NOT NULL AND p_owner_id = (SELECT auth.uid()) THEN p_full_name
           WHEN (SELECT public.is_server_context()) THEN p_full_name
           WHEN (SELECT auth.uid()) IS NOT NULL
                AND public.has_role((SELECT auth.uid()), 'admin'::public.app_role) THEN p_full_name
           ELSE public.member_display_name(p_full_name, NULL)
         END
$fn$;
COMMENT ON FUNCTION public.display_name_for_viewer(text, uuid) IS
  'The name a reader may see: the full name for the caller''s own row (p_owner_id = auth.uid()), an admin, or a trusted server context; otherwise member_display_name(full_name, NULL) = formatName''s "First L.". Every member-facing reader of profiles.full_name goes through this (src/test/memberNamesMaskedInResponses.test.ts).';
-- Called only from SECURITY DEFINER readers (as their owner), so no client role needs EXECUTE.
REVOKE ALL ON FUNCTION public.display_name_for_viewer(text, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.display_name_for_viewer(text, uuid) TO service_role;

-- get_safe_profiles: restated verbatim from 20261021074131_id_badge_reads_stripe_identity_only.sql; full_name -> display_name_for_viewer (own row, admin, server: full).
CREATE OR REPLACE FUNCTION public.get_safe_profiles(user_ids uuid[])
 RETURNS TABLE(user_id uuid, full_name text, avatar_url text, bio text, location text, skills text, hourly_rate numeric, role text, subscription_tier text, portfolio_urls text[], created_at timestamp with time zone, is_id_verified boolean, is_payout_ready boolean, profile_id uuid, is_licensed boolean, license_status text, is_insured boolean, insurance_status text, business_name text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT
    p.user_id, public.display_name_for_viewer(p.full_name, p.user_id) AS full_name, p.avatar_url, p.bio, p.location,
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
    -- The "ID verified" BADGE (owner 2026-10-21): Stripe Identity's photo ID +
    -- selfie verdict only. Payout setup (Connect) is its own fact, is_payout_ready
    -- below, and never draws this badge. A badge, not a gate.
    (p.idv_status IS NOT DISTINCT FROM 'verified') AS is_id_verified,
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
    AND (p.ban_status IS NULL OR p.ban_status NOT IN ('temp_banned', 'permanently_banned'))
    AND p.anonymized_at IS NULL
    -- Q552: a test account's profile is hidden once the launch switch is on
    -- (your own row never is).
    AND (p.is_seed IS NOT TRUE OR p.user_id = auth.uid() OR NOT (SELECT public.seed_hidden_from_caller()));
$function$;
-- anon keeps EXECUTE, as in prod's proacl (2026-10-21); an anon caller now gets "First L." too.
REVOKE ALL ON FUNCTION public.get_safe_profiles(uuid[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_safe_profiles(uuid[]) TO anon, authenticated, service_role;

-- search_profiles_by_name: restated verbatim from 20261007033530_seed_switch_hides_test_profiles.sql; returns, matches and sorts on display_name_for_viewer: a member can no longer find (and so confirm) someone by surname; an admin still can.
CREATE OR REPLACE FUNCTION public.search_profiles_by_name(query text)
 RETURNS TABLE(user_id uuid, full_name text, avatar_url text)
 LANGUAGE plpgsql
 SECURITY DEFINER
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
  SELECT p.user_id, d.name, p.avatar_url
  FROM public.profiles p
  CROSS JOIN LATERAL (SELECT public.display_name_for_viewer(p.full_name, p.user_id) AS name) d
  WHERE p.user_id <> _uid
    AND d.name IS NOT NULL
    -- A typed full name still finds the person: it is shortened the same way first, so "Lexi Lombas"
    -- and "Lexi Lxyz" both find every "Lexi L." and neither confirms a surname.
    AND (d.name ILIKE '%' || trim(query) || '%'
         OR d.name ILIKE '%' || public.member_display_name(trim(query), NULL) || '%')  -- a blank query shortens to NULL: no match
    AND p.email_verified
    AND (p.ban_status IS NULL OR p.ban_status NOT IN ('temp_banned', 'permanently_banned'))
    -- Q552: test accounts are not findable once the launch switch is on.
    AND (p.is_seed IS NOT TRUE OR NOT public.seed_hidden_in_discovery())
  ORDER BY d.name ASC, p.user_id  -- many members share one "First L.": a stable order
  LIMIT 10;
END;
$function$;
REVOKE ALL ON FUNCTION public.search_profiles_by_name(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.search_profiles_by_name(text) TO authenticated, service_role;

-- get_my_saved_helpers: restated verbatim from 20260924062150_saved_helpers_hide_blocked.sql; the saved Helpr's name -> display_name_for_viewer.
CREATE OR REPLACE FUNCTION public.get_my_saved_helpers()
 RETURNS TABLE(helper_id uuid, full_name text, avatar_url text, bio text, parish text, skills text, hourly_rate numeric, saved_at timestamp with time zone, completed_jobs_together integer, last_job_at timestamp with time zone, private_note text, available_until timestamp with time zone)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT
    fh.helper_id,
    public.display_name_for_viewer(p.full_name, p.user_id) AS full_name,
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
    AND NOT public.are_users_blocked(fh.customer_id, fh.helper_id)  -- TS-011 block filter
  ORDER BY fh.created_at DESC;
$function$;
REVOKE ALL ON FUNCTION public.get_my_saved_helpers() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_my_saved_helpers() TO authenticated, service_role;

-- get_quotes_for_request: restated verbatim from 20261015091114_job_quotes.sql; quoter_name -> display_name_for_viewer.
CREATE OR REPLACE FUNCTION public.get_quotes_for_request(p_request_id uuid)
RETURNS TABLE(
  id uuid, quoter_id uuid, quoter_name text, quoter_avatar_url text, price_cents integer,
  note text, available_note text, photo_paths text[], last_offer_side text, respond_until timestamptz,
  status text, offers jsonb, created_at timestamptz
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid uuid;
BEGIN
  PERFORM public.require_feature('quotes');
  v_uid := (SELECT auth.uid());
  PERFORM public.quote_require_member();
  IF NOT EXISTS (SELECT 1 FROM public.job_quote_requests r WHERE r.id = p_request_id AND r.poster_id = v_uid) THEN
    RAISE EXCEPTION 'unknown_request' USING ERRCODE = 'P0002';
  END IF;
  RETURN QUERY
    SELECT q.id, q.quoter_id, public.display_name_for_viewer(p.full_name, q.quoter_id)::text, p.avatar_url::text, q.price_cents,
           q.note, q.available_note, q.photo_paths, q.last_offer_side, q.respond_until,
           public.quote_display_status(q.status, q.respond_until),
           COALESCE((SELECT jsonb_agg(jsonb_build_object('by', o.by_side, 'price_cents', o.price_cents,
                                                         'note', o.note, 'at', o.created_at)
                                      ORDER BY o.created_at)
                       FROM public.job_quote_offers o WHERE o.quote_id = q.id), '[]'::jsonb),
           q.created_at
      FROM public.job_quotes q
      LEFT JOIN public.profiles p ON p.user_id = q.quoter_id
     WHERE q.request_id = p_request_id
       AND q.quoter_id IS NOT NULL
       AND NOT public.are_users_blocked(v_uid, q.quoter_id)
     ORDER BY q.price_cents, q.created_at;
END;
$fn$;
REVOKE ALL ON FUNCTION public.get_quotes_for_request(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_quotes_for_request(uuid) TO authenticated, service_role;

-- get_public_profile_reviews: restated verbatim from 20261007033530_seed_switch_hides_test_profiles.sql; reviewer_name -> display_name_for_viewer.
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
      r.feedback, r.created_at, r.reviewer_id, r.response_text, r.response_at,
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

-- helpr_task_view: restated verbatim from 20261018184535_declutter_delivery_no_dropoff_code.sql; the Helpr's first name is the first word of member_display_name (a tab or no-break space no longer keeps the surname attached).
CREATE OR REPLACE FUNCTION public.helpr_task_view(p_task_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid uuid := (SELECT auth.uid());
  t public.helpr_tasks;
  v_role text;
  v_active boolean;
  v_helpr_name text;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO t FROM public.helpr_tasks WHERE id = p_task_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'task_not_found' USING ERRCODE = 'P0002';
  END IF;
  v_role := CASE WHEN t.helpr_id = v_uid THEN 'helpr'
                 WHEN t.customer_id = v_uid THEN 'customer'
                 WHEN t.pickup_contact_id = v_uid THEN 'pickup_contact' END;
  IF v_role IS NULL THEN
    -- An open task is visible to a Helpr who could take it (area words only).
    PERFORM public.helpr_task_source_require_feature(t.source_kind);
    PERFORM public.helpr_task_assert_helpr();
    -- The same checks helpr_tasks_open_near applies (lh-authz-rls #8).
    IF t.status <> 'open' OR t.open_until <= now() OR NOT public.helpr_task_vehicle_fits(v_uid, t.size)
       OR public.are_users_blocked(v_uid, t.customer_id) OR public.are_users_blocked(v_uid, t.pickup_contact_id)
       OR NOT public.helpr_task_same_stripe_mode(v_uid, t.customer_id) THEN
      RAISE EXCEPTION 'task_not_found' USING ERRCODE = 'P0002';
    END IF;
    v_role := 'candidate';
  END IF;
  v_active := t.status IN ('accepted', 'picked_up', 'delivered');
  SELECT NULLIF(split_part(COALESCE(public.member_display_name(pr.full_name, NULL), ''), ' ', 1), '') INTO v_helpr_name
    FROM public.profiles pr WHERE pr.user_id = t.helpr_id;
  RETURN jsonb_build_object(
    'task_id', t.id, 'source_kind', t.source_kind, 'source_id', CASE WHEN v_role <> 'candidate' THEN t.source_id END,
    'role', v_role, 'status', t.status, 'size', t.size, 'title', t.title,
    'pickup_area', t.pickup_area, 'dropoff_area', t.dropoff_area, 'trip_miles', t.trip_miles,
    'take_home_cents', CASE WHEN v_role IN ('helpr', 'candidate') THEN t.pay_cents - t.fee_cents END,
    'pay_cents', CASE WHEN v_role IN ('helpr', 'candidate') THEN t.pay_cents END,
    'fee_cents', CASE WHEN v_role IN ('helpr', 'candidate') THEN t.fee_cents END,
    'open_until', t.open_until, 'latest_pickup_at', t.latest_pickup_at,
    'pickup_slot_start', t.pickup_slot_start, 'accepted_at', t.accepted_at,
    'picked_up_at', t.picked_up_at, 'delivered_at', t.delivered_at, 'confirmed_at', t.confirmed_at,
    'confirmed_by', t.confirmed_by,
    'helpr_first_name', CASE WHEN v_role IN ('customer', 'pickup_contact') THEN v_helpr_name END,
    'pickup_address', CASE WHEN v_role = 'helpr' AND v_active THEN t.pickup_address END,
    'pickup_lat', CASE WHEN v_role = 'helpr' AND v_active THEN t.pickup_lat END,
    'pickup_lng', CASE WHEN v_role = 'helpr' AND v_active THEN t.pickup_lng END,
    'dropoff_address', CASE WHEN v_role = 'helpr' AND t.status IN ('picked_up', 'delivered') THEN t.dropoff_address END,
    'dropoff_lat', CASE WHEN v_role = 'helpr' AND t.status IN ('picked_up', 'delivered') THEN t.dropoff_lat END,
    'dropoff_lng', CASE WHEN v_role = 'helpr' AND t.status IN ('picked_up', 'delivered') THEN t.dropoff_lng END,
    'pickup_photo_path', CASE WHEN v_role <> 'candidate' THEN t.pickup_photo_path END,
    'dropoff_photo_path', CASE WHEN v_role <> 'candidate' THEN t.dropoff_photo_path END);
END;
$fn$;
REVOKE ALL ON FUNCTION public.helpr_task_view(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.helpr_task_view(uuid) TO authenticated, service_role;

-- nudge_confirm: restated verbatim from 20261008205730_confirm_reminders_nudge_and_repost.sql; the sender's first name is the first word of member_display_name.
CREATE OR REPLACE FUNCTION public.nudge_confirm(p_job_id uuid)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  v_job public.jobs;
  v_uid uuid := auth.uid();
  v_target uuid;
  v_sender text;
  v_owes boolean;
BEGIN
  SELECT * INTO v_job FROM public.jobs WHERE id = p_job_id;
  IF v_job.id IS NULL THEN
    RAISE EXCEPTION 'job_not_found' USING ERRCODE = 'P0002';
  END IF;
  IF v_uid IS NULL OR (v_uid IS DISTINCT FROM v_job.customer_id AND v_uid IS DISTINCT FROM v_job.helper_id) THEN
    RAISE EXCEPTION 'not_a_party' USING ERRCODE = '42501';
  END IF;
  -- A restricted account sends nobody anything (the ban gate, Q281).
  IF public.is_caller_banned() THEN
    RETURN 'account_restricted';
  END IF;
  IF v_job.status::text <> 'accepted' OR v_job.helper_id IS NULL OR v_job.helper_confirmed_at IS NULL THEN
    RETURN 'not_booked';
  END IF;
  v_target := CASE WHEN v_uid = v_job.customer_id THEN v_job.helper_id ELSE v_job.customer_id END;
  v_owes := CASE WHEN v_target = v_job.helper_id THEN v_job.helper_dayof_confirmed_at IS NULL ELSE v_job.poster_confirmed_at IS NULL END;
  IF NOT v_owes THEN
    RETURN 'already_confirmed';
  END IF;
  -- Once per 2 hours per job per sender: the notifications row is the record.
  IF EXISTS (SELECT 1 FROM public.notifications n
              WHERE n.user_id = v_target AND n.job_id = p_job_id AND n.title = 'Please confirm'
                AND n.created_at > now() - interval '2 hours') THEN
    RETURN 'too_soon';
  END IF;
  SELECT COALESCE(NULLIF(split_part(COALESCE(public.member_display_name(p.full_name, NULL), ''), ' ', 1), ''), 'They') INTO v_sender
    FROM public.profiles p WHERE p.user_id = v_uid;
  INSERT INTO public.notifications (user_id, title, message, type, link, job_id)
  VALUES (
    v_target, 'Please confirm',
    COALESCE(v_sender, 'They') || ' asked you to confirm "' || COALESCE(v_job.title, 'the job') || '" is still on.'
      || CASE WHEN v_target = v_job.helper_id THEN ' If you don''t confirm 2 hours before the start, it''s reposted to other Helprs.' ELSE '' END,
    'job_update',
    CASE WHEN v_target = v_job.customer_id THEN '/posts?job=' ELSE '/jobs?job=' END || p_job_id::text,
    p_job_id
  );
  RETURN 'sent';
END;
$fn$;
REVOKE ALL ON FUNCTION public.nudge_confirm(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.nudge_confirm(uuid) TO authenticated, service_role;

-- record_backout_notice: restated verbatim from 20261018050953_offer_notices_wait_for_funding.sql; the actor's first name (stored on the recipient's back-out notice) is the first word of member_display_name.
CREATE OR REPLACE FUNCTION public.record_backout_notice()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  v_kind text;
  v_recipient uuid;
  v_actor uuid;
  v_actor_name text;
  v_link text;
  v_text record;
BEGIN
  IF OLD.is_group_job IS TRUE OR OLD.parent_job_id IS NOT NULL THEN
    RETURN NULL;
  END IF;
  -- A10 (20261017073146): a setup job the Declutter seller's backing out
  -- cancelled is not the poster's cancel; declutter_refund_cancels_setup_jobs
  -- tells the Helpr itself, in the right words (lh-silent-failure review of
  -- c57d948d0 #2: this said "<poster> cancelled").
  IF COALESCE(current_setting('app.declutter_seller_fault_cancel', true), '') = 'on' THEN
    RETURN NULL;
  END IF;

  IF OLD.helper_id IS NOT NULL AND NEW.helper_id IS NULL
     AND OLD.status::text IN ('accepted', 'in_progress') AND NEW.status::text = 'open' THEN
    -- The booked (or offered) Helpr is off the job and it reopened.
    v_recipient := OLD.customer_id;
    v_actor := OLD.helper_id;
    v_kind := CASE
      WHEN COALESCE(current_setting('app.repost_unconfirmed', true), '') = '1' THEN 'helper_unconfirmed'
      WHEN OLD.helper_confirmed_at IS NOT NULL THEN 'helper_cancelled'
      WHEN auth.uid() IS NOT DISTINCT FROM OLD.helper_id THEN 'offer_declined'
      ELSE 'offer_expired' END;
  ELSIF OLD.direct_offer_status = 'pending' AND NEW.direct_offer_status IN ('declined', 'expired')
     AND OLD.offered_to_helper_id IS NOT NULL
     -- Q2131: "<Helpr> declined your offer ... open to everyone again" only
     -- about a funded job (the notification row says "was declined." alone).
     AND public.job_payment_is_funded(NEW.payment_status) THEN
    v_recipient := OLD.customer_id;
    v_actor := OLD.offered_to_helper_id;
    v_kind := CASE WHEN NEW.direct_offer_status = 'declined' THEN 'offer_declined' ELSE 'offer_expired' END;
  ELSIF NEW.status::text = 'cancelled' AND OLD.status::text IN ('accepted', 'in_progress')
     AND OLD.helper_id IS NOT NULL AND NEW.cancelled_by IS DISTINCT FROM OLD.helper_id THEN
    v_recipient := OLD.helper_id;
    v_actor := COALESCE(NEW.cancelled_by, OLD.customer_id);
    v_kind := 'poster_cancelled';
  ELSE
    RETURN NULL;
  END IF;

  IF v_recipient IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT NULLIF(split_part(COALESCE(public.member_display_name(p.full_name, NULL), ''), ' ', 1), '') INTO v_actor_name
    FROM public.profiles p WHERE p.user_id = v_actor;

  INSERT INTO public.backout_notices (job_id, user_id, actor_name, backout_kind)
  VALUES (OLD.id, v_recipient, v_actor_name, v_kind);

  v_link := CASE WHEN v_recipient = OLD.customer_id THEN '/posts?job=' ELSE '/jobs?job=' END || OLD.id::text;
  SELECT * INTO v_text FROM public.backout_notice_text(v_kind, v_actor_name, OLD.title);
  PERFORM public.send_backout_email(v_recipient, OLD.id, v_text.title, v_text.message, v_link);
  RETURN NULL;
END;
$fn$;
REVOKE ALL ON FUNCTION public.record_backout_notice() FROM PUBLIC, anon, authenticated;

-- notify_message_recipient: restated verbatim from 20261011161100_team_thread_direct_messages.sql; the sender is named through member_display_name instead of a split on ' ' that a tab or no-break space defeated.
CREATE OR REPLACE FUNCTION public.notify_message_recipient()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  sender_name text;
  sender_short text;
  preview text;
  preview_full text;
BEGIN
  -- Skip self-sends (RLS blocks them but defense-in-depth)
  IF NEW.sender_id IS NULL OR NEW.receiver_id IS NULL OR NEW.sender_id = NEW.receiver_id THEN
    RETURN NEW;
  END IF;

  -- Skip messages flagged as hidden by scan_message_content (the off-
  -- platform-content scanner already created a fraud_flag for the
  -- sender; the recipient never sees these in their UI).
  IF NEW.flagged_hidden = true THEN
    RETURN NEW;
  END IF;

  -- Look up sender's name (NULL-safe fallback to "Someone")
  SELECT public.member_display_name(full_name, 'Someone')
    INTO sender_name
    FROM public.profiles
    WHERE user_id = NEW.sender_id;
  sender_name := COALESCE(sender_name, 'Someone');

  -- "First L.": member_display_name above is formatName (src/lib/utils.ts) in SQL.
  sender_short := sender_name;

  -- Team thread: the staff side speaks as the team, never as one admin.
  IF NEW.team_thread_user_id IS NOT NULL AND NEW.sender_id <> NEW.team_thread_user_id THEN
    sender_short := 'Louisiana Helpr Team';
  END IF;

  -- Build preview. Attachment-only → "📎 Attachment"; text → first 80
  -- chars + ellipsis if longer.
  preview_full := COALESCE(NEW.content, '');
  IF length(trim(preview_full)) = 0 AND NEW.attachment_url IS NOT NULL THEN
    preview := '📎 Attachment';
  ELSE
    IF length(preview_full) > 80 THEN
      preview := left(preview_full, 80) || '…';
    ELSE
      preview := preview_full;
    END IF;
  END IF;

  -- Skip empty messages with no attachment (defensive)
  IF length(trim(preview)) = 0 THEN
    RETURN NEW;
  END IF;

  -- IMPORTANT: link param is `jobId` (camelCase), matching
  -- searchParams.get("jobId") in src/pages/Messages.tsx. Earlier
  -- version used `job=` and broke deep-link auto-open.
  INSERT INTO public.notifications (user_id, title, message, type, link, read)
  VALUES (
    NEW.receiver_id,
    sender_short,
    preview,
    'message',
    -- BOTH params. `jobId` stays camelCase to match searchParams.get("jobId");
    -- `userId` is the SENDER, who is the "other user" from the recipient's
    -- point of view. The client required both before it would auto-open a
    -- thread, so a jobId-only link always landed on the inbox instead.
    -- A team-thread row has no job: `teamThread=<the thread's user>` instead,
    -- still carrying `userId=<sender>` so the seed boundary can see the actor.
    CASE
      WHEN NEW.team_thread_user_id IS NOT NULL THEN
        '/messages?teamThread=' || NEW.team_thread_user_id::text
          || '&userId=' || COALESCE(NEW.sender_id::text, '')
      ELSE
        '/messages?jobId=' || COALESCE(NEW.job_id::text, '')
          || '&userId=' || COALESCE(NEW.sender_id::text, '')
    END,
    false
  );

  RETURN NEW;
END;
$function$;
REVOKE ALL ON FUNCTION public.notify_message_recipient() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.notify_message_recipient() TO service_role;
