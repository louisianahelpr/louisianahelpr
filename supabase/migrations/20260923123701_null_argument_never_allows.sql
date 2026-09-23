-- Q140 (docs/OPEN.md): a NULL argument never makes an allow/validity check
-- say yes.
--
-- WHAT WAS BROKEN. helper_credential_document_ok and its twin
-- credential_document_path_ok are chains of `IF <cond> THEN RETURN false`
-- guards that end in a bare `RETURN EXISTS (object named p_path)`. With the
-- kind argument NULL every guard condition is NULL (`NULL NOT IN (...)` is
-- NULL, and the regex built with `|| p_kind ||` is NULL); plpgsql skips an IF
-- whose condition is NULL, so the function fell through to the EXISTS and
-- returned TRUE for ANOTHER member's real document path. Measured live
-- 2026-09-23: helper_credential_document_ok('437de07d-...', NULL,
-- '437de07d-.../credentials/trade_license-1757721600000.png') = true, and
-- credential_document_path_ok('76b07824-...', NULL, '76b07824-.../credentials/
-- insurance-1787168146999.png') = true; the same calls with a real kind that
-- does not match the path are false. Unreachable today (every caller passes a
-- literal kind, or helper_credentials.credential_type, which is NOT NULL and
-- not member-updatable), so a latent trap, not a live bypass.
--
-- THE CLASS. Every public boolean function that decides access or validity was
-- called live with NULL for each argument in turn, against a tuple that is
-- otherwise allowed (inventory and results: scripts/ci/null-arg-validators.sql,
-- which db-smoke now runs on every replay). Three more returned a non-false
-- value for a NULL argument where a garbage value gives false:
--   - check_dispute_velocity(NULL) = TRUE ("under the limit"). Its one caller,
--     open_dispute_as, only asks for a non-NULL opener, but `IF NOT f(x)` is
--     exactly the caller shape in which TRUE-for-NULL means "skip the check".
--   - identity_is_verified(NULL, false) = NULL (`NULL = 'verified'`). Callers
--     only display it today, but NULL in `IF NOT f()` would read as verified.
--   - job_is_funded(NULL) and job_is_funded(<no such job>) = NULL (no row). Its
--     one caller is an RLS WITH CHECK, where NULL denies; a future
--     `IF NOT job_is_funded(x)` would not.
-- Each now returns exactly false. Nothing else changes: every non-NULL input
-- returns what it returned before.
--
-- STRICT was not used: a STRICT function returns NULL for a NULL argument,
-- and in `IF NOT f(x) THEN RAISE` that NULL skips the RAISE, i.e. allows.
--
-- Bodies are the live pg_get_functiondef (2026-09-23) with only the NULL
-- handling added. CREATE OR REPLACE keeps each function's ACL; the REVOKE /
-- GRANT lines below restate the live ACLs (pg_proc.proacl read 2026-09-23).
-- Replay-safe: CREATE OR REPLACE only, and every function here is created by an
-- earlier migration.

CREATE OR REPLACE FUNCTION public.helper_credential_document_ok(p_user_id uuid, p_type text, p_path text)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'public'
AS $fn$
BEGIN
  IF p_user_id IS NULL OR p_type IS NULL OR p_path IS NULL THEN
    RETURN false;
  END IF;
  IF p_type NOT IN ('trade_license', 'insurance', 'bond') THEN
    RETURN false;
  END IF;
  IF p_path !~ ('^' || p_user_id::text || '/credentials/' || p_type || '-[0-9]{13}\.([Pp][Dd][Ff]|[Pp][Nn][Gg]|[Jj][Pp][Ee]?[Gg]|[Ww][Ee][Bb][Pp]|[Hh][Ee][Ii][Cc])$') THEN
    RETURN false;
  END IF;
  RETURN EXISTS (
    SELECT 1 FROM storage.objects o
     WHERE o.bucket_id = 'user-documents' AND o.name = p_path
  );
END;
$fn$;

REVOKE ALL ON FUNCTION public.helper_credential_document_ok(uuid, text, text) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.credential_document_path_ok(p_user_id uuid, p_kind text, p_path text)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'public'
AS $fn$
BEGIN
  IF p_user_id IS NULL OR p_kind IS NULL OR p_path IS NULL THEN
    RETURN false;
  END IF;
  IF p_kind NOT IN ('license', 'insurance') THEN
    RETURN false;
  END IF;
  IF p_path !~ ('^' || p_user_id::text || '/credentials/' || p_kind || '-[0-9]{13}\.([Pp][Dd][Ff]|[Pp][Nn][Gg]|[Jj][Pp][Ee]?[Gg]|[Ww][Ee][Bb][Pp]|[Hh][Ee][Ii][Cc])$') THEN
    RETURN false;
  END IF;
  RETURN EXISTS (
    SELECT 1 FROM storage.objects o
     WHERE o.bucket_id = 'user-documents' AND o.name = p_path
  );
END;
$fn$;

REVOKE ALL ON FUNCTION public.credential_document_path_ok(uuid, text, text) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.check_dispute_velocity(p_user_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'public'
AS $fn$
  SELECT p_user_id IS NOT NULL
     AND (SELECT count(*) < 3
            FROM public.jobs
           WHERE disputed_by = p_user_id
             AND disputed_at > now() - interval '30 days');
$fn$;

REVOKE ALL ON FUNCTION public.check_dispute_velocity(uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.identity_is_verified(p_idv_status text, p_stripe_identity_verified boolean)
 RETURNS boolean
 LANGUAGE sql
 IMMUTABLE PARALLEL SAFE
 SET search_path TO 'public', 'pg_temp'
AS $fn$
  SELECT p_idv_status IS NOT DISTINCT FROM 'verified' OR p_stripe_identity_verified IS TRUE;
$fn$;

-- Live ACL: anon, authenticated, service_role (the public profile readers use it).
REVOKE ALL ON FUNCTION public.identity_is_verified(text, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.identity_is_verified(text, boolean) TO anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.job_is_funded(p_job_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $fn$
  SELECT COALESCE((
    SELECT public.job_payment_is_funded(j.payment_status)
      FROM public.jobs j
     WHERE j.id = p_job_id
  ), false);
$fn$;

REVOKE ALL ON FUNCTION public.job_is_funded(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.job_is_funded(uuid) TO authenticated, service_role;
