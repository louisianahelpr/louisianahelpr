-- Q1286 (owner decision 2026-10-12): /complete-profile tells a person whose
-- details were cleared by the Q447 pre-verification takeover wipe why the form
-- is empty: "For your security, details entered before your email was
-- confirmed were cleared. Please add them again."
--
-- public.pre_verification_wipes is server-only (REVOKE ALL FROM PUBLIC, anon,
-- authenticated in 20261004194257), so the page cannot read it. This function
-- answers ONE yes/no question about the CALLER only (auth.uid(); no argument,
-- so no other account can be asked about) and returns nothing else from the
-- row (no timestamps, no storage object list, no error text).
--
-- "A clearing happened" = a row whose wipe ran. A row the trigger wrote
-- because the wipe itself FAILED ('wipe failed: ...', see
-- wipe_on_provider_takeover; the wipe is rolled back before that row is
-- written) cleared nothing, so it does not count. Any other error text would
-- not undo a clearing that ran; no writer sets one today (the storage sweep in
-- _shared/preVerificationWipeSweep.ts only reads the column).
CREATE OR REPLACE FUNCTION public.has_pre_verification_wipe()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
  SELECT auth.uid() IS NOT NULL
     AND EXISTS (
       SELECT 1
         FROM public.pre_verification_wipes w
        WHERE w.user_id = auth.uid()
          AND coalesce(w.error, '') NOT LIKE 'wipe failed:%'
     );
$fn$;

REVOKE ALL ON FUNCTION public.has_pre_verification_wipe() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.has_pre_verification_wipe() TO authenticated;

COMMENT ON FUNCTION public.has_pre_verification_wipe() IS
  'Q1286: true when the CALLER''s account had its pre-verification details cleared by the Q447 takeover wipe (a failed wipe does not count). Read by /complete-profile to explain the empty form.';
