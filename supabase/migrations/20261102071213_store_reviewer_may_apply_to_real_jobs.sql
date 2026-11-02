-- Q1755 follow-up (lead 2026-11-02): the App Store / Play review account may
-- apply to a real job.
--
-- 20261030063902 refuses any public.test_accounts member on a real
-- (is_seed false) job. The review account is a test account (isolation:
-- Stripe TEST key, out of stats), and since 20261101160649 it sees no seed
-- jobs, so every Apply it tried was refused. A public.store_review_accounts
-- member is now let through on applications INSERT only, as ID checks exempt
-- it. A hire (jobs.helper_id), a direct offer (jobs.offered_to_helper_id) and
-- a crew spot (group_job_helpers) stay refused: a real poster's payment to a
-- test account is refused by create-payment anyway (mixed test/live parties).
--
-- Restated from the newest CREATE (20261030063902) with only that clause
-- added; triggers unchanged. Replay-safe (CREATE OR REPLACE; grants by name).

CREATE OR REPLACE FUNCTION public.enforce_test_account_off_real_jobs()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  v_member uuid;
  v_job_id uuid;
  v_job_is_seed boolean;
BEGIN
  IF TG_TABLE_NAME = 'jobs' THEN
    v_job_id := NEW.id;
    v_job_is_seed := NEW.is_seed;
    IF NEW.helper_id IS NOT NULL
       AND (TG_OP = 'INSERT' OR NEW.helper_id IS DISTINCT FROM OLD.helper_id)
       AND NOT v_job_is_seed
       AND EXISTS (SELECT 1 FROM public.test_accounts t WHERE t.user_id = NEW.helper_id) THEN
      RAISE EXCEPTION 'test_account_real_job: a test account cannot be hired on a real job (Q1755)'
        USING ERRCODE = '42501', HINT = 'Test accounts work only on test (is_seed) jobs.';
    END IF;
    IF NEW.offered_to_helper_id IS NOT NULL
       AND (TG_OP = 'INSERT' OR NEW.offered_to_helper_id IS DISTINCT FROM OLD.offered_to_helper_id)
       AND NOT v_job_is_seed
       AND EXISTS (SELECT 1 FROM public.test_accounts t WHERE t.user_id = NEW.offered_to_helper_id) THEN
      RAISE EXCEPTION 'test_account_real_job: a test account cannot be offered a real job (Q1755)'
        USING ERRCODE = '42501', HINT = 'Test accounts work only on test (is_seed) jobs.';
    END IF;
    RETURN NEW;
  END IF;

  -- applications / group_job_helpers: the member is helper_id, the job is job_id.
  v_member := NEW.helper_id;
  IF v_member IS NULL THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE'
     AND NEW.helper_id IS NOT DISTINCT FROM OLD.helper_id
     AND NEW.job_id IS NOT DISTINCT FROM OLD.job_id THEN
    RETURN NEW;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.test_accounts t WHERE t.user_id = v_member) THEN
    RETURN NEW;
  END IF;
  -- Q1755 (lead 11-02): the App Review account may APPLY to a real job, the
  -- only kind it sees (20261101160649). Being hired, offered or put in a crew
  -- spot on one stays refused (the jobs and group_job_helpers branches).
  IF TG_TABLE_NAME = 'applications'
     AND EXISTS (SELECT 1 FROM public.store_review_accounts r WHERE r.user_id = v_member) THEN
    RETURN NEW;
  END IF;
  -- FOR SHARE, like enforce_application_job_state's own read of the same row.
  SELECT j.is_seed INTO v_job_is_seed FROM public.jobs j WHERE j.id = NEW.job_id FOR SHARE;
  -- A job that does not exist is the foreign key's to refuse, not this rule's.
  IF v_job_is_seed IS FALSE THEN
    RAISE EXCEPTION 'test_account_real_job: a test account cannot apply to or join a real job (Q1755)'
      USING ERRCODE = '42501', HINT = 'Test accounts work only on test (is_seed) jobs.';
  END IF;
  RETURN NEW;
END;
$fn$;

REVOKE ALL ON FUNCTION public.enforce_test_account_off_real_jobs() FROM PUBLIC, anon, authenticated;
