-- Shops audit 11-08 #3 (~/.lh-shots/handoffs-1108/shops-audit.md), Builder 5: services and at-home work never go
-- through the goods porch handover.
--
-- Before: an order froze its shop's handover_mode at insert, whatever it sold. A porch-mode shop's haircut, lesson or
-- carpet cleaning at the buyer's place was told "Take photo and mark ready", and shop_refund_sweep refunded the buyer in
-- full, took the card fee from the shop and gave the strike no_ready_photo when no ready photo came 3 days after the
-- ready date, even though the work was done.
--
-- Now: an order with a service line, a rental line or an at-home line is always 'in_person'. Its completion step is the
-- in-person one that already exists: the shop taps "Mark done" (shops_mark_handed_over -> shop_confirmed_at) from the
-- ready date, the buyer taps "It's done" or reports a problem, and the handover sweep confirms 48 hours after the shop's
-- tap. The porch photo rule (and its refund and strike) stays for goods only, because every porch branch of
-- shop_refund_sweep / shop_handover_sweep reads o.handover_mode = 'porch'. No sweep is restated here.
--
-- How: the lines are written after the order row, so the order cannot know its lines at insert. A new AFTER INSERT
-- trigger on shop_order_lines moves a still-unpaid ('awaiting_hold') porch order to 'in_person' when the new line is a
-- service, a rental or at-home work; shop_orders_handover_mode_frozen allows exactly that one move and still refuses
-- every other change.
--
-- Restated from its NEWEST CREATE: shop_orders_handover_mode_frozen (20261018211820_shops_handover_payout.sql); only the
-- lines marked "audit 11-08" change. Not restated on origin/ready/b5-preorders or origin/ready/b4-digital (checked 11-08).
-- MONEY: yes (which orders can be refunded with a strike by the porch rule; lh-money-escrow). AUTHZ: trigger functions
--   only, EXECUTE revoked from PUBLIC, anon, authenticated.
-- REPLAY-SAFE: CREATE OR REPLACE, DROP TRIGGER IF EXISTS before CREATE TRIGGER; the backfill only touches unpaid porch
--   orders that hold such a line (none after the first run).
-- Proof: src/test/pglite/shopsServicesInPerson.pglite.mjs (applied 3x; NEW_MIGRATION=skip is red).

CREATE OR REPLACE FUNCTION public.shop_orders_handover_mode_frozen()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $fn$
BEGIN
  IF TG_OP = 'INSERT' THEN
    NEW.handover_mode := COALESCE((SELECT s.handover_mode FROM public.shops s WHERE s.id = NEW.shop_id), 'in_person');
  ELSIF NEW.handover_mode IS DISTINCT FROM OLD.handover_mode
    -- audit 11-08 #3: the one allowed move, porch -> in person, on an unpaid order that holds a service, rental or
    -- at-home line (written by shop_order_lines_service_in_person).
    AND NOT (OLD.handover_mode = 'porch' AND NEW.handover_mode = 'in_person' AND OLD.status = 'awaiting_hold'
             AND EXISTS (SELECT 1 FROM public.shop_order_lines l
                          WHERE l.order_id = OLD.id AND (l.kind IN ('service', 'rental') OR l.at_buyer))) THEN
    RAISE EXCEPTION 'handover_mode_frozen' USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$fn$;
REVOKE ALL ON FUNCTION public.shop_orders_handover_mode_frozen() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.shop_order_lines_service_in_person()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
BEGIN
  IF NEW.kind IN ('service', 'rental') OR NEW.at_buyer THEN
    UPDATE public.shop_orders SET handover_mode = 'in_person'
     WHERE id = NEW.order_id AND handover_mode = 'porch' AND status = 'awaiting_hold';
  END IF;
  RETURN NULL;
END;
$fn$;
REVOKE ALL ON FUNCTION public.shop_order_lines_service_in_person() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS shop_order_lines_service_in_person ON public.shop_order_lines;
CREATE TRIGGER shop_order_lines_service_in_person AFTER INSERT ON public.shop_order_lines
  FOR EACH ROW EXECUTE FUNCTION public.shop_order_lines_service_in_person();

-- Unpaid orders already written that way (prod held 0 shop orders on 11-08).
UPDATE public.shop_orders o SET handover_mode = 'in_person'
 WHERE o.handover_mode = 'porch' AND o.status = 'awaiting_hold'
   AND EXISTS (SELECT 1 FROM public.shop_order_lines l
                WHERE l.order_id = o.id AND (l.kind IN ('service', 'rental') OR l.at_buyer));
