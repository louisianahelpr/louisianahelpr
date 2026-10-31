-- BUY-50 (buying audit 10-30 #50): matches inside the hour were dropped. A Declutter saved search alerts at most once
-- an hour, and the queue row was deleted when the item was matched, so a member whose search had just alerted never
-- heard of a second listing at all (only the "N new" count still had it).
--
-- Now a match inside the hour is HELD, not dropped:
--   * saved_search_item_matches keeps, per listing and search, whether the member was told (held = false) or is
--     still owed it (held = true).
--   * The listing goes back on saved_search_item_queue with retry_after = the end of that member's hour, so the
--     every-minute sweep (sweep_saved_search_alert_queue, unchanged) runs it again then. A re-run only reaches the
--     searches still holding it, so nobody hears of one listing twice.
--   * When a member is told, the other listings held for their searches are told with it, in the same alert:
--     "Something new matches “mug” in Declutter: Blue mug ($5), and 2 more". Those still live are counted; all are
--     marked told.
--   * A listing that goes live again (relist) starts fresh: saved_search_on_item_live clears its rows.
-- The bell and email words are otherwise D4-15's; the daily email throttle is unchanged (an email still goes at most
-- once a day per search, now with the same "and N more").
--
-- RESTATED FROM: deliver_saved_search_item_alerts in 20261031023451_saved_search_keeps_its_origin.sql (BUY-49: the
-- distance from where the search was saved) and saved_search_on_item_live in 20261021042132_saved_searches_every_section.sql
-- (origin/main's newest CREATE of each, 2026-10-31). Who is matched (every filter, BUY-49's origin included), the seed
-- rules, the lock order, the hourly and daily throttles and the grants are unchanged. No money moves.
-- REPLAY-SAFE: CREATE TABLE IF NOT EXISTS, CREATE OR REPLACE. Proof: src/test/pglite/declutterSavedSearchHeldMatches.pglite.mjs
-- (applied 3x). Guard: src/test/declutterSavedSearchHeldMatches.test.ts.

-- 1. Who was told of which listing, and who is still owed it. Service only: RLS on, no policy, no member grant.
--    Keyed by search, so deleting a search (or the account, which deletes its searches) deletes its rows.
CREATE TABLE IF NOT EXISTS public.saved_search_item_matches (
  item_id uuid NOT NULL REFERENCES public.declutter_items(id) ON DELETE CASCADE,
  search_id uuid NOT NULL REFERENCES public.saved_searches(id) ON DELETE CASCADE,
  held boolean NOT NULL,
  at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (item_id, search_id)
);
-- Both foreign keys lead an index: the key (item_id) and this one (search_id), which the "told" update reads.
-- Unique, so the unused-index advisor (non-unique only) never counts it.
CREATE UNIQUE INDEX IF NOT EXISTS saved_search_item_matches_search_item_key ON public.saved_search_item_matches (search_id, item_id);
ALTER TABLE public.saved_search_item_matches ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.saved_search_item_matches FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.saved_search_item_matches TO service_role;

-- Q807: every public table carries the unconfirmed-email statement gate.
DO $do$
BEGIN
  IF to_regprocedure('public.attach_unconfirmed_email_gate()') IS NOT NULL THEN
    PERFORM public.attach_unconfirmed_email_gate();
  END IF;
END
$do$;

-- 2. A listing that goes live (again) is matched afresh.
CREATE OR REPLACE FUNCTION public.saved_search_on_item_live()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
BEGIN
  DELETE FROM public.saved_search_item_matches WHERE item_id = NEW.id;
  INSERT INTO public.saved_search_item_queue (item_id) VALUES (NEW.id)
  ON CONFLICT (item_id) DO UPDATE SET attempts = 0, retry_after = NULL, queued_at = now();
  RETURN NULL;
END;
$fn$;
REVOKE ALL ON FUNCTION public.saved_search_on_item_live() FROM PUBLIC, anon, authenticated;

-- 3. The alert: told now, or held to the end of the member's hour.
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
      -- BUY-50: on a re-run, only the searches still owed this listing.
      AND (NOT v_rerun OR EXISTS (SELECT 1 FROM public.saved_search_item_matches m
                                   WHERE m.item_id = v_item.id AND m.search_id = s.id AND m.held))
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
