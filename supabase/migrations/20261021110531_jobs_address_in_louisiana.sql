-- Q2291 (Louisiana-only brand; builder2f friction 4, 2026-10-21): a job's address state was never checked on
-- the server. The single address box refuses a non-LA pick in the client, but the manual fields (State read-only
-- "LA" while city/street/ZIP can be anywhere), CurrentLocationPill (a coarse geocode) and any direct insert
-- reached jobs with no state rule.
--
-- jobs_address_in_louisiana (trigger zz_jobs_address_in_louisiana): a BEFORE INSERT OR UPDATE OF location, latitude, longitude trigger. A client write
-- is refused (job_address_not_louisiana, 23514) when the address names another place:
--   - a state token other than LA / Louisiana before the ZIP or as the last segment ("…, Houston, TX 77002");
--   - a 5-digit ZIP outside Louisiana's 700xx-714xx range;
--   - map coordinates outside Louisiana's bounding box (lat 28.8-33.1, lng -94.1 to -88.7).
-- An address with no state, ZIP or point (a coarse "Lafayette") is not refused: nothing in it is out of state.
-- Server writes (is_server_context: edge functions, migrations) and test rows (is_seed, hidden from the public
-- by seed_jobs_hidden_publicly, and the audit fixtures use the fake ZIP 99999) pass. A redaction (location
-- NULL on account deletion) passes. Measured on prod 2026-10-21 (read-only, last 60 days, 543 jobs): no real job
-- carries a non-LA state, ZIP or point, so nothing that exists today would have been refused.
-- Proof: node src/test/pglite/jobsAddressInLouisiana.pglite.mjs (red without the file, 3x apply).

CREATE OR REPLACE FUNCTION public.jobs_address_in_louisiana()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_loc text := btrim(COALESCE(NEW.location, ''));
  v_state text;
  v_zip text;
BEGIN
  IF public.is_server_context() OR COALESCE(NEW.is_seed, false) THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE'
     AND NEW.location IS NOT DISTINCT FROM OLD.location
     AND NEW.latitude IS NOT DISTINCT FROM OLD.latitude
     AND NEW.longitude IS NOT DISTINCT FROM OLD.longitude THEN
    RETURN NEW;
  END IF;

  -- The state: "…, XX 12345" or a last segment that is only a state word.
  v_state := substring(v_loc FROM ',\s*([A-Za-z]{2})\s+\d{5}(?:-\d{4})?\s*$');
  IF v_state IS NULL THEN
    v_state := substring(v_loc FROM ',\s*([A-Za-z]{2}|[A-Za-z ]{4,})\s*$');
    -- A last segment is a state only when it is a two-letter code (a city name is not a state).
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

  IF NEW.latitude IS NOT NULL AND NEW.longitude IS NOT NULL
     AND (NEW.latitude::float8 NOT BETWEEN 28.8 AND 33.1 OR NEW.longitude::float8 NOT BETWEEN -94.1 AND -88.7) THEN
    RAISE EXCEPTION 'job_address_not_louisiana' USING ERRCODE = '23514',
      HINT = 'Helpr is in Louisiana only for now. Use a Louisiana address.';
  END IF;
  RETURN NEW;
END;
$fn$;

REVOKE ALL ON FUNCTION public.jobs_address_in_louisiana() FROM PUBLIC, anon, authenticated;

-- zz_: it must fire AFTER trg_jobs_insert_column_lock, which re-derives NEW.is_seed from the poster's profile, so
-- a member cannot send is_seed:true to skip this check (lh-authz-rls review M1). Still before zzzzzz_jobs_location_*.
DROP TRIGGER IF EXISTS zz_jobs_address_in_louisiana ON public.jobs;
CREATE TRIGGER zz_jobs_address_in_louisiana
  BEFORE INSERT OR UPDATE OF location, latitude, longitude ON public.jobs
  FOR EACH ROW EXECUTE FUNCTION public.jobs_address_in_louisiana();
