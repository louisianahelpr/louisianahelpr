-- Atomic helper-side instant-book claim — makes "Book now" actually book.
--
-- Instant Book has been a silent no-op in production since the column shipped
-- (20260612090000). The only write path was a client-side UPDATE in
-- useApplyFlow.ts:
--
--   supabase.from("jobs").update({ helper_id, status: "accepted", ... })
--          .eq("id", jobId)
--
-- Two independent defects there:
--
--   1. RLS silently blocks it. The relevant policy is "Helpers can update their
--      assigned jobs" — USING (auth.uid() = helper_id). At claim time the job is
--      still open and helper_id IS NULL, so the row is invisible to the helper
--      and the UPDATE matches ZERO rows. A zero-row UPDATE is a SUCCESS, not an
--      error, so the surrounding try/catch never fired and nothing was logged.
--   2. Even with permission it was an unguarded read-then-write with no
--      `status = 'open'` predicate and no row lock, so two helpers tapping
--      "Book now" simultaneously would both "win" and the second would silently
--      overwrite helper_id.
--
-- Meanwhile the UI actively promises the behaviour: JobCard renders an
-- "Instant book" badge and JobDetailFooter labels the button "Book now".
--
-- This RPC mirrors accept_application (20260518120000): lock the job FOR UPDATE,
-- re-check every precondition inside the lock, then assign in one transaction.
-- Concurrent callers serialize on the lock; the loser gets a clear error.
CREATE OR REPLACE FUNCTION public.instant_book_claim(p_job_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_status         text;
  v_helper_id      uuid;
  v_instant_book   boolean;
  v_customer_id    uuid;
  v_offered_to     uuid;
BEGIN
  -- Lock the job row — concurrent claims serialize here.
  SELECT j.status, j.helper_id, j.instant_book, j.customer_id, j.offered_to_helper_id
    INTO v_status, v_helper_id, v_instant_book, v_customer_id, v_offered_to
  FROM public.jobs j
  WHERE j.id = p_job_id
  FOR UPDATE;

  IF v_status IS NULL THEN
    RAISE EXCEPTION 'job_not_found';
  END IF;

  -- A poster must never be able to claim their own job as the helper.
  IF v_customer_id = auth.uid() THEN
    RAISE EXCEPTION 'cannot_claim_own_job';
  END IF;

  IF v_instant_book IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'not_instant_book';
  END IF;

  -- Race guard: the second of two concurrent claims lands here.
  IF v_status IS DISTINCT FROM 'open' THEN
    RAISE EXCEPTION 'job_not_open';
  END IF;

  IF v_helper_id IS NOT NULL THEN
    RAISE EXCEPTION 'job_already_claimed';
  END IF;

  -- A targeted direct offer must not leak into the instant-book pool: only the
  -- helper it was offered to may claim it.
  IF v_offered_to IS NOT NULL AND v_offered_to IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'job_is_targeted_offer';
  END IF;

  UPDATE public.jobs
     SET status              = 'accepted',
         helper_id           = auth.uid(),
         helper_confirmed_at = now(),
         response_deadline   = NULL
   WHERE id = p_job_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.instant_book_claim(uuid) TO authenticated;
