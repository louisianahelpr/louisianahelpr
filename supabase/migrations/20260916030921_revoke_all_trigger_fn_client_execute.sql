-- NO TRIGGER FUNCTION IS AN API — REVOKE CLIENT EXECUTE ON ALL OF THEM.
--
-- 20260916023649 revoked EXECUTE on the eight trigger functions the Supabase
-- advisor happened to flag (the anon-executable SECURITY DEFINER subset). The
-- live catalog then showed the finding is systemic, not eight cases: ~50 more
-- SECURITY DEFINER trigger functions are `authenticated`-executable and ~11
-- SECURITY INVOKER trigger functions are anon/authenticated-executable — all via
-- the PUBLIC EXECUTE default that the relation-level default-privilege cleanup
-- (20260915101101) does not cover for functions.
--
-- A function whose return type is `trigger` cannot be usefully called as an RPC
-- (Postgres rejects a direct call, and NEW/OLD/TG_OP are null besides), so none
-- of them is a legitimate client entry point. The trigger keeps firing no matter
-- what — the trigger machinery invokes it as the table owner, never through an
-- EXECUTE grant — so revoking client EXECUTE removes pure attack surface and
-- changes nothing about the triggers.
--
-- Done as a set-based sweep over the live catalog rather than a name list, so it
-- is both the fix and the class guard: any trigger function that arrives later
-- with the PUBLIC default is caught by a re-run. Real RPCs (non-trigger return
-- types) are never touched — the WHERE clause is prorettype = trigger only.
--
-- REPLAY-SAFE: the loop reads the catalog as it exists at run time, so a
-- from-scratch rebuild that has not yet created a given function simply does not
-- see it; REVOKE is idempotent. Proof: scripts/probes/trigger-fn-grants.pglite.mjs
-- (a definer + an invoker trigger fn, both client-granted, both revoked; a
-- non-trigger RPC left intact; idempotent) and scripts/ci/trigger-fn-grants.sql
-- (the class query: zero trigger fns client-executable).

DO $revoke_all_trigger_execute$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT p.oid::regprocedure AS sig
      FROM pg_proc p
     WHERE p.pronamespace = 'public'::regnamespace
       AND p.prorettype = 'pg_catalog.trigger'::regtype
       AND (has_function_privilege('anon', p.oid, 'EXECUTE')
            OR has_function_privilege('authenticated', p.oid, 'EXECUTE'))
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated', r.sig);
  END LOOP;
END
$revoke_all_trigger_execute$;
