-- Declutter search matches every WORD (audit DA-1, 2026-10-30, live site: "mug blue", "mugs" and "kitchen" found
-- nothing, because Browse and the saved-search alerts matched the whole query as one exact phrase inside the title).
--
-- One rule, here and in Browse (src/lib/declutter/searchMatch.ts):
--   1. lower-case; split the query and the item into words on anything that is not a-z or 0-9;
--   2. each word loses a simple plural ending: "ies" -> "y", "es" after s/x/z/ch/sh, else one "s" when the word is
--      longer than 3 and does not end in "ss";
--   3. the item's words are its title, its description and its category key ("home_decor" -> "home decor");
--   4. EVERY query word must appear inside that run of item words. An empty query matches everything.
-- src/test/pglite/declutterSearchMatchParity.pglite.mjs runs this function and the TypeScript one over one table of
-- cases (they must agree), and replays this file 3x.
--
-- Restated from the EFFECTIVE prod definitions (pg_get_functiondef, 2026-10-30 04:40Z), changing only the query line:
--   - deliver_saved_search_item_alerts(uuid)  (newest in the repo: 20261021042132; prod md5 3ec1dc16de07...)
--   - saved_search_new_counts()               (newest in the repo: 20261021072206; prod md5 ab7950ae7960...)
--     its Jobs branch is untouched (Jobs search is its own rule).

CREATE OR REPLACE FUNCTION public.declutter_search_stem(p_word text)
RETURNS text
LANGUAGE sql
IMMUTABLE PARALLEL SAFE
SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT CASE
    WHEN length(p_word) > 4 AND right(p_word, 3) = 'ies' THEN left(p_word, -3) || 'y'
    WHEN length(p_word) > 4 AND p_word ~ '(s|x|z|ch|sh)es$' THEN left(p_word, -2)
    WHEN length(p_word) > 3 AND right(p_word, 1) = 's' AND right(p_word, 2) <> 'ss' THEN left(p_word, -1)
    ELSE p_word
  END
$function$;

REVOKE ALL ON FUNCTION public.declutter_search_stem(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.declutter_search_stem(text) TO service_role;

CREATE OR REPLACE FUNCTION public.declutter_search_matches(p_query text, p_title text, p_description text, p_category text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE PARALLEL SAFE
SET search_path TO 'public', 'pg_temp'
AS $function$
  WITH item AS (
    SELECT COALESCE(string_agg(public.declutter_search_stem(w), ' '), '') AS words
      FROM regexp_split_to_table(
             lower(COALESCE(p_title, '') || ' ' || COALESCE(p_description, '') || ' ' || replace(COALESCE(p_category::text, ''), '_', ' ')),
             '[^a-z0-9]+') AS w
     WHERE w <> ''
  )
  SELECT NOT EXISTS (
    SELECT 1
      FROM regexp_split_to_table(lower(COALESCE(p_query, '')), '[^a-z0-9]+') AS q, item
     WHERE q <> ''
       AND strpos(item.words, public.declutter_search_stem(q)) = 0
  )
$function$;

REVOKE ALL ON FUNCTION public.declutter_search_matches(text, text, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.declutter_search_matches(text, text, text, text) TO service_role;

CREATE OR REPLACE FUNCTION public.deliver_saved_search_item_alerts(p_item uuid)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_item public.declutter_items%ROWTYPE;
  r record;
  v_ids uuid[];
  v_email_ids uuid[];
  v_sent integer := 0;
  v_title text := 'New item matches your saved search';
  v_price text;
  v_message text;
  v_link text;
  v_seller_seed boolean;
BEGIN
  -- FOR SHARE NOWAIT: a sale cannot take the item between this check and the
  -- sends; a held row raises lock_not_available and stays queued.
  SELECT * INTO v_item FROM public.declutter_items WHERE id = p_item FOR SHARE NOWAIT;
  IF NOT FOUND
     OR v_item.status <> 'live'
     OR (COALESCE(v_item.is_seed, false) AND public.seed_jobs_hidden_publicly())
     OR public.declutter_seller_hidden(v_item.seller_id)
  THEN
    RETURN 0;
  END IF;

  v_link := '/declutter/item/' || v_item.id::text;
  -- Q137: a test seller never alerts a real member, in the app OR by email
  -- (declutter_notify drops only the in-app row; this skips the whole send).
  v_seller_seed := COALESCE((SELECT sp.is_seed FROM public.profiles sp WHERE sp.user_id = v_item.seller_id), false);
  v_price := '$' || CASE WHEN v_item.current_price_cents % 100 = 0
                         THEN (v_item.current_price_cents / 100)::text
                         ELSE to_char(v_item.current_price_cents / 100.0, 'FM999999990.00') END;

  FOR r IN
    SELECT
      s.user_id,
      (ARRAY_AGG(s.name ORDER BY s.created_at DESC))[1] AS search_name,
      ARRAY_AGG(s.id ORDER BY s.id)                     AS search_ids
    FROM public.saved_searches s
    JOIN public.profiles p ON p.user_id = s.user_id
    LEFT JOIN public.notification_preferences np ON np.user_id = s.user_id
    WHERE s.section = 'declutter'
      AND s.notify_enabled = true
      AND p.email_verified
      AND COALESCE(p.ban_status, 'active') = 'active'
      AND s.user_id <> v_item.seller_id
      AND (NOT v_seller_seed OR COALESCE(p.is_seed, false))
      AND COALESCE(np.job_matches, true) IS TRUE
      AND NOT COALESCE(np.saved_searches_paused, false)
      -- Declutter Browse for THIS member: the switch is theirs.
      AND public.feature_enabled_for_user('declutter', s.user_id)
      AND NOT EXISTS (SELECT 1 FROM public.user_blocks b
                       WHERE (b.blocker_id = s.user_id AND b.blocked_id = v_item.seller_id)
                          OR (b.blocker_id = v_item.seller_id AND b.blocked_id = s.user_id))
      AND (s.category IS NULL OR s.category = v_item.category)
      AND (s.max_budget IS NULL OR v_item.current_price_cents <= s.max_budget * 100)
      AND (s.min_budget IS NULL OR v_item.current_price_cents >= s.min_budget * 100)
      -- Declutter Browse's rule (DA-1): every word, in the title, description or category, plurals folded.
      AND public.declutter_search_matches(s.query, v_item.title, v_item.description, v_item.category)
      AND (s.radius_miles IS NULL
           OR (p.latitude IS NOT NULL AND p.longitude IS NOT NULL
               AND public.miles_between(p.latitude, p.longitude, v_item.area_lat::numeric, v_item.area_lng::numeric) <= s.radius_miles))
      AND (s.last_notified_at IS NULL OR s.last_notified_at < now() - interval '1 hour')
    GROUP BY s.user_id
    ORDER BY s.user_id
  LOOP
    -- The deliver_saved_search_alert lock: a concurrent send for the same
    -- searches waits, then finds the throttle spent.
    SELECT ARRAY_AGG(x.id)
      INTO v_ids
      FROM (
        SELECT s.id
          FROM public.saved_searches s
         WHERE s.id = ANY(r.search_ids)
           AND s.notify_enabled = true
           AND (s.last_notified_at IS NULL OR s.last_notified_at < now() - interval '1 hour')
         ORDER BY s.id
           FOR UPDATE
      ) x;
    CONTINUE WHEN v_ids IS NULL;

    UPDATE public.saved_searches SET last_notified_at = now() WHERE id = ANY(v_ids);

    v_message := 'Something new matches "' || r.search_name || '": ' || v_item.title || ' (' || v_price || ')';
    PERFORM public.declutter_notify(r.user_id, 'job_match', v_title, v_message, v_link, v_item.seller_id);

    SELECT ARRAY_AGG(s.id)
      INTO v_email_ids
      FROM public.saved_searches s
     WHERE s.id = ANY(v_ids)
       AND s.notify_email
       AND (s.last_emailed_at IS NULL OR s.last_emailed_at < now() - interval '1 day');
    IF v_email_ids IS NOT NULL THEN
      UPDATE public.saved_searches SET last_emailed_at = now() WHERE id = ANY(v_email_ids);
      PERFORM net.http_post(
        url := (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'supabase_url' LIMIT 1) || '/functions/v1/send-notification-email',
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'service_role_key' LIMIT 1)
        ),
        body := jsonb_build_object(
          'user_id', r.user_id,
          'title', v_title,
          'message', v_message,
          'type', 'job_match',
          'link', v_link
        )
      );
    END IF;
    v_sent := v_sent + 1;
  END LOOP;

  RETURN v_sent;
END;
$function$;

REVOKE ALL ON FUNCTION public.deliver_saved_search_item_alerts(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.deliver_saved_search_item_alerts(uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.saved_search_new_counts()
 RETURNS TABLE(search_id uuid, new_count integer)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
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
           -- Declutter Browse's rule (DA-1): every word, in the title, description or category, plurals folded.
           AND public.declutter_search_matches(s.query, i.title, i.description, i.category)
           AND (s.radius_miles IS NULL
                OR (p.latitude IS NOT NULL AND p.longitude IS NOT NULL
                    AND public.miles_between(p.latitude, p.longitude, i.area_lat::numeric, i.area_lng::numeric) <= s.radius_miles))
      )
      ELSE 0
    END
  FROM public.saved_searches s
  LEFT JOIN public.profiles p ON p.user_id = s.user_id
  WHERE s.user_id = (SELECT auth.uid());
$function$;

REVOKE ALL ON FUNCTION public.saved_search_new_counts() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.saved_search_new_counts() TO authenticated;
