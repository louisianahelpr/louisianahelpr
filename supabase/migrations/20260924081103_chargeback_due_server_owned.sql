-- AM-002 follow-up: jobs.chargeback_evidence_due_by is written only by
-- stripe-webhook (service role). 20260924080301 granted SELECT alone, but
-- authenticated holds a TABLE-level UPDATE grant on jobs, which covers every
-- new column (measured live: has_column_privilege(..., 'UPDATE') = true), so
-- a poster could set or forge the deadline the admin console shows. Same
-- shape as enforce_dispute_markers_server_owned: direct client writes are
-- cleared on INSERT and refused on UPDATE; admins, SECURITY DEFINER RPCs,
-- the service role and cron pass.
CREATE OR REPLACE FUNCTION public.enforce_chargeback_due_server_owned()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid;
BEGIN
  -- Not SECURITY DEFINER: current_user is the caller's role.
  IF current_user::text NOT IN ('authenticated', 'anon') THEN
    RETURN NEW;
  END IF;
  v_uid := auth.uid();
  IF current_user::text = 'authenticated' AND v_uid IS NOT NULL THEN
    IF public.has_role(v_uid, 'admin'::app_role) THEN
      RETURN NEW;
    END IF;
  END IF;
  IF TG_OP = 'INSERT' THEN
    NEW.chargeback_evidence_due_by := NULL;
    RETURN NEW;
  END IF;
  IF NEW.chargeback_evidence_due_by IS DISTINCT FROM OLD.chargeback_evidence_due_by THEN
    RAISE EXCEPTION 'jobs.chargeback_evidence_due_by is set by stripe-webhook, not by the client'
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.enforce_chargeback_due_server_owned() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_chargeback_due_server_owned ON public.jobs;
CREATE TRIGGER trg_chargeback_due_server_owned
  BEFORE INSERT OR UPDATE ON public.jobs
  FOR EACH ROW EXECUTE FUNCTION public.enforce_chargeback_due_server_owned();
