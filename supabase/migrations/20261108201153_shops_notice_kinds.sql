-- Shops audit 11-08 #6 (~/.lh-shots/handoffs-1108/shops-audit.md), Builder 5: Shops notices get their own switches.
--
-- Before: every Shops notice rode a JOBS switch. declutter_notify kept the caller's generic type for any link outside
-- /declutter, so the seller's "New order" was type new_offers (the "Job offers" switch), money notices payment ("Job
-- payments"), cancels warning ("System alerts") and shop chat info ("Work status"). A shop owner who is not a Helpr turns
-- "Job offers" off, gets no push for a new order, and the order drops after 24 hours.
--
-- Now: three kinds, each with a push column and its email twin, all ON by default (owner via the lead, 11-08: orders,
-- messages, updates, default ON; Shops had 0 shops on prod 11-08, so no member's choice is carried over):
--   shops_orders    new orders, accepts, ready, handovers, money, refunds, cancels, custom requests and prices
--   shops_messages  a shop chat message (links with ?talk=)
--   shops_updates   the shop's own settings notices (/shops/mine) and Shops strikes
-- declutter_notify routes them in its one place, declutter_notice_type (restated VERBATIM from its newest CREATE,
-- 20261104123305_bundle_request_export_and_notice_kinds.sql, plus the four lines marked "audit 11-08 #6"), so no
-- Shops function is restated. Text messages: unchanged (sms_kind_for reads job_id and titles, not these types).
--
-- notifications_type_check: prod's list read 2026-11-08 (pg_get_constraintdef, read-only), which equals the newest
--   migration's (20261030170443), plus the three new types.
-- MONEY: none. AUTHZ: none new (declutter_notice_type stays service_role only).
-- REPLAY-SAFE: ADD COLUMN only when missing; DROP/ADD of the CHECK; ON CONFLICT; CREATE OR REPLACE.
-- Proof: src/test/pglite/shopsNoticeKinds.pglite.mjs (applied 3x; NEW_MIGRATION=skip is red).

-- 1. The switches.
DO $mig$
DECLARE
  v_col text;
BEGIN
  FOREACH v_col IN ARRAY ARRAY['shops_orders', 'shops_messages', 'shops_updates']
  LOOP
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                    WHERE table_schema = 'public' AND table_name = 'notification_preferences' AND column_name = v_col) THEN
      EXECUTE format('ALTER TABLE public.notification_preferences ADD COLUMN %I boolean NOT NULL DEFAULT true', v_col);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                    WHERE table_schema = 'public' AND table_name = 'notification_preferences' AND column_name = 'email_' || v_col) THEN
      EXECUTE format('ALTER TABLE public.notification_preferences ADD COLUMN %I boolean NOT NULL DEFAULT true', 'email_' || v_col);
    END IF;
  END LOOP;
END
$mig$;

-- 2. The types and their push columns.
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
    -- Shops, one per switch in the Shops group
    'shops_orders', 'shops_messages', 'shops_updates'
  ));

INSERT INTO public.notification_type_pref_map (type, pref_column, description) VALUES
  ('shops_orders',   'shops_orders',   'Shops: new orders, accepts, ready and handovers, payments, refunds, cancels and custom orders.'),
  ('shops_messages', 'shops_messages', 'Shops: a new message in a shop chat.'),
  ('shops_updates',  'shops_updates',  'Shops: your shop''s settings and Shops strikes.')
ON CONFLICT (type) DO UPDATE
  SET pref_column = EXCLUDED.pref_column,
      description = EXCLUDED.description;

-- 3. Which kind a notice is (one place). Restated verbatim from 20261104123305 plus the Shops branch.
CREATE OR REPLACE FUNCTION public.declutter_notice_type(p_type text, p_title text, p_link text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path TO 'public', 'pg_temp'
AS $fn$
  SELECT CASE
    -- The caller already chose a Declutter kind.
    WHEN p_type IN ('declutter_listings', 'declutter_offers', 'declutter_sales', 'declutter_pickups',
                    'declutter_refunds', 'declutter_price_drops', 'declutter_wanted', 'declutter_questions') THEN p_type
    -- audit 11-08 #6: Shops has its own kinds. A caller's own Shops kind is kept; every other notice that opens a
    -- Shops screen is filed by its link: a shop chat (?talk=) is a message, the shop's own settings page and strikes
    -- are updates, and everything else (orders, money, handovers, custom requests, refunds) is an order.
    WHEN p_type IN ('shops_orders', 'shops_messages', 'shops_updates') THEN p_type
    WHEN p_link LIKE '/shops%' THEN
      CASE WHEN p_link LIKE '%?talk=%' OR p_link LIKE '%&talk=%' THEN 'shops_messages'
           WHEN p_link LIKE '/shops/mine%' OR p_title IN ('Shops strike') THEN 'shops_updates'
           ELSE 'shops_orders' END
    -- Not a Declutter screen: setup jobs, admin alerts, earnings.
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
                     'Now free', 'Item came down',
                     -- Smart offers (20261029162620): an offer the seller's rules answered.
                     'Offer accepted automatically', 'Offer answered automatically',
                     -- Bundle requests (20261104103528): an ask and its answers are offers.
                     'Bundle request', 'Bundle request declined', 'Bundle request closed', 'Bundle request expired')
      THEN 'declutter_offers'
    WHEN p_title IN ('It''s yours', 'Reserved for you: check out within 48 hours',
                     'It''s yours: pick a pickup within 48 hours', 'Free item claimed',
                     'Someone claimed your free item', 'Sold: waiting for the buyer to pay',
                     'Check out within 24 hours', '2 hours left to check out', 'Checkout closed',
                     'Buyer did not check out', 'The seller cancelled', 'This sale was cancelled',
                     'Sale cancelled', 'Free pickup cancelled', 'Payment received', 'Buyer paid',
                     'Card saved', 'Handover done', 'Enjoy your item', 'Amount owed', 'Amount owed added',
                     'An amount owed comes out of your next payout', 'Setup fee coming back',
                     'Delivery pay raised', 'Your raise is coming back',
                     -- Shipping S6 (20261102030530, 20261102055653)
                     'Order cancelled: no charge', 'Shipping label added to what you owe', 'Don''t ship it',
                     -- Bundle requests (20261104103528): an accepted bundle waits to be paid, like 'Check out within 24 hours'.
                     'Bundle accepted: pay within 24 hours', 'Save a card to get your bundle')
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
                     'Your strike was removed',
                     -- Shipping S6 (20261102051521)
                     'Shipping refund on its way')
      THEN 'declutter_refunds'
    WHEN p_title IN ('A seller has a match')
      THEN 'declutter_wanted'
    WHEN p_title IN ('New question', 'The seller answered')
      THEN 'declutter_questions'
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
