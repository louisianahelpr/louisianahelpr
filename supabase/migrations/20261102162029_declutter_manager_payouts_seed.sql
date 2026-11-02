-- A test sale's manager payout is test data from birth (Builder 4, 2026-11-02, batch fix for PR #4014; Q46 class).
--
-- WHY: declutter_manager_payouts (20261101230509) has is_seed but nothing sets it: declutter_complete_handover inserts
-- the row without it, so a seed order's manager share was born is_seed = false and would count as real money in the
-- admin held-payout list (20261101234732 reads p.is_seed) and every is_seed-filtered figure. fixtureWritersSetIsSeed
-- caught the table missing from the scanner.
-- WHAT: the same BEFORE INSERT trigger every other order-keyed Declutter table uses (declutter_order_rows_seed,
-- 20261015042253: is_seed := the order's is_seed), plus a one-time backfill of rows already written from a seed order.
-- Replay-safe: guarded on the table and the function, DROP TRIGGER IF EXISTS, the backfill only touches mismatches.
DO $do$
BEGIN
  IF to_regclass('public.declutter_manager_payouts') IS NOT NULL
     AND to_regprocedure('public.declutter_order_rows_seed()') IS NOT NULL THEN
    DROP TRIGGER IF EXISTS trg_declutter_manager_payouts_seed ON public.declutter_manager_payouts;
    CREATE TRIGGER trg_declutter_manager_payouts_seed BEFORE INSERT ON public.declutter_manager_payouts
      FOR EACH ROW EXECUTE FUNCTION public.declutter_order_rows_seed();
    UPDATE public.declutter_manager_payouts p
       SET is_seed = COALESCE(o.is_seed, false)
      FROM public.declutter_orders o
     WHERE o.id = p.order_id AND p.is_seed IS DISTINCT FROM COALESCE(o.is_seed, false);
  END IF;
END
$do$;
