-- B110 leftover 1 (lead 11-01): the porch WINDOW the buyer chose at checkout ("Sun 11/2, 3-5 PM") showed only in the
-- seller's "Buyer paid" notice; the order card read the 30-minute booking that declutter_mark_order_paid makes from
-- its start. The window is frozen on declutter_orders.pickup_slot_start / pickup_slot_end (20261101191500), whose
-- columns members could not read (the table grants members a column list, 20261014210518). The two sides of an order
-- may now read those two columns, under the existing "the two sides read" row policy. Nothing else changes.
DO $do$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'declutter_orders'
               AND column_name = 'pickup_slot_end') THEN
    GRANT SELECT (pickup_slot_start, pickup_slot_end) ON TABLE public.declutter_orders TO authenticated;
  END IF;
END
$do$;
