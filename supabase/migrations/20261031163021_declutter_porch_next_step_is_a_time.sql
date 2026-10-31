-- Declutter: a paid porch order's next step names a TIME (LEAD-PLACE-TIMES, owner 2026-10-31; lead's decision 1:
-- the porch buyer picks the place, then a day, then a time inside that place's hours).
--
-- The app now books a new porch pickup through declutter_book_pickup (a time inside the order's frozen place hours,
-- 20261031145652) instead of declutter_book_porch_day. The paid notice's next step said "choose your pickup day";
-- it now falls to the pickup line every other pickup uses: "Next: choose your pickup time in Buying."
--
-- Layer changed: declutter_paid_next_step only, restated from its NEWEST CREATE
-- (20261028225038_declutter_porch_pick_a_day.sql; checked on origin/main 2026-10-31), with its porch line removed.
-- Nothing else changes: declutter_book_porch_day stays for app builds already installed and a day already booked.
-- MONEY: none. REPLAY-SAFE: CREATE OR REPLACE, grants restated.
CREATE OR REPLACE FUNCTION public.declutter_paid_next_step(p_order_id uuid)
RETURNS text
LANGUAGE sql
STABLE
SET search_path TO 'public', 'pg_temp'
AS $fn$
  SELECT CASE
    WHEN o.handover = 'delivery' THEN
      'Next: we''re finding a Helpr to bring it to your door. We''ll tell you when one takes it.'
    WHEN o.handover = 'seller_delivery' THEN
      CASE WHEN EXISTS (SELECT 1 FROM public.declutter_seller_deliveries d
                         WHERE d.order_id = o.id AND d.status = 'booked' AND d.slot_start IS NOT NULL)
           THEN 'Next: the seller delivers at the time you chose.'
           ELSE 'Next: pick a new delivery time in Buying.' END
    WHEN EXISTS (SELECT 1 FROM public.declutter_bookings b WHERE b.order_id = o.id AND b.slot_start IS NOT NULL) THEN
      'Next: pick up your items at the time you chose.'
    ELSE 'Next: choose your pickup time in Buying.'
  END
  FROM public.declutter_orders o
  WHERE o.id = p_order_id;
$fn$;
REVOKE ALL ON FUNCTION public.declutter_paid_next_step(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.declutter_paid_next_step(uuid) TO service_role;
