-- A banned account cannot write declutter_seller_defaults (scripts/check-ban-gate-coverage.mjs, table:ungated).
--
-- 20261030144112 made the table with own-row policies and no ban gate. The gate is the usual one, per command, as
-- job_access_notes carries it. The own-row policies do not change.
--
-- enforce_ban_gate refuses only when auth.uid() is set, so server deletes pass: account deletion through the auth admin
-- API cascades from auth.users with no caller, and service-role cleanup has none either.
-- Proof: src/test/pglite/sellerDefaultsBanGate.pglite.mjs.

DO $gates$
BEGIN
  IF to_regprocedure('public.enforce_ban_gate()') IS NOT NULL THEN
    DROP TRIGGER IF EXISTS trg_ban_gate_declutter_seller_defaults_insert ON public.declutter_seller_defaults;
    CREATE TRIGGER trg_ban_gate_declutter_seller_defaults_insert BEFORE INSERT ON public.declutter_seller_defaults
      FOR EACH ROW EXECUTE FUNCTION public.enforce_ban_gate();
    DROP TRIGGER IF EXISTS trg_ban_gate_declutter_seller_defaults_update ON public.declutter_seller_defaults;
    CREATE TRIGGER trg_ban_gate_declutter_seller_defaults_update BEFORE UPDATE ON public.declutter_seller_defaults
      FOR EACH ROW EXECUTE FUNCTION public.enforce_ban_gate();
    DROP TRIGGER IF EXISTS trg_ban_gate_declutter_seller_defaults_delete ON public.declutter_seller_defaults;
    CREATE TRIGGER trg_ban_gate_declutter_seller_defaults_delete BEFORE DELETE ON public.declutter_seller_defaults
      FOR EACH ROW EXECUTE FUNCTION public.enforce_ban_gate();
  END IF;
END
$gates$;
