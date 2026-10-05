-- Q1231 (docs/OPEN.md): a job party could forge job_revisions.requested_by or
-- rewrite the poster's revision request.
--
-- Read live 2026-10-04: one policy, "Job parties can manage revisions" (FOR
-- ALL TO authenticated), admits the requester, the job's poster AND the job's
-- Helpr in both USING and WITH CHECK; anon and authenticated hold table-level
-- INSERT/UPDATE/DELETE (relacl arwdxm); the only triggers are the ban gate and
-- the email gate. So the Helpr could INSERT a "revision request" in the
-- poster's name (requested_by = the poster), or UPDATE the poster's
-- description and photos. 0 rows live; no SQL function writes the table.
--
-- The client's own writes (write-contract AST, two-way pinned by
-- scripts/ci/client-insert-columns.sql):
--   INSERT  CompletionChoiceSheet.tsx  job_id, requested_by, description, photos, status  (the poster)
--   UPDATE  HelperRevisionCard.tsx     status                                             (the Helpr)
--
-- Fix, two layers:
--   1. Grants: table-level INSERT/UPDATE go; authenticated gets back exactly
--      those columns; anon gets nothing on the table.
--   2. A BEFORE INSERT OR UPDATE trigger for a client seat (current_user is
--      the PostgREST role, the Q346 test; SECURITY INVOKER so a definer RPC or
--      the service role passes): on INSERT requested_by := auth.uid(), the
--      caller must be the job's poster, and the row is born pending with no
--      Helpr answer; on UPDATE requested_by, job_id, description, photos and
--      created_at never change, and only the job's Helpr may move status,
--      once, from pending to accepted or rejected.
--   3. No client DELETE (no client deletes a revision request).
--
-- Replay-safe: REVOKE/GRANT are idempotent; CREATE OR REPLACE; DROP TRIGGER IF EXISTS.

REVOKE ALL ON public.job_revisions FROM PUBLIC, anon;
REVOKE INSERT, UPDATE ON public.job_revisions FROM authenticated;
-- No client deletes a revision request (write-contract AST: no
-- .from("job_revisions").delete()); with DELETE granted, the FOR ALL policy
-- let the Helpr delete the poster's request and its evidence outright
-- (lh-authz-rls review, 2026-10-04; folded into Q1231). The purge, the seed cleanup
-- and the job's ON DELETE CASCADE run as the server.
REVOKE DELETE ON public.job_revisions FROM PUBLIC, anon, authenticated;
GRANT INSERT (job_id, requested_by, description, photos, status) ON public.job_revisions TO authenticated;
GRANT UPDATE (status) ON public.job_revisions TO authenticated;

CREATE OR REPLACE FUNCTION public.enforce_job_revision_party_columns()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $fn$
DECLARE
  v_uid    uuid := auth.uid();
  v_poster uuid;
  v_helpr  uuid;
BEGIN
  -- A definer RPC (current_user = its owner), service_role, or postgres.
  IF current_user::text NOT IN ('authenticated', 'anon') THEN
    RETURN NEW;
  END IF;

  -- Read through the caller's own RLS: a party sees their job, a stranger does
  -- not. FOR SHARE: a hire or unassign landing mid-write cannot change who
  -- the Helpr is between this read and the write it decides (race-class).
  SELECT j.customer_id, j.helper_id INTO v_poster, v_helpr
    FROM public.jobs j WHERE j.id = NEW.job_id
    FOR SHARE;

  IF TG_OP = 'INSERT' THEN
    IF v_uid IS NULL OR v_poster IS DISTINCT FROM v_uid THEN
      RAISE EXCEPTION 'revision_poster_only: only the person who posted the job can ask for a revision (job_id=%)', NEW.job_id
        USING ERRCODE = '42501';
    END IF;
    NEW.requested_by    := v_uid;
    NEW.status          := 'pending';
    NEW.helper_response := NULL;
    NEW.resolved_at     := NULL;
    NEW.created_at      := now();
    RETURN NEW;
  END IF;

  IF NEW.requested_by IS DISTINCT FROM OLD.requested_by
     OR NEW.job_id IS DISTINCT FROM OLD.job_id
     OR NEW.description IS DISTINCT FROM OLD.description
     OR NEW.photos IS DISTINCT FROM OLD.photos
     OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'revision_request_immutable: a revision request is not rewritten once sent (revision_id=%)', OLD.id
      USING ERRCODE = '42501';
  END IF;
  IF (NEW.status IS DISTINCT FROM OLD.status OR NEW.helper_response IS DISTINCT FROM OLD.helper_response
      OR NEW.resolved_at IS DISTINCT FROM OLD.resolved_at)
     AND (v_uid IS NULL OR v_helpr IS DISTINCT FROM v_uid) THEN
    RAISE EXCEPTION 'revision_helpr_answers: only the Helpr on the job answers a revision request (revision_id=%)', OLD.id
      USING ERRCODE = '42501';
  END IF;
  -- The Helpr's answer is one move out of pending (HelperRevisionCard sends
  -- 'accepted'); an answered request is not re-opened or re-answered by hand
  -- (lh-authz-rls review, 2026-10-04).
  IF NEW.status IS DISTINCT FROM OLD.status
     AND NOT (OLD.status = 'pending' AND NEW.status IN ('accepted', 'rejected')) THEN
    RAISE EXCEPTION 'revision_answer_once: a revision request is answered once, from pending (revision_id=%)', OLD.id
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$fn$;

REVOKE ALL ON FUNCTION public.enforce_job_revision_party_columns() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_job_revision_party_columns ON public.job_revisions;
CREATE TRIGGER trg_job_revision_party_columns
  BEFORE INSERT OR UPDATE ON public.job_revisions
  FOR EACH ROW EXECUTE FUNCTION public.enforce_job_revision_party_columns();
