-- A banned account cannot write gift_planner_plans (scripts/check-ban-gate-coverage.mjs, table:ungated).
--
-- 20261120062334 (#4791) made the table with own-row policies and no ban gate; DB Deploy 44779229734's live check
-- "Verify a banned account is refused on every client write path" failed on INSERT, UPDATE and DELETE. The gate is the
-- usual one, per command, as 20261030224733 (declutter_seller_defaults) carries it. The own-row policies do not change.
--
-- enforce_ban_gate refuses only when auth.uid() is set, so server deletes pass (account deletion cascades, service-role
-- cleanup).

DO $gates$
BEGIN
  IF to_regprocedure('public.enforce_ban_gate()') IS NOT NULL THEN
    DROP TRIGGER IF EXISTS trg_ban_gate_gift_planner_plans_insert ON public.gift_planner_plans;
    CREATE TRIGGER trg_ban_gate_gift_planner_plans_insert BEFORE INSERT ON public.gift_planner_plans
      FOR EACH ROW EXECUTE FUNCTION public.enforce_ban_gate();
    DROP TRIGGER IF EXISTS trg_ban_gate_gift_planner_plans_update ON public.gift_planner_plans;
    CREATE TRIGGER trg_ban_gate_gift_planner_plans_update BEFORE UPDATE ON public.gift_planner_plans
      FOR EACH ROW EXECUTE FUNCTION public.enforce_ban_gate();
    DROP TRIGGER IF EXISTS trg_ban_gate_gift_planner_plans_delete ON public.gift_planner_plans;
    CREATE TRIGGER trg_ban_gate_gift_planner_plans_delete BEFORE DELETE ON public.gift_planner_plans
      FOR EACH ROW EXECUTE FUNCTION public.enforce_ban_gate();
  END IF;
END
$gates$;
