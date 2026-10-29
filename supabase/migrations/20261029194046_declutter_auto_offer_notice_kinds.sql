-- Smart offers (20261029162620, owner 2026-10-29) notify the seller with two new
-- titles, 'Offer accepted automatically' and 'Offer answered automatically'. They
-- land under declutter_offers by an explicit title, not only by the new_offers
-- fallback (src/test/declutterNoticeKinds.test.ts). declutter_notice_type is
-- restated verbatim from 20261028171944 with the two titles added; same grants.

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
                     'Now free', 'New question', 'The seller answered', 'Item came down',
                     -- Smart offers (20261029162620): an offer the seller's rules answered.
                     'Offer accepted automatically', 'Offer answered automatically')
      THEN 'declutter_offers'
    WHEN p_title IN ('It''s yours', 'Reserved for you: check out within 48 hours',
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
