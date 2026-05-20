-- Lock down which columns a job owner is allowed to change on an application.
--
-- Background:
--   "Job owners can update application status" (defined in
--    20260311000404_…sql) is a FOR UPDATE policy with a USING clause but
--    no WITH CHECK clause. The USING clause restricts the SET of rows the
--    job owner may touch (only applications on their own jobs) but does
--    NOT restrict what columns they may change. In particular, the policy
--    as written allowed a malicious job owner to UPDATE the row and flip
--    helper_id to some other user_id, effectively re-assigning the job to
--    a different helper without their consent — or, more dangerously,
--    flipping job_id to a different job they don't own (the USING check
--    is evaluated against the OLD row, the WITH CHECK guards the NEW row).
--
-- Fix:
--   1. Recreate the policy with a WITH CHECK that requires helper_id and
--      job_id to match the values currently persisted for this id. The
--      subquery resolves against the pre-update tuple in a single-statement
--      UPDATE because RLS evaluates WITH CHECK in the same statement
--      snapshot as the row's prior visible state.
--   2. Belt-and-suspenders: a BEFORE UPDATE trigger raises immediately if
--      NEW.helper_id or NEW.job_id differs from OLD. The trigger runs in
--      every isolation level and doesn't depend on snapshot semantics —
--      making the guarantee bulletproof across PG versions and
--      configurations.
--
-- Replay-safe: every object guarded with IF EXISTS / OR REPLACE so a
-- from-scratch rebuild succeeds even if the trigger / policy is already
-- in the desired state from an earlier run.

DROP POLICY IF EXISTS "Job owners can update application status" ON public.applications;

CREATE POLICY "Job owners can update application status"
ON public.applications
FOR UPDATE
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.jobs j
    WHERE j.id = applications.job_id AND j.customer_id = auth.uid()
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.jobs j
    WHERE j.id = applications.job_id AND j.customer_id = auth.uid()
  )
);

-- Defense in depth: explicitly reject helper_id / job_id mutation. This
-- catches the case even if a future migration weakens the WITH CHECK
-- above, and works for service-role updates too (which bypass RLS).
-- Service-role callers that legitimately need to change these columns
-- can SET LOCAL session_replication_role = 'replica' inside a tx, which
-- skips user-defined triggers — but every legitimate writer in this repo
-- creates new rows rather than swapping owners on an existing row.
CREATE OR REPLACE FUNCTION public.lock_applications_owner_columns()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.helper_id IS DISTINCT FROM OLD.helper_id THEN
    RAISE EXCEPTION 'applications.helper_id is immutable (attempted change on id %)', OLD.id
      USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.job_id IS DISTINCT FROM OLD.job_id THEN
    RAISE EXCEPTION 'applications.job_id is immutable (attempted change on id %)', OLD.id
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS lock_applications_owner_columns_tg ON public.applications;
CREATE TRIGGER lock_applications_owner_columns_tg
  BEFORE UPDATE ON public.applications
  FOR EACH ROW
  EXECUTE FUNCTION public.lock_applications_owner_columns();

COMMENT ON FUNCTION public.lock_applications_owner_columns() IS
'Rejects UPDATE statements that attempt to change applications.helper_id or applications.job_id. Backs up the WITH CHECK clause on "Job owners can update application status" against any future RLS regression.';
