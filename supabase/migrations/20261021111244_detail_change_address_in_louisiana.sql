-- Q2291 follow-up (lh-authz-rls L2 on ready/builder2h-jobs-14; lead 2026-10-21): an out-of-state address asked for
-- through request_job_detail_change (Q1254) was refused only when a Helpr ACCEPTED it (the jobs rule
-- zz_jobs_address_in_louisiana fires on respond_job_detail_change's UPDATE), so the refusal landed on the Helpr.
-- It is now refused at the moment it is ASKED, with the same code and words.
--
-- A BEFORE INSERT trigger on job_detail_change_requests (written only by request_job_detail_change, a definer RPC),
-- so the RPC is not restated: when 'location' is among the changed fields, the new address is held to the same
-- three tests as the jobs rule (a non-LA state token; a ZIP outside 700xx-714xx; a point outside lat 28.8-33.1,
-- lng -94.1 to -88.7). A test job (jobs.is_seed) passes, as on jobs. No client calls this RPC yet (2026-10-21),
-- so this closes the server path before one does.
-- Proof: node src/test/pglite/detailChangeAddressInLouisiana.pglite.mjs (red without the file, 3x apply).

CREATE OR REPLACE FUNCTION public.detail_change_address_in_louisiana()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_loc text := btrim(COALESCE(NEW.new_location, ''));
  v_state text;
  v_zip text;
BEGIN
  IF NOT ('location' = ANY (COALESCE(NEW.changed_fields, ARRAY[]::text[]))) THEN
    RETURN NEW;
  END IF;
  IF EXISTS (SELECT 1 FROM public.jobs j WHERE j.id = NEW.job_id AND COALESCE(j.is_seed, false)) THEN
    RETURN NEW;
  END IF;

  v_state := substring(v_loc FROM ',\s*([A-Za-z]{2})\s+\d{5}(?:-\d{4})?\s*$');
  IF v_state IS NULL THEN
    v_state := substring(v_loc FROM ',\s*([A-Za-z]{2}|[A-Za-z ]{4,})\s*$');
    IF v_state IS NOT NULL AND length(btrim(v_state)) <> 2 AND lower(btrim(v_state)) <> 'louisiana' THEN
      v_state := NULL;
    END IF;
  END IF;
  IF v_state IS NOT NULL AND lower(btrim(v_state)) NOT IN ('la', 'louisiana') THEN
    RAISE EXCEPTION 'job_address_not_louisiana' USING ERRCODE = '23514',
      HINT = 'Helpr is in Louisiana only for now. Use a Louisiana address.';
  END IF;

  v_zip := substring(v_loc FROM '(\d{5})(?:-\d{4})?\s*$');
  IF v_zip IS NOT NULL AND (v_zip < '70000' OR v_zip > '71499') THEN
    RAISE EXCEPTION 'job_address_not_louisiana' USING ERRCODE = '23514',
      HINT = 'Helpr is in Louisiana only for now. Use a Louisiana address.';
  END IF;

  IF NEW.new_latitude IS NOT NULL AND NEW.new_longitude IS NOT NULL
     AND (NEW.new_latitude::float8 NOT BETWEEN 28.8 AND 33.1 OR NEW.new_longitude::float8 NOT BETWEEN -94.1 AND -88.7) THEN
    RAISE EXCEPTION 'job_address_not_louisiana' USING ERRCODE = '23514',
      HINT = 'Helpr is in Louisiana only for now. Use a Louisiana address.';
  END IF;
  RETURN NEW;
END;
$fn$;

REVOKE ALL ON FUNCTION public.detail_change_address_in_louisiana() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_detail_change_address_in_louisiana ON public.job_detail_change_requests;
CREATE TRIGGER trg_detail_change_address_in_louisiana
  BEFORE INSERT ON public.job_detail_change_requests
  FOR EACH ROW EXECUTE FUNCTION public.detail_change_address_in_louisiana();
