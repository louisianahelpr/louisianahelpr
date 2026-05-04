-- Audit every admin override of a job status transition.
--
-- Background: enforce_job_status_transition() lets admins bypass the
-- transition matrix for support / dispute resolution. Without an audit
-- trail there's no after-the-fact way to see who overrode what — that
-- becomes a compliance and trust hole as soon as money disputes get
-- settled by hand. This trigger writes one row to admin_audit_log per
-- admin-driven status change.
--
-- Fires AFTER UPDATE so the audit row is only written when the change
-- has been accepted by Postgres (no rollback noise). Skips non-admin
-- transitions (those follow the matrix and don't need extra audit).
-- Skips no-op updates (status didn't change).

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

COMMENT ON FUNCTION public.audit_admin_job_status_change() IS
'Logs admin overrides of jobs.status to admin_audit_log. Pairs with enforce_job_status_transition() — that trigger lets admins bypass the matrix; this one records the bypass.';

DROP TRIGGER IF EXISTS trg_audit_admin_job_status_change ON public.jobs;
CREATE TRIGGER trg_audit_admin_job_status_change
  AFTER UPDATE OF status ON public.jobs
  FOR EACH ROW
  EXECUTE FUNCTION public.audit_admin_job_status_change();
