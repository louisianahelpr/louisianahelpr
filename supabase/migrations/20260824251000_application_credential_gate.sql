-- Credential-gated jobs enforce their gate at the data layer (2026-08-24
-- launch-killer sweep, same class as the ban gate two migrations ago).
--
-- FOUND: jobs.credential_tier (1 = licensed, 2 = licensed + insured) was
-- enforced by JobDetailFooter hiding the Apply button — and nowhere else.
-- apply_to_job never checks it (verified via pg_proc), so an unlicensed
-- helper could apply to any of the live credential-gated jobs straight
-- through PostgREST, and a poster who paid for "licensed only" got a queue
-- the gate never filtered.
--
-- FIX: BEFORE INSERT trigger on applications — compares the applicant's
-- verified tier (get_user_credential_tier, the same RPC the UI trusts)
-- against the job's requirement. Service role passes through.

CREATE OR REPLACE FUNCTION public.enforce_application_credential_tier()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_required int;
  v_actual int;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN NEW;  -- service-role writers (recurring visits, admin tooling)
  END IF;

  SELECT COALESCE(j.credential_tier, 0) INTO v_required
    FROM public.jobs j WHERE j.id = NEW.job_id;

  IF v_required > 0 THEN
    v_actual := COALESCE(public.get_user_credential_tier(NEW.helper_id), 0);
    IF v_actual < v_required THEN
      RAISE EXCEPTION 'credential_tier_required'
        USING ERRCODE = '42501',
              HINT = CASE WHEN v_required >= 2
                          THEN 'This job requires a verified license and insurance.'
                          ELSE 'This job requires a verified license.' END;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_application_credential_gate ON public.applications;
CREATE TRIGGER trg_application_credential_gate
  BEFORE INSERT ON public.applications
  FOR EACH ROW EXECUTE FUNCTION public.enforce_application_credential_tier();
