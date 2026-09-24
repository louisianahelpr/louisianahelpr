-- IB-002: special_requirements is shown to every browsing Helpr next to the
-- title and description, but reject_contact_leak_in_job (20260913020635)
-- scanned only title and description, so a phone number or "Venmo me" in
-- special requirements went live unchecked. Same scanner, same error shape
-- ("... in the job special requirements."), which the client's
-- contactLeakRejectionMessage already surfaces verbatim.
CREATE OR REPLACE FUNCTION public.reject_contact_leak_in_job()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
DECLARE
  v_reason text;
BEGIN
  IF TG_OP = 'INSERT' OR NEW.title IS DISTINCT FROM OLD.title THEN
    v_reason := public.contact_leak_reason(NEW.title);
    IF v_reason IS NOT NULL THEN
      RAISE EXCEPTION USING
        ERRCODE = 'check_violation',
        MESSAGE = v_reason || ' in the job title. Keep contact details and payment off the post; hiring and payment happen in the app.';
    END IF;
  END IF;

  IF TG_OP = 'INSERT' OR NEW.description IS DISTINCT FROM OLD.description THEN
    v_reason := public.contact_leak_reason(NEW.description);
    IF v_reason IS NOT NULL THEN
      RAISE EXCEPTION USING
        ERRCODE = 'check_violation',
        MESSAGE = v_reason || ' in the job description. Keep contact details and payment off the post; hiring and payment happen in the app.';
    END IF;
  END IF;

  IF TG_OP = 'INSERT' OR NEW.special_requirements IS DISTINCT FROM OLD.special_requirements THEN
    v_reason := public.contact_leak_reason(NEW.special_requirements);
    IF v_reason IS NOT NULL THEN
      RAISE EXCEPTION USING
        ERRCODE = 'check_violation',
        MESSAGE = v_reason || ' in the job special requirements. Keep contact details and payment off the post; hiring and payment happen in the app.';
    END IF;
  END IF;

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_reject_contact_leak_in_job ON public.jobs;
CREATE TRIGGER trg_reject_contact_leak_in_job
  BEFORE INSERT OR UPDATE OF title, description, special_requirements ON public.jobs
  FOR EACH ROW EXECUTE FUNCTION public.reject_contact_leak_in_job();
