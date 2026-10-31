-- NOID-23 (admin audit, "own hires shown as admin overrides"): audit_admin_job_status_change logged every status change
-- an admin made as job_status_override, including the admin's OWN jobs as an ordinary member (hiring a Helpr on a job
-- she posted, or starting a job she was hired on). Measured read-only on prod 10-31 ~16:35 CT: of 33
-- job_status_override rows, 11 are on a job where the actor is the job's poster or its Helpr (the latest 2026-10-30,
-- "Mow and Weed Eat" -> accepted, her own post); the other 22 name jobs no longer readable by that join.
-- Now a change by the job's own poster or Helpr (before or after the change) is a member action, not an override, and
-- writes no audit row. Every other admin change is logged exactly as before.
--
-- Restated from its newest CREATE, 20260504154605_audit_admin_job_status_overrides (no later CREATE in the repo; the
-- live body, pg_proc.prosrc read 10-31, is the same code with the comments and blank lines stripped). Grants: prod's
-- proacl is {postgres=X, service_role=X}; restated with the same REVOKE (20260505190000 revoked it from PUBLIC, anon,
-- authenticated). Replay-safe: CREATE OR REPLACE.
-- Proof: src/test/pglite/adminOwnJobStatusNotOverride.pglite.mjs (applied 3x; NEW_MIGRATION=skip and mutants fail).

CREATE OR REPLACE FUNCTION public.audit_admin_job_status_change()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF OLD.status = NEW.status THEN
    RETURN NEW;
  END IF;

  -- Only audit when the actor is an admin. Service-role calls (auth.uid()
  -- IS NULL) follow the matrix, not a bypass — no audit row for them.
  IF auth.uid() IS NULL THEN
    RETURN NEW;
  END IF;

  IF NOT public.has_role(auth.uid(), 'admin'::app_role) THEN
    RETURN NEW;
  END IF;

  -- NOID-23: the admin acting on her own job (its poster, or its Helpr before or after the change) is a member, not an
  -- override.
  IF auth.uid() = NEW.customer_id OR auth.uid() = NEW.helper_id OR auth.uid() = OLD.helper_id THEN
    RETURN NEW;
  END IF;

  INSERT INTO public.admin_audit_log (admin_id, action, target_type, target_id, details)
  VALUES (
    auth.uid(),
    'job_status_override',
    'job',
    NEW.id::text,
    jsonb_build_object(
      'from_status', OLD.status::text,
      'to_status',   NEW.status::text,
      'job_title',   NEW.title,
      'customer_id', NEW.customer_id,
      'helper_id',   NEW.helper_id,
      'budget',      NEW.budget,
      'dispute_status', NEW.dispute_status
    )
  );

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.audit_admin_job_status_change() FROM PUBLIC, anon, authenticated;
