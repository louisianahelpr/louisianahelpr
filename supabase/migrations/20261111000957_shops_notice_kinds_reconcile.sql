-- Reconcile declutter_notice_type: main's F503/F508 titles plus the Shops kinds (lead train 11-10).
--
-- Problem: 20261108201153_shops_notice_kinds.sql (this train) restates public.declutter_notice_type(text,text,text) to add
-- the shops_orders / shops_messages / shops_updates kinds and the /shops link map. While that train waited, origin/main
-- landed 20261110202142 (F503: decision notice titles by outcome) and 20261110205345 (F508: titles that fit a lock
-- screen), each restating the same function from the 11-04 body WITHOUT the Shops lines. db-deploy runs
-- `supabase db push --include-all`, so prod would apply the OLDER 20261108201153 after the newer two and lose F503/F508's
-- titles (e.g. 'Reserved: check out within 30 minutes' from an 'info' caller would fall to declutter_listings, the wrong
-- switch). A fresh replay (version order) would instead end with 20261110205345 and lose the Shops kinds (a shop's
-- "New order" back on the Jobs switch).
--
-- Fix: this file carries the newest stamp and restates the UNION, VERBATIM from 20261110205345's body (which already
-- contains F503's titles) plus the Shops block from 20261108201153. Both orders now end here.
-- MONEY: none. AUTHZ: none new (service_role only, as before).
-- REPLAY-SAFE: CREATE OR REPLACE; REVOKE/GRANT are idempotent.

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
    -- Shops audit 11-08 #6 (20261108201153): Shops has its own kinds. A caller's own Shops kind is kept; every other
    -- notice that opens a Shops screen is filed by its link: a shop chat (?talk=) is a message, the shop's own settings
    -- page and strikes are updates, and everything else (orders, money, handovers, custom requests, refunds) is an order.
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
                     -- F508 (20261110205345): the same notices with titles that fit a lock screen
                     'It''s yours: pick a pickup time', 'Reserved for you: check out in 24 hours',
                     'Reserved: check out within 30 minutes', 'Bundle accepted: waiting on payment',
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
                     -- F503 (20261110202142): the decision notices' titles by outcome
                     'Sale is final', 'The free handover stands', 'Free pickup cancelled by our team',
                     'Part refund on your Declutter order', 'Refund on your Declutter order',
                     'We reviewed your delivery problem', 'Sale cancelled after delivery problem',
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
