-- S2-020 (Shops audit 2, 11-12): a custom request reopens when the order it became closes without a charge.
--
-- WHY
--   A request reads "Ordered" (status 'accepted', order_id set) as soon as the buyer's card is held
--   (shop_orders_custom_request_accepted, 20261106205852). If the shop then declines, lets its 24 hours to accept run
--   out, or the buyer cancels before the shop accepts, the order closes and the card hold is released (nothing was
--   charged), but the request still said "Ordered" and its price could never be ordered again.
--
-- WHAT
--   shop_orders_custom_request_reopen(): AFTER UPDATE OF status on shop_orders. When an order goes from 'held' (card
--   held, not charged) to 'declined', 'expired' or 'cancelled', every request that became it goes back to:
--     - 'quoted' (order_id cleared, closed_at cleared) while its price is still good (expires_at in the future), so
--       the buyer can order it again or withdraw it; or
--     - 'expired' (closed_at = expires_at, as the request sweep stores it) once the 7 days have passed.
--   Only orders that left 'held': a charged order (accepted, handed over, refunded later) never reopens its request.
--   No notice: the order's own decline / expiry / cancel notice already told the buyer; the request card now says
--   "The shop sent a price" again.
--
-- Money: none moves here. The order's own close path releases the hold, as before. Replay-safe: CREATE OR REPLACE,
-- DROP TRIGGER IF EXISTS.

CREATE OR REPLACE FUNCTION public.shop_orders_custom_request_reopen()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $fn$
BEGIN
  IF OLD.status = 'held' AND NEW.status IN ('declined', 'expired', 'cancelled') THEN
    UPDATE public.shop_custom_requests cr
       SET status = CASE WHEN cr.expires_at > now() THEN 'quoted' ELSE 'expired' END,
           order_id = NULL,
           closed_at = CASE WHEN cr.expires_at > now() THEN NULL ELSE cr.expires_at END,
           updated_at = now()
     WHERE cr.order_id = NEW.id
       AND cr.status = 'accepted';
  END IF;
  RETURN NEW;
END;
$fn$;
REVOKE ALL ON FUNCTION public.shop_orders_custom_request_reopen() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_shop_orders_custom_request_reopen ON public.shop_orders;
CREATE TRIGGER trg_shop_orders_custom_request_reopen AFTER UPDATE OF status ON public.shop_orders
  FOR EACH ROW EXECUTE FUNCTION public.shop_orders_custom_request_reopen();
