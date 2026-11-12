-- Shops "new from shops you follow" alerts (Q1948 L92; owner 11-12 1:20 AM: a last piece before Shops opens to everyone).
--
-- Before: a member could follow a shop (shop_follows, 20261017061155) but nothing ever told them anything; following did
-- nothing.
--
-- Now: when a shop item goes LIVE for the first time, each follower gets one bell + push notice of the new type
-- shops_following, "New from <shop>: <shop> added <title>.", linking to /shops/<shop id>.
--   * ONCE PER ITEM: shop_items.followers_told_at is stamped the first time the item is live, so an edit that sends a
--     live item back through review (live -> pending_review -> live), a withdraw and relist, or a stock change never
--     tells the followers again.
--   * NO FLOOD: a follower with an UNREAD shops_following notice for the same shop from the last 24 hours gets that
--     notice rewritten in place ("<shop> added new items.", unread again) instead of a second one.
--   * WHO IS SKIPPED: the owner themselves; a follower on either side of a block with the owner (are_users_blocked);
--     a follower whose shops switch is off for them (feature_enabled_for_user); a test item (is_seed), a test shop
--     (shops.is_seed) or a test owner (is_test_subject), so test data never reaches a real member; a shop that is not
--     publicly in good standing (shop_state_ok: hidden, banned or struck-out owner), is paused (vacation) or has
--     selling turned off (offers_selling). The in-place rewrite uses the same block and switch filters.
--   * FAIL-SAFE: the notice step catches its own errors (RAISE WARNING); listing an item can never fail on it.
-- SWITCHES: notification_preferences.shops_following (push, DEFAULT true, owner rule: reminders all on by default; a
-- follow is already an opt-in) and email_shops_following (DEFAULT false: no email sender exists for this kind; the
-- settings row says "In the app only"). notification_type_pref_map row points push at shops_following.
-- notifications_type_check: RESTATED from the newest CREATE, 20261112061000_admin_activity_bell.sql (this branch sits on
-- ready/b1-bell-1112), plus 'shops_following'.
-- MONEY: none. AUTHZ: one trigger function (SECURITY DEFINER, no caller; EXECUTE revoked from PUBLIC/anon/authenticated);
-- no new table, no grant, no RLS change. shop_items.followers_told_at is not in the authenticated column grant.
-- REPLAY-SAFE: ADD COLUMN IF NOT EXISTS, DROP/ADD of the CHECK, ON CONFLICT, CREATE OR REPLACE, DROP TRIGGER IF EXISTS.
-- Proof: src/test/pglite/shopsFollowAlerts.pglite.mjs (3x; NEW_MIGRATION=skip red; planted defects red).

-- 1. The switches.
ALTER TABLE public.notification_preferences ADD COLUMN IF NOT EXISTS shops_following boolean NOT NULL DEFAULT true;
ALTER TABLE public.notification_preferences ADD COLUMN IF NOT EXISTS email_shops_following boolean NOT NULL DEFAULT false;

-- 2. The type.
ALTER TABLE public.notifications
  DROP CONSTRAINT IF EXISTS notifications_type_check;
ALTER TABLE public.notifications
  ADD CONSTRAINT notifications_type_check
  CHECK (type IN (
    'info', 'success', 'warning', 'job_update', 'application', 'review', 'payment',
    'job_match', 'job_updates', 'work_status', 'transit_updates',
    'system_alert', 'new_offers', 'expired', 'financial_alerts', 'verified',
    'message',
    'admin_alert',
    'declutter_listings', 'declutter_offers', 'declutter_sales', 'declutter_pickups',
    'declutter_refunds', 'declutter_price_drops', 'declutter_wanted', 'declutter_questions',
    'shops_orders', 'shops_messages', 'shops_updates',
    -- Admin bell activity (20261112061000): bell only.
    'admin_activity',
    -- New from shops you follow (20261112070000).
    'shops_following'
  ));

INSERT INTO public.notification_type_pref_map (type, pref_column, description) VALUES
  ('shops_following', 'shops_following', 'Shops: new items from shops you follow.')
ON CONFLICT (type) DO UPDATE
  SET pref_column = EXCLUDED.pref_column,
      description = EXCLUDED.description;

-- 3. Once per item.
ALTER TABLE public.shop_items ADD COLUMN IF NOT EXISTS followers_told_at timestamptz;

-- 4. The step. BEFORE, so the stamp rides the same row write (no second UPDATE, no recursion).
CREATE OR REPLACE FUNCTION public.shop_items_tell_followers()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_shop public.shops%ROWTYPE;
  v_link text;
BEGIN
  IF NEW.status IS DISTINCT FROM 'live' OR NEW.followers_told_at IS NOT NULL THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.status = 'live' THEN
    RETURN NEW;
  END IF;
  -- Stamped even when nobody is told (a test item, a paused shop): the first time live is the only time.
  NEW.followers_told_at := now();
  IF coalesce(NEW.is_seed, false) THEN
    RETURN NEW;
  END IF;
  BEGIN
    SELECT * INTO v_shop FROM public.shops s WHERE s.id = NEW.shop_id;
    IF NOT FOUND OR coalesce(v_shop.is_seed, false) OR coalesce(v_shop.paused, false) OR NOT coalesce(v_shop.offers_selling, true)
       OR NOT public.shop_state_ok(v_shop.id) OR public.is_test_subject(v_shop.owner_id) THEN
      RETURN NEW;
    END IF;
    v_link := '/shops/' || v_shop.id::text;
    -- Collapse: an unread notice for this shop from the last 24 hours becomes "added new items".
    UPDATE public.notifications n
       SET message = v_shop.name || ' added new items.', read = false
      FROM public.shop_follows f
     WHERE f.shop_id = v_shop.id
       AND n.user_id = f.user_id
       AND n.type = 'shops_following' AND n.link = v_link AND NOT n.read
       AND n.created_at > now() - interval '24 hours'
       AND f.user_id <> v_shop.owner_id
       AND NOT public.are_users_blocked(f.user_id, v_shop.owner_id)
       AND public.feature_enabled_for_user('shops', f.user_id);
    INSERT INTO public.notifications (user_id, title, message, type, link, actor_id)
    SELECT f.user_id, left('New from ' || v_shop.name, 200), v_shop.name || ' added ' || NEW.title || '.',
           'shops_following', v_link, v_shop.owner_id
      FROM public.shop_follows f
     WHERE f.shop_id = v_shop.id
       AND f.user_id <> v_shop.owner_id
       AND NOT public.are_users_blocked(f.user_id, v_shop.owner_id)
       AND public.feature_enabled_for_user('shops', f.user_id)
       AND NOT EXISTS (
         SELECT 1 FROM public.notifications n
          WHERE n.user_id = f.user_id AND n.type = 'shops_following' AND n.link = v_link AND NOT n.read
            AND n.created_at > now() - interval '24 hours');
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'shop_items_tell_followers: %', SQLERRM;
  END;
  RETURN NEW;
END;
$fn$;
REVOKE ALL ON FUNCTION public.shop_items_tell_followers() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.shop_items_tell_followers() TO service_role;

DROP TRIGGER IF EXISTS trg_shop_items_tell_followers ON public.shop_items;
CREATE TRIGGER trg_shop_items_tell_followers
  BEFORE INSERT OR UPDATE OF status ON public.shop_items
  FOR EACH ROW EXECUTE FUNCTION public.shop_items_tell_followers();
