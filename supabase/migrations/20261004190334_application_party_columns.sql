-- Q1234 (docs/OPEN.md): applications column ownership was not enforced; each
-- party could write the other's fields.
--
-- Read live 2026-10-04: lock_applications_owner_columns pins only helper_id
-- and job_id; anon and authenticated held table-level UPDATE (relacl arwdxm);
-- "Helpers can update their own pending applications" let the applicant set
-- the poster's offer_message, decline_reason, poster_viewed_at, closed_reason
-- and stake_*, and "Job owners can update application status" let the poster
-- rewrite the applicant's message, attachment_urls, stake_* and flag_*.
-- (The INSERT half closed with Q1009: no client INSERTs an application.)
--
-- Every server writer of applications, read from pg_proc on 2026-10-04 by
-- body (prosrc ~ 'update applications'), is SECURITY DEFINER: the accept RPCs
-- (offer_message, status), mark_applications_viewed (poster_viewed_at), the
-- cancel/block/ban/expiry sweeps (status, closed_reason). The client's own
-- UPDATEs (write-contract AST, pinned two-way by
-- scripts/ci/client-insert-columns.sql):
--   the applicant  message, attachment_urls   (AppliedJobsTab.tsx, useApplyFlow.ts)
--   the poster     status, decline_reason     (useOfferHandlers.ts decline)
--
-- Fix, two layers:
--   1. Grants: table-level UPDATE goes (anon keeps none); authenticated gets
--      back exactly those four columns.
--   2. enforce_application_party_columns, BEFORE UPDATE for a client seat
--      (current_user is the PostgREST role, the Q346 test; SECURITY INVOKER so
--      the definer RPCs and the service role pass): message and
--      attachment_urls are the applicant's; status and decline_reason are the
--      job poster's, and the poster's only status move is pending ->
--      rejected (an accept goes through accept_application); decline_reason
--      is written only in that same move.
--
-- Replay-safe: REVOKE/GRANT are idempotent; CREATE OR REPLACE; DROP TRIGGER IF EXISTS.

REVOKE UPDATE ON public.applications FROM PUBLIC, anon, authenticated;
GRANT UPDATE (status, decline_reason, message, attachment_urls) ON public.applications TO authenticated;

CREATE OR REPLACE FUNCTION public.enforce_application_party_columns()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $fn$
DECLARE
  v_uid uuid := auth.uid();
BEGIN
  -- A definer RPC (current_user = its owner), service_role, or postgres.
  IF current_user::text NOT IN ('authenticated', 'anon') THEN
    RETURN NEW;
  END IF;

  -- The applicant's own words and files.
  IF (NEW.message IS DISTINCT FROM OLD.message OR NEW.attachment_urls IS DISTINCT FROM OLD.attachment_urls)
     AND (v_uid IS NULL OR v_uid IS DISTINCT FROM OLD.helper_id) THEN
    RAISE EXCEPTION 'application_applicant_only: only the applicant edits their message and attachments (application_id=%)', OLD.id
      USING ERRCODE = '42501';
  END IF;

  -- The poster's answer. get_job_customer_id is SECURITY DEFINER: the
  -- applicant cannot read the job row's owner through RLS.
  IF NEW.status IS DISTINCT FROM OLD.status OR NEW.decline_reason IS DISTINCT FROM OLD.decline_reason THEN
    IF v_uid IS NULL OR v_uid IS DISTINCT FROM public.get_job_customer_id(OLD.job_id) THEN
      RAISE EXCEPTION 'application_poster_only: only the person who posted the job answers an application (application_id=%)', OLD.id
        USING ERRCODE = '42501';
    END IF;
    IF NEW.status IS DISTINCT FROM OLD.status
       AND NOT (OLD.status::text = 'pending' AND NEW.status::text = 'rejected') THEN
      RAISE EXCEPTION 'application_status_via_rpc: an application is declined here, accepted only through accept_application (application_id=%)', OLD.id
        USING ERRCODE = '42501';
    END IF;
    -- The reason rides with the decline, and only with it (useOfferHandlers
    -- sends them in one write): it is not rewritten after the fact
    -- (lh-authz-rls review, 2026-10-04).
    IF NEW.decline_reason IS DISTINCT FROM OLD.decline_reason
       AND NOT (OLD.status::text = 'pending' AND NEW.status::text = 'rejected') THEN
      RAISE EXCEPTION 'application_decline_reason_with_decline: a decline reason is written only with the decline (application_id=%)', OLD.id
        USING ERRCODE = '42501';
    END IF;
  END IF;

  RETURN NEW;
END;
$fn$;

REVOKE ALL ON FUNCTION public.enforce_application_party_columns() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_application_party_columns ON public.applications;
CREATE TRIGGER trg_application_party_columns
  BEFORE UPDATE ON public.applications
  FOR EACH ROW EXECUTE FUNCTION public.enforce_application_party_columns();
