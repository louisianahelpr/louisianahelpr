-- Q1503 (lh-authz-rls re-review of Q1499, finding lh-authz-rls@054942e80#3):
-- jobs.parish and jobs.zip_code still described the OLD address after an
-- address change.
--
-- Both are written once, by the client, when the job is posted
-- (jobSubmitHelpers: zip from the form, parish from get_parish_for_zip). Two
-- writers change jobs.location later and neither touches them:
--   - the poster's edit of an open job (EditJobDialog: one free-text
--     Location field, PATCHed with its geocoded point), and
--   - an agreed change of a booked job's address (respond_job_detail_change,
--     20261007113957, applied as the last accepting Helpr).
-- So parish matching, ranking and the job's parish label kept reading the
-- old place.
--
-- Change: a BEFORE UPDATE OF location trigger re-derives both from the new
-- address, server-side, the way profiles.parish is derived from its ZIP
-- (20260907053228's ladder):
--   1. ZIP: the trailing five digits of the address ("street, city, LA 70501",
--      the shape post-job writes; a ZIP+4 suffix is allowed). If the text has
--      none but the same write sends a new zip_code, that one.
--   2. parish: louisiana_zip_parishes for that ZIP. A ZIP Louisiana does not
--      have (out of state) gives NULL, never the old parish.
--   3. no ZIP at all: zip_code NULL, parish from the city segment
--      (get_parish_for_city, which refuses an ambiguous city), else NULL.
-- An address that does not change, or is redacted to NULL by account
-- deletion (the earnings export groups tax by parish), leaves both alone.
--
-- Named to sort AFTER every other BEFORE UPDATE trigger on jobs (they fire in
-- name order; the last was zzzzzz_jobs_location_clears_coords): the poster's
-- lock and the Helpr's column whitelist judge the write as the client sent
-- it, so this server-side derivation never reads as a Helpr writing parish or
-- zip_code (the whitelist's agreed-change carve-out names only title,
-- description, location, latitude, longitude, materials_note).
-- SECURITY DEFINER because the agreed change runs as the Helpr, and the
-- lookups read louisiana_zip_parishes and get_parish_for_city (owner-only).
--
-- Replay-safe: CREATE OR REPLACE, DROP TRIGGER IF EXISTS.
-- Proof: src/test/pglite/jobAddressRederivesPlace.pglite.mjs (RED without
-- this file). Guard: src/test/jobAddressRederivesPlace.test.ts.

CREATE OR REPLACE FUNCTION public.jobs_location_rederives_place()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_zip  text;
  v_city text;
  v_parts text[];
BEGIN
  IF NEW.location IS NOT DISTINCT FROM OLD.location THEN
    RETURN NEW;
  END IF;
  -- Account deletion redacts the poster's money-carrying jobs (location :=
  -- NULL) and keeps the rest of the financial record: the Helpr's earnings
  -- export groups sales tax by parish. A redaction is not a move.
  IF NEW.location IS NULL THEN
    RETURN NEW;
  END IF;

  v_zip := substring(COALESCE(NEW.location, '') FROM '(\d{5})(?:-\d{4})?\s*$');
  IF v_zip IS NULL AND NEW.zip_code IS DISTINCT FROM OLD.zip_code THEN
    v_zip := NULLIF(substring(COALESCE(NEW.zip_code, '') FROM '^\s*(\d{5})'), '');
  END IF;

  NEW.zip_code := v_zip;
  IF v_zip IS NOT NULL THEN
    SELECT z.parish INTO NEW.parish FROM public.louisiana_zip_parishes z WHERE z.zip_code = v_zip;
    IF NOT FOUND THEN
      NEW.parish := NULL;
    END IF;
  ELSE
    -- "street, city, LA" or "street, city": the city is the segment before
    -- the last one when the last is a state, else the last.
    v_parts := regexp_split_to_array(COALESCE(NEW.location, ''), '\s*,\s*');
    IF cardinality(v_parts) >= 3 AND btrim(v_parts[cardinality(v_parts)]) ~* '^(la|louisiana)$' THEN
      v_city := v_parts[cardinality(v_parts) - 1];
    ELSIF cardinality(v_parts) >= 2 THEN
      v_city := v_parts[cardinality(v_parts)];
    END IF;
    NEW.parish := CASE WHEN v_city IS NULL THEN NULL ELSE public.get_parish_for_city(v_city) END;
  END IF;
  RETURN NEW;
END;
$fn$;

REVOKE ALL ON FUNCTION public.jobs_location_rederives_place() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS zzzzzz_jobs_location_rederives_place ON public.jobs;
CREATE TRIGGER zzzzzz_jobs_location_rederives_place
  BEFORE UPDATE OF location ON public.jobs
  FOR EACH ROW EXECUTE FUNCTION public.jobs_location_rederives_place();
