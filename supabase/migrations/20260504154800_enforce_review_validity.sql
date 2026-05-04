-- Two-way review enforcement.
--
-- Today public.reviews has a single RLS policy ("auth.uid() = reviewer_id")
-- and a UNIQUE (job_id, reviewer_id). That blocks dup reviews from one
-- person, but doesn't stop:
--   1. Self-reviews (reviewer_id = reviewee_id)
--   2. Reviewing a job you weren't part of
--   3. Reviewing the wrong counterparty (e.g. customer reviews another customer)
--   4. Reviewing before the job is completed
--
-- This trigger validates all four. Runs BEFORE INSERT so invalid reviews
-- never reach the table; raises a check_violation that propagates back to
-- the caller as a 23514. Trigger is SECURITY DEFINER so it can read
-- public.jobs even when RLS would normally hide it from the reviewer.

CREATE OR REPLACE FUNCTION public.enforce_review_validity()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_job RECORD;
BEGIN
  -- 1. No self-reviews.
  IF NEW.reviewer_id = NEW.reviewee_id THEN
    RAISE EXCEPTION 'You cannot review yourself.'
      USING ERRCODE = 'check_violation';
  END IF;

  SELECT customer_id, helper_id, status
    INTO v_job
    FROM public.jobs
    WHERE id = NEW.job_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Job % not found.', NEW.job_id
      USING ERRCODE = 'foreign_key_violation';
  END IF;

  -- 2. Job must be completed.
  IF v_job.status <> 'completed' THEN
    RAISE EXCEPTION 'Reviews can only be left after the job is marked completed.'
      USING ERRCODE = 'check_violation', HINT = 'Current status: ' || v_job.status::text;
  END IF;

  -- 3. Reviewer must be the customer OR the helper of this job.
  IF NEW.reviewer_id NOT IN (v_job.customer_id, v_job.helper_id) THEN
    RAISE EXCEPTION 'Only the job poster or assigned helper can submit a review.'
      USING ERRCODE = 'check_violation';
  END IF;

  -- 4. Reviewee must be the OTHER party (not the reviewer's own side).
  IF NEW.reviewer_id = v_job.customer_id AND NEW.reviewee_id <> v_job.helper_id THEN
    RAISE EXCEPTION 'Customer must review the assigned helper.'
      USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.reviewer_id = v_job.helper_id AND NEW.reviewee_id <> v_job.customer_id THEN
    RAISE EXCEPTION 'Helper must review the customer who hired them.'
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.enforce_review_validity() IS
'Validates reviews on INSERT: no self-review, job must be completed, reviewer must be customer or helper, reviewee must be the counterparty.';

DROP TRIGGER IF EXISTS trg_enforce_review_validity ON public.reviews;
CREATE TRIGGER trg_enforce_review_validity
  BEFORE INSERT ON public.reviews
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_review_validity();
