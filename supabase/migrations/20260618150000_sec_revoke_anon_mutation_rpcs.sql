-- F-SEC-07 + F-SEC-04: tighten anon surface on SECURITY DEFINER objects.
--
-- F-SEC-07 (defense-in-depth): 60 SECURITY DEFINER functions are anon-executable.
-- 30 are intentional public reads (landing/browse: get_public_open_jobs,
-- get_platform_impact_stats, get_recent_public_payouts, get_safe_profiles, ...)
-- and MUST keep anon EXECUTE. The other ~30 are write (volatile) mutations that
-- only ever run for an authenticated user (apply_to_job, accept_application,
-- rpc_decide_dispute, respond_to_review, ...). They self-guard on auth.uid() /
-- has_role() internally, but because they run as owner, locking anon out is a
-- cheap second line of defense and is behavior-preserving for real callers.
--
-- NOTE: Postgres grants function EXECUTE to PUBLIC at creation, and anon inherits
-- PUBLIC. So REVOKE ... FROM anon alone does NOT lock anon out -- we must REVOKE
-- FROM PUBLIC and then GRANT to the roles that should keep access (authenticated,
-- service_role). The function body still enforces authz, so granting authenticated
-- EXECUTE is not a privilege change -- non-authorized callers are still rejected
-- inside the function.
--
-- We touch every volatile SECURITY DEFINER function in public EXCEPT
-- record_job_view / record_profile_view, which an anon visitor may legitimately
-- call on a public job/profile page (view counting). Done dynamically so the set
-- tracks reality and stays correct on a from-scratch replay: the loop only
-- touches functions that currently exist and is idempotent.

DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT p.oid::regprocedure AS sig
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.prosecdef
      AND p.provolatile = 'v'
      AND p.proname NOT IN ('record_job_view', 'record_profile_view')
  LOOP
    EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC, anon', r.sig);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated, service_role', r.sig);
  END LOOP;
END;
$$;

-- F-SEC-04 (documented accepted finding): the Supabase advisor flags
-- public.open_jobs_browse as a SECURITY DEFINER view (its only ERROR). This is
-- INTENTIONAL and cannot be flipped to security_invoker without breaking browse:
-- the jobs table has no anon/broad SELECT RLS policy, so an invoker-rights view
-- would return zero rows for the public browse feed. Granting such a policy would
-- instead re-expose the unmasked street address on the base table (the very leak
-- F-DISC-01 closed). The view already masks location via mask_job_location(),
-- restricts to status='open', and exposes a curated column set -- so the definer
-- property is the safe design here, not a vulnerability. Record that intent on
-- the object so the advisor finding is understood as accepted, not overlooked.
DO $$
BEGIN
  IF to_regclass('public.open_jobs_browse') IS NOT NULL THEN
    COMMENT ON VIEW public.open_jobs_browse IS
      'Intentional SECURITY DEFINER view: public masked browse feed. Bypasses '
      'jobs RLS to expose open jobs to anon/authenticated with location masked '
      'via mask_job_location() and a curated column set. Do NOT convert to '
      'security_invoker -- jobs has no broad SELECT RLS, so invoker rights would '
      'return zero rows and break browse (F-SEC-04 accepted; see F-DISC-01).';
  END IF;
END;
$$;
