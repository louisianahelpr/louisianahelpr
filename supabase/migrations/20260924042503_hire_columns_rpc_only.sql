-- Q346: the hire RPCs are the ONLY way to hire.
--
-- MEASURED LIVE 2026-09-24T04:24Z (scripts/probes/direct-patch-hire.prod.mjs,
-- seed accounts poster-e2e / helper-e2e, funded is_seed jobs, cleaned up):
--   A  poster PATCH jobs {helper_id: <helper who never applied>, status: accepted}  -> 200, 1 row
--   B  direct-offer target PATCH jobs {helper_id: self, status: accepted}           -> 200, 1 row
--   C  poster PATCH jobs {offered_to_helper_id: <someone else>}                      -> 200, 1 row
--   D  poster POST group_job_helpers {job_id, helper_id: <anyone>}                   -> 201, 1 row
-- None of these goes through accept_application / accept_group_application /
-- respond_to_direct_offer, so none of their checks runs: no application (no
-- consent), no are_users_blocked (Q345), no row lock. The only things standing
-- were the Stripe/IDV award gates and the funded-before-award gate.
--
-- WHY IT WAS OPEN. authenticated holds column UPDATE on jobs.helper_id /
-- status / offered_to_helper_id and INSERT/UPDATE on group_job_helpers; the
-- policies "Customers can update their own jobs" and "Targeted helper can
-- respond to direct offer" have no WITH CHECK; enforce_poster_jobs_money_lock
-- and prevent_job_field_escalation both deliberately allow helper_id NULL->X
-- on an open job (that carve-out exists for the RPCs, but the triggers cannot
-- tell an RPC from a PATCH by auth.uid()); enforce_job_status_transition allows
-- open->accepted for anyone.
--
-- THE FIX. One trigger per table that refuses a hire-shaped write when it comes
-- straight from a client. "Straight from a client" is `current_user` being the
-- PostgREST request role (authenticated / anon): this function is SECURITY
-- INVOKER, so inside a SECURITY DEFINER RPC current_user is the RPC's owner
-- (postgres: every live function that UPDATEs jobs and writes helper_id,
-- offered_to_helper_id or status='accepted' — 18 matched in pg_proc on
-- 2026-09-24 — is SECURITY DEFINER owned by postgres), and edge functions /
-- cron run as service_role / postgres. Same
-- test enforce_group_member_lifecycle_server_owned (20260919192559) already uses.
--
-- Refused from a client:
--   jobs:  helper_id newly set to a non-NULL value (clearing it stays allowed:
--          that is un-assignment, not a hire); status newly 'accepted';
--          offered_to_helper_id newly set to a non-NULL value (an offer is born
--          only at INSERT, where "Customers can create jobs" checks blocks;
--          withdrawing it by clearing stays allowed).
--   group_job_helpers: any INSERT; an UPDATE that changes helper_id.
-- Not changed: INSERT on jobs (trg_jobs_insert_column_lock already forces
-- status='open', helper_id=NULL on every self-insert), the RPCs, the policies.
--
-- The one client writer this breaks is the dormant PGRST202 fallback in
-- useOfferHandlers.confirmAcceptWithDeadline (direct UPDATE status=accepted,
-- helper_id=...), removed in the same commit: accept_application is live, so
-- that branch never ran, and it was itself a hire with no RPC checks.
--
-- Replay-safe: CREATE OR REPLACE + DROP TRIGGER IF EXISTS; grants restated.

CREATE OR REPLACE FUNCTION public.enforce_hire_columns_rpc_only()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $fn$
BEGIN
  -- A definer RPC (current_user = its owner), service_role, or postgres.
  IF current_user::text NOT IN ('authenticated', 'anon') THEN
    RETURN NEW;
  END IF;

  IF TG_TABLE_NAME = 'jobs' THEN
    IF NEW.helper_id IS NOT NULL AND NEW.helper_id IS DISTINCT FROM OLD.helper_id THEN
      RAISE EXCEPTION 'hire_requires_rpc: jobs.helper_id is set only by the hire flow (job_id=%)', OLD.id
        USING ERRCODE = '42501',
              HINT = 'Use accept_application, accept_group_application or respond_to_direct_offer.';
    END IF;
    IF NEW.status::text = 'accepted' AND OLD.status::text IS DISTINCT FROM 'accepted' THEN
      RAISE EXCEPTION 'hire_requires_rpc: jobs.status becomes accepted only through the hire flow (job_id=%)', OLD.id
        USING ERRCODE = '42501',
              HINT = 'Use accept_application, accept_group_application or respond_to_direct_offer.';
    END IF;
    IF NEW.offered_to_helper_id IS NOT NULL
       AND NEW.offered_to_helper_id IS DISTINCT FROM OLD.offered_to_helper_id THEN
      RAISE EXCEPTION 'hire_requires_rpc: jobs.offered_to_helper_id is set only when the job is posted (job_id=%)', OLD.id
        USING ERRCODE = '42501',
              HINT = 'A direct offer is made at post time; post a new job to offer it to someone else.';
    END IF;
    RETURN NEW;
  END IF;

  -- group_job_helpers
  IF TG_OP = 'INSERT' THEN
    RAISE EXCEPTION 'hire_requires_rpc: a crew member is added only by accept_group_application (job_id=%)', NEW.job_id
      USING ERRCODE = '42501';
  END IF;
  IF NEW.helper_id IS DISTINCT FROM OLD.helper_id THEN
    RAISE EXCEPTION 'hire_requires_rpc: group_job_helpers.helper_id cannot be re-pointed (job_id=%)', OLD.job_id
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$fn$;

DROP TRIGGER IF EXISTS trg_hire_columns_rpc_only ON public.jobs;
CREATE TRIGGER trg_hire_columns_rpc_only
  BEFORE UPDATE ON public.jobs
  FOR EACH ROW EXECUTE FUNCTION public.enforce_hire_columns_rpc_only();

DROP TRIGGER IF EXISTS trg_hire_columns_rpc_only ON public.group_job_helpers;
CREATE TRIGGER trg_hire_columns_rpc_only
  BEFORE INSERT OR UPDATE ON public.group_job_helpers
  FOR EACH ROW EXECUTE FUNCTION public.enforce_hire_columns_rpc_only();

REVOKE ALL ON FUNCTION public.enforce_hire_columns_rpc_only() FROM PUBLIC, anon;
