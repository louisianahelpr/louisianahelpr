-- BUY-52 (buying audit 10-30 #52): a price drop into a saved search's budget never alerted. The Declutter saved-search
-- alert ran only when a listing went live (saved_search_on_item_live: INSERT live, or status -> live), so a $60 lamp
-- dropped to $40 never reached a "lamp, up to $50" search.
--
-- Now:
--   * saved_search_on_item_price_drop: AFTER UPDATE OF current_price_cents on a live listing whose price went DOWN,
--     the listing goes back on saved_search_item_queue (the every-minute sweep runs the alert). Unlike the live
--     trigger it keeps the listing's saved_search_item_matches rows, so nobody already told hears of it twice.
--   * deliver_saved_search_item_alerts: on a re-run (the listing has match rows) it skipped every search without a
--     HELD row; it now skips only the searches already TOLD (held = false). A search with no row is matched by the
--     same filters as ever, so it is reached only when the listing now matches it (the price is the one thing that
--     changed). A held search is still told at the end of its hour, as BUY-50 made it.
--   * declutter_item_price_drops: every such drop is written down (when, from what price, to what). It is what the
--     count reads: the alert's match rows exist only for searches with alerts on.
--   * saved_search_new_counts: a Declutter search's "N new" also counts a listing whose price dropped from OVER that
--     search's top price since the member last looked (it now matches, so it is in budget). Counted once, however many
--     drops: the count is of listings.
--   * declutter_dropped_into_budget(since, top): the ids the count's drop rule takes, for a member, so Browse opened from
--     the search marks the same listings New (resultsPath's `new=` and `max=`). Ids only: no past prices leave the
--     database.
--
-- RESTATED FROM: deliver_saved_search_item_alerts in 20261031091529_declutter_saved_search_held_matches.sql and
-- saved_search_new_counts in 20261031023451_saved_search_keeps_its_origin.sql (origin/main's newest CREATEs,
-- checked with git grep on origin/main 2026-10-31 17:12 CT); one clause changed in each (marked BUY-52). Who is
-- matched, the seed rules, the lock order, the hourly and daily throttles and the grants are unchanged. No money moves.
-- REPLAY-SAFE: IF NOT EXISTS; CREATE OR REPLACE; DROP TRIGGER IF EXISTS before CREATE TRIGGER.
-- Proof: src/test/pglite/declutterSavedSearchPriceDrop.pglite.mjs (applied 3x; NEW_MIGRATION=skip is red).

-- 1. A live listing's price went down: write it down, and run its alert again.
CREATE TABLE IF NOT EXISTS public.declutter_item_price_drops (
  item_id uuid NOT NULL REFERENCES public.declutter_items(id) ON DELETE CASCADE,
  at timestamptz NOT NULL DEFAULT now(),
  from_cents integer NOT NULL,
  to_cents integer NOT NULL
);
CREATE INDEX IF NOT EXISTS declutter_item_price_drops_item_at ON public.declutter_item_price_drops (item_id, at);
-- Read only through the two functions below (definer); no member reads the rows.
ALTER TABLE public.declutter_item_price_drops ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.declutter_item_price_drops FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.declutter_item_price_drops TO service_role;

CREATE OR REPLACE FUNCTION public.saved_search_on_item_price_drop()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
BEGIN
  INSERT INTO public.declutter_item_price_drops (item_id, from_cents, to_cents)
  VALUES (NEW.id, OLD.current_price_cents, NEW.current_price_cents);
  INSERT INTO public.saved_search_item_queue (item_id) VALUES (NEW.id)
  ON CONFLICT (item_id) DO UPDATE SET attempts = 0, retry_after = NULL, queued_at = now();
  RETURN NULL;
END;
$fn$;
REVOKE ALL ON FUNCTION public.saved_search_on_item_price_drop() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS saved_search_on_item_price_drop ON public.declutter_items;
CREATE TRIGGER saved_search_on_item_price_drop
  AFTER UPDATE OF current_price_cents ON public.declutter_items
  FOR EACH ROW
  WHEN (NEW.status = 'live' AND OLD.status = 'live' AND NEW.current_price_cents < OLD.current_price_cents)
  EXECUTE FUNCTION public.saved_search_on_item_price_drop();

-- 2. The alert: a re-run skips only the searches already told.
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
  v_rerun boolean;
  v_more integer;
  v_retry timestamptz;
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
  -- BUY-50: a listing with match rows was matched before; this run is for the searches still owed it.
  v_rerun := EXISTS (SELECT 1 FROM public.saved_search_item_matches m WHERE m.item_id = v_item.id);

  FOR r IN
    SELECT
      s.user_id,
      (ARRAY_AGG(s.name ORDER BY s.created_at DESC) FILTER (WHERE s.last_notified_at IS NULL OR s.last_notified_at < now() - interval '1 hour'))[1] AS search_name,
      ARRAY_AGG(s.id ORDER BY s.id) FILTER (WHERE s.last_notified_at IS NULL OR s.last_notified_at < now() - interval '1 hour') AS search_ids,
      ARRAY_AGG(s.id ORDER BY s.id)                     AS all_ids,
      MIN(s.last_notified_at) FILTER (WHERE s.last_notified_at >= now() - interval '1 hour') + interval '1 hour' AS free_at
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
      -- BUY-49: from where the search was saved; else the profile, as before.
      AND (s.radius_miles IS NULL
           OR (COALESCE(s.origin_lat, p.latitude) IS NOT NULL AND COALESCE(s.origin_lng, p.longitude) IS NOT NULL
               AND public.miles_between(COALESCE(s.origin_lat, p.latitude), COALESCE(s.origin_lng, p.longitude), v_item.area_lat::numeric, v_item.area_lng::numeric) <= s.radius_miles))
      -- BUY-50: on a re-run, never a search already told of this listing. BUY-52: a search with no row for it is
      -- reached too (its price dropped into that search's budget; else the filters above still say no).
      AND (NOT v_rerun OR NOT EXISTS (SELECT 1 FROM public.saved_search_item_matches m
                                       WHERE m.item_id = v_item.id AND m.search_id = s.id AND NOT m.held))
    GROUP BY s.user_id
    ORDER BY s.user_id
  LOOP
    v_ids := NULL;
    IF r.search_ids IS NOT NULL THEN
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
    END IF;

    IF v_ids IS NULL THEN
      -- BUY-50: inside the member's hour. Held, and the listing comes back when the hour is up.
      INSERT INTO public.saved_search_item_matches (item_id, search_id, held, at)
        SELECT v_item.id, x, true, now() FROM unnest(r.all_ids) x
      ON CONFLICT (item_id, search_id) DO UPDATE SET held = true, at = now();
      v_retry := LEAST(v_retry, COALESCE(r.free_at, now() + interval '1 hour'));
      CONTINUE;
    END IF;

    UPDATE public.saved_searches SET last_notified_at = now() WHERE id = ANY(v_ids);

    -- BUY-50: the listings held for this member's searches are told now, with this one; the live ones are counted.
    WITH told AS (
      UPDATE public.saved_search_item_matches m
         SET held = false, at = now()
       WHERE m.held
         AND m.item_id <> v_item.id
         AND m.search_id IN (SELECT s.id FROM public.saved_searches s WHERE s.user_id = r.user_id AND s.section = 'declutter')
      RETURNING m.item_id
    )
    SELECT COUNT(DISTINCT t.item_id) INTO v_more
      FROM told t JOIN public.declutter_items i ON i.id = t.item_id AND i.status = 'live';
    INSERT INTO public.saved_search_item_matches (item_id, search_id, held, at)
      SELECT v_item.id, x, false, now() FROM unnest(r.all_ids) x
    ON CONFLICT (item_id, search_id) DO UPDATE SET held = false, at = now();

    -- D4-15: the default name already carries its own quotes and "in Declutter" (src/lib/savedSearches.ts defaultName),
    -- so it is written as it is. Only a name with neither is quoted here.
    v_message := 'Something new matches '
      || CASE WHEN r.search_name ~ '["“”]' OR r.search_name ~ ' in Declutter$' THEN r.search_name
              ELSE '"' || r.search_name || '"' END
      || ': ' || v_item.title || ' (' || v_price || ')'
      || CASE WHEN v_more > 0 THEN ', and ' || v_more || ' more' ELSE '' END;
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

  -- BUY-50: someone is still owed this listing: back on the queue for the end of the earliest hour.
  -- (sweep_saved_search_alert_queue deleted the row just before this call; a failure rolls this back with it.)
  IF v_retry IS NOT NULL THEN
    INSERT INTO public.saved_search_item_queue (item_id, retry_after) VALUES (v_item.id, v_retry)
    ON CONFLICT (item_id) DO UPDATE SET retry_after = EXCLUDED.retry_after, attempts = 0;
  END IF;

  RETURN v_sent;
END;
$function$;

REVOKE ALL ON FUNCTION public.deliver_saved_search_item_alerts(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.deliver_saved_search_item_alerts(uuid) TO service_role;

-- 3. The listings whose price dropped from over `p_max_budget` (dollars, a search's top price) since `p_since`.
--    No top price: none (a drop never brings a listing into a budget it has no top to). Only live listings; who may see
--    one is the caller's own saved_search_new_counts / Browse filter, which still applies every other rule.
CREATE OR REPLACE FUNCTION public.declutter_dropped_into_budget(p_since timestamptz, p_max_budget numeric)
 RETURNS SETOF uuid
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT DISTINCT d.item_id
    FROM public.declutter_item_price_drops d
    JOIN public.declutter_items i ON i.id = d.item_id AND i.status = 'live'
   WHERE p_max_budget IS NOT NULL
     AND p_since IS NOT NULL
     AND d.at > p_since
     AND d.from_cents > p_max_budget * 100
     AND i.current_price_cents <= p_max_budget * 100;
$function$;
REVOKE ALL ON FUNCTION public.declutter_dropped_into_budget(timestamptz, numeric) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.declutter_dropped_into_budget(timestamptz, numeric) TO authenticated, service_role;

-- 4. "N new": also the listings that dropped into the search's budget since the last look.
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
           -- BUY-52: new since the last look, or dropped into this search's budget since then.
           AND (i.live_at > COALESCE(s.last_seen_at, s.created_at)
                OR i.id IN (SELECT public.declutter_dropped_into_budget(COALESCE(s.last_seen_at, s.created_at), s.max_budget)))
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
                OR (COALESCE(s.origin_lat, p.latitude) IS NOT NULL AND COALESCE(s.origin_lng, p.longitude) IS NOT NULL
                    AND public.miles_between(COALESCE(s.origin_lat, p.latitude), COALESCE(s.origin_lng, p.longitude), i.area_lat::numeric, i.area_lng::numeric) <= s.radius_miles))
      )
      ELSE 0
    END
  FROM public.saved_searches s
  LEFT JOIN public.profiles p ON p.user_id = s.user_id
  WHERE s.user_id = (SELECT auth.uid());
$function$;

REVOKE ALL ON FUNCTION public.saved_search_new_counts() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.saved_search_new_counts() TO authenticated;
