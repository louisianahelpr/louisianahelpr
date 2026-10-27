-- AUTO-FREE BEFORE HAUL-AWAY (owner 2026-10-27, Q2430): "A seller can opt in: 'If it hasn't sold by day
-- 12, make it free' -- the price-drop sweep sets it Free (Q2419 free rules apply, no setup fee) one last
-- chance before the 14-day haul-away; watchers get the Q2429 alert."
--
-- - declutter_item_private.auto_free_day12: the seller's private switch, off by default.
-- - declutter_set_auto_free(item, on) / declutter_auto_free_state(item): the seller's own listing only
--   (draft, in review, live or paused), behind the 'declutter' switch, not for a banned caller; a free
--   item has nothing to switch.
-- - declutter_auto_free_due(): run by the evening price-drop sweep. Every LIVE listing the seller switched
--   on, still priced, sold by offers, and live for 12 days or more (COALESCE(live_at, submitted_at,
--   created_at), the same clock the haul-away's 14 days uses) becomes free exactly as a free listing is
--   (20261027170717): price and current price 0, a 0 floor, the stop re-picked by its trigger (the
--   1-cent stop a new free listing gets). Its open offers close (an offer must be below the price), each
--   buyer told (once: the watchers' alert or this notice); the seller is told. A hidden seller's listing
--   is never made free. One item failing frees nothing for it and is logged (log_cron_defect).
--   Switching it on after day 12 makes the listing free at that evening's sweep. No setup fee is charged (the listing
--   fee trigger never charges a $0 item) and no payout is ever owed on it. The watchers' "now free"
--   notice comes from trg_declutter_items_price_drop_alert (Q2429).
-- - declutter_price_drop_sweep restated from its newest definition (20261027204745) with only the
--   auto-free call added at the top.
--
-- Replay-safe: ADD COLUMN IF NOT EXISTS / CREATE OR REPLACE; grants by role name (REVOKE ... FROM
-- PUBLIC, anon). Proof: src/test/pglite/declutterAutoFree.pglite.mjs (3x replay). Guard:
-- src/test/declutterAutoFree.test.ts.

ALTER TABLE public.declutter_item_private ADD COLUMN IF NOT EXISTS auto_free_day12 boolean NOT NULL DEFAULT false;
COMMENT ON COLUMN public.declutter_item_private.auto_free_day12 IS
  'Q2430: the seller''s "If it hasn''t sold by day 12, make it free". Set only by declutter_set_auto_free; acted on by declutter_auto_free_due (the evening sweep).';

CREATE OR REPLACE FUNCTION public.declutter_set_auto_free(p_item_id uuid, p_on boolean)
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
  -- Turning it ON is a selling choice (the member gate); turning it OFF never is, so a seller who can
  -- no longer sell (3 strikes, under 18) can still stop it, as pausing a listing works (review #2).
  IF p_on THEN
    v_uid := public.declutter_assert_member(true);
  ELSE
    v_uid := (SELECT auth.uid());
    IF v_uid IS NULL THEN
      RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501';
    END IF;
  END IF;
  SELECT * INTO v_item FROM public.declutter_items WHERE id = p_item_id AND seller_id = v_uid FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'item_not_found' USING ERRCODE = 'P0002';
  END IF;
  IF v_item.status NOT IN ('draft', 'pending_review', 'live', 'paused') THEN
    RAISE EXCEPTION 'item_not_editable' USING ERRCODE = '22023';
  END IF;
  IF v_item.current_price_cents = 0 THEN
    RAISE EXCEPTION 'already_free' USING ERRCODE = '22023', HINT = 'This item is already free.';
  END IF;
  UPDATE public.declutter_item_private SET auto_free_day12 = p_on, updated_at = now() WHERE item_id = p_item_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'item_not_found' USING ERRCODE = 'P0002';
  END IF;
  RETURN p_on;
END;
$fn$;
REVOKE ALL ON FUNCTION public.declutter_set_auto_free(uuid, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.declutter_set_auto_free(uuid, boolean) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.declutter_auto_free_state(p_item_id uuid)
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
  SELECT p.auto_free_day12 INTO v_on
    FROM public.declutter_item_private p JOIN public.declutter_items i ON i.id = p.item_id
   WHERE p.item_id = p_item_id AND i.seller_id = v_uid;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'item_not_found' USING ERRCODE = 'P0002';
  END IF;
  RETURN v_on;
END;
$fn$;
REVOKE ALL ON FUNCTION public.declutter_auto_free_state(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.declutter_auto_free_state(uuid) TO authenticated, service_role;

-- Day 12: every due listing becomes free. Returns how many. Service role only (the sweep).
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
  v_claimed uuid;
  v_buyers uuid[];
  b uuid;
BEGIN
  FOR it IN
    SELECT i.id, i.title, i.seller_id
      FROM public.declutter_items i
      JOIN public.declutter_item_private p ON p.item_id = i.id
     WHERE p.auto_free_day12
       AND i.status = 'live'
       AND NOT i.seller_hidden
       AND i.sale_mode = 'offers'
       AND i.current_price_cents > 0
       AND COALESCE(i.live_at, i.submitted_at, i.created_at) + interval '12 days' <= now()
     ORDER BY i.id
       FOR UPDATE OF i
  LOOP
    -- One item at a time: a failure frees nothing for that item and never undoes the evening's other
    -- work (review #4); it is logged where ops sees it.
    BEGIN
      -- Claim the switch with a fresh read: a seller who turned it off while the sweep waited on the
      -- item lock is respected (review #3).
      v_claimed := NULL;
      UPDATE public.declutter_item_private
         SET floor_price_cents = 0, drop_stop_cents = NULL, auto_free_day12 = false, updated_at = now()
       WHERE item_id = it.id AND auto_free_day12
      RETURNING item_id INTO v_claimed;
      CONTINUE WHEN v_claimed IS NULL;
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
        format('"%s" didn''t sell in 12 days, so it is now free, as you asked. One more chance before haul-away.', it.title),
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

-- The evening sweep, restated from 20261027204745 with the auto-free call added.
CREATE OR REPLACE FUNCTION public.declutter_price_drop_sweep()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_today date := (now() AT TIME ZONE 'America/Chicago')::date;
  v_n integer := 0;
  r record;
BEGIN
  -- Q2430: day 12, the seller's "make it free" (one last chance before the 14-day haul-away).
  v_n := v_n + public.declutter_auto_free_due();
  FOR r IN
    UPDATE public.declutter_items i
       -- Never below the stop point, which is always above the floor (B42).
       SET current_price_cents = greatest(p.floor_price_cents, COALESCE(p.drop_stop_cents, p.floor_price_cents),
                                          floor(i.current_price_cents * 0.95)::integer),
           last_price_drop_on = v_today,
           price_dropped_at = now(),
           updated_at = now()
      FROM public.declutter_item_private p
     WHERE p.item_id = i.id
       AND i.status = 'live'
       AND i.sale_mode = 'offers'
       AND i.live_at IS NOT NULL AND i.live_at <= now() - interval '12 hours'
       AND i.current_price_cents > greatest(p.floor_price_cents, COALESCE(p.drop_stop_cents, p.floor_price_cents))
       AND (i.last_price_drop_on IS NULL OR i.last_price_drop_on < v_today)
    RETURNING i.id, i.title, i.current_price_cents, i.is_seed
  LOOP
    -- Q2429: the watchers' "price dropped" notice is sent by trg_declutter_items_price_drop_alert
    -- (every path that lowers a price, rate-limited), no longer from here.
    v_n := v_n + 1;
  END LOOP;
  RETURN v_n;
END;
$fn$;
REVOKE ALL ON FUNCTION public.declutter_price_drop_sweep() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.declutter_price_drop_sweep() TO service_role;

