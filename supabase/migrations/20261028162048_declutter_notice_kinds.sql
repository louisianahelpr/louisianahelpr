-- Declutter notices get their own kinds and their own switches (owner pop-up
-- via the lead, 2026-10-28: "Yes, build them": in-app + push for Declutter,
-- with on/off switches under a "Declutter" group in notification settings).
--
-- WHAT WAS WRONG (measured on prod fncmgoasalhdgfwzhsqa, read-only, 2026-10-28):
--
--   1. Every Declutter notice rode a JOBS switch. public.declutter_notify wrote
--      whatever generic type its caller passed ('new_offers', 'payment',
--      'info', 'warning', 'expired', 'job_updates', 'work_status'), and
--      fan_out_push_on_notification gates push on that type's column. So a
--      member who muted "Job offers" silently lost the push for a new offer on
--      their Declutter item, "Job payments" muted "Buyer paid", and so on. The
--      2026-10-28 walkthrough account had exactly those two switched off.
--      There was no Declutter group to turn on or off.
--   2. Submitting a listing told the seller nothing: declutter_publish_item
--      sets 'pending_review' (or 'live' for a trusted seller) and returns.
--      Approval and "needs a change" were told (20261027182550); the first step
--      was not.
--   3. A question on an item, and the seller's answer, told nobody.
--   4. declutter_price_drop_alert (20261027204745) did
--      `INSERT ... RETURNING id INTO v_notified` with v_notified declared
--      bigint, but notifications.id is uuid on prod. The assignment fails, the
--      watcher's block rolls back (bell row and ledger row with it) and a
--      defect is logged: no watcher could ever be told of a price drop. Its
--      PGlite proof built notifications with a bigint id, so it never saw it.
--      (Prod has 0 watchlist rows today, so no member has missed one yet.)
--
-- WHAT THIS DOES:
--
--   * Seven notification types, each with a push column and its email twin
--     (the six-registry rule, src/test/notificationTypeRegistries.test.ts):
--       declutter_listings     your listing: in review, live, needs a change, haul-away
--       declutter_offers       offers made, countered, declined, expired; questions
--       declutter_sales        sold or reserved, checkout reminders, payment received
--       declutter_pickups      pickup reminders, no-shows, meet-ups, deliveries
--       declutter_refunds      refund request steps, problems, strikes
--       declutter_price_drops  a watched item got cheaper or free
--       declutter_wanted       a listing matches your Wanted post
--     Transactional kinds default ON. The two alert-like kinds (price drops,
--     Wanted matches) follow the switch that governed them until now: each is
--     backfilled from the member's own `new_offers` (and price-drop email from
--     `email_new_offers`), so nobody who muted them is re-subscribed. Pickup
--     reminders are transactional: push and email both start ON (owner rule),
--     not carried over from the Job updates switches. Backfills run only on
--     the run that ADDS the column, so a replay never overwrites a later choice.
--   * declutter_notify routes by kind in ONE place (declutter_notice_type):
--     a caller's own declutter_* type is kept; a link outside /declutter (Shops,
--     /jobs, /admin, earnings), a Helpr's delivery work (/declutter?view=deliver)
--     and saved-search matches (job_match, which have per-search switches) keep
--     their type; every other Declutter notice maps by its title, then by its
--     old type. src/test/declutterNoticeKinds.test.ts fails when a Declutter
--     notice title is not listed explicitly.
--   * declutter_notify never fails the event it reports: a notice that cannot be
--     written is logged (log_cron_defect, one row per member+title+link an hour,
--     with the message, so ops can rebuild it) and the caller's transaction goes
--     on. That includes the sweeps whose comments say a failed step is "retried
--     next run" (deadline, handover, delivery, refund-request sweeps): their
--     state changes still roll back and retry on their own errors, but a notice
--     that cannot be written is now logged instead of undoing the step. Pickup
--     reminders, where the notice IS the step, use declutter_notify_strict, so
--     a failed reminder still rolls its booking's claim back and is retried.
--   * New notices, written in the same transaction as the event, by trigger so no
--     RPC another lane owns is restated: "Listing sent for review" / "Your listing
--     is live" when a draft is submitted (one per seller per 10 minutes, so a
--     moving-out sale that lists 30 things at once sends one), "New question" to
--     the seller, "The seller answered" to the asker.
--   * Text messages: unchanged. sms_kind_for (prod, read 2026-10-28) gives
--     every Declutter notice NULL today (no job_id, no matching title), so no
--     Declutter notice was being texted, and the new types keep it that way.
--     The setup-job notices that ARE texted ("Job cancelled") link to /jobs and
--     keep their type.
--   * declutter_price_drop_alert: v_notified is uuid (bug 4), type
--     declutter_price_drops. Wanted alerts: type declutter_wanted, muted by the
--     new declutter_wanted column. Pickup reminders: type declutter_pickups,
--     email gated by email_declutter_pickups.
--   * One more definer helper, declutter_notify_strict (service_role only).
--
-- REPLAY-SAFETY: ADD COLUMN IF NOT EXISTS behind a DO block that backfills only
-- when it added the column; DROP/ADD of the CHECK; INSERT .. ON CONFLICT;
-- CREATE OR REPLACE; DROP TRIGGER IF EXISTS before CREATE TRIGGER. Every object
-- it depends on exists on prod and in every earlier migration's world:
-- notification_preferences, notification_type_pref_map, notifications,
-- declutter_items, declutter_questions, declutter_watchlist,
-- declutter_price_alerts, log_cron_defect, are_users_blocked.

-- ---------------------------------------------------------------------------
-- 1. The switches: seven push columns and their email twins.
-- ---------------------------------------------------------------------------
DO $mig$
DECLARE
  v_col text;
BEGIN
  FOREACH v_col IN ARRAY ARRAY['declutter_listings', 'declutter_offers', 'declutter_sales',
                               'declutter_pickups', 'declutter_refunds', 'declutter_price_drops',
                               'declutter_wanted']
  LOOP
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                    WHERE table_schema = 'public' AND table_name = 'notification_preferences'
                      AND column_name = v_col) THEN
      EXECUTE format('ALTER TABLE public.notification_preferences ADD COLUMN %I boolean NOT NULL DEFAULT true', v_col);
      -- The alert-like kinds keep the member's current choice (they rode new_offers).
      IF v_col IN ('declutter_price_drops', 'declutter_wanted') THEN
        EXECUTE format('UPDATE public.notification_preferences SET %I = COALESCE(new_offers, true)', v_col);
      END IF;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                    WHERE table_schema = 'public' AND table_name = 'notification_preferences'
                      AND column_name = 'email_' || v_col) THEN
      EXECUTE format('ALTER TABLE public.notification_preferences ADD COLUMN %I boolean NOT NULL DEFAULT true', 'email_' || v_col);
      IF v_col = 'declutter_price_drops' THEN
        UPDATE public.notification_preferences SET email_declutter_price_drops = COALESCE(email_new_offers, true);
      END IF;
    END IF;
  END LOOP;
END
$mig$;

-- ---------------------------------------------------------------------------
-- 2. The types (every earlier value kept) and their push columns.
-- ---------------------------------------------------------------------------
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
    -- Declutter, one per switch in the Declutter group
    'declutter_listings', 'declutter_offers', 'declutter_sales', 'declutter_pickups',
    'declutter_refunds', 'declutter_price_drops', 'declutter_wanted'
  ));

INSERT INTO public.notification_type_pref_map (type, pref_column, description) VALUES
  ('declutter_listings',    'declutter_listings',    'Declutter: your listing is in review, live, needs a change, or heading to haul-away.'),
  ('declutter_offers',      'declutter_offers',      'Declutter: offers made, countered, declined, withdrawn or expired, and questions on items.'),
  ('declutter_sales',       'declutter_sales',       'Declutter: sold or reserved, checkout reminders, payment received, sale cancelled.'),
  ('declutter_pickups',     'declutter_pickups',     'Declutter: pickup reminders, no-shows, meet-ups, porch pickups and deliveries.'),
  ('declutter_refunds',     'declutter_refunds',     'Declutter: refund request steps, reported problems and strikes.'),
  ('declutter_price_drops', 'declutter_price_drops', 'Declutter: an item you watch got cheaper or free.'),
  ('declutter_wanted',      'declutter_wanted',      'Declutter: a listing matches something you posted on Wanted.')
ON CONFLICT (type) DO UPDATE
  SET pref_column = EXCLUDED.pref_column,
      description = EXCLUDED.description;

-- ---------------------------------------------------------------------------
-- 3. Which kind a Declutter notice is. One place; titles listed explicitly
--    (src/test/declutterNoticeKinds.test.ts reads these lists).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.declutter_notice_type(p_type text, p_title text, p_link text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path TO 'public', 'pg_temp'
AS $fn$
  SELECT CASE
    -- The caller already chose a Declutter kind.
    WHEN p_type IN ('declutter_listings', 'declutter_offers', 'declutter_sales', 'declutter_pickups',
                    'declutter_refunds', 'declutter_price_drops', 'declutter_wanted') THEN p_type
    -- Not a Declutter screen: Shops orders, setup jobs, admin alerts, earnings.
    WHEN p_link IS NULL OR p_link NOT LIKE '/declutter%' THEN p_type
    -- A Helpr's delivery work is work, not their own buying or selling.
    WHEN p_link LIKE '/declutter?view=deliver%' OR p_link LIKE '/declutter?tab=deliver%' THEN p_type
    -- Saved-search matches have their own per-search switches.
    WHEN p_type = 'job_match' THEN p_type
    WHEN p_title IN ('Listing sent for review', 'Your listing is live', 'Your listing needs a change',
                     'Your item is now free', 'Haul-away is open', 'Haul-away not booked',
                     'Haul-away refunded', 'Back on sale', 'Donation receipt',
                     -- Listing rounds (sell flow, 20261028164424, lands after this file)
                     'Your listing goes back up soon', 'Your listing comes down soon',
                     'Back up for another 30 days', 'Your listing came down')
      THEN 'declutter_listings'
    WHEN p_title IN ('New offer', 'New counteroffer', 'Offer declined', 'Offer withdrawn', 'Offer expired',
                     'Item no longer available', 'Item paused', 'Item taken down', 'Item off sale',
                     'Now free', 'New question', 'The seller answered', 'Item came down')
      THEN 'declutter_offers'
    WHEN p_title IN ('It''s yours', 'It''s yours: check out within 48 hours',
                     'It''s yours: pick a pickup within 48 hours', 'Free item claimed',
                     'Someone claimed your free item', 'Sold: waiting for the buyer to pay',
                     'Check out within 24 hours', '2 hours left to check out', 'Checkout closed',
                     'Buyer did not check out', 'The seller cancelled', 'This sale was cancelled',
                     'Sale cancelled', 'Free pickup cancelled', 'Payment received', 'Buyer paid',
                     'Card saved', 'Handover done', 'Enjoy your item', 'Amount owed', 'Amount owed added',
                     'An amount owed comes out of your next payout', 'Setup fee coming back',
                     'Delivery pay raised', 'Your raise is coming back')
      THEN 'declutter_sales'
    WHEN p_title IN ('Pickup booked', 'Pickup time changed', 'Pickup time cancelled', 'You missed your pickup',
                     'Your buyer is at the meeting spot', 'The seller is at the meeting spot',
                     'Your item is on the porch', 'Your item was picked up', 'Picked up', 'Delivered',
                     'Delivery booked', 'Delivery changed', 'Delivery coming up', 'Delivery time kept',
                     'Delivery time changed', 'New delivery time asked', 'Pick a new delivery time',
                     'Buyer is picking a delivery time', 'Your items were delivered', 'Your item is on its way',
                     'A Helpr took your delivery', 'A Helpr will pick it up', 'Helpr pickup booked',
                     'Finding another Helpr', 'The Helpr couldn''t pick up', 'Your delivery is on hold',
                     'Your delivery fell through', 'No Helpr took your delivery', 'The buyer will pick it up')
      THEN 'declutter_pickups'
    WHEN p_title IN ('Refund request', 'Refund request withdrawn', 'Refund on its way', 'Buyer refunded',
                     'Your refund did not go through', 'Your refund is being sent by hand',
                     'The seller agreed to a full refund', 'Full refund agreed',
                     'The seller offered a part refund', 'The seller said no',
                     'Louisiana Helpr will decide', 'Louisiana Helpr decided',
                     'A problem was reported on your sale', 'You got a Declutter strike',
                     'Your strike was removed')
      THEN 'declutter_refunds'
    WHEN p_title IN ('A seller has a match')
      THEN 'declutter_wanted'
    -- A title nobody listed yet still lands in the Declutter group, by its old type.
    WHEN p_type IN ('new_offers', 'expired') THEN 'declutter_offers'
    WHEN p_type IN ('job_updates', 'job_update', 'work_status', 'transit_updates') THEN 'declutter_pickups'
    WHEN p_type IN ('warning', 'system_alert') THEN 'declutter_refunds'
    WHEN p_type IN ('payment', 'financial_alerts') THEN 'declutter_sales'
    WHEN p_type IN ('info', 'success') THEN 'declutter_listings'
    ELSE p_type
  END;
$fn$;
REVOKE ALL ON FUNCTION public.declutter_notice_type(text, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.declutter_notice_type(text, text, text) TO service_role;

-- ---------------------------------------------------------------------------
-- 4. declutter_notify: the kind, and a notice never fails its event.
--    The seed rule (Q137) is the slice 3 one, restated as an early return.
-- ---------------------------------------------------------------------------
-- The write itself, raising on failure: for a caller whose step IS the notice
-- (pickup reminders), so its own handler rolls the step back and retries.
CREATE OR REPLACE FUNCTION public.declutter_notify_strict(p_user uuid, p_type text, p_title text, p_message text, p_link text,
  p_other uuid DEFAULT NULL)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
BEGIN
  IF p_user IS NULL THEN
    RETURN;
  END IF;
  -- Q137: a seed (test) counterpart never notifies a real member.
  IF p_other IS NOT NULL
     AND COALESCE((SELECT o.is_seed FROM public.profiles o WHERE o.user_id = p_other), false)
     AND NOT COALESCE((SELECT r.is_seed FROM public.profiles r WHERE r.user_id = p_user), false) THEN
    RETURN;
  END IF;
  INSERT INTO public.notifications (user_id, type, title, message, link)
  VALUES (p_user, public.declutter_notice_type(p_type, p_title, p_link), p_title, p_message, p_link);
END;
$fn$;
REVOKE ALL ON FUNCTION public.declutter_notify_strict(uuid, text, text, text, text, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.declutter_notify_strict(uuid, text, text, text, text, uuid) TO service_role;

-- Every other caller: the notice never takes its event down with it.
CREATE OR REPLACE FUNCTION public.declutter_notify(p_user uuid, p_type text, p_title text, p_message text, p_link text,
  p_other uuid DEFAULT NULL)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
BEGIN
  BEGIN
    PERFORM public.declutter_notify_strict(p_user, p_type, p_title, p_message, p_link, p_other);
  EXCEPTION WHEN OTHERS THEN
    -- The sale, offer or refund this notice reports has already happened in
    -- this transaction; it must not roll back because the bell row could not
    -- be written. Logged where ops reads (error_logs via log_cron_defect).
    RAISE WARNING 'declutter_notify: notice to % not written (%): %', p_user, p_title, SQLERRM;
    -- The ref names the notice, not only the member: log_cron_defect keeps one
    -- row per (function, ref) an hour, and two different lost notices to one
    -- member must both be on record (lh-silent-failure review, finding 1).
    PERFORM public.log_cron_defect('declutter_notify',
      COALESCE(p_user::text, '-') || ':' || COALESCE(p_title, '') || ':' || COALESCE(p_link, ''), SQLERRM,
      jsonb_build_object('user_id', p_user, 'title', p_title, 'message', p_message, 'type', p_type, 'link', p_link));
  END;
END;
$fn$;
REVOKE ALL ON FUNCTION public.declutter_notify(uuid, text, text, text, text, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.declutter_notify(uuid, text, text, text, text, uuid) TO service_role;

-- ---------------------------------------------------------------------------
-- 5. Pickup reminders: their own kind, in the app and by email.
--    Body otherwise verbatim from 20261027205028.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.declutter_pickup_remind(p_user uuid, p_title text, p_message text, p_link text, p_other uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
BEGIN
  IF p_user IS NULL THEN
    RETURN;
  END IF;
  -- Strict: the reminder is this step; a failure rolls the booking's claim back
  -- in declutter_pickup_reminder_sweep and the next run retries it.
  PERFORM public.declutter_notify_strict(p_user, 'declutter_pickups', p_title, p_message, p_link, p_other);
  IF EXISTS (SELECT 1 FROM public.profiles o WHERE o.user_id = p_other AND o.is_seed)
     AND NOT EXISTS (SELECT 1 FROM public.profiles r WHERE r.user_id = p_user AND r.is_seed) THEN
    RETURN;
  END IF;
  BEGIN
    PERFORM net.http_post(
      url := (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'supabase_url' LIMIT 1) || '/functions/v1/send-notification-email',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'service_role_key' LIMIT 1)
      ),
      body := jsonb_build_object('user_id', p_user, 'title', p_title, 'message', p_message, 'type', 'declutter_pickups', 'link', p_link)
    );
  EXCEPTION WHEN OTHERS THEN
    -- The bell row above already landed; an email that could not be queued is
    -- recorded where the alerting reads (error_logs), not only the Postgres log.
    INSERT INTO public.error_logs (severity, message, tags, context)
    VALUES ('error', 'declutter pickup reminder email could not be queued',
            jsonb_build_object('source', 'declutter_pickup_remind'),
            jsonb_build_object('user_id', p_user::text, 'error', SQLERRM));
  END;
END;
$fn$;
REVOKE ALL ON FUNCTION public.declutter_pickup_remind(uuid, text, text, text, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.declutter_pickup_remind(uuid, text, text, text, uuid) TO service_role;

-- ---------------------------------------------------------------------------
-- 6. Price drops: v_notified is uuid (it was bigint: every alert rolled back),
--    and the kind is declutter_price_drops. Body otherwise verbatim from
--    20261027204745; the trigger itself is unchanged.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.declutter_price_drop_alert()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  w record;
  v_free boolean := NEW.current_price_cents = 0;
  v_title text;
  v_message text;
  v_link text := '/declutter/item/' || NEW.id::text;
  v_notified uuid;
BEGIN
  -- A seller out of Declutter keeps 'live' rows hidden (seller_hidden): their watchers cannot open them (review #3).
  IF NEW.status <> 'live' OR NEW.seller_hidden OR NEW.current_price_cents >= OLD.current_price_cents THEN
    RETURN NEW;
  END IF;
  v_title := CASE WHEN v_free THEN 'Now free' ELSE 'Price dropped' END;
  v_message := CASE WHEN v_free THEN format('"%s" is now free.', NEW.title)
                    ELSE format('"%s" dropped to $%s.', NEW.title, to_char(NEW.current_price_cents / 100.0, 'FM999990.00')) END;
  FOR w IN
    SELECT wl.user_id
      FROM public.declutter_watchlist wl
      LEFT JOIN public.profiles wp ON wp.user_id = wl.user_id
     WHERE wl.item_id = NEW.id
       AND wl.user_id IS DISTINCT FROM NEW.seller_id
       -- Q137: a seed (test) listing never alerts a real watcher.
       AND (NOT NEW.is_seed OR COALESCE(wp.is_seed, false))
       AND NOT public.are_users_blocked(wl.user_id, NEW.seller_id)
       -- One per item per watcher every 3 days ("now free" always goes: it is the last drop).
       AND (v_free OR NOT EXISTS (SELECT 1 FROM public.declutter_price_alerts a
                                   WHERE a.item_id = NEW.id AND a.user_id = wl.user_id AND a.sent_at > now() - interval '3 days'))
       -- At most 5 price notices per watcher a day, across items.
       AND (SELECT count(*) FROM public.declutter_price_alerts a
             WHERE a.user_id = wl.user_id AND a.sent_at > now() - interval '1 day') < 5
  LOOP
    BEGIN
      v_notified := NULL;
      INSERT INTO public.notifications (user_id, type, title, message, link)
      VALUES (w.user_id, 'declutter_price_drops', v_title, v_message, v_link)
      RETURNING id INTO v_notified;
      -- The seed boundary trigger can suppress the bell: then nothing was told, nothing is counted, no email (review #4).
      IF v_notified IS NOT NULL THEN
        INSERT INTO public.declutter_price_alerts (item_id, user_id, price_cents) VALUES (NEW.id, w.user_id, NEW.current_price_cents);
        -- The email in its own block: a failed email never takes the bell and the ledger with it (review #1).
        BEGIN
          IF to_regnamespace('net') IS NOT NULL THEN
            PERFORM net.http_post(
              url := (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'supabase_url' LIMIT 1) || '/functions/v1/send-notification-email',
              headers := jsonb_build_object(
                'Content-Type', 'application/json',
                'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'service_role_key' LIMIT 1)),
              body := jsonb_build_object('user_id', w.user_id, 'title', v_title, 'message', v_message, 'type', 'declutter_price_drops', 'link', v_link));
          END IF;
        EXCEPTION WHEN OTHERS THEN
          RAISE WARNING 'declutter_price_drop_alert: item % watcher % email not queued: %', NEW.id, w.user_id, SQLERRM;
          PERFORM public.log_cron_defect('declutter_price_drop_alert', NEW.id::text, SQLERRM,
            jsonb_build_object('watcher', w.user_id, 'step', 'email'));
        END;
      END IF;
    EXCEPTION WHEN OTHERS THEN
      -- A price change never fails because a watcher could not be told; the defect is logged where ops sees it (review #2).
      RAISE WARNING 'declutter_price_drop_alert: item % watcher % not told: %', NEW.id, w.user_id, SQLERRM;
      PERFORM public.log_cron_defect('declutter_price_drop_alert', NEW.id::text, SQLERRM,
        jsonb_build_object('watcher', w.user_id, 'step', 'notice'));
    END;
  END LOOP;
  RETURN NEW;
END;
$fn$;
REVOKE ALL ON FUNCTION public.declutter_price_drop_alert() FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 7. Wanted matches: their own kind and their own mute.
--    Bodies otherwise verbatim from 20261016053541.
-- ---------------------------------------------------------------------------
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
    WHEN NOT COALESCE((SELECT np.declutter_wanted FROM public.notification_preferences np WHERE np.user_id = p_user), true) THEN 'muted'
  END;
$fn$;
REVOKE ALL ON FUNCTION public.declutter_wanted_alert_block(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.declutter_wanted_alert_block(uuid) TO service_role;

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
  VALUES (p_user, 'declutter_wanted', p_title, p_message, p_link)
  RETURNING id INTO v_id;
  RETURN CASE WHEN v_id IS NULL THEN 0 ELSE 1 END;
END;
$fn$;
REVOKE ALL ON FUNCTION public.declutter_wanted_notify(uuid, text, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.declutter_wanted_notify(uuid, text, text, text) TO service_role;

-- ---------------------------------------------------------------------------
-- 8. "Listing sent for review" / "Your listing is live" when a draft is
--    submitted. A trigger, so declutter_publish_item (the sell flow's) is not
--    restated. One per seller per 10 minutes: a moving-out sale submits many
--    drafts at once and the seller needs one notice, not thirty.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.declutter_listing_submitted_notice()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_title text;
  v_name text := COALESCE(NULLIF(btrim(NEW.title), ''), 'Your item');
BEGIN
  IF NEW.status NOT IN ('pending_review', 'live')
     OR (TG_OP = 'UPDATE' AND OLD.status IS DISTINCT FROM 'draft') THEN
    RETURN NULL;
  END IF;
  BEGIN
    v_title := CASE WHEN NEW.status = 'live' THEN 'Your listing is live' ELSE 'Listing sent for review' END;
    IF EXISTS (SELECT 1 FROM public.notifications n
                WHERE n.user_id = NEW.seller_id
                  AND n.type = 'declutter_listings'
                  AND n.title = v_title
                  -- Only this trigger's own notices (the approval RPC's "live"
                  -- notice links to the Selling tab, not an item).
                  AND (n.link = '/declutter?tab=selling' OR n.link LIKE '/declutter/item/%')
                  AND n.created_at > now() - interval '10 minutes') THEN
      RETURN NULL;
    END IF;
    IF NEW.status = 'live' THEN
      PERFORM public.declutter_notify(NEW.seller_id, 'declutter_listings', v_title,
        '"' || v_name || '" is live. Buyers can see it now.',
        '/declutter/item/' || NEW.id::text);
    ELSE
      PERFORM public.declutter_notify(NEW.seller_id, 'declutter_listings', v_title,
        'We''re checking "' || v_name || '" before buyers see it. We''ll tell you when it''s live.',
        '/declutter?tab=selling');
    END IF;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'declutter_listing_submitted_notice: item %: %', NEW.id, SQLERRM;
    PERFORM public.log_cron_defect('declutter_listing_submitted_notice', NEW.id::text, SQLERRM);
  END;
  RETURN NULL;
END;
$fn$;
REVOKE ALL ON FUNCTION public.declutter_listing_submitted_notice() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_declutter_items_submitted_notice ON public.declutter_items;
CREATE TRIGGER trg_declutter_items_submitted_notice
  AFTER INSERT OR UPDATE OF status ON public.declutter_items
  FOR EACH ROW EXECUTE FUNCTION public.declutter_listing_submitted_notice();

-- ---------------------------------------------------------------------------
-- 9. Questions on an item: the seller hears of a new one, the asker of the
--    answer. The text was already checked for contact details on the way in
--    (trg_reject_contact_leak_in_declutter_question); it is cut to 120 chars.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.declutter_question_notice()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_item record;
  v_text text;
BEGIN
  IF NEW.removed_at IS NOT NULL THEN
    RETURN NULL;
  END IF;
  BEGIN
    SELECT i.id, i.seller_id, COALESCE(NULLIF(btrim(i.title), ''), 'your item') AS title
      INTO v_item FROM public.declutter_items i WHERE i.id = NEW.item_id;
    IF NOT FOUND THEN
      RETURN NULL;
    END IF;
    -- A block between the two since the question was asked: nobody is told
    -- (lh-authz-rls review 2026-10-28, finding 1).
    IF public.are_users_blocked(NEW.asker_id, v_item.seller_id) THEN
      RETURN NULL;
    END IF;
    IF TG_OP = 'INSERT' THEN
      v_text := btrim(NEW.question);
      PERFORM public.declutter_notify(v_item.seller_id, 'declutter_offers', 'New question',
        'Someone asked about "' || v_item.title || '": "'
          || CASE WHEN char_length(v_text) > 120 THEN left(v_text, 117) || '...' ELSE v_text END || '"',
        '/declutter/item/' || v_item.id::text, NEW.asker_id);
    ELSIF OLD.answered_at IS NULL AND NEW.answered_at IS NOT NULL THEN
      v_text := btrim(COALESCE(NEW.answer, ''));
      PERFORM public.declutter_notify(NEW.asker_id, 'declutter_offers', 'The seller answered',
        'About "' || v_item.title || '": "'
          || CASE WHEN char_length(v_text) > 120 THEN left(v_text, 117) || '...' ELSE v_text END || '"',
        '/declutter/item/' || v_item.id::text, v_item.seller_id);
    END IF;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'declutter_question_notice: question %: %', NEW.id, SQLERRM;
    PERFORM public.log_cron_defect('declutter_question_notice', NEW.id::text, SQLERRM);
  END;
  RETURN NULL;
END;
$fn$;
REVOKE ALL ON FUNCTION public.declutter_question_notice() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_declutter_questions_notice ON public.declutter_questions;
CREATE TRIGGER trg_declutter_questions_notice
  AFTER INSERT OR UPDATE OF answered_at ON public.declutter_questions
  FOR EACH ROW EXECUTE FUNCTION public.declutter_question_notice();
