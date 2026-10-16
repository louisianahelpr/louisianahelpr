-- DECLUTTER: WANTED POSTS + FAIR-PRICE HINT (owner, 2026-10-16; spec rows 76
-- and 87 of docs/specs/declutter-auctions.md; this feature's own decision
-- record, with every default the lane picked, is docs/specs/declutter-wanted-price-hint.md,
-- cited as "W<n>").
--
-- (a) WANTED POSTS. A member says what they are looking for (words, category,
--     highest price, how far). Members whose LIVE listing matches get a bell +
--     push ("Someone near you wants an item like your "White crib" for $80 or
--     less"; W15: the poster's own words never reach anyone else), now and
--     when a match is listed later; the poster gets one when a match at or
--     under their price is listed later (they see current matches on screen).
--       declutter_wanted          the posts. RLS: the poster reads their own;
--                                 nobody else (W3). Written only by RPCs.
--       declutter_wanted_matches  (post, item) ledger: each pair alerts at most
--                                 once per side, ever (W6). No client privilege,
--                                 never exported (seller_notified_at would be a
--                                 hidden-floor oracle to the poster).
--       declutter_wanted_queue    listings that went live, matched by the cron
--                                 'declutter-wanted' every 10 minutes, so no
--                                 alert work runs inside a publish, approval or
--                                 refund transaction (review 2026-10-16).
--       declutter_create_wanted / declutter_close_wanted / declutter_my_wanted
--                                 the client RPCs.
--     Gates (W4): the 'declutter' AND 'declutter_wanted' switches for the
--     caller (require_feature), for every RECIPIENT and for the poster of every
--     matched post (feature_enabled_for_user); signed in, not banned, fewer
--     than 3 Declutter strikes, not under 18 (row 53: a wanted post is a
--     buying intent); a block either way stops every alert; a hidden seller
--     (declutter_seller_out) is never matched; the recipient's 'New offers'
--     switch (notification_preferences.new_offers, unset = on); seed (test)
--     posts and listings only ever meet each other.
--     Rate limits (W7): 5 new posts a day and 10 open per member; a post
--     alerts at most 20 sellers when made (nearest first); a seller gets at
--     most 5 wanted alerts a day and at most 1 a week from the same poster; a
--     poster at most 10 match alerts a day. A cap or ledger stamp is spent only
--     on a notification really written.
--     Free text: ASCII words only, no web address or phone number (W8), then
--     contact_leak_reason (rejected, never hidden).
--
-- (b) FAIR-PRICE HINT. declutter_price_hint(category, condition, lat, lng):
--     "Most items like this sold for $X-$Y", computed ONLY from our own
--     completed Declutter sales (order handed over, line paid), same category
--     and same condition stars, item within 25 miles of the point snapped to a
--     0.1-degree grid, handed over in the last 365 days, no seed row anywhere
--     (order, line, item, either profile), no side now banned or at 3 strikes,
--     one sale per buyer-seller pair. It answers only with at least 11 such
--     sales from at least 3 sellers AND 3 buyers (W10); otherwise no row, and
--     the app shows nothing. X/Y are the 10th/90th percentile (nearest rank),
--     rounded OUTWARD to $5, so at least 80% of the sales counted lie inside
--     ("most" is true) and neither end is the single cheapest or dearest sale.
--     The count comes back in tens. Behind 'declutter' AND 'declutter_price_hint'.
--
-- Error codes: 42501 refusals (feature_disabled, not_authenticated,
-- account_restricted, declutter_strikes_blocked, under_18,
-- wanted_rate_limited, wanted_open_limit), 22023 bad input
-- (invalid_wanted_text, invalid_category, invalid_max_price,
-- invalid_radius, wanted_area_unknown), P0002 a post the caller cannot act on.
--
-- Replay-safe: IF NOT EXISTS / OR REPLACE / DROP ... IF EXISTS / ON CONFLICT
-- DO NOTHING; grants restated by role name, REVOKE ... FROM PUBLIC, anon (and
-- authenticated for internal helpers). Applied 3x in PGlite by
-- src/test/pglite/declutterWantedPriceHint.pglite.mjs.

-- ---------------------------------------------------------------------------
-- 0. The hidden switches, testers only (W1). Each needs 'declutter' too, which
--    every RPC below also requires.
INSERT INTO public.feature_switches (key, audience, description)
VALUES ('declutter_wanted', 'testers',
        'Declutter wanted posts: members post what they are looking for and matching sellers are told. '
        'Gates declutter_create_wanted / _close_wanted / _my_wanted and every wanted alert (needs declutter too).')
ON CONFLICT (key) DO NOTHING;
INSERT INTO public.feature_switches (key, audience, description)
VALUES ('declutter_price_hint', 'testers',
        'Declutter fair-price hint: "Most similar items sold for $X-$Y near you" from our own completed sales. '
        'Gates declutter_price_hint (needs declutter too).')
ON CONFLICT (key) DO NOTHING;

-- ---------------------------------------------------------------------------
-- 1. Straight-line miles between two points (the coarse public points, B7).
--    Internal; a NULL in gives NULL out (a NULL distance never matches).
CREATE OR REPLACE FUNCTION public.declutter_miles(p_lat1 numeric, p_lng1 numeric, p_lat2 numeric, p_lng2 numeric)
RETURNS double precision
LANGUAGE sql
IMMUTABLE
SET search_path TO 'public', 'pg_temp'
AS $fn$
  SELECT 2 * 3958.8 * asin(least(1, sqrt(
           sin(radians((p_lat2 - p_lat1)::double precision) / 2) ^ 2
           + cos(radians(p_lat1::double precision)) * cos(radians(p_lat2::double precision))
             * sin(radians((p_lng2 - p_lng1)::double precision) / 2) ^ 2)));
$fn$;
REVOKE ALL ON FUNCTION public.declutter_miles(numeric, numeric, numeric, numeric) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.declutter_miles(numeric, numeric, numeric, numeric) TO service_role;

-- "$80" / "$80.50" for notification words. Internal.
CREATE OR REPLACE FUNCTION public.declutter_money_words(p_cents integer)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path TO 'public', 'pg_temp'
AS $fn$
  SELECT CASE WHEN p_cents % 100 = 0 THEN '$' || to_char(p_cents / 100, 'FM9,999,990')
              ELSE '$' || to_char(p_cents / 100.0, 'FM9,999,990.00') END;
$fn$;
REVOKE ALL ON FUNCTION public.declutter_money_words(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.declutter_money_words(integer) TO service_role;

-- ---------------------------------------------------------------------------
-- 2. Wanted posts.
CREATE TABLE IF NOT EXISTS public.declutter_wanted (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  -- What they want, in their words ("crib", "oak dresser"). Shown to the
  -- poster ONLY (W15: never echoed in a seller's alert); still contact-leak
  -- checked (trigger below) and plain characters (W8).
  what text NOT NULL CHECK (char_length(btrim(what)) BETWEEN 3 AND 60),
  category text NOT NULL CHECK (category ~ '^[a-z][a-z0-9_]{1,39}$'),
  -- Row 70: within the $1,000 per-item cap.
  max_price_cents integer NOT NULL CHECK (max_price_cents BETWEEN 100 AND 100000),
  -- The Browse distance choices (src/lib/declutter/distance.ts), "any" excluded.
  radius_miles smallint NOT NULL CHECK (radius_miles IN (5, 10, 25, 50)),
  -- Coarse point (2 decimals, ~1 km, as B7): never a door.
  area_lat numeric(5,2) NOT NULL CHECK (area_lat BETWEEN -90 AND 90),
  area_lng numeric(6,2) NOT NULL CHECK (area_lng BETWEEN -180 AND 180),
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'closed')),
  -- W2: a post stops matching 30 days after it was made.
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '30 days'),
  is_seed boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  closed_at timestamptz,
  CONSTRAINT declutter_wanted_closed_at CHECK ((status = 'closed') = (closed_at IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS declutter_wanted_user_idx ON public.declutter_wanted (user_id, created_at);
CREATE INDEX IF NOT EXISTS declutter_wanted_open_idx ON public.declutter_wanted (category, expires_at) WHERE status = 'open';
ALTER TABLE public.declutter_wanted ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.declutter_wanted FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.declutter_wanted TO authenticated;
GRANT ALL ON TABLE public.declutter_wanted TO service_role;
DROP POLICY IF EXISTS "declutter wanted: poster reads own" ON public.declutter_wanted;
CREATE POLICY "declutter wanted: poster reads own" ON public.declutter_wanted
  FOR SELECT TO authenticated USING (user_id = (SELECT auth.uid()));
COMMENT ON TABLE public.declutter_wanted IS
  'Declutter wanted posts (docs/specs/declutter-wanted-price-hint.md). The poster reads their own; '
  'written only by declutter_create_wanted / declutter_close_wanted.';

-- (post, item) alert ledger: each pair alerts each side at most once (W6).
CREATE TABLE IF NOT EXISTS public.declutter_wanted_matches (
  wanted_id uuid NOT NULL REFERENCES public.declutter_wanted(id) ON DELETE CASCADE,
  item_id uuid NOT NULL REFERENCES public.declutter_items(id) ON DELETE CASCADE,
  seller_notified_at timestamptz,
  poster_notified_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (wanted_id, item_id)
);
CREATE INDEX IF NOT EXISTS declutter_wanted_matches_item_idx ON public.declutter_wanted_matches (item_id);
ALTER TABLE public.declutter_wanted_matches ENABLE ROW LEVEL SECURITY;
-- No policy and no client privilege: read only by the definer functions below.
REVOKE ALL ON TABLE public.declutter_wanted_matches FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.declutter_wanted_matches TO service_role;

-- is_seed at birth from the poster's profile (B16's rule).
CREATE OR REPLACE FUNCTION public.declutter_wanted_seed_from_poster()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
BEGIN
  NEW.is_seed := COALESCE((SELECT p.is_seed FROM public.profiles p WHERE p.user_id = NEW.user_id), false);
  RETURN NEW;
END;
$fn$;
REVOKE ALL ON FUNCTION public.declutter_wanted_seed_from_poster() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS declutter_wanted_seed_from_poster ON public.declutter_wanted;
CREATE TRIGGER declutter_wanted_seed_from_poster
  BEFORE INSERT ON public.declutter_wanted
  FOR EACH ROW EXECUTE FUNCTION public.declutter_wanted_seed_from_poster();

-- Contact-leak filter on the free text (the row 35 rule): rejected, never hidden.
CREATE OR REPLACE FUNCTION public.reject_contact_leak_in_declutter_wanted()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_reason text;
BEGIN
  IF TG_OP = 'INSERT' OR NEW.what IS DISTINCT FROM OLD.what THEN
    v_reason := public.contact_leak_reason(NEW.what);
  END IF;
  IF v_reason IS NOT NULL THEN
    RAISE EXCEPTION USING
      ERRCODE = 'check_violation',
      MESSAGE = v_reason || ' in what you want. Keep contact details and payment out; offers, payment and pickup happen in the app.';
  END IF;
  RETURN NEW;
END;
$fn$;
REVOKE ALL ON FUNCTION public.reject_contact_leak_in_declutter_wanted() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS trg_reject_contact_leak_in_declutter_wanted ON public.declutter_wanted;
CREATE TRIGGER trg_reject_contact_leak_in_declutter_wanted
  BEFORE INSERT OR UPDATE OF what ON public.declutter_wanted
  FOR EACH ROW EXECUTE FUNCTION public.reject_contact_leak_in_declutter_wanted();

-- ---------------------------------------------------------------------------
-- 3. The alert rules, shared by both directions. Internal (service only).
--
-- NO alert work runs inside the transaction that puts a listing live (review
-- 2026-10-16, lh-authz-rls #1 reproduced a deadlock; lh-silent-failure #1): the
-- go-live trigger only queues the item id, and the cron 'declutter-wanted'
-- (every 10 minutes) matches it, each item in its own subtransaction, a
-- failure logged with log_cron_defect and retried. No advisory locks: the
-- daily caps are soft anti-spam limits (one over under true concurrency is
-- harmless), never money.

-- May member p_user get a wanted alert right now? Both switches on for THEM,
-- their 'New offers' switch (unset = on), still in Declutter. Returns the
-- reason it may NOT, or NULL when it may (never a boolean: a NULL user gets
-- 'no_user', so no caller can mistake NULL for yes).
CREATE OR REPLACE FUNCTION public.declutter_wanted_alert_block(p_user uuid)
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
  SELECT CASE
    WHEN p_user IS NULL THEN 'no_user'
    WHEN NOT public.feature_enabled_for_user('declutter', p_user) THEN 'switch_off'
    WHEN NOT public.feature_enabled_for_user('declutter_wanted', p_user) THEN 'switch_off'
    WHEN public.declutter_member_out(p_user) THEN 'member_out'
    WHEN COALESCE(public.member_under_18(p_user), false) THEN 'under_18'
    WHEN NOT COALESCE((SELECT np.new_offers FROM public.notification_preferences np WHERE np.user_id = p_user), true) THEN 'muted'
  END;
$fn$;
REVOKE ALL ON FUNCTION public.declutter_wanted_alert_block(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.declutter_wanted_alert_block(uuid) TO service_role;

-- One bell + push row; returns whether a row was really written (a BEFORE
-- INSERT trigger on notifications may drop a duplicate), so a cap or ledger
-- stamp is never spent on an alert nobody got (review: lh-silent-failure #2,
-- lh-trust-safety #2). Seed/real mixing never reaches here (pairs exclude it).
CREATE OR REPLACE FUNCTION public.declutter_wanted_notify(p_user uuid, p_title text, p_message text, p_link text)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_id uuid;
BEGIN
  INSERT INTO public.notifications (user_id, type, title, message, link)
  VALUES (p_user, 'new_offers', p_title, p_message, p_link)
  RETURNING id INTO v_id;
  RETURN CASE WHEN v_id IS NULL THEN 0 ELSE 1 END;
END;
$fn$;
REVOKE ALL ON FUNCTION public.declutter_wanted_notify(uuid, text, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.declutter_wanted_notify(uuid, text, text, text) TO service_role;

-- Record one (post, item) match and send what its rules allow. Returns the
-- number of alerts written (0-2). The caller has already checked the match
-- itself (declutter_wanted_pairs). p_tell_seller false: this post already
-- reached its per-post seller limit (W7). p_tell_poster false: the poster is
-- looking at the matches on screen (they just posted).
CREATE OR REPLACE FUNCTION public.declutter_wanted_record_match(p_wanted uuid, p_item uuid, p_tell_seller boolean, p_tell_poster boolean)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  w public.declutter_wanted%ROWTYPE;
  i public.declutter_items%ROWTYPE;
  v_floor integer;
  v_n integer;
  v_sent integer := 0;
BEGIN
  SELECT * INTO w FROM public.declutter_wanted WHERE id = p_wanted;
  SELECT * INTO i FROM public.declutter_items WHERE id = p_item;
  IF w.id IS NULL OR i.id IS NULL THEN
    RETURN 0;
  END IF;
  INSERT INTO public.declutter_wanted_matches (wanted_id, item_id) VALUES (w.id, i.id)
  ON CONFLICT (wanted_id, item_id) DO NOTHING;
  IF NOT FOUND THEN
    RETURN 0; -- W6: this pair was handled before; never again.
  END IF;

  -- The seller: told when an offer at the buyer's highest price would clear
  -- their own hidden floor (W5). Only the seller ever learns of that test.
  -- W15: the alert never repeats the poster's words; it names the seller's
  -- own listing, so it cannot carry a message from a stranger.
  SELECT p.floor_price_cents INTO v_floor FROM public.declutter_item_private p WHERE p.item_id = i.id;
  IF p_tell_seller IS TRUE AND v_floor IS NOT NULL AND v_floor <= w.max_price_cents
     AND public.declutter_wanted_alert_block(i.seller_id) IS NULL
     -- W7: at most 5 wanted alerts a day per seller ...
     AND (SELECT count(*) FROM public.declutter_wanted_matches m
            JOIN public.declutter_items mi ON mi.id = m.item_id
           WHERE mi.seller_id = i.seller_id AND m.seller_notified_at > now() - interval '1 day') < 5
     -- ... and at most one per poster per seller a week.
     AND NOT EXISTS (SELECT 1 FROM public.declutter_wanted_matches m
                       JOIN public.declutter_items mi ON mi.id = m.item_id
                       JOIN public.declutter_wanted mw ON mw.id = m.wanted_id
                      WHERE mi.seller_id = i.seller_id AND mw.user_id = w.user_id
                        AND m.seller_notified_at > now() - interval '7 days') THEN
    v_n := public.declutter_wanted_notify(i.seller_id,
      'Someone near you wants one',
      'Someone near you wants an item like your "' || i.title || '" for '
        || public.declutter_money_words(w.max_price_cents) || ' or less.',
      '/declutter/item/' || i.id::text);
    IF v_n > 0 THEN
      UPDATE public.declutter_wanted_matches SET seller_notified_at = now()
       WHERE wanted_id = w.id AND item_id = i.id;
      v_sent := v_sent + 1;
    END IF;
  END IF;

  -- The poster: told when the item's price today is at or under theirs.
  IF p_tell_poster IS TRUE AND i.current_price_cents <= w.max_price_cents
     AND public.declutter_wanted_alert_block(w.user_id) IS NULL
     AND (SELECT count(*) FROM public.declutter_wanted_matches m
            JOIN public.declutter_wanted mw ON mw.id = m.wanted_id
           WHERE mw.user_id = w.user_id AND m.poster_notified_at > now() - interval '1 day') < 10 THEN
    v_n := public.declutter_wanted_notify(w.user_id,
      'A match for what you want',
      '"' || i.title || '" was just listed near you for ' || public.declutter_money_words(i.current_price_cents) || '.',
      '/declutter/item/' || i.id::text);
    IF v_n > 0 THEN
      UPDATE public.declutter_wanted_matches SET poster_notified_at = now()
       WHERE wanted_id = w.id AND item_id = i.id;
      v_sent := v_sent + 1;
    END IF;
  END IF;
  RETURN v_sent;
END;
$fn$;
REVOKE ALL ON FUNCTION public.declutter_wanted_record_match(uuid, uuid, boolean, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.declutter_wanted_record_match(uuid, uuid, boolean, boolean) TO service_role;

-- The open posts a live item matches (or, with p_wanted, the live items one
-- post matches), nearest first. ONE definition of "a match" for both
-- directions (W5): live item, same category, every word of the post in the
-- item's title or description (English stemming: "cribs" finds "crib"), item
-- point within the post's miles, not the poster's own item, the seller not
-- hidden, the post open and unexpired, the poster still in Declutter, 18+ and
-- with both switches on, and seed (test) posts and listings only ever meet
-- each other. p_with_blocked: the poster's own on-screen list shows a blocked
-- seller's listing exactly as Browse does (lh-trust-safety #6: omitting it
-- would reveal the block); alerts never cross a block.
CREATE OR REPLACE FUNCTION public.declutter_wanted_pairs(p_item uuid, p_wanted uuid, p_with_blocked boolean)
RETURNS TABLE(wanted_id uuid, item_id uuid, miles double precision)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
  SELECT w.id, i.id, public.declutter_miles(w.area_lat, w.area_lng, i.area_lat, i.area_lng)
    FROM public.declutter_wanted w
    JOIN public.declutter_items i
      ON i.category = w.category
     AND i.status = 'live'
     AND i.seller_id <> w.user_id
     AND i.is_seed = w.is_seed
     -- And by the LIVE profiles too (an account marked test after it posted
     -- or listed): the Q137 rule, applied before any alert or cap.
     AND COALESCE((SELECT p.is_seed FROM public.profiles p WHERE p.user_id = w.user_id), false)
       = COALESCE((SELECT p.is_seed FROM public.profiles p WHERE p.user_id = i.seller_id), false)
   WHERE (p_item IS NOT NULL OR p_wanted IS NOT NULL)
     AND (p_item IS NULL OR i.id = p_item)
     AND (p_wanted IS NULL OR w.id = p_wanted)
     AND w.status = 'open'
     AND w.expires_at > now()
     AND public.declutter_miles(w.area_lat, w.area_lng, i.area_lat, i.area_lng) <= w.radius_miles
     AND to_tsvector('english', i.title || ' ' || i.description) @@ plainto_tsquery('english', w.what)
     AND (p_with_blocked IS TRUE OR NOT EXISTS (
           SELECT 1 FROM public.user_blocks b
            WHERE (b.blocker_id = i.seller_id AND b.blocked_id = w.user_id)
               OR (b.blocker_id = w.user_id AND b.blocked_id = i.seller_id)))
     AND NOT public.declutter_seller_out(i.seller_id)
     AND NOT public.declutter_member_out(w.user_id)
     AND NOT COALESCE(public.member_under_18(w.user_id), false)
     AND public.feature_enabled_for_user('declutter', w.user_id)
     AND public.feature_enabled_for_user('declutter_wanted', w.user_id)
   ORDER BY 3, 1, 2;
$fn$;
REVOKE ALL ON FUNCTION public.declutter_wanted_pairs(uuid, uuid, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.declutter_wanted_pairs(uuid, uuid, boolean) TO service_role;

-- Listings that went live and still need matching. No client privilege.
CREATE TABLE IF NOT EXISTS public.declutter_wanted_queue (
  item_id uuid PRIMARY KEY REFERENCES public.declutter_items(id) ON DELETE CASCADE,
  queued_at timestamptz NOT NULL DEFAULT now(),
  attempts integer NOT NULL DEFAULT 0
);
ALTER TABLE public.declutter_wanted_queue ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.declutter_wanted_queue FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.declutter_wanted_queue TO service_role;

-- Q807: every public table carries the unconfirmed-email statement gate. Run
-- AFTER the last CREATE TABLE here (declutter_wanted_queue), so all three get it.
DO $do$
BEGIN
  IF to_regprocedure('public.attach_unconfirmed_email_gate()') IS NOT NULL THEN
    PERFORM public.attach_unconfirmed_email_gate();
  END IF;
END
$do$;

-- A listing just went live: match it against every open post (W5). Returns
-- alerts written. Service only; the sweep calls it.
CREATE OR REPLACE FUNCTION public.declutter_wanted_match_item(p_item uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  r record;
  v_sent integer := 0;
BEGIN
  IF p_item IS NULL THEN
    RETURN 0;
  END IF;
  FOR r IN SELECT * FROM public.declutter_wanted_pairs(p_item, NULL, false) LOOP
    v_sent := v_sent + public.declutter_wanted_record_match(r.wanted_id, r.item_id, true, true);
  END LOOP;
  RETURN v_sent;
END;
$fn$;
REVOKE ALL ON FUNCTION public.declutter_wanted_match_item(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.declutter_wanted_match_item(uuid) TO service_role;

-- The cron 'declutter-wanted': drain the queue, oldest first, at most 200 a
-- run. Each item in its own subtransaction: a failure is logged
-- (log_cron_defect), counted and retried next run, up to 12 tries, and never
-- blocks the others. Returns what it did, for cron_record_work.
CREATE OR REPLACE FUNCTION public.declutter_wanted_sweep()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  q record;
  v_items integer := 0;
  v_alerts integer := 0;
  v_failed integer := 0;
BEGIN
  -- Nobody can have the feature while either switch is off: empty the queue
  -- (a listing that goes live again later is queued again).
  IF NOT EXISTS (SELECT 1 FROM public.feature_switches s
                  WHERE s.key = 'declutter_wanted' AND s.audience IN ('testers', 'everyone'))
     OR NOT EXISTS (SELECT 1 FROM public.feature_switches s
                     WHERE s.key = 'declutter' AND s.audience IN ('testers', 'everyone')) THEN
    DELETE FROM public.declutter_wanted_queue;
    RETURN jsonb_build_object('items', 0, 'alerts', 0, 'failed', 0, 'switch', 'off');
  END IF;
  FOR q IN SELECT * FROM public.declutter_wanted_queue ORDER BY queued_at, item_id LIMIT 200 LOOP
    BEGIN
      v_alerts := v_alerts + public.declutter_wanted_match_item(q.item_id);
      DELETE FROM public.declutter_wanted_queue WHERE item_id = q.item_id;
      v_items := v_items + 1;
    EXCEPTION WHEN OTHERS THEN
      v_failed := v_failed + 1;
      IF q.attempts + 1 >= 12 THEN
        -- Out of tries: drop the row (so a later go-live queues it afresh)
        -- and say so plainly.
        DELETE FROM public.declutter_wanted_queue WHERE item_id = q.item_id;
        PERFORM public.log_cron_defect('declutter_wanted_sweep', q.item_id::text,
          'gave up after 12 tries, no wanted alerts for this listing: ' || SQLERRM);
      ELSE
        UPDATE public.declutter_wanted_queue SET attempts = attempts + 1 WHERE item_id = q.item_id;
        PERFORM public.log_cron_defect('declutter_wanted_sweep', q.item_id::text, SQLERRM);
      END IF;
    END;
  END LOOP;
  RETURN jsonb_build_object('items', v_items, 'alerts', v_alerts, 'failed', v_failed);
END;
$fn$;
REVOKE ALL ON FUNCTION public.declutter_wanted_sweep() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.declutter_wanted_sweep() TO service_role;

-- Every way a listing goes live (publish, admin approval, back on sale after a
-- missed checkout or a buyer-fault refund) queues it once; nothing else runs
-- in that transaction. Pairs already handled stay silent (W6).
CREATE OR REPLACE FUNCTION public.declutter_wanted_on_item_live()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
BEGIN
  INSERT INTO public.declutter_wanted_queue (item_id) VALUES (NEW.id)
  ON CONFLICT (item_id) DO UPDATE SET attempts = 0, queued_at = now();
  RETURN NULL;
END;
$fn$;
REVOKE ALL ON FUNCTION public.declutter_wanted_on_item_live() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS declutter_wanted_on_item_live ON public.declutter_items;
CREATE TRIGGER declutter_wanted_on_item_live
  AFTER UPDATE OF status ON public.declutter_items
  FOR EACH ROW
  WHEN (NEW.status = 'live' AND OLD.status IS DISTINCT FROM 'live')
  EXECUTE FUNCTION public.declutter_wanted_on_item_live();
DROP TRIGGER IF EXISTS declutter_wanted_on_item_insert_live ON public.declutter_items;
CREATE TRIGGER declutter_wanted_on_item_insert_live
  AFTER INSERT ON public.declutter_items
  FOR EACH ROW
  WHEN (NEW.status = 'live')
  EXECUTE FUNCTION public.declutter_wanted_on_item_live();

-- Cron + dead-cron expectation (the declutter-deadlines pattern, 20261014210518).
-- Every 10 minutes it heals itself on its next run, so no catch-up policy row.
DO $do$
BEGIN
  IF to_regclass('public.cron_work_expectations') IS NOT NULL THEN
    INSERT INTO public.cron_work_expectations (jobname, expected_max_gap, note, work_visibility, work_exempt_reason)
    VALUES ('declutter-wanted', interval '30 minutes',
            'Declutter: matches newly live listings against open wanted posts and sends the alerts (W5).',
            'exempt', 'While the wanted switch is off or nothing new was listed, a run that sends nothing is the healthy state.')
    ON CONFLICT (jobname) DO UPDATE SET expected_max_gap = EXCLUDED.expected_max_gap, note = EXCLUDED.note,
      work_visibility = EXCLUDED.work_visibility, work_exempt_reason = EXCLUDED.work_exempt_reason;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'cron') THEN
    PERFORM cron.schedule('declutter-wanted', '2-59/10 * * * *',
      $c$SELECT public.cron_record_work('declutter-wanted', to_jsonb(public.declutter_wanted_sweep()));$c$);
  END IF;
END
$do$;

-- ---------------------------------------------------------------------------
-- 4. Client RPCs. Each VOLATILE one names is_caller_banned() in its own body
--    (the Q281 class check).

-- Post what you want. Returns the new post's id. Sellers of live listings that
-- match now are told at once (at most 20, nearest first; W7); the poster sees
-- the matches on screen (declutter_my_wanted). This runs in the poster's own
-- transaction, which holds no other member's lock.
CREATE OR REPLACE FUNCTION public.declutter_create_wanted(
  p_what text,
  p_category text,
  p_max_price_cents integer,
  p_radius_miles integer,
  p_lat numeric,
  p_lng numeric
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid uuid;
  v_id uuid;
  v_what text := btrim(regexp_replace(COALESCE(p_what, ''), '\s+', ' ', 'g'));
  v_told integer := 0;
  r record;
BEGIN
  PERFORM public.require_feature('declutter');
  PERFORM public.require_feature('declutter_wanted');
  IF public.is_caller_banned() THEN
    RAISE EXCEPTION 'account_restricted' USING ERRCODE = '42501';
  END IF;
  -- Row 53: a wanted post is a buying intent, so the under-18 rule applies.
  PERFORM public.declutter_assert_member(true);
  v_uid := (SELECT auth.uid());

  -- W8: plain words only (ASCII letters, digits, spaces and . , ' & ( ) / -),
  -- no web address (a dot between letters), no phone number spelled out in
  -- digits (7 or more) or in words (4 number words in a row), and at least
  -- one searchable word.
  IF char_length(v_what) NOT BETWEEN 3 AND 60
     OR v_what !~ '^[A-Za-z0-9 .,''&()/-]+$'
     OR v_what ~ '[A-Za-z]\.[A-Za-z]'
     OR char_length(regexp_replace(v_what, '[^0-9]', '', 'g')) >= 7
     OR lower(v_what) ~ '(\m(zero|oh|one|two|three|four|five|six|seven|eight|nine)\M[^a-z0-9]*){4,}'
     OR numnode(plainto_tsquery('english', v_what)) = 0 THEN
    RAISE EXCEPTION 'invalid_wanted_text'
      USING ERRCODE = '22023', HINT = 'Say what you want in 3 to 60 letters, like "crib" or "oak dresser".';
  END IF;
  IF p_category IS NULL OR p_category !~ '^[a-z][a-z0-9_]{1,39}$' THEN
    RAISE EXCEPTION 'invalid_category' USING ERRCODE = '22023';
  END IF;
  -- Whole dollars only (re-review note 7: cents are a free channel to a seller).
  IF p_max_price_cents IS NULL OR p_max_price_cents NOT BETWEEN 100 AND 100000 OR p_max_price_cents % 100 <> 0 THEN
    RAISE EXCEPTION 'invalid_max_price'
      USING ERRCODE = '22023', HINT = 'Your highest price must be whole dollars between $1 and $1,000.';
  END IF;
  IF p_radius_miles IS NULL OR p_radius_miles NOT IN (5, 10, 25, 50) THEN
    RAISE EXCEPTION 'invalid_radius' USING ERRCODE = '22023';
  END IF;
  IF p_lat IS NULL OR p_lng IS NULL OR p_lat NOT BETWEEN -90 AND 90 OR p_lng NOT BETWEEN -180 AND 180 THEN
    RAISE EXCEPTION 'wanted_area_unknown' USING ERRCODE = '22023';
  END IF;

  -- W7: one poster at a time (their own key only), so parallel calls cannot
  -- all pass the caps.
  PERFORM pg_advisory_xact_lock(hashtext('declutter_wanted_post:' || v_uid::text));
  IF (SELECT count(*) FROM public.declutter_wanted w
       WHERE w.user_id = v_uid AND w.created_at > now() - interval '1 day') >= 5 THEN
    RAISE EXCEPTION 'wanted_rate_limited'
      USING ERRCODE = '42501', HINT = 'You can post up to 5 wanted items a day.';
  END IF;
  IF (SELECT count(*) FROM public.declutter_wanted w
       WHERE w.user_id = v_uid AND w.status = 'open' AND w.expires_at > now()) >= 10 THEN
    RAISE EXCEPTION 'wanted_open_limit'
      USING ERRCODE = '42501', HINT = 'You have 10 open wanted posts. Close one to post another.';
  END IF;

  INSERT INTO public.declutter_wanted (user_id, what, category, max_price_cents, radius_miles, area_lat, area_lng)
  VALUES (v_uid, v_what, p_category, p_max_price_cents, p_radius_miles::smallint, round(p_lat, 2), round(p_lng, 2))
  RETURNING id INTO v_id;

  FOR r IN SELECT * FROM public.declutter_wanted_pairs(NULL, v_id, false) LOOP
    v_told := v_told + public.declutter_wanted_record_match(r.wanted_id, r.item_id, v_told < 20, false);
  END LOOP;
  RETURN v_id;
END;
$fn$;
REVOKE ALL ON FUNCTION public.declutter_create_wanted(text, text, integer, integer, numeric, numeric) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.declutter_create_wanted(text, text, integer, integer, numeric, numeric) TO authenticated, service_role;

-- Close one of your own posts. Returns 'closed' (also when it already was).
CREATE OR REPLACE FUNCTION public.declutter_close_wanted(p_wanted_id uuid)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid uuid := (SELECT auth.uid());
BEGIN
  PERFORM public.require_feature('declutter');
  PERFORM public.require_feature('declutter_wanted');
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501';
  END IF;
  -- A banned member's posts already match nothing (declutter_member_out).
  IF public.is_caller_banned() THEN
    RAISE EXCEPTION 'account_restricted' USING ERRCODE = '42501';
  END IF;
  UPDATE public.declutter_wanted
     SET status = 'closed', closed_at = COALESCE(closed_at, now())
   WHERE id = p_wanted_id AND user_id = v_uid;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'wanted_not_found' USING ERRCODE = 'P0002';
  END IF;
  RETURN 'closed';
END;
$fn$;
REVOKE ALL ON FUNCTION public.declutter_close_wanted(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.declutter_close_wanted(uuid) TO authenticated, service_role;

-- The caller's own posts, open ones first then newest, each with the live
-- listings that match it right now at or under its price (id, title, price;
-- all public on the listing itself), cheapest first. Never anyone else's
-- posts, and never anything from the match ledger (its seller_notified_at
-- would tell a poster "this seller's hidden floor is under your price").
CREATE OR REPLACE FUNCTION public.declutter_my_wanted()
RETURNS TABLE(id uuid, what text, category text, max_price_cents integer, radius_miles integer,
              status text, expires_at timestamptz, created_at timestamptz, matches jsonb)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid uuid := (SELECT auth.uid());
BEGIN
  PERFORM public.require_feature('declutter');
  PERFORM public.require_feature('declutter_wanted');
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
    SELECT w.id, w.what, w.category, w.max_price_cents, w.radius_miles::integer,
           CASE WHEN w.status = 'open' AND w.expires_at <= now() THEN 'expired' ELSE w.status END,
           w.expires_at, w.created_at,
           CASE WHEN w.status = 'open' AND w.expires_at > now() THEN
             COALESCE((SELECT jsonb_agg(jsonb_build_object('id', i.id, 'title', i.title, 'price_cents', i.current_price_cents)
                                        ORDER BY i.current_price_cents, i.id)
                         FROM public.declutter_wanted_pairs(NULL, w.id, true) p
                         JOIN public.declutter_items i ON i.id = p.item_id
                        WHERE i.current_price_cents <= w.max_price_cents
                          AND NOT public.declutter_seller_hidden(i.seller_id)), '[]'::jsonb)
           ELSE '[]'::jsonb END
      FROM public.declutter_wanted w
     WHERE w.user_id = v_uid
     ORDER BY (w.status = 'open' AND w.expires_at > now()) DESC, w.created_at DESC
     LIMIT 50;
END;
$fn$;
REVOKE ALL ON FUNCTION public.declutter_my_wanted() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.declutter_my_wanted() TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 5. The fair-price hint (W9-W12). One row (low, high, sales) or NO row: the
--    app shows nothing then. Never invented, never seed data. Hardened after
--    review (lh-authz-rls #4, lh-trust-safety #3/#4): at least 11 counted
--    sales (so neither end of the 10th-90th range can be the single cheapest
--    or dearest sale), one sale per buyer-seller pair, the point snapped to a
--    0.1-degree grid (~7 miles), prices rounded outward to $5, and the count
--    given only in tens ("10+", "20+").
CREATE OR REPLACE FUNCTION public.declutter_price_hint(p_category text, p_condition_stars integer, p_lat numeric, p_lng numeric)
RETURNS TABLE(low_cents integer, high_cents integer, sales integer)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
BEGIN
  PERFORM public.require_feature('declutter');
  PERFORM public.require_feature('declutter_price_hint');
  IF (SELECT auth.uid()) IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501';
  END IF;
  IF p_category IS NULL OR p_condition_stars IS NULL OR p_lat IS NULL OR p_lng IS NULL
     OR p_condition_stars NOT BETWEEN 1 AND 5 THEN
    RETURN;
  END IF;
  RETURN QUERY
    WITH sold AS (
      SELECT c.price_cents, c.seller_id, c.buyer_id, o.handed_over_at
        FROM public.declutter_cart_items c
        JOIN public.declutter_orders o ON o.id = c.order_id
        JOIN public.declutter_items i ON i.id = c.item_id
       WHERE c.status = 'paid'
         AND o.status = 'handed_over'
         AND o.handed_over_at > now() - interval '365 days'
         AND NOT c.is_seed AND NOT o.is_seed AND NOT i.is_seed
         AND NOT EXISTS (SELECT 1 FROM public.profiles p
                          WHERE p.user_id IN (c.seller_id, c.buyer_id) AND COALESCE(p.is_seed, false))
         AND i.category = p_category
         AND i.condition_stars = p_condition_stars
         AND public.declutter_miles(round(p_lat, 1), round(p_lng, 1), i.area_lat, i.area_lng) <= 25
         AND NOT public.declutter_member_out(c.seller_id)
         AND NOT public.declutter_member_out(c.buyer_id)
    ), one_per_pair AS (
      -- The latest sale between each pair of members, whichever way it went.
      SELECT DISTINCT ON (least(s.seller_id, s.buyer_id), greatest(s.seller_id, s.buyer_id))
             s.price_cents, s.seller_id, s.buyer_id
        FROM sold s
       ORDER BY least(s.seller_id, s.buyer_id), greatest(s.seller_id, s.buyer_id), s.handed_over_at DESC
    ), agg AS (
      SELECT count(*)::integer AS n,
             count(DISTINCT s.seller_id)::integer AS sellers,
             count(DISTINCT s.buyer_id)::integer AS buyers,
             percentile_disc(0.1) WITHIN GROUP (ORDER BY s.price_cents) AS p10,
             percentile_disc(0.9) WITHIN GROUP (ORDER BY s.price_cents) AS p90
        FROM one_per_pair s
    )
    SELECT greatest(100, (floor(a.p10 / 500.0) * 500)::integer), (ceil(a.p90 / 500.0) * 500)::integer, (a.n / 10) * 10
      FROM agg a
     WHERE a.n >= 11 AND a.sellers >= 3 AND a.buyers >= 3;
END;
$fn$;
REVOKE ALL ON FUNCTION public.declutter_price_hint(text, integer, numeric, numeric) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.declutter_price_hint(text, integer, numeric, numeric) TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 6. Download My Data gains the member's wanted posts. The body is
--    20261015084728's export_my_data verbatim (the newest restatement) with
--    one 'declutter_wanted' section added before RETURN. Any later restatement
--    must start from THIS body. Grants restated exactly as live: EXECUTE for
--    service_role only.
DROP FUNCTION IF EXISTS public.export_my_data();

CREATE OR REPLACE FUNCTION public.export_my_data(p_user_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_uid     uuid := p_user_id;
  v_email   text;
  v_created timestamptz;
  v_out   jsonb;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501';
  END IF;

  SELECT lower(u.email), u.created_at INTO v_email, v_created FROM auth.users u WHERE u.id = v_uid;

  v_out := jsonb_build_object('exported_at', now(), 'user_id', v_uid, 'email', v_email);

  v_out := v_out || jsonb_build_object('profile', (SELECT to_jsonb(t) - 'insurance_reviewed_by' - 'license_reviewed_by' FROM public.profiles t
      WHERE t.user_id = v_uid));
  v_out := v_out || jsonb_build_object('jobs', (SELECT coalesce(jsonb_agg(
        CASE WHEN t.customer_id = v_uid OR public.user_may_see_job_address(t.id, v_uid)
          THEN CASE WHEN t.customer_id = v_uid OR t.offered_to_helper_id = v_uid THEN to_jsonb(t)
                 ELSE to_jsonb(t) - 'offered_to_helper_id' END - 'removed_by'
          ELSE jsonb_build_object(
                 'id', t.id, 'title', t.title, 'category', t.category, 'parish', t.parish,
                 'status', t.status, 'created_at', t.created_at, 'row_limited', true,
                 'offered_to_you', t.offered_to_helper_id IS NOT DISTINCT FROM v_uid,
                 'cancelled_by_you', t.cancelled_by IS NOT DISTINCT FROM v_uid,
                 'disputed_by_you', t.disputed_by IS NOT DISTINCT FROM v_uid,
                 'recurring_helper_is_you', t.recurring_helper_id IS NOT DISTINCT FROM v_uid)
        END), '[]'::jsonb) FROM public.jobs t
      WHERE t.customer_id = v_uid OR t.helper_id = v_uid OR t.recurring_helper_id = v_uid
        OR t.offered_to_helper_id = v_uid OR t.cancelled_by = v_uid OR t.disputed_by = v_uid
        OR t.id IN (SELECT g.job_id FROM public.group_job_helpers g WHERE g.helper_id = v_uid)));
  v_out := v_out || jsonb_build_object('applications', (SELECT coalesce(jsonb_agg(CASE WHEN t.helper_id = v_uid THEN to_jsonb(t) - 'flag_reason' - 'offer_message_withheld'
        ELSE jsonb_build_object('id', t.id, 'job_id', t.job_id, 'helper_id', t.helper_id, 'status', t.status,
          'offer_message', t.offer_message, 'offer_message_withheld', t.offer_message_withheld,
          'offer_message_flagged_hidden', t.offer_message_flagged_hidden, 'decline_reason', t.decline_reason, 'poster_viewed_at', t.poster_viewed_at,
          'closed_reason', t.closed_reason, 'created_at', t.created_at, 'updated_at', t.updated_at) END), '[]'::jsonb) FROM public.applications t
      WHERE t.helper_id = v_uid
        OR (t.job_id IN (SELECT j.id FROM public.jobs j WHERE j.customer_id = v_uid) AND NOT public.are_users_blocked(t.helper_id, v_uid))));
  v_out := v_out || jsonb_build_object('reviews', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.reviews t
      WHERE t.reviewer_id = v_uid
        OR (t.reviewee_id = v_uid AND t.status = 'published'
            AND t.feedback_visible_at IS NOT NULL AND t.feedback_visible_at <= now())));
  v_out := v_out || jsonb_build_object('messages', (SELECT coalesce(jsonb_agg(to_jsonb(t) - 'flag_reason'), '[]'::jsonb) FROM public.messages t
      WHERE t.sender_id = v_uid
        OR (t.receiver_id = v_uid AND NOT coalesce(t.flagged_hidden, false))));
  v_out := v_out || jsonb_build_object('message_reactions', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.message_reactions t
      WHERE t.user_id = v_uid));
  v_out := v_out || jsonb_build_object('notifications', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.notifications t
      WHERE t.user_id = v_uid));
  v_out := v_out || jsonb_build_object('notification_preferences', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.notification_preferences t
      WHERE t.user_id = v_uid));
  v_out := v_out || jsonb_build_object('notification_logs', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.notification_logs t
      WHERE t.user_id = v_uid OR (lower(t.recipient_email) = v_email AND t.user_id IS NULL AND t.created_at >= v_created)));
  v_out := v_out || jsonb_build_object('notification_dedupe_suppressions', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.notification_dedupe_suppressions t
      WHERE t.user_id = v_uid));
  v_out := v_out || jsonb_build_object('push_tokens', (SELECT coalesce(jsonb_agg(to_jsonb(t) - 'token'), '[]'::jsonb) FROM public.push_tokens t
      WHERE t.user_id = v_uid));
  v_out := v_out || jsonb_build_object('saved_jobs', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.saved_jobs t
      WHERE t.user_id = v_uid));
  v_out := v_out || jsonb_build_object('saved_searches', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.saved_searches t
      WHERE t.user_id = v_uid));
  v_out := v_out || jsonb_build_object('saved_search_alert_queue', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.saved_search_alert_queue t
      WHERE t.user_id = v_uid));
  v_out := v_out || jsonb_build_object('match_digest_queue', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.match_digest_queue t
      WHERE t.user_id = v_uid));
  v_out := v_out || jsonb_build_object('parish_match_alert_queue', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.parish_match_alert_queue t
      WHERE t.user_id = v_uid));
  v_out := v_out || jsonb_build_object('job_match_queue', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.job_match_queue t
      WHERE t.user_id = v_uid));
  v_out := v_out || jsonb_build_object('ops_alert_admin_subjects', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.ops_alert_admin_subjects t
      WHERE t.user_id = v_uid));
  v_out := v_out || jsonb_build_object('favorite_helpers', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.favorite_helpers t
      WHERE t.customer_id = v_uid));
  v_out := v_out || jsonb_build_object('helper_availability', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.helper_availability t
      WHERE t.helper_id = v_uid));
  v_out := v_out || jsonb_build_object('helper_credentials', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.helper_credentials t
      WHERE t.user_id = v_uid));
  v_out := v_out || jsonb_build_object('helper_verifications', (SELECT coalesce(jsonb_agg(to_jsonb(t) - 'changed_by'), '[]'::jsonb) FROM public.helper_verifications t
      WHERE t.user_id = v_uid));
  v_out := v_out || jsonb_build_object('verification_checks', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.verification_checks t
      WHERE t.user_id = v_uid));
  v_out := v_out || jsonb_build_object('verification_exceptions', (SELECT coalesce(jsonb_agg(to_jsonb(t) - 'assigned_to'), '[]'::jsonb) FROM public.verification_exceptions t
      WHERE t.user_id = v_uid));
  v_out := v_out || jsonb_build_object('helper_w9_records', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.helper_w9_records t
      WHERE t.helper_id = v_uid));
  v_out := v_out || jsonb_build_object('instant_payouts', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.instant_payouts t
      WHERE t.helper_id = v_uid));
  v_out := v_out || jsonb_build_object('payout_transfers', (SELECT coalesce(jsonb_agg(to_jsonb(t) - 'initiated_by' - 'initiated_by_user_id'), '[]'::jsonb) FROM public.payout_transfers t
      WHERE t.helper_id = v_uid));
  v_out := v_out || jsonb_build_object('crew_cancellation_fee_shares', (SELECT coalesce(jsonb_agg(CASE WHEN t.helper_id = v_uid THEN to_jsonb(t) ELSE to_jsonb(t) - 'stripe_transfer_id' - 'status' - 'paid_at' END), '[]'::jsonb) FROM public.crew_cancellation_fee_shares t
      WHERE t.helper_id = v_uid OR t.job_id IN (SELECT j.id FROM public.jobs j WHERE j.customer_id = v_uid)));
  -- Q1390: a crew block fee is the member's money record. The member only:
  -- the ledger has no client read policy, and an export never gives a poster
  -- a row the app's own SELECT rules would not (Q739); the poster's side of
  -- it is the notification block_user_and_settle sends.
  v_out := v_out || jsonb_build_object('crew_block_fees', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.crew_block_fees t
      WHERE t.helper_id = v_uid));
  v_out := v_out || jsonb_build_object('cancellation_fee_transfers', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.cancellation_fee_transfers t
      WHERE t.helper_id = v_uid));
  v_out := v_out || jsonb_build_object('payment_refunds', (SELECT coalesce(jsonb_agg(to_jsonb(t) - 'initiated_by_user_id'), '[]'::jsonb) FROM public.payment_refunds t
      WHERE t.customer_id = v_uid));
  v_out := v_out || jsonb_build_object('chargeback_clawbacks', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.chargeback_clawbacks t
      WHERE t.helper_id = v_uid));
  v_out := v_out || jsonb_build_object('tips', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.tips t
      WHERE t.tipper_id = v_uid OR t.helper_id = v_uid));
  v_out := v_out || jsonb_build_object('tip_hold_redrives', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.tip_hold_redrives t
      WHERE t.helper_id = v_uid));
  v_out := v_out || jsonb_build_object('gift_cards', (SELECT coalesce(jsonb_agg(to_jsonb(t) - 'claim_token'), '[]'::jsonb) FROM public.gift_cards t
      WHERE t.donor_id = v_uid OR t.recipient_id = v_uid OR (lower(t.recipient_email) = v_email AND t.recipient_id IS NULL)));
  v_out := v_out || jsonb_build_object('referral_codes', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.referral_codes t
      WHERE t.user_id = v_uid));
  v_out := v_out || jsonb_build_object('referral_credits', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.referral_credits t
      WHERE t.user_id = v_uid));
  v_out := v_out || jsonb_build_object('referrals', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.referrals t
      WHERE t.referrer_id = v_uid OR t.referred_id = v_uid));
  v_out := v_out || jsonb_build_object('reports', (SELECT coalesce(jsonb_agg(to_jsonb(t) - 'assigned_to'), '[]'::jsonb) FROM public.reports t
      WHERE t.reporter_id = v_uid));
  v_out := v_out || jsonb_build_object('user_blocks', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.user_blocks t
      WHERE t.blocker_id = v_uid));
  v_out := v_out || jsonb_build_object('user_bans', (SELECT coalesce(jsonb_agg(to_jsonb(t) - 'banned_by'), '[]'::jsonb) FROM public.user_bans t
      WHERE t.user_id = v_uid));
  v_out := v_out || jsonb_build_object('user_strikes', (SELECT coalesce(jsonb_agg(to_jsonb(t) - 'issued_by'), '[]'::jsonb) FROM public.user_strikes t
      WHERE t.user_id = v_uid));
  v_out := v_out || jsonb_build_object('user_violations', (SELECT coalesce(jsonb_agg(to_jsonb(t) - 'reported_by'), '[]'::jsonb) FROM public.user_violations t
      WHERE t.user_id = v_uid));
  v_out := v_out || jsonb_build_object('user_roles', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.user_roles t
      WHERE t.user_id = v_uid));
  v_out := v_out || jsonb_build_object('legal_acceptances', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.legal_acceptances t
      WHERE t.user_id = v_uid));
  v_out := v_out || jsonb_build_object('login_history', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.login_history t
      WHERE t.user_id = v_uid));
  v_out := v_out || jsonb_build_object('email_tracking', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.email_tracking t
      WHERE t.user_id = v_uid));
  v_out := v_out || jsonb_build_object('email_send_log', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.email_send_log t
      WHERE lower(t.recipient_email) = v_email AND t.created_at >= v_created));
  v_out := v_out || jsonb_build_object('suppressed_emails', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.suppressed_emails t
      WHERE lower(t.email) = v_email AND t.created_at >= v_created));
  v_out := v_out || jsonb_build_object('job_checkins', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.job_checkins t
      WHERE t.user_id = v_uid));
  v_out := v_out || jsonb_build_object('job_tracking', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.job_tracking t
      WHERE t.helper_id = v_uid));
  v_out := v_out || jsonb_build_object('group_job_helpers', (SELECT coalesce(jsonb_agg(CASE WHEN t.helper_id = v_uid THEN to_jsonb(t)
        ELSE jsonb_build_object('id', t.id, 'job_id', t.job_id, 'helper_id', t.helper_id, 'slot_no', t.slot_no, 'status', t.status,
          'share_cents', t.share_cents, 'poster_confirmed_arrival_at', t.poster_confirmed_arrival_at,
          'poster_confirmed_working_at', t.poster_confirmed_working_at,
          'poster_confirmed_completion_at', t.poster_confirmed_completion_at) END), '[]'::jsonb) FROM public.group_job_helpers t
      WHERE t.helper_id = v_uid OR t.job_id IN (SELECT j.id FROM public.jobs j WHERE j.customer_id = v_uid)));
  v_out := v_out || jsonb_build_object('recurring_visit_releases', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.recurring_visit_releases t
      WHERE t.helper_id = v_uid OR t.parent_job_id IN (SELECT j.id FROM public.jobs j WHERE j.customer_id = v_uid)));
  v_out := v_out || jsonb_build_object('recurring_visit_payments', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.recurring_visit_payments t
      WHERE t.payer_id = v_uid OR t.helper_id = v_uid));
  v_out := v_out || jsonb_build_object('job_revisions', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.job_revisions t
      WHERE t.requested_by = v_uid
        OR t.job_id IN (SELECT j.id FROM public.jobs j WHERE j.customer_id = v_uid OR j.helper_id = v_uid)));
  v_out := v_out || jsonb_build_object('job_completion_nudges', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.job_completion_nudges t
      WHERE t.resolved_by = v_uid));
  v_out := v_out || jsonb_build_object('disputes', (SELECT coalesce(jsonb_agg(to_jsonb(t) - 'decided_by'), '[]'::jsonb) FROM public.disputes t
      WHERE t.opener_id = v_uid
        OR t.job_id IN (SELECT j.id FROM public.jobs j WHERE j.customer_id = v_uid OR j.helper_id = v_uid)));
  v_out := v_out || jsonb_build_object('job_views', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.job_views t
      WHERE t.viewer_id = v_uid));
  v_out := v_out || jsonb_build_object('profile_views', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.profile_views t
      WHERE t.viewer_user_id = v_uid));
  v_out := v_out || jsonb_build_object('pet_profiles', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.pet_profiles t
      WHERE t.owner_id = v_uid));
  v_out := v_out || jsonb_build_object('job_pets', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.job_pets t
      WHERE t.job_id IN (SELECT j.id FROM public.jobs j WHERE j.customer_id = v_uid)));
  v_out := v_out || jsonb_build_object('job_access_notes', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.job_access_notes t
      WHERE t.job_id IN (SELECT j.id FROM public.jobs j WHERE j.customer_id = v_uid)));
  v_out := v_out || jsonb_build_object('str_calendar_connections', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.str_calendar_connections t
      WHERE t.user_id = v_uid));
  v_out := v_out || jsonb_build_object('thread_archives', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.thread_archives t
      WHERE t.user_id = v_uid));
  v_out := v_out || jsonb_build_object('thread_mutes', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.thread_mutes t
      WHERE t.user_id = v_uid));
  v_out := v_out || jsonb_build_object('thread_pins', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.thread_pins t
      WHERE t.user_id = v_uid));
  v_out := v_out || jsonb_build_object('nps_responses', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.nps_responses t
      WHERE t.user_id = v_uid));
  v_out := v_out || jsonb_build_object('analytics_events', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.analytics_events t
      WHERE t.user_id = v_uid));
  v_out := v_out || jsonb_build_object('error_logs', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.error_logs t
      WHERE t.user_id = v_uid));
  v_out := v_out || jsonb_build_object('admin_user_notes', (SELECT coalesce(jsonb_agg(to_jsonb(t) - 'admin_id'), '[]'::jsonb) FROM public.admin_user_notes t
      WHERE t.user_id = v_uid));
  v_out := v_out || jsonb_build_object('fraud_flags', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.fraud_flags t
      WHERE t.user_id = v_uid));
  v_out := v_out || jsonb_build_object('helper_shadowbans', (SELECT coalesce(jsonb_agg(to_jsonb(t) - 'created_by'), '[]'::jsonb) FROM public.helper_shadowbans t
      WHERE t.helper_id = v_uid));
  v_out := v_out || jsonb_build_object('payout_holds', (SELECT coalesce(jsonb_agg(to_jsonb(t) - 'held_by' - 'denied_by'), '[]'::jsonb) FROM public.payout_holds t
      WHERE t.helper_id = v_uid));
  v_out := v_out || jsonb_build_object('application_rate_log', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.application_rate_log t
      WHERE t.applicant_id = v_uid));
  v_out := v_out || jsonb_build_object('profile_search_rate_log', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.profile_search_rate_log t
      WHERE t.searcher_id = v_uid));
  v_out := v_out || jsonb_build_object('crew_dispute_member_outcomes', (SELECT coalesce(jsonb_agg(to_jsonb(t) - 'decided_by'), '[]'::jsonb) FROM public.crew_dispute_member_outcomes t
      WHERE t.helper_id = v_uid OR t.job_id IN (SELECT j.id FROM public.jobs j WHERE j.customer_id = v_uid)));
  v_out := v_out || jsonb_build_object('job_schedule_change_requests', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.job_schedule_change_requests t
      WHERE t.requested_by = v_uid OR t.responder_id = v_uid));
  v_out := v_out || jsonb_build_object('job_detail_change_requests', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.job_detail_change_requests t
      WHERE t.requested_by = v_uid));
  v_out := v_out || jsonb_build_object('job_detail_change_answers', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.job_detail_change_answers t
      WHERE t.helper_id = v_uid));
  v_out := v_out || jsonb_build_object('series_date_offers', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.series_date_offers t
      WHERE t.helper_id = v_uid OR t.parent_job_id IN (SELECT j.id FROM public.jobs j WHERE j.customer_id = v_uid)));
  v_out := v_out || jsonb_build_object('series_visit_holds', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.series_visit_holds t
      WHERE t.helper_id = v_uid OR t.parent_job_id IN (SELECT j.id FROM public.jobs j WHERE j.customer_id = v_uid)));

  -- Declutter (20261014200728, B9).
  v_out := v_out || jsonb_build_object('declutter_items', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.declutter_items t
      WHERE t.seller_id = v_uid));
  v_out := v_out || jsonb_build_object('declutter_item_private', (SELECT coalesce(jsonb_agg(to_jsonb(t) - 'ai_flag_reason'), '[]'::jsonb) FROM public.declutter_item_private t
      WHERE t.seller_id = v_uid));
  v_out := v_out || jsonb_build_object('declutter_item_photos', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.declutter_item_photos t
      WHERE t.seller_id = v_uid));
  v_out := v_out || jsonb_build_object('declutter_pickup_windows', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.declutter_pickup_windows t
      WHERE t.seller_id = v_uid));
  v_out := v_out || jsonb_build_object('declutter_questions', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.declutter_questions t
      WHERE t.asker_id = v_uid OR t.item_id IN (SELECT i.id FROM public.declutter_items i WHERE i.seller_id = v_uid)));
  v_out := v_out || jsonb_build_object('declutter_watchlist', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.declutter_watchlist t
      WHERE t.user_id = v_uid));
  v_out := v_out || jsonb_build_object('declutter_tax_attestations', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.declutter_tax_attestations t
      WHERE t.seller_id = v_uid));
  v_out := v_out || jsonb_build_object('declutter_strikes', (SELECT coalesce(jsonb_agg(to_jsonb(t) - 'removed_by' - 'appeal_decided_by'), '[]'::jsonb) FROM public.declutter_strikes t
      WHERE t.user_id = v_uid));
  v_out := v_out || jsonb_build_object('declutter_seller_flags', (SELECT coalesce(jsonb_agg(to_jsonb(t) - 'set_by'), '[]'::jsonb) FROM public.declutter_seller_flags t
      WHERE t.user_id = v_uid));
  -- Declutter slice 3 (20261014210518): offers (their current amount and
  -- status; the step history has no person column), orders and cart lines on
  -- either side of the trade; the saved card's brand + last 4 (the Stripe ids
  -- are ours, not the member's data, and are never shown to them, B31).
  v_out := v_out || jsonb_build_object('declutter_offers', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.declutter_offers t
      WHERE t.buyer_id = v_uid OR t.seller_id = v_uid));
  v_out := v_out || jsonb_build_object('declutter_orders', (SELECT coalesce(jsonb_agg(to_jsonb(t) - 'stripe_checkout_session_id' - 'stripe_payment_intent_id'), '[]'::jsonb) FROM public.declutter_orders t
      WHERE t.buyer_id = v_uid OR t.seller_id = v_uid));
  v_out := v_out || jsonb_build_object('declutter_cart_items', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.declutter_cart_items t
      WHERE t.buyer_id = v_uid OR t.seller_id = v_uid));
  v_out := v_out || jsonb_build_object('declutter_buyer_cards', (SELECT coalesce(jsonb_agg(to_jsonb(t) - 'stripe_customer_id' - 'payment_method_id'), '[]'::jsonb) FROM public.declutter_buyer_cards t
      WHERE t.user_id = v_uid));

  -- Declutter slice 3b (20261014224914): a seller's card-fee debts (row 60).
  -- Refunds have no person column (they hang off an order, exported above);
  -- each section is scoped to the caller by its own column only.
  v_out := v_out || jsonb_build_object('declutter_seller_fee_debts', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.declutter_seller_fee_debts t
      WHERE t.seller_id = v_uid));

  -- Declutter slice 4 (20261015042253): bookings (either side), the problems
  -- the member reported (the deciding admin's id dropped), the seller's payouts
  -- (the Stripe transfer id is ours), and reviews: those the member wrote, and
  -- those about them once visible (row 45: both sides reviewed or 14 days),
  -- without the reviewer's id.
  v_out := v_out || jsonb_build_object('declutter_bookings', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.declutter_bookings t
      WHERE t.buyer_id = v_uid OR t.seller_id = v_uid));
  v_out := v_out || jsonb_build_object('declutter_problems', (SELECT coalesce(jsonb_agg(to_jsonb(t) - 'decided_by'), '[]'::jsonb) FROM public.declutter_problems t
      WHERE t.reporter_id = v_uid));
  v_out := v_out || jsonb_build_object('declutter_payouts', (SELECT coalesce(jsonb_agg(to_jsonb(t) - 'stripe_transfer_id' - 'last_error'), '[]'::jsonb) FROM public.declutter_payouts t
      WHERE t.seller_id = v_uid));
  v_out := v_out || jsonb_build_object('declutter_reviews', (SELECT coalesce(jsonb_agg(CASE WHEN t.reviewer_id = v_uid THEN to_jsonb(t) ELSE to_jsonb(t) - 'reviewer_id' END), '[]'::jsonb) FROM public.declutter_reviews t
      WHERE t.reviewer_id = v_uid
         OR (t.reviewee_id = v_uid AND EXISTS (SELECT 1 FROM public.declutter_orders o WHERE o.id = t.order_id
               AND (o.handed_over_at <= now() - interval '14 days'
                    OR (SELECT count(*) FROM public.declutter_reviews r2 WHERE r2.order_id = t.order_id) = 2)))));

  -- "Suggest a category" (20261015051141, I1): the caller's own suggestions.
  -- reviewed_by (the staff reviewer) and admin_note (staff-only) are stripped.
  v_out := v_out || jsonb_build_object('category_suggestions', (SELECT coalesce(jsonb_agg(to_jsonb(t) - 'reviewed_by' - 'admin_note'), '[]'::jsonb) FROM public.category_suggestions t
      WHERE t.user_id = v_uid));

  -- Declutter wanted posts (20261016053541). The match ledger holds no person
  -- column; a seller's alerts are in 'notifications' above.
  v_out := v_out || jsonb_build_object('declutter_wanted', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.declutter_wanted t
      WHERE t.user_id = v_uid));
  RETURN v_out;
END;
$function$;

REVOKE ALL ON FUNCTION public.export_my_data(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.export_my_data(uuid) TO service_role;
