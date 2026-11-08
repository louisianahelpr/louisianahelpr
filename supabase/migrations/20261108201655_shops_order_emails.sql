-- Shops audit 11-08 #7 (~/.lh-shots/handoffs-1108/shops-audit.md), Builder 5: Shops sends email for its key events.
--
-- Before: no Shops function and no Shops edge function sent email. A new order has a hard 24-hour answer deadline, and
-- payment and refund receipts matter to both sides.
--
-- Now: one AFTER INSERT trigger on notifications emails exactly these Shops notices (the in-app row is written first,
-- by declutter_notify, so the email follows every rule the bell row does: the seed/test counterpart refusal in
-- declutter_notify_strict and the notifications BEFORE INSERT seed boundary):
--   to the shop:   "New order"  (shop_mark_order_held, link /shops/dashboard)
--                  "Payment sent" (NEW here: a shop payout that succeeded; shop_payout_executed sent no notice)
--   to the buyer:  "Order accepted" (shop_order_captured), "Your order is ready" (shops_mark_ready),
--                  "Order refunded" (shop_refund_sweep, shops_admin_refund_order), "Order cancelled by the shop"
--                  (shops_shop_cancel_order), each with link /shops/orders.
-- The mail goes through send_notice_email -> send-notification-email, which reads the member's "Orders" email switch
-- (email_shops_orders, 20261108201153), the email master switch, the suppression list, and refuses a test or seed
-- recipient (Q840). The notices are filed shops_orders by declutter_notice_type (20261108201153), so the trigger keys
-- on that type plus the title and the recipient's link; nothing else in the app writes those three together.
--
-- The payout notice is a trigger on shop_payouts (status -> 'succeeded'), so shop_payout_executed (and the
-- preorders/digital branches) are not restated. Its amount is amount_cents, which already has the card-fee debt and
-- the one-time setup fee taken out (20261105181603).
-- MONEY: no money moves (notices only). AUTHZ: trigger functions only, EXECUTE revoked from PUBLIC, anon, authenticated.
-- REPLAY-SAFE: CREATE OR REPLACE, DROP TRIGGER IF EXISTS before each CREATE TRIGGER.
-- Proof: src/test/pglite/shopsOrderEmails.pglite.mjs (applied 3x; NEW_MIGRATION=skip is red).

-- 1. "Payment sent" when a shop payout lands.
CREATE OR REPLACE FUNCTION public.shop_payout_sent_notice()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_seller uuid;
BEGIN
  SELECT o.seller_id INTO v_seller FROM public.shop_orders o WHERE o.id = NEW.order_id;
  IF v_seller IS NULL THEN
    RETURN NULL;
  END IF;
  PERFORM public.declutter_notify(v_seller, 'shops_orders', 'Payment sent',
    format('$%s for your Shops order is on its way to your bank. Most banks show it in 2 to 5 business days.',
           to_char(NEW.amount_cents / 100.0, 'FM999990.00')),
    '/shops/dashboard', NULL);
  RETURN NULL;
END;
$fn$;
REVOKE ALL ON FUNCTION public.shop_payout_sent_notice() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS trg_shop_payout_sent_notice ON public.shop_payouts;
CREATE TRIGGER trg_shop_payout_sent_notice
  AFTER UPDATE OF status ON public.shop_payouts
  FOR EACH ROW
  WHEN (NEW.status = 'succeeded' AND OLD.status IS DISTINCT FROM 'succeeded')
  EXECUTE FUNCTION public.shop_payout_sent_notice();

-- 2. The emails.
CREATE OR REPLACE FUNCTION public.email_shop_order_notice()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
BEGIN
  PERFORM public.send_notice_email(NEW.user_id, NEW.title, NEW.message, NEW.type, NEW.link, NULL);
  RETURN NULL;
END;
$fn$;
REVOKE ALL ON FUNCTION public.email_shop_order_notice() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS trg_email_shop_order_notice ON public.notifications;
CREATE TRIGGER trg_email_shop_order_notice
  AFTER INSERT ON public.notifications
  FOR EACH ROW
  WHEN (NEW.type = 'shops_orders' AND (
        (NEW.title IN ('New order', 'Payment sent') AND NEW.link LIKE '/shops/dashboard%')
     OR (NEW.title IN ('Order accepted', 'Your order is ready', 'Order refunded', 'Order cancelled by the shop')
         AND NEW.link LIKE '/shops/orders%')))
  EXECUTE FUNCTION public.email_shop_order_notice();
