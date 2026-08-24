-- Money tables an admin can write now leave a trail.
--
-- `jobs` has trg_audit_admin_job_status_change and `user_roles` has
-- audit_role_changes_trigger plus self-escalation guards. The tables where the
-- MONEY actually lives had nothing, while RLS explicitly grants admins write
-- access to them — the policies are even named for it ("Admins can write
-- transfers (manual reconciliation)", "Admins can update transfers", "Admins
-- can write refunds"). Verified on prod before writing this:
--
--   table               has_trigger   write_policies
--   payout_transfers    false         2
--   payment_refunds     false         1
--   platform_settings   false         2
--   user_bans           false         1
--
-- So an admin could create or alter a row in the payout ledger — the same
-- ledger the Payout Batches screen calls authoritative, and which Analytics now
-- reads its Helpr Payouts figure from — with no record that it happened.
-- platform_settings was logged ONLY when the change went through
-- AdminSettings.tsx's client-side logAdminAction(); any other path was silent,
-- and a client-side log is not an audit trail in any case.
--
-- A trigger cannot be bypassed by the path taken, which is the point: the log
-- is written by the database, on the write itself.
--
-- WHAT IS DELIBERATELY NOT DONE HERE: nothing is blocked. These writes are
-- legitimate (manual reconciliation is a real operation) — they simply have to
-- be attributable. Turning a silent capability into a recorded one is the whole
-- change.
--
-- `changed_by` is auth.uid(), which is NULL for service-role writes (the edge
-- functions that create transfers normally). That is correct and worth keeping:
-- a NULL actor distinguishes "the system did this" from "a person did this",
-- and only the second needs explaining.

CREATE OR REPLACE FUNCTION public.audit_money_table_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_target text;
BEGIN
  -- Prefer the row's own id; fall back to the job it belongs to so a deleted
  -- row is still traceable to something.
  v_target := COALESCE(
    (to_jsonb(COALESCE(NEW, OLD)) ->> 'id'),
    (to_jsonb(COALESCE(NEW, OLD)) ->> 'job_id'),
    'unknown'
  );

  INSERT INTO public.admin_audit_log (admin_id, action, target_type, target_id, details)
  VALUES (
    auth.uid(),
    TG_OP,                    -- INSERT / UPDATE / DELETE
    TG_TABLE_NAME,
    v_target,
    jsonb_build_object(
      'op', TG_OP,
      -- Both sides on an UPDATE so the log says what CHANGED, not just that
      -- something did. NULL on the side that does not exist for the operation.
      'old', CASE WHEN TG_OP IN ('UPDATE','DELETE') THEN to_jsonb(OLD) ELSE NULL END,
      'new', CASE WHEN TG_OP IN ('INSERT','UPDATE') THEN to_jsonb(NEW) ELSE NULL END
    )
  );

  RETURN COALESCE(NEW, OLD);
END;
$function$;

-- Replay-safe: guarded on the table existing, and each trigger dropped before
-- it is created so a re-run is a no-op rather than a duplicate-name error.
DO $$
DECLARE
  t text;
  tables text[] := ARRAY['payout_transfers', 'payment_refunds', 'platform_settings', 'user_bans'];
BEGIN
  FOREACH t IN ARRAY tables LOOP
    IF to_regclass('public.' || t) IS NOT NULL THEN
      EXECUTE format('DROP TRIGGER IF EXISTS trg_audit_%1$s ON public.%1$I', t);
      EXECUTE format(
        'CREATE TRIGGER trg_audit_%1$s
           AFTER INSERT OR UPDATE OR DELETE ON public.%1$I
           FOR EACH ROW EXECUTE FUNCTION public.audit_money_table_change()', t);
      RAISE NOTICE 'audit trigger installed on %', t;
    ELSE
      RAISE NOTICE 'skipped (table not present): %', t;
    END IF;
  END LOOP;
END $$;
