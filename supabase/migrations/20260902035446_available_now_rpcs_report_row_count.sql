-- "Available now" reported success whether or not it wrote anything.
--
-- `set_available_now` (20260612430000:14-25) and `clear_available_now`
-- (:29-37) each run a single UPDATE keyed on `auth.uid()` and then RETURN
-- unconditionally. plpgsql does not raise on an UPDATE that matches zero rows,
-- so from the client an untouched database and a successful toggle are
-- byte-identical: `set_available_now` still hands back the `v_until` it
-- computed BEFORE the write, and `clear_available_now` returns void either
-- way. 20260618140000 only pins search_path via ALTER; it does not redefine
-- the bodies, so those really are the live definitions.
--
-- This is the toggle behind the "Available now" badge poster-side applicant
-- cards read, so the failure mode is a helper whose UI says they are available
-- for the next four hours while every poster looking at them sees nothing.
-- AvailabilityTab.tsx already treats a thrown error correctly (report() +
-- toast) and already refuses to invent an expiry the server did not return —
-- it just had no way to find out.
--
-- GET DIAGNOSTICS + RAISE is the right shape rather than returning NULL:
-- zero rows here is never a legitimate outcome. Either the caller has no JWT
-- (auth.uid() IS NULL) or their profile row is missing, and both are failures
-- the person toggling needs to see.
--
-- CREATE OR REPLACE FUNCTION DROPS a function's existing SET clauses, so
-- `SET search_path = public` is restated here — without it this migration
-- would silently undo the F-SEC-06 hardening 20260618140000 applied.
--
-- Replay-safe: CREATE OR REPLACE plus idempotent REVOKE/GRANT.

CREATE OR REPLACE FUNCTION public.set_available_now(p_hours numeric DEFAULT 4)
RETURNS timestamptz
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_until timestamptz := now() + (p_hours || ' hours')::interval;
  v_rows  integer;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;

  UPDATE public.profiles SET available_until = v_until WHERE user_id = auth.uid();
  GET DIAGNOSTICS v_rows = ROW_COUNT;

  IF v_rows = 0 THEN
    RAISE EXCEPTION 'could not set availability: no profile row for the current user';
  END IF;

  RETURN v_until;
END;
$function$;

COMMENT ON FUNCTION public.set_available_now(numeric) IS
  'Sets the caller''s available_until to now() + p_hours and returns it. Raises '
  'if the UPDATE matched no rows — the returned timestamp is computed before '
  'the write, so without the row-count check a no-op write was indistinguishable '
  'from a successful one at the client.';

CREATE OR REPLACE FUNCTION public.clear_available_now()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_rows integer;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;

  UPDATE public.profiles SET available_until = NULL WHERE user_id = auth.uid();
  GET DIAGNOSTICS v_rows = ROW_COUNT;

  IF v_rows = 0 THEN
    RAISE EXCEPTION 'could not clear availability: no profile row for the current user';
  END IF;
END;
$function$;

COMMENT ON FUNCTION public.clear_available_now() IS
  'Clears the caller''s available_until. Raises if the UPDATE matched no rows, '
  'so a toggle that wrote nothing can no longer report success.';

-- Grants restated explicitly. CREATE OR REPLACE preserves them, but stating
-- them keeps the privilege surface of these two functions readable in one
-- place and satisfies migration-lint.
REVOKE ALL ON FUNCTION public.set_available_now(numeric) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.clear_available_now() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_available_now(numeric) TO authenticated;
GRANT EXECUTE ON FUNCTION public.clear_available_now() TO authenticated;
