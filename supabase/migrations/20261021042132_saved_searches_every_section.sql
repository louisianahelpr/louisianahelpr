-- Q2275 (board 91): saved searches for every section, an alert per channel,
-- and "N new since you looked".
--
-- 1. public.saved_searches is migrated IN PLACE (owner 10-19 ask: saved-search
--    email alerts for Declutter, Shops and Homes; lead 2026-10-21):
--    - section: 'jobs' | 'declutter' | 'shops' | 'homes'. Every existing row is
--      a Jobs search (the DEFAULT fills them), so nothing about them changes.
--      The filters stay the columns they are: query, category, min/max_budget
--      (whole dollars; for Declutter the item's price), radius_miles.
--    - notify_email: the email channel, per search. In the app is always on
--      for a saved search (notify_enabled stays the row's own on/off). Every
--      existing row keeps email (DEFAULT true), as it has today.
--      Email is sent at most once a day per search, and only when something
--      new matched (last_emailed_at). Text messages are not a channel yet:
--      there is no text-alert sender (board 88); the column arrives with it.
--    - last_seen_at: when the member last opened the search's results; the
--      "N new" count is everything that matched since then.
-- 2. notification_preferences.saved_searches_paused: "Pause all alerts" keeps
--    the searches and stops every saved-search alert.
-- 3. Jobs: notify_saved_searches_on_new_job and deliver_saved_search_alert are
--    the live bodies of 20261018035944 with only these changes: they read
--    Jobs searches only, obey the pause, skip a poster on either side of a
--    block (Jobs Browse hides them, Q573), and email only from searches whose
--    email channel is on, once a day.
-- 4. Declutter: a listing that goes live is queued (saved_search_item_queue,
--    one row per item, no person column) and the existing every-minute
--    'saved-search-alert-queue' cron matches it against every Declutter
--    search (deliver_saved_search_item_alerts) under the same visibility as
--    Declutter Browse for that member: the 'declutter' switch for them, the
--    seller not hidden, not a test item, and not across a block. In-app
--    through public.declutter_notify (its seed boundary), email through
--    send-notification-email, type 'job_match' so the existing "Job matches"
--    switches gate both channels exactly as they gate Jobs alerts.
-- 5. saved_search_new_counts(): the member's own searches and how many matches
--    each has since last_seen_at. SECURITY DEFINER because miles_between is
--    not granted to members; it reads only the caller's rows (auth.uid()),
--    Jobs through open_jobs_browse (the Browse view, evaluated for the
--    caller) and Declutter through the declutter_items SELECT policy's own
--    predicate, written out (savedSearchesEverySection.test.ts pins it to the
--    policy). REVOKE FROM PUBLIC, anon.
--
-- Replay-safe: ADD COLUMN IF NOT EXISTS, CREATE TABLE IF NOT EXISTS, guarded
-- constraint add, CREATE OR REPLACE, DROP TRIGGER IF EXISTS before CREATE.

ALTER TABLE public.saved_searches
  ADD COLUMN IF NOT EXISTS section text NOT NULL DEFAULT 'jobs',
  ADD COLUMN IF NOT EXISTS notify_email boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS last_emailed_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_seen_at timestamptz;

DO $do$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                  WHERE conname = 'saved_searches_section_check'
                    AND conrelid = 'public.saved_searches'::regclass) THEN
    ALTER TABLE public.saved_searches
      ADD CONSTRAINT saved_searches_section_check
      CHECK (section IN ('jobs', 'declutter', 'shops', 'homes'));
  END IF;
END
$do$;

ALTER TABLE public.notification_preferences
  ADD COLUMN IF NOT EXISTS saved_searches_paused boolean NOT NULL DEFAULT false;

-- The Declutter queue: one row per listing that just went live. Service only:
-- RLS on with no policy, and no grant to members.
CREATE TABLE IF NOT EXISTS public.saved_search_item_queue (
  item_id uuid PRIMARY KEY REFERENCES public.declutter_items(id) ON DELETE CASCADE,
  queued_at timestamptz NOT NULL DEFAULT now(),
  attempts integer NOT NULL DEFAULT 0,
  retry_after timestamptz
);
ALTER TABLE public.saved_search_item_queue ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.saved_search_item_queue FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.saved_search_item_queue TO service_role;

-- Q807: every public table carries the unconfirmed-email statement gate.
DO $do$
BEGIN
  IF to_regprocedure('public.attach_unconfirmed_email_gate()') IS NOT NULL THEN
    PERFORM public.attach_unconfirmed_email_gate();
  END IF;
END
$do$;

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

CREATE OR REPLACE FUNCTION public.deliver_saved_search_alert(p_user_id uuid, p_job_id uuid, p_search_name text, p_search_ids uuid[])
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_job public.jobs%ROWTYPE;
  v_ids uuid[];
  v_email_ids uuid[];
  v_title TEXT := 'New job matches your saved search';
  v_message TEXT;
  v_link TEXT;
  v_is_urgent BOOLEAN;
BEGIN
  -- FOR SHARE: the job cannot be hired, cancelled or unfunded between this
  -- check and the send. NOWAIT: if a writer (the funding transaction, a hire)
  -- holds the row, this raises lock_not_available instead of waiting, and the
  -- sweep keeps the row for its next run. The sweep never waits on a job.
  SELECT * INTO v_job FROM public.jobs WHERE id = p_job_id FOR SHARE NOWAIT;
  IF NOT FOUND THEN
    RETURN false;
  END IF;

  -- The job must still be what open_jobs_browse shows this user: open,
  -- funded, not under a live direct offer, not a hidden fixture, not
  -- ownerless (the poster deleted their account), not the recipient's own,
  -- and not above the recipient's credential tier (the view's gate, with
  -- get_user_credential_tier(recipient) in place of my_credential_tier()).
  IF v_job.status <> 'open'
     -- A series visit is re-offered only inside its series (20260927015010).
     OR v_job.parent_job_id IS NOT NULL
     OR COALESCE(v_job.payment_status, '') <> ALL (ARRAY['escrow'::text, 'payout_pending'::text, 'released'::text])
     OR (v_job.offered_to_helper_id IS NOT NULL
         AND COALESCE(v_job.direct_offer_status, 'pending') NOT IN ('declined', 'expired'))
     OR (COALESCE(v_job.is_seed, false) AND public.seed_jobs_hidden_publicly())
     OR v_job.customer_id IS NULL
     OR v_job.customer_id = p_user_id
     OR (COALESCE(v_job.credential_tier, 0) <> 0
         AND COALESCE(public.get_user_credential_tier(p_user_id), 0) < v_job.credential_tier)
     -- Q1411: not while the poster is under an open ban settlement review.
     OR EXISTS (SELECT 1 FROM public.ban_settlement_queue q WHERE q.user_id = v_job.customer_id AND q.review_state = 'open')
     -- Q2275: Jobs Browse hides a poster on either side of a block (Q573);
     -- so does the alert.
     OR EXISTS (SELECT 1 FROM public.user_blocks b
                 WHERE (b.blocker_id = p_user_id AND b.blocked_id = v_job.customer_id)
                    OR (b.blocker_id = v_job.customer_id AND b.blocked_id = p_user_id))
  THEN
    RETURN false;
  END IF;

  -- V-008: never before the job is in this user's feed.
  IF public.early_access_visible_at(p_user_id, v_job.created_at) > now() THEN
    RETURN false;
  END IF;

  -- The recipient must still be verified, active and opted in to job matches.
  PERFORM 1
    FROM public.profiles p
    LEFT JOIN public.notification_preferences np ON np.user_id = p.user_id
   WHERE p.user_id = p_user_id
     AND p.email_verified
     AND COALESCE(p.ban_status, 'active') = 'active'
     -- Q2275: "Pause all alerts".
     AND NOT COALESCE(np.saved_searches_paused, false)
     AND COALESCE(np.job_matches, true) IS TRUE;
  IF NOT FOUND THEN
    RETURN false;
  END IF;

  v_is_urgent := COALESCE(v_job.is_urgent, false);

  -- ST-011: the matched searches that still notify and are past the hourly
  -- throttle. None left means this alert is dropped, as a throttled match is.
  -- FOR UPDATE (in id order, so two sends cannot deadlock): a concurrent send
  -- for the same searches waits here, then re-reads last_notified_at after the
  -- first one's stamp commits and finds nothing left. Without the lock both
  -- read the old stamp and both send.
  SELECT ARRAY_AGG(x.id)
    INTO v_ids
    FROM (
      SELECT s.id
        FROM public.saved_searches s
       WHERE s.id = ANY(p_search_ids)
         AND s.user_id = p_user_id
         AND s.notify_enabled = true
         AND s.section = 'jobs'
         AND (s.last_notified_at IS NULL OR s.last_notified_at < now() - interval '1 hour')
       ORDER BY s.id
         FOR UPDATE
    ) x;
  IF v_ids IS NULL THEN
    RETURN false;
  END IF;

  -- ST-011: the throttle is spent only when the user is actually notified.
  UPDATE public.saved_searches
     SET last_notified_at = now()
   WHERE id = ANY(v_ids); -- ST-011 stamp on notify only

  -- Q2275: email is its own channel per search, at most once a day, and only
  -- when something new matched (this send is that something). The in-app
  -- alert above is always on for a saved search.
  SELECT ARRAY_AGG(s.id)
    INTO v_email_ids
    FROM public.saved_searches s
   WHERE s.id = ANY(v_ids)
     AND s.notify_email
     AND (s.last_emailed_at IS NULL OR s.last_emailed_at < now() - interval '1 day');

  v_link := '/home?job=' || v_job.id::text;
  v_message :=
    'A new job matches "' || p_search_name || '": '
    || v_job.title || ' ($' || v_job.budget || ')'
    || CASE WHEN v_is_urgent THEN ' · Urgent' ELSE '' END;

  INSERT INTO public.notifications (user_id, title, message, type, link)
  VALUES (p_user_id, v_title, v_message, 'job_match', v_link);

  IF v_email_ids IS NOT NULL THEN
  UPDATE public.saved_searches
     SET last_emailed_at = now()
   WHERE id = ANY(v_email_ids);

  PERFORM net.http_post(
    url := (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'supabase_url' LIMIT 1) || '/functions/v1/send-notification-email',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'service_role_key' LIMIT 1)
    ),
    body := jsonb_build_object(
      'user_id', p_user_id,
      'title', v_title,
      'message', v_message,
      'type', 'job_match',
      'link', v_link
    )
  );
  END IF;

  RETURN true;
END;
$function$;

REVOKE ALL ON FUNCTION public.deliver_saved_search_alert(uuid, uuid, text, uuid[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.deliver_saved_search_alert(uuid, uuid, text, uuid[]) TO service_role;

-- A Declutter listing just went live: match it against every Declutter saved
-- search and alert each member once. Returns the members alerted. Service
-- only; the sweep calls it.
CREATE OR REPLACE FUNCTION public.deliver_saved_search_item_alerts(p_item uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
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
      -- Declutter Browse and /search match the title.
      AND (s.query IS NULL OR btrim(s.query) = ''
           OR strpos(lower(v_item.title), lower(btrim(s.query))) > 0)
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
$fn$;
REVOKE ALL ON FUNCTION public.deliver_saved_search_item_alerts(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.deliver_saved_search_item_alerts(uuid) TO service_role;

-- Every way a listing goes live (publish, admin approval, back on sale)
-- queues it once; nothing else runs in that transaction.
CREATE OR REPLACE FUNCTION public.saved_search_on_item_live()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
BEGIN
  INSERT INTO public.saved_search_item_queue (item_id) VALUES (NEW.id)
  ON CONFLICT (item_id) DO UPDATE SET attempts = 0, retry_after = NULL, queued_at = now();
  RETURN NULL;
END;
$fn$;
REVOKE ALL ON FUNCTION public.saved_search_on_item_live() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS saved_search_on_item_live ON public.declutter_items;
CREATE TRIGGER saved_search_on_item_live
  AFTER UPDATE OF status ON public.declutter_items
  FOR EACH ROW
  WHEN (NEW.status = 'live' AND OLD.status IS DISTINCT FROM 'live')
  EXECUTE FUNCTION public.saved_search_on_item_live();
DROP TRIGGER IF EXISTS saved_search_on_item_insert_live ON public.declutter_items;
CREATE TRIGGER saved_search_on_item_insert_live
  AFTER INSERT ON public.declutter_items
  FOR EACH ROW
  WHEN (NEW.status = 'live')
  EXECUTE FUNCTION public.saved_search_on_item_live();

-- "N new since you looked", per saved search of the CALLER. Each count uses
-- that section's Browse visibility for the caller (see the header, item 5).
-- Shops and Homes searches cannot match anything until those sections open,
-- so they count 0 (the list shows no badge for 0).
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
           AND (s.category IS NULL OR s.category = j.category::text)
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


CREATE OR REPLACE FUNCTION public.sweep_saved_search_alert_queue()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  r RECORD;
  v_sent integer := 0;
  v_max_attempts CONSTANT integer := 5;
BEGIN
  -- Any lock wait in this run is bounded; a send that hits it stays queued.
  PERFORM set_config('lock_timeout', '5s', true);

  -- Due = the job is in the user's feed by their CURRENT tier (an upgrade
  -- since queueing makes a row due early; notify_at is the estimate made at
  -- queue time). (user_id, id) order: see deliver's saved_searches lock.
  FOR r IN
    SELECT q.id, q.user_id, q.job_id, q.search_name, q.matched_search_ids,
           COALESCE(j.is_seed, false) AS job_is_seed
      FROM public.saved_search_alert_queue q
      JOIN public.jobs j ON j.id = q.job_id
     WHERE public.early_access_visible_at(q.user_id, j.created_at) <= now()
     ORDER BY q.user_id, q.id
     LIMIT 1000
       FOR UPDATE OF q SKIP LOCKED
  LOOP
    BEGIN
      -- Deleted before sending: a second run can never pick this row up
      -- again. deliver_saved_search_alert re-checks the job, the user and the
      -- throttle, so a job cancelled, hired or unfunded meanwhile is dropped
      -- unsent.
      DELETE FROM public.saved_search_alert_queue WHERE id = r.id;
      IF public.deliver_saved_search_alert(r.user_id, r.job_id, r.search_name, r.matched_search_ids) THEN
        v_sent := v_sent + 1;
      END IF;
    EXCEPTION
      WHEN lock_not_available THEN
        -- The job or a saved search is held by another writer (NOWAIT or the
        -- 5s lock_timeout). The block's DELETE rolls back with it, so the row
        -- stays queued and the next run retries it; nothing was sent.
        NULL;
      WHEN OTHERS THEN
        -- One row that raises must not roll back every other send in this
        -- run and then raise again every minute. Only this send's writes roll
        -- back; the row is dropped and the failure goes to error_logs. A seed
        -- (E2E) job's failure is logged under a '-seed' source with
        -- tags.seed, so a fixture never reads as a real delivery failure.
        DELETE FROM public.saved_search_alert_queue WHERE id = r.id;
        INSERT INTO public.error_logs (severity, message, tags)
        VALUES ('error', 'saved-search alert not sent: ' || SQLERRM,
                jsonb_build_object('source', 'saved-search-alert-queue' || CASE WHEN r.job_is_seed THEN '-seed' ELSE '' END,
                                   'area', 'notifications', 'seed', r.job_is_seed,
                                   'job_id', r.job_id, 'user_id', r.user_id));
    END;
  END LOOP;

  -- Q225: the parish job-match queue, same rules. (user_id, id) order keeps
  -- two runs from taking the same user's rows in opposite orders.
  FOR r IN
    SELECT q.id, q.user_id, q.job_id, q.attempts,
           COALESCE(j.is_seed, false) AS job_is_seed
      FROM public.parish_match_alert_queue q
      JOIN public.jobs j ON j.id = q.job_id
     WHERE (q.retry_after IS NULL OR q.retry_after <= now())  -- Q723 backoff
       AND public.early_access_visible_at(q.user_id, j.created_at) <= now()
     ORDER BY q.user_id, q.id
     LIMIT 1000
       FOR UPDATE OF q SKIP LOCKED
  LOOP
    BEGIN
      DELETE FROM public.parish_match_alert_queue WHERE id = r.id;
      IF public.deliver_parish_match_alert(r.user_id, r.job_id) THEN
        v_sent := v_sent + 1;
      END IF;
    EXCEPTION
      WHEN lock_not_available OR deadlock_detected OR serialization_failure THEN
        -- Transient: not an attempt. The row stays queued for next run.
        NULL;
      WHEN OTHERS THEN
        -- Q723: the DELETE and the ledger claim rolled back with the send, so
        -- the row is still here. It retries after 5, 10, 20, 40 minutes (a
        -- warning each time); the 5th failure deletes it and logs an error.
        IF r.attempts + 1 < v_max_attempts THEN
          UPDATE public.parish_match_alert_queue
             SET attempts = r.attempts + 1,
                 retry_after = now() + interval '5 minutes' * power(2, r.attempts)
           WHERE id = r.id;
        ELSE
          DELETE FROM public.parish_match_alert_queue WHERE id = r.id;
        END IF;
        INSERT INTO public.error_logs (severity, message, tags)
        VALUES (CASE WHEN r.attempts + 1 < v_max_attempts THEN 'warning' ELSE 'error' END,
                CASE WHEN r.attempts + 1 < v_max_attempts THEN 'parish job-match alert failed, will retry: '
                     ELSE 'parish job-match alert not sent: ' END || SQLERRM,
                jsonb_build_object('source', 'parish-match-alert-queue' || CASE WHEN r.job_is_seed THEN '-seed' ELSE '' END,
                                   'area', 'notifications', 'seed', r.job_is_seed,
                                   'attempt', r.attempts + 1,
                                   'job_id', r.job_id, 'user_id', r.user_id));
    END;
  END LOOP;

  -- Q2275: Declutter saved searches. A listing that just went live is queued
  -- once (saved_search_on_item_live); each item is matched against every
  -- Declutter search in its own subtransaction, with the parish queue's
  -- retry rules: a lock is not an attempt, the 5th failure drops the row.
  FOR r IN
    SELECT q.item_id, q.attempts, COALESCE(i.is_seed, false) AS item_is_seed
      FROM public.saved_search_item_queue q
      JOIN public.declutter_items i ON i.id = q.item_id
     WHERE (q.retry_after IS NULL OR q.retry_after <= now())
     ORDER BY q.queued_at, q.item_id
     LIMIT 200
       FOR UPDATE OF q SKIP LOCKED
  LOOP
    BEGIN
      DELETE FROM public.saved_search_item_queue WHERE item_id = r.item_id;
      v_sent := v_sent + public.deliver_saved_search_item_alerts(r.item_id);
    EXCEPTION
      WHEN lock_not_available OR deadlock_detected OR serialization_failure THEN
        NULL;
      WHEN OTHERS THEN
        IF r.attempts + 1 < v_max_attempts THEN
          UPDATE public.saved_search_item_queue
             SET attempts = r.attempts + 1,
                 retry_after = now() + interval '5 minutes' * power(2, r.attempts)
           WHERE item_id = r.item_id;
        ELSE
          DELETE FROM public.saved_search_item_queue WHERE item_id = r.item_id;
        END IF;
        INSERT INTO public.error_logs (severity, message, tags)
        VALUES (CASE WHEN r.attempts + 1 < v_max_attempts THEN 'warning' ELSE 'error' END,
                CASE WHEN r.attempts + 1 < v_max_attempts THEN 'Declutter saved-search alert failed, will retry: '
                     ELSE 'Declutter saved-search alert not sent: ' END || SQLERRM,
                jsonb_build_object('source', 'saved-search-item-queue' || CASE WHEN r.item_is_seed THEN '-seed' ELSE '' END,
                                   'area', 'notifications', 'seed', r.item_is_seed,
                                   'attempt', r.attempts + 1, 'item_id', r.item_id));
    END;
  END LOOP;

  RETURN v_sent;
END;
$function$;

REVOKE ALL ON FUNCTION public.sweep_saved_search_alert_queue() FROM PUBLIC, anon, authenticated;