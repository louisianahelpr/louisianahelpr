-- The manager-share trigger fires after the order's notice trigger (train guard declutterNoticesNameTheItem).
--
-- Postgres fires same-timing row triggers on a table in name order. trg_declutter_orders_a_notice_about
-- (20261028191646) records the order for Declutter notices and must run before any other AFTER trigger on
-- public.declutter_orders, so a notice those triggers write names its item. trg_declutter_lock_manager_share
-- (20261101230509) sorted before it ("l" < "o"). Renamed only: same table, same function, same timing and events
-- (AFTER UPDATE OF status, FOR EACH ROW); no logic change. Neither trigger reads what the other does: both are
-- AFTER triggers (RETURN NULL, NEW is not changed), the share trigger only inserts into
-- declutter_order_manager_shares (no trigger there), and the notice trigger only sets a transaction-local setting.
-- Replay-safe: renames only while the old name exists and the new one does not.
DO $do$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = 'public.declutter_orders'::regclass
                AND tgname = 'trg_declutter_lock_manager_share' AND NOT tgisinternal)
     AND NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = 'public.declutter_orders'::regclass
                AND tgname = 'trg_declutter_orders_manager_share' AND NOT tgisinternal) THEN
    ALTER TRIGGER trg_declutter_lock_manager_share ON public.declutter_orders RENAME TO trg_declutter_orders_manager_share;
  END IF;
END
$do$;
