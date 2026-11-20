-- DECLUTTER HAUL-AWAY IS THE SELLER'S CHOICE (owner, 2026-11-20: "I just got a message to haul away stuff that's on
-- declutter I think we shouldn't offer to haul away unless they pick that like who's going to haul away there good
-- stuff they posted").
--
-- What was wrong: declutter_haul_away_sweep (20261027165903, cron 'declutter-haul-away', daily 15:21 UTC) Part A
-- told EVERY seller "Haul-away is open" (bell + push) when a listing reached 14 days unsold, whether they wanted a
-- haul-away or not. The auto-free notice (declutter_auto_free_due, 20261030030408) added "One more chance before
-- haul-away.", and the listing-rounds notices (declutter_listing_rounds_sweep, 20261029154323) offered "a Helpr take
-- it to donation" after the fourth round, to everyone.
--
-- What this does (OFF by default, for every listing; no switch for testers, it is on for everyone):
--   1. declutter_item_private.haul_away_opt_in boolean NOT NULL DEFAULT false: the seller's private "If it doesn't
--      sell, offer me a haul-away". Existing listings get false (the column default); no catch-up notice is sent.
--   2. declutter_set_haul_away_opt_in(item, on) / declutter_haul_away_opt_in_state(item): the seller's own listing
--      only (draft, in review, live, paused or off sale), behind the 'declutter' switch, not for a banned caller.
--      Turning it ON is a selling choice (declutter_assert_member) behind the 'declutter_haul_away' switch; turning
--      it OFF never is (the keep-up / auto-free pattern), so a seller who can no longer sell can still stop it.
--      The state reads NULL when the haul-away switch is off for the caller (the app hides the row then).
--      declutter_haul_away_opt_ins(): the caller's own opted-in item ids, for My listings (one read, not one a row).
--   3. declutter_haul_away_opted_in(item): the sweeps' read of the choice (not a definer; service role only).
--   4. RESTATED FROM THE NEWEST CREATE, verbatim except the lines marked HAUL-OPT-IN (prod md5(prosrc) read
--      2026-11-20 with read-only SQL and equal to the repo's bodies):
--        declutter_haul_away_sweep       from 20261027165903 (7a82d8e5ebe5b60108b97ccc92b2da26): Part A takes only
--          opted-in listings, and the claim re-checks the choice. Parts B and C (a haul-away the seller already
--          booked) are unchanged.
--        declutter_auto_free_due          from 20261030030408 (f4ed6ad197cf11e69d5055c961217264): "One more chance
--          before haul-away." only when the seller opted in (and 14 days or fewer, as before).
--        declutter_listing_rounds_sweep   from 20261029154323 (f78418a44ebef41c0eefd3d73bf111d6): "a Helpr take it
--          to donation" only when the seller opted in; the others get the same notice without that step.
--   What stays: declutter_link_haul_away and the haul-away state read do not look at the choice. The seller's own
--   taps (the moving sale's "Haul away what's left", a haul-away already booked or linked) keep working.
--
-- No money moves. Replay-safe: ADD COLUMN IF NOT EXISTS, CREATE OR REPLACE; grants restated by role name (REVOKE ...
-- FROM PUBLIC, anon). Proof: src/test/pglite/declutterHaulAwayOptIn.pglite.mjs (applied 3x; NEW_MIGRATION=skip is
-- red). Guard: src/test/declutterHaulAwayOptIn.test.ts.

ALTER TABLE public.declutter_item_private ADD COLUMN IF NOT EXISTS haul_away_opt_in boolean NOT NULL DEFAULT false;
COMMENT ON COLUMN public.declutter_item_private.haul_away_opt_in IS
  'Owner 2026-11-20: the seller''s "If it doesn''t sell, offer me a haul-away" (off by default). Set only by declutter_set_haul_away_opt_in; read by declutter_haul_away_sweep (the 14-day notice), declutter_auto_free_due and declutter_listing_rounds_sweep (their haul-away wording).';

-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.declutter_haul_away_opted_in(p_item_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path TO 'public', 'pg_temp'
AS $fn$
  SELECT COALESCE((SELECT p.haul_away_opt_in FROM public.declutter_item_private p WHERE p.item_id = p_item_id), false);
$fn$;
REVOKE ALL ON FUNCTION public.declutter_haul_away_opted_in(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.declutter_haul_away_opted_in(uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.declutter_set_haul_away_opt_in(p_item_id uuid, p_on boolean)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid uuid;
  v_item public.declutter_items%ROWTYPE;
BEGIN
  PERFORM public.require_feature('declutter');
  IF public.is_caller_banned() THEN
    RAISE EXCEPTION 'account_restricted' USING ERRCODE = '42501';
  END IF;
  IF p_on IS NULL THEN
    RAISE EXCEPTION 'invalid_choice' USING ERRCODE = '22023';
  END IF;
  -- Asking for a haul-away is a selling choice behind its own switch; turning it off never is.
  IF p_on THEN
    PERFORM public.require_feature('declutter_haul_away');
    v_uid := public.declutter_assert_member(true);
  ELSE
    v_uid := (SELECT auth.uid());
    IF v_uid IS NULL THEN
      RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501';
    END IF;
  END IF;
  SELECT * INTO v_item FROM public.declutter_items WHERE id = p_item_id AND seller_id = v_uid FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'item_not_found' USING ERRCODE = 'PT404';
  END IF;
  IF v_item.status NOT IN ('draft', 'pending_review', 'live', 'paused', 'ended') THEN
    RAISE EXCEPTION 'item_not_editable' USING ERRCODE = '22023';
  END IF;
  UPDATE public.declutter_item_private SET haul_away_opt_in = p_on, updated_at = now() WHERE item_id = p_item_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'item_not_found' USING ERRCODE = 'PT404';
  END IF;
  RETURN p_on;
END;
$fn$;
REVOKE ALL ON FUNCTION public.declutter_set_haul_away_opt_in(uuid, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.declutter_set_haul_away_opt_in(uuid, boolean) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.declutter_haul_away_opt_in_state(p_item_id uuid)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid uuid := (SELECT auth.uid());
  v_on boolean;
BEGIN
  PERFORM public.require_feature('declutter');
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501';
  END IF;
  SELECT p.haul_away_opt_in INTO v_on
    FROM public.declutter_item_private p JOIN public.declutter_items i ON i.id = p.item_id
   WHERE p.item_id = p_item_id AND i.seller_id = v_uid;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'item_not_found' USING ERRCODE = 'PT404';
  END IF;
  -- NULL: haul-away is not open for this member, so there is nothing to choose (the app hides the row).
  IF NOT public.feature_enabled_for_user('declutter_haul_away', v_uid) THEN
    RETURN NULL;
  END IF;
  RETURN v_on;
END;
$fn$;
REVOKE ALL ON FUNCTION public.declutter_haul_away_opt_in_state(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.declutter_haul_away_opt_in_state(uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.declutter_haul_away_opt_ins()
RETURNS uuid[]
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid uuid := (SELECT auth.uid());
  v_ids uuid[];
BEGIN
  PERFORM public.require_feature('declutter');
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501';
  END IF;
  SELECT COALESCE(array_agg(p.item_id ORDER BY p.item_id), ARRAY[]::uuid[]) INTO v_ids
    FROM public.declutter_item_private p JOIN public.declutter_items i ON i.id = p.item_id
   WHERE i.seller_id = v_uid AND p.haul_away_opt_in;
  RETURN v_ids;
END;
$fn$;
REVOKE ALL ON FUNCTION public.declutter_haul_away_opt_ins() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.declutter_haul_away_opt_ins() TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- RESTATED: the three senders. Grants as at their newest definitions (service role only).

CREATE OR REPLACE FUNCTION public.declutter_haul_away_sweep()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
SET lock_timeout TO '1s'
AS $fn$
DECLARE
  r record;
  v_ids uuid[];
  v_n integer;
  v_title text;
  v_status text;
  v_seller uuid;
  v_hold text;
  v_pay text;
  v_job_touched timestamptz;
  v_pi text;
  v_photos integer;
  v_link public.declutter_haul_aways%ROWTYPE;
  v_sellers integer := 0;
  v_items integer := 0;
  v_abandoned integer := 0;
  v_undone integer := 0;
  v_back integer := 0;
  v_errors integer := 0;
  v_locked integer := 0;
BEGIN
  -- A. One notice per seller for the listings that reached 14 days unsold.
  FOR r IN
    SELECT i.seller_id, array_agg(i.id ORDER BY i.id) AS ids
      FROM public.declutter_items i
     WHERE i.status = 'live'
       AND COALESCE(i.live_at, i.submitted_at, i.created_at) + interval '14 days' <= now()
       -- HAUL-OPT-IN (owner 2026-11-20): only a listing whose seller chose "If it doesn't sell, offer me a haul-away".
       AND public.declutter_haul_away_opted_in(i.id)
       AND NOT EXISTS (SELECT 1 FROM public.declutter_haul_away_notices n WHERE n.item_id = i.id)
       AND NOT EXISTS (SELECT 1 FROM public.declutter_haul_aways h WHERE h.item_id = i.id)
       AND NOT EXISTS (SELECT 1 FROM public.declutter_cart_items c
                        WHERE c.item_id = i.id AND c.status IN ('in_cart', 'paid'))
       AND public.feature_enabled_for_user('declutter', i.seller_id)
       AND public.feature_enabled_for_user('declutter_haul_away', i.seller_id)
       AND NOT public.declutter_member_out(i.seller_id)
     GROUP BY i.seller_id
     ORDER BY i.seller_id
     LIMIT 500
  LOOP
    BEGIN
      -- Claim first: an item another run already marked is never told twice.
      WITH claimed AS (
        INSERT INTO public.declutter_haul_away_notices (item_id)
        SELECT x FROM unnest(r.ids) x
         WHERE public.declutter_haul_away_opted_in(x)  -- HAUL-OPT-IN: switched off since the scan, never told
        ON CONFLICT (item_id) DO NOTHING
        RETURNING item_id
      )
      SELECT array_agg(item_id ORDER BY item_id) INTO v_ids FROM claimed;
      v_n := COALESCE(cardinality(v_ids), 0);
      IF v_n > 0 THEN
        IF v_n = 1 THEN
          SELECT i.title INTO v_title FROM public.declutter_items i WHERE i.id = v_ids[1];
          PERFORM public.declutter_notify(r.seller_id, 'info', 'Haul-away is open',
            format('"%s" hasn''t sold in 2 weeks. You can book a Helpr to take it to donation or the dump from My listings.', v_title),
            '/declutter?view=mine', r.seller_id);
        ELSE
          PERFORM public.declutter_notify(r.seller_id, 'info', 'Haul-away is open',
            format('%s of your items haven''t sold in 2 weeks. You can book a Helpr to take them to donation or the dump from My listings.', v_n),
            '/declutter?view=mine', r.seller_id);
        END IF;
        v_sellers := v_sellers + 1;
        v_items := v_items + v_n;
      END IF;
    EXCEPTION WHEN lock_not_available THEN
      v_locked := v_locked + 1;
    WHEN OTHERS THEN
      v_errors := v_errors + 1;
      PERFORM public.log_cron_defect('declutter_haul_away_sweep', r.seller_id::text,
        format('haul-away notice for seller %s failed: %s (%s)', r.seller_id, SQLERRM, SQLSTATE));
    END;
  END LOOP;

  -- B. A declined card's haul-away job whose checkout is gone: 'failed' -> 'abandoned'.
  FOR r IN
    SELECT j.id, COALESCE(j.is_seed, false) AS is_seed
      FROM public.jobs j
     WHERE j.status = 'open'
       AND j.payment_status = 'failed'
       AND j.stripe_session_id IS NULL
       AND j.stripe_payment_intent_id IS NULL
       AND j.updated_at <= now() - interval '1 day'
       AND EXISTS (SELECT 1 FROM public.declutter_haul_aways h WHERE h.job_id = j.id)
     ORDER BY j.id
     LIMIT 200
     -- The rows it is about to update (race-class guard); one a payment
     -- holds right now is left for the next day.
     FOR UPDATE OF j SKIP LOCKED
  LOOP
    BEGIN
      UPDATE public.jobs j
         SET payment_status = 'abandoned'
       WHERE j.id = r.id
         AND j.status = 'open'
         AND j.payment_status = 'failed'
         AND j.stripe_session_id IS NULL
         AND j.stripe_payment_intent_id IS NULL
         AND j.updated_at <= now() - interval '1 day'
         AND NOT EXISTS (SELECT 1 FROM public.gift_cards g
                          WHERE g.job_id = j.id AND g.status IN ('reserved', 'redeemed'));
      GET DIAGNOSTICS v_n = ROW_COUNT;
      v_abandoned := v_abandoned + v_n;
    EXCEPTION WHEN lock_not_available THEN
      v_locked := v_locked + 1;
    WHEN OTHERS THEN
      v_errors := v_errors + 1;
      PERFORM public.log_cron_defect('declutter_haul_away_sweep' || CASE WHEN r.is_seed THEN '-seed' ELSE '' END,
        r.id::text, format('could not mark haul-away job %s abandoned: %s (%s)', r.id, SQLERRM, SQLSTATE));
    END;
  END LOOP;

  -- C. Links at least 7 days old whose job holds nothing: the items come back.
  FOR r IN
    SELECT c.item_id FROM public.declutter_haul_away_sweep_candidates(500) c
  LOOP
    BEGIN
      -- Lock order: item, then job (the hold rule locks it), then link row,
      -- as declutter_link_haul_away and declutter_cancel_haul_away take them.
      SELECT i.status, i.seller_id, i.title INTO v_status, v_seller, v_title
        FROM public.declutter_items i WHERE i.id = r.item_id FOR UPDATE;
      SELECT * INTO v_link FROM public.declutter_haul_aways h WHERE h.item_id = r.item_id;
      IF NOT FOUND OR v_link.updated_at > now() - interval '7 days' THEN
        CONTINUE;  -- undone, re-pointed or re-made meanwhile
      END IF;
      v_hold := public.declutter_haul_job_hold(v_link.job_id);
      IF v_hold = 'job_open' THEN
        -- Part B's money guards too (lh-money-escrow review 2026-10-27 #2): an
        -- 'abandoned' job is never funded today, but the webhooks would fund one.
        SELECT j.payment_status, j.updated_at, j.stripe_payment_intent_id INTO v_pay, v_job_touched, v_pi
          FROM public.jobs j WHERE j.id = v_link.job_id FOR UPDATE;  -- already locked by the hold rule
        IF v_pay IS DISTINCT FROM 'abandoned' OR v_job_touched > now() - interval '1 day' OR v_pi IS NOT NULL
           OR EXISTS (SELECT 1 FROM public.gift_cards g
                       WHERE g.job_id = v_link.job_id AND g.status IN ('reserved', 'redeemed')) THEN
          CONTINUE;
        END IF;
      ELSIF v_hold <> 'none' THEN
        CONTINUE;  -- paying, booked, hauled, job_stuck: the haul-away stands
      END IF;
      PERFORM 1 FROM public.declutter_haul_aways h WHERE h.item_id = r.item_id FOR UPDATE;
      DELETE FROM public.declutter_haul_aways WHERE item_id = r.item_id AND job_id IS NOT DISTINCT FROM v_link.job_id;
      IF NOT FOUND THEN
        CONTINUE;
      END IF;
      v_undone := v_undone + 1;
      IF v_status = 'ended' AND v_link.prior_status = 'live' THEN
        SELECT count(*) INTO v_photos FROM public.declutter_item_photos ph WHERE ph.item_id = r.item_id;
        IF v_photos BETWEEN 3 AND 12 THEN
          UPDATE public.declutter_items SET status = 'live', updated_at = now() WHERE id = r.item_id;
          v_back := v_back + 1;
          PERFORM public.declutter_notify(v_seller, 'info', 'Back on sale',
            format('Your haul-away for "%s" didn''t go ahead, so it is back on sale. If it is gone, take it down in My listings.', v_title),
            '/declutter?view=mine', v_seller);
        ELSE
          PERFORM public.declutter_notify(v_seller, 'info', 'Haul-away not booked',
            format('Your haul-away for "%s" didn''t go ahead. It stays off sale until it has 3 to 12 photos: add them in My listings to put it back on sale.', v_title),
            '/declutter?view=mine', v_seller);
        END IF;
      END IF;
    EXCEPTION WHEN lock_not_available THEN
      v_locked := v_locked + 1;
    WHEN OTHERS THEN
      v_errors := v_errors + 1;
      PERFORM public.log_cron_defect('declutter_haul_away_sweep', r.item_id::text,
        format('could not put haul-away item %s back on sale: %s (%s)', r.item_id, SQLERRM, SQLSTATE));
    END;
  END LOOP;

  RETURN jsonb_build_object(
    'notified_sellers', v_sellers, 'notified_items', v_items, 'jobs_abandoned', v_abandoned,
    'links_undone', v_undone, 'items_back_on_sale', v_back, 'skipped_locked', v_locked, 'errors', v_errors);
END;
$fn$;
REVOKE ALL ON FUNCTION public.declutter_haul_away_sweep() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.declutter_haul_away_sweep() TO service_role;

CREATE OR REPLACE FUNCTION public.declutter_auto_free_due()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_n integer := 0;
  it record;
  o record;
  v_days integer;
  v_buyers uuid[];
  b uuid;
BEGIN
  FOR it IN
    SELECT i.id, i.title, i.seller_id, COALESCE(i.live_at, i.submitted_at, i.created_at) AS started
      FROM public.declutter_items i
      JOIN public.declutter_item_private p ON p.item_id = i.id
     WHERE p.auto_free_days IS NOT NULL
       AND i.status = 'live'
       AND NOT i.seller_hidden
       AND i.current_price_cents > 0
       AND COALESCE(i.live_at, i.submitted_at, i.created_at) + make_interval(days => p.auto_free_days) <= now()
     ORDER BY i.id
       FOR UPDATE OF i
  LOOP
    -- One item at a time: a failure frees nothing for that item and never undoes the evening's other
    -- work (review #4); it is logged where ops sees it.
    BEGIN
      -- Claim with a fresh read of the day count, under the item lock: a seller who chose Never, or a
      -- later day, while the sweep waited on the lock is respected (review #3).
      SELECT p.auto_free_days INTO v_days FROM public.declutter_item_private p WHERE p.item_id = it.id FOR UPDATE;
      CONTINUE WHEN v_days IS NULL OR it.started + make_interval(days => v_days) > now();
      UPDATE public.declutter_item_private
         SET floor_price_cents = 0, drop_stop_cents = NULL, auto_free_days = NULL, auto_free_day12 = false, updated_at = now()
       WHERE item_id = it.id;
      -- Open offers close: an offer must be below the price, and the item is now free to claim.
      v_buyers := '{}';
      FOR o IN
        UPDATE public.declutter_offers
           SET status = 'voided', closed_at = now(), updated_at = now()
         WHERE item_id = it.id AND status = 'open'
        RETURNING id, buyer_id
      LOOP
        INSERT INTO public.declutter_offer_events (offer_id, actor_side, action) VALUES (o.id, 'system', 'void');
        v_buyers := v_buyers || o.buyer_id;
      END LOOP;
      -- The watchers' "now free" notice: trg_declutter_items_price_drop_alert (Q2429).
      UPDATE public.declutter_items
         SET price_cents = 0, current_price_cents = 0, updated_at = now()
       WHERE id = it.id;
      -- Each buyer whose offer closed is told, unless the watchers' alert just told them (one notice,
      -- not two; and never none, e.g. a watcher over the daily alert cap: review #1).
      FOREACH b IN ARRAY v_buyers LOOP
        CONTINUE WHEN EXISTS (SELECT 1 FROM public.declutter_price_alerts a
                               WHERE a.item_id = it.id AND a.user_id = b AND a.sent_at = now());
        PERFORM public.declutter_notify(b, 'new_offers', 'Now free',
          format('"%s" is now free, so your offer is closed. Nothing was charged. You can claim it.', it.title),
          '/declutter/item/' || it.id::text, it.seller_id);
      END LOOP;
      PERFORM public.declutter_notify(it.seller_id, 'info', 'Your item is now free',
        format('"%s" didn''t sell in %s days, so it is now free, as you asked.%s', it.title, v_days,
          -- HAUL-OPT-IN: the haul-away line only for a seller who asked to be offered one.
          CASE WHEN v_days <= 14 AND public.declutter_haul_away_opted_in(it.id) THEN ' One more chance before haul-away.' ELSE '' END),
        '/declutter/item/' || it.id::text);
      v_n := v_n + 1;
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'declutter_auto_free_due: item % not made free: %', it.id, SQLERRM;
      PERFORM public.log_cron_defect('declutter_auto_free_due', it.id::text, SQLERRM, '{}'::jsonb);
    END;
  END LOOP;
  RETURN v_n;
END;
$fn$;
REVOKE ALL ON FUNCTION public.declutter_auto_free_due() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.declutter_auto_free_due() TO service_role;

CREATE OR REPLACE FUNCTION public.declutter_listing_rounds_sweep()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_nudged integer := 0;
  v_relisted integer := 0;
  v_ended integer := 0;
  v_renewed integer := 0;
  v_errors integer := 0;
  it record;
  r record;
  v_left integer;
  v_day text;
BEGIN
  -- a. "Ends soon": once per round, 3 days ahead.
  FOR it IN
    SELECT i.id, i.seller_id, i.title, i.relist_count, i.listed_until
      FROM public.declutter_items i
     WHERE i.status = 'live'
       AND i.listed_until IS NOT NULL
       AND i.listed_until > now()
       AND i.listed_until <= now() + interval '3 days'
       AND i.round_nudged IS DISTINCT FROM i.relist_count
       -- Keep it up until it sells (owner 2026-10-29): no "ends soon" notice; it just renews.
       AND NOT public.declutter_keeps_up(i.id)
     ORDER BY i.listed_until
     LIMIT 500
  LOOP
    BEGIN
      -- Claimed under the row lock, skipping a row another sweep holds (it is told on the next run):
      -- never a plain UPDATE that waits while this run holds the rows it already claimed (review nit 2).
      SELECT i.id, i.current_price_cents INTO r
        FROM public.declutter_items i
       WHERE i.id = it.id AND i.status = 'live' AND i.round_nudged IS DISTINCT FROM it.relist_count
       FOR UPDATE SKIP LOCKED;
      -- Re-read under the row lock (declutter_set_keep_up takes the same lock): switched on since the scan, no notice.
      IF FOUND AND NOT public.declutter_keeps_up(it.id) THEN
        UPDATE public.declutter_items SET round_nudged = it.relist_count WHERE id = it.id;
        v_day := to_char(it.listed_until AT TIME ZONE 'America/Chicago', 'FMDay, Mon FMDD');
        v_left := 3 - it.relist_count;
        -- Only steps that exist (review should-fix 1): lowering the price (not for a free item), and after the
        -- last round a Helpr haul to donation (haul-away takes an 'ended' item). No "give it away" for an
        -- ended item: nothing moves one to the Free section.
        PERFORM public.declutter_notify(it.seller_id, 'info',
          CASE WHEN v_left > 0 THEN 'Your listing goes back up soon' ELSE 'Your listing comes down soon' END,
          CASE
            WHEN v_left > 0 AND r.current_price_cents > 0
              THEN format('"%s" hasn''t sold yet. On %s it goes back up for another 30 days by itself (%s more %s after this). You could lower the price to help it sell.',
                          it.title, v_day, v_left, CASE WHEN v_left = 1 THEN 'time' ELSE 'times' END)
            WHEN v_left > 0
              THEN format('No one has claimed "%s" yet. On %s it goes back up for another 30 days by itself (%s more %s after this).',
                          it.title, v_day, v_left, CASE WHEN v_left = 1 THEN 'time' ELSE 'times' END)
            -- HAUL-OPT-IN: the Helpr-to-donation step only for a seller who asked to be offered a haul-away.
            WHEN r.current_price_cents > 0 AND public.declutter_haul_away_opted_in(it.id)
              THEN format('"%s" has been up four times without selling. It comes down on %s. Lower the price now, or after that you can have a Helpr take it to donation.',
                          it.title, v_day)
            WHEN r.current_price_cents > 0
              THEN format('"%s" has been up four times without selling. It comes down on %s. You could lower the price now to help it sell.',
                          it.title, v_day)
            WHEN public.declutter_haul_away_opted_in(it.id)
              THEN format('No one has claimed "%s" after four rounds. It comes down on %s. After that you can have a Helpr take it to donation.',
                        it.title, v_day)
            ELSE format('No one has claimed "%s" after four rounds. It comes down on %s.',
                        it.title, v_day)
          END,
          '/declutter?view=selling');
        v_nudged := v_nudged + 1;
      END IF;
    EXCEPTION WHEN OTHERS THEN
      v_errors := v_errors + 1;
      RAISE WARNING 'declutter_listing_rounds_sweep: notice for % failed: %', it.id, SQLERRM;
      PERFORM public.log_cron_defect('declutter_listing_rounds_sweep', it.id::text, SQLERRM, '{}'::jsonb);
    END;
  END LOOP;

  -- b. A round ended: relist, or after the last round take it down.
  FOR it IN
    SELECT i.id
      FROM public.declutter_items i
     WHERE i.status = 'live' AND i.listed_until IS NOT NULL AND i.listed_until <= now()
     ORDER BY i.listed_until
     LIMIT 500
  LOOP
    BEGIN
      -- Under the row lock, re-read: a sale or a pause since the scan wins.
      SELECT i.id, i.seller_id, i.title, i.relist_count INTO r
        FROM public.declutter_items i
       WHERE i.id = it.id AND i.status = 'live' AND i.listed_until <= now()
       FOR UPDATE SKIP LOCKED;
      CONTINUE WHEN NOT FOUND;
      IF public.declutter_keeps_up(r.id) THEN
        -- Keep it up until it sells (owner 2026-10-29): another 30 days, no cap, no notice. relist_count is
        -- not counted up, so switching it off picks up the normal rounds where they were.
        UPDATE public.declutter_items
           SET listed_until = now() + interval '30 days', round_nudged = NULL, updated_at = now()
         WHERE id = r.id;
        v_renewed := v_renewed + 1;
      ELSIF r.relist_count < 3 THEN
        UPDATE public.declutter_items
           SET relist_count = r.relist_count + 1, listed_until = now() + interval '30 days', round_nudged = NULL, updated_at = now()
         WHERE id = r.id;
        PERFORM public.declutter_notify(r.seller_id, 'info', 'Back up for another 30 days',
          format('"%s" is up again for 30 more days (round %s of 4).', r.title, r.relist_count + 2),
          '/declutter?view=selling');
        v_relisted := v_relisted + 1;
      ELSE
        -- Its open offers close (buyers told, nothing charged), as a pause does.
        PERFORM public.declutter_listing_round_close_offers(r.id, r.title, r.seller_id);
        UPDATE public.declutter_items SET status = 'ended', updated_at = now() WHERE id = r.id;
        PERFORM public.declutter_notify(r.seller_id, 'info', 'Your listing came down',
          -- HAUL-OPT-IN: the Helpr-to-donation step only for a seller who asked to be offered a haul-away.
          CASE WHEN public.declutter_haul_away_opted_in(r.id)
            THEN format('"%s" was up four times without a buyer, so it''s off sale now. Open Selling to have a Helpr take it to donation.', r.title)
            ELSE format('"%s" was up four times without a buyer, so it''s off sale now.', r.title)
          END,
          '/declutter?view=selling');
        v_ended := v_ended + 1;
      END IF;
    EXCEPTION WHEN OTHERS THEN
      v_errors := v_errors + 1;
      RAISE WARNING 'declutter_listing_rounds_sweep: item % not moved: %', it.id, SQLERRM;
      PERFORM public.log_cron_defect('declutter_listing_rounds_sweep', it.id::text, SQLERRM, '{}'::jsonb);
    END;
  END LOOP;

  RETURN jsonb_build_object('nudged', v_nudged, 'relisted', v_relisted, 'renewed', v_renewed, 'ended', v_ended, 'errors', v_errors);
END;
$fn$;
REVOKE ALL ON FUNCTION public.declutter_listing_rounds_sweep() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.declutter_listing_rounds_sweep() TO service_role;
