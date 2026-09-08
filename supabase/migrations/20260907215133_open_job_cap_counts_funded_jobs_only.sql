-- The 5-open-job cap counted jobs nobody could see.
--
-- `enforce_open_job_limit()` is a BEFORE INSERT trigger on `jobs` that refuses
-- a sixth `open` job. It already skipped `payment_status = 'abandoned'`
-- (20260831010000, preserved through 20260901030422 and 20260904031217), but
-- it still counted `'unpaid'` — the column DEFAULT, i.e. a job row that was
-- inserted and whose checkout never started.
--
-- WHY THAT IS WRONG. `open_jobs_browse` admits a job only when
-- `payment_status = ANY (ARRAY['escrow','payout_pending','released'])`, and
-- every other browse surface agrees. An `open`/`unpaid` job is therefore
-- invisible to every account except the poster's own: it holds no applicant's
-- attention, occupies no slot in any feed, and costs the marketplace nothing.
-- Counting it toward the cap meant a poster who started the wizard five times
-- and never reached checkout was told they had hit their limit — a refusal for
-- a resource they were not consuming, with no screen anywhere telling them
-- which five jobs were to blame.
--
-- THE PREDICATE IS AN ALLOW-LIST OF THINGS THAT DON'T COUNT, matching
-- 20260903034507's delete gate verbatim. Those are the only two values that
-- mean money was never taken:
--
--     'unpaid'     the column default; checkout never started
--     'abandoned'  checkout started and did not complete
--
-- Anything else — escrow, payout_pending, released, refunded, disputed,
-- cancelled — still counts exactly as it did before. Notably this migration
-- does NOT relax the cap for funded jobs, which is the case the cap exists for.
--
-- MEASURED AGAINST PROD BEFORE WRITING THIS: zero rows are currently
-- `open`/`unpaid`, so this changes no existing account's count today. It closes
-- the state, not a backlog.
--
-- Replay-safe: CREATE OR REPLACE only, no DDL that depends on object absence.
-- The trigger binding from 20260325045540 is untouched and is not re-created.

CREATE OR REPLACE FUNCTION public.enforce_open_job_limit()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  open_count integer;
BEGIN
  -- Skip counting ONLY for a non-self insert (service_role recurring-series
  -- creation, or an admin/impersonation path where the caller is not the
  -- job's own customer_id). A self-insert always gets counted, no matter
  -- what status it names, because trg_jobs_insert_column_lock forces every
  -- self-inserted row to 'open' regardless — so the cap must judge the value
  -- the row will actually land as, not the value the client sent.
  IF NEW.status IS DISTINCT FROM 'open'
     AND NOT (auth.uid() IS NOT NULL AND auth.uid() = NEW.customer_id) THEN
    RETURN NEW;
  END IF;

  SELECT count(*) INTO open_count
  FROM public.jobs
  WHERE customer_id = NEW.customer_id
    AND status = 'open'
    -- Unfunded jobs are invisible in every browse surface, so they consume
    -- nothing and must not consume a slot in the cap either.
    AND COALESCE(payment_status, '') NOT IN ('unpaid', 'abandoned');

  IF open_count >= 5 THEN
    RAISE EXCEPTION 'You can have a maximum of 5 open jobs at a time. Please wait for existing jobs to be accepted or close them first.';
  END IF;
  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.enforce_open_job_limit() FROM PUBLIC, anon;
