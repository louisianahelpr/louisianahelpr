-- Add RLS policy: applicants can SELECT jobs they've applied to,
-- as long as the job is still open. Closes a real UX bug:
--
-- AppliedJobsTab queries `from("jobs").select("*").in("id", jobIds)`
-- using job_ids from the user's applications. Until now, RLS only
-- allowed customers and accepted helpers to read the jobs table.
-- Helpers with pending applications got zero rows back, and their
-- "My Jobs" cards rendered with placeholder "Task" titles + no
-- details (job.location, job.budget, etc. were all undefined).
--
-- Privacy reasoning:
--   - Job is still 'open' → no other helper has been chosen yet, so
--     the applicant has a legitimate need to see job details
--     (location, budget, dates) while their application is in flight.
--   - Once the job leaves 'open' (accepted by another / cancelled /
--     expired), the applicant loses access. They see only their
--     application's status field on the applications row, not the
--     job row that's now another helper's job.
--   - This matches the existing 'open_jobs_browse' view's contract
--     (anonymous + authenticated users see open jobs in the browse
--     surface; accepted helpers see the full row).
--
-- Compared to the dropped "Authenticated users can view open jobs"
-- policy: this is narrower — only applicants of THIS specific job,
-- not all authenticated users.

CREATE POLICY "Applicants can view their pending applied jobs"
ON public.jobs
FOR SELECT
TO authenticated
USING (
  status = 'open'
  AND EXISTS (
    SELECT 1 FROM public.applications a
    WHERE a.job_id = jobs.id
      AND a.helper_id = (SELECT auth.uid())
  )
);
