-- Client compatibility floor (launch blocker, owner-reported 2026-10-05).
--
-- WHY: a client bundle is frozen at the moment it was built. The native app
-- carries its bundle inside the binary (no over-the-air updates), and a web
-- tab keeps running the JS it loaded. When a migration takes a privilege away
-- from `authenticated` (20261004191007 withheld applications.flag_reason and
-- friends), every bundle built before it keeps asking for what it can no
-- longer read and gets 42501 "permission denied" on My Jobs and Applicants.
-- Measured: the 2026-10-01 TestFlight bundle (release 693db745) logged 19
-- such rows on 2026-10-05 from capacitor://localhost.
--
-- WHAT: one number. Every client bundle carries CLIENT_COMPAT_EPOCH
-- (src/lib/clientCompat.ts). This function returns the oldest epoch the
-- database still serves correctly. A bundle older than it reloads (web) or
-- shows "Update Helpr" (native). Bumping it is a CREATE OR REPLACE in the same
-- migration that narrows a grant; src/test/schemaBreakBumpsClientFloor.test.ts
-- fails any migration that narrows what `authenticated` may read or write on a
-- table without raising this number, and holds it equal to the client's epoch.
--
-- A constant, not a table row: nothing to seed, nothing an operator can set
-- by accident, and its history is the migration history. It reads no data,
-- so anon may call it (a signed-out web tab needs the answer too).
--
-- STABLE, not IMMUTABLE: an immutable call may be folded into a cached plan
-- on a pooled connection, and a later bump must be seen at once.
--
-- Replay-safe: CREATE OR REPLACE; grants restated.
CREATE OR REPLACE FUNCTION public.client_compat_floor()
RETURNS integer
LANGUAGE sql
STABLE
PARALLEL SAFE
SET search_path = public
AS $$ SELECT 1 $$;

COMMENT ON FUNCTION public.client_compat_floor() IS
  'Oldest client bundle epoch (src/lib/clientCompat.ts CLIENT_COMPAT_EPOCH) the schema still serves. Raised by any migration that narrows authenticated table/column privileges.';

REVOKE ALL ON FUNCTION public.client_compat_floor() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.client_compat_floor() TO anon, authenticated, service_role;
