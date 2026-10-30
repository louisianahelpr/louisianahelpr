-- Q1755: a test account is never put on a REAL job.
--
-- On 2026-10-09 the shared test Helpr applied to the owner's real job. A test
-- account pays and is paid on the Stripe TEST key, so a real job that pairs it
-- with a real account can never be paid out (create-payment answers 409, a
-- payout refuses as mixed_parties) and has to be refunded by hand.
-- enforce_application_job_state's rule C6 only stops the reverse (a real
-- member applying to a hidden seed job); nothing stopped a test account
-- applying to, being offered, or being hired on a real job.
--
-- This refuses, at every write that puts a member on a job:
--   * applications INSERT                      (apply_to_job and any insert path)
--   * jobs INSERT/UPDATE of helper_id          (every single hire: accept_application,
--                                               accept_application_at_suggested_time,
--                                               accept_job_offer, respond_to_direct_offer,
--                                               quote_job_funded_hires_quoter, ...)
--   * jobs INSERT/UPDATE of offered_to_helper_id (a direct offer)
--   * group_job_helpers INSERT/UPDATE of helper_id (a crew spot)
-- when that member is a test account (public.test_accounts) and the job is not
-- a test job (jobs.is_seed false). A test account's own jobs are marked is_seed
-- by trg_jobs_insert_column_lock / trg_jobs_seed_from_poster; this trigger's
-- name sorts after both, so on INSERT it reads the final is_seed.
--
-- Measured on prod 2026-10-30 (read-only): 63 test_accounts, all with an
-- is_seed profile; 461 jobs posted by test accounts, all is_seed; 0
-- applications, 0 hires and 0 direct offers pairing a test account with a
-- non-seed job. So nothing that exists today is refused.
--
-- Only rows whose member column CHANGES are checked, so an existing row is
-- never blocked from unrelated updates. A real member on a seed job keeps
-- today's rule (C6, only while the launch switch hides seed jobs).

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

DROP TRIGGER IF EXISTS trg_applications_test_account_off_real_jobs ON public.applications;
CREATE TRIGGER trg_applications_test_account_off_real_jobs
  BEFORE INSERT OR UPDATE OF helper_id, job_id ON public.applications
  FOR EACH ROW EXECUTE FUNCTION public.enforce_test_account_off_real_jobs();

DROP TRIGGER IF EXISTS trg_jobs_test_account_off_real_jobs ON public.jobs;
CREATE TRIGGER trg_jobs_test_account_off_real_jobs
  BEFORE INSERT OR UPDATE OF helper_id, offered_to_helper_id ON public.jobs
  FOR EACH ROW EXECUTE FUNCTION public.enforce_test_account_off_real_jobs();

DROP TRIGGER IF EXISTS trg_group_job_helpers_test_account_off_real_jobs ON public.group_job_helpers;
CREATE TRIGGER trg_group_job_helpers_test_account_off_real_jobs
  BEFORE INSERT OR UPDATE OF helper_id, job_id ON public.group_job_helpers
  FOR EACH ROW EXECUTE FUNCTION public.enforce_test_account_off_real_jobs();
