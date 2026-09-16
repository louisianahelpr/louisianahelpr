-- TRIGGER FUNCTIONS ARE NOT AN API, AND ONE HELPER'S search_path WAS UNPINNED.
--
-- The Supabase security advisor (0028/0029) flagged eight SECURITY DEFINER
-- functions whose return type is `trigger` as EXECUTE-able by `anon` AND
-- `authenticated` — i.e. reachable at /rest/v1/rpc/<name>. They are not an API:
-- each is attached to a table trigger and reads NEW/OLD/TG_OP, which are null
-- when it is invoked as a bare RPC, so a direct call does nothing useful. But
-- the grant is real attack surface with no purpose. It exists only because
-- Postgres grants EXECUTE on every new function to PUBLIC by default, and the
-- default-privilege cleanup that closed the same hole for TABLES/VIEWS/SEQUENCES
-- (20260915101101, client-default-privileges.sql) does not cover functions.
-- The trigger keeps firing regardless of this grant — the trigger machinery
-- calls the function as the table owner, never through an EXECUTE privilege — so
-- revoking EXECUTE removes the RPC exposure and changes nothing about the
-- triggers themselves. Verified 2026-09-16: zero client/edge RPC call sites for
-- any of the eight.
--
-- Also: public.normalize_phone_for_ban had a role-mutable search_path (advisor
-- 0011). It is SECURITY INVOKER so the exposure is smaller than a definer's, but
-- an unpinned search_path is still a hazard (a caller's search_path decides
-- which `replace`/operator it binds) and there is no reason to leave it open.
-- Pin it to public, matching every other function in this schema.
--
-- REPLAY-SAFE: every statement is guarded on to_regprocedure(...) IS NOT NULL,
-- so a from-scratch rebuild that has not yet created a given function simply
-- skips it. REVOKE is idempotent; ALTER ... SET search_path is idempotent.
-- Proof: scripts/probes/trigger-fn-grants.pglite.mjs (PGlite) — RED-BEFORE
-- (anon/authenticated CAN execute the trigger fn, search_path unpinned), green
-- after, idempotent 3x, and a clean no-op when the functions are absent.
-- The class query (no trigger-returning function in public may be
-- anon/authenticated-executable) is scripts/ci/trigger-fn-grants.sql.

DO $revoke_trigger_execute$
DECLARE
  fn text;
  triggers text[] := ARRAY[
    'public.audit_money_table_change()',
    'public.enforce_ban_gate()',
    'public.enforce_no_admin_for_disposable_email()',
    'public.enforce_referral_credit_eligibility()',
    'public.message_reactions_set_job()',
    'public.messages_validate_reply()',
    'public.scan_application_contact_info()',
    'public.stamp_job_accepted_at()'
  ];
BEGIN
  FOREACH fn IN ARRAY triggers LOOP
    IF to_regprocedure(fn) IS NOT NULL THEN
      EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated', fn);
    END IF;
  END LOOP;
END
$revoke_trigger_execute$;

-- Pin the one unpinned search_path.
DO $pin_search_path$
BEGIN
  IF to_regprocedure('public.normalize_phone_for_ban(text)') IS NOT NULL THEN
    ALTER FUNCTION public.normalize_phone_for_ban(text) SET search_path = public;
  ELSIF to_regprocedure('public.normalize_phone_for_ban()') IS NOT NULL THEN
    ALTER FUNCTION public.normalize_phone_for_ban() SET search_path = public;
  END IF;
END
$pin_search_path$;
