-- Supabase PERFORMANCE advisor, multiple_permissive_policies (docs/OPEN.md
-- Q1321). Measured with get_advisors (performance) on 2026-10-12 19:32Z:
-- 46 findings. Two tables carry overlapping permissive policies that change
-- nothing about who may read or write; folding them removes 14 findings and
-- leaves every permission exactly as it was.
--
-- 1. verification_exceptions: "Admins manage exceptions" (FOR ALL TO public,
--    USING auth.role() = 'service_role') can never admit anyone. service_role
--    has BYPASSRLS (pg_roles, read 2026-10-12), so its requests never evaluate
--    a policy, and no other role carries a service_role JWT. Admins keep
--    "Admins can manage verification exceptions" (has_role admin) and users
--    keep "Users see own exceptions". 8 findings (INSERT/UPDATE/DELETE for
--    authenticated, SELECT for five other roles).
--
-- 2. job_pets: "Poster manages the pets on their job" (FOR ALL) and "Assigned
--    helper reads the pets on their job" (FOR SELECT) overlapped on SELECT for
--    every role. Restated as ONE read policy (the poster OR the assigned
--    helper, both conditions verbatim) and the poster's writes split per
--    command with the original USING / WITH CHECK, so each command admits
--    exactly whom it did. 6 findings.
--
-- Replay-safe: DROP POLICY IF EXISTS / CREATE POLICY; the tables exist from
-- 20260612220000 and 20260823160000.

DROP POLICY IF EXISTS "Admins manage exceptions" ON public.verification_exceptions;

DROP POLICY IF EXISTS "Poster manages the pets on their job" ON public.job_pets;
DROP POLICY IF EXISTS "Assigned helper reads the pets on their job" ON public.job_pets;
DROP POLICY IF EXISTS "Poster or assigned helper reads the pets on a job" ON public.job_pets;
DROP POLICY IF EXISTS "Poster attaches pets to their job" ON public.job_pets;
DROP POLICY IF EXISTS "Poster updates the pets on their job" ON public.job_pets;
DROP POLICY IF EXISTS "Poster detaches pets from their job" ON public.job_pets;

-- Read: the poster (who owns the list) or the ASSIGNED helper. Applicants may
-- not: a pet list is care detail for whoever is doing the job.
CREATE POLICY "Poster or assigned helper reads the pets on a job"
  ON public.job_pets
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.jobs j
       WHERE j.id = job_pets.job_id
         AND j.customer_id = (SELECT auth.uid())
    )
    OR EXISTS (
      SELECT 1 FROM public.jobs j
       WHERE j.id = job_pets.job_id
         AND j.helper_id = (SELECT auth.uid())
    )
  );

-- Attach: only to your own job, and only a pet you own.
CREATE POLICY "Poster attaches pets to their job"
  ON public.job_pets
  FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.jobs j
       WHERE j.id = job_pets.job_id
         AND j.customer_id = (SELECT auth.uid())
    )
    AND EXISTS (
      SELECT 1 FROM public.pet_profiles p
       WHERE p.id = job_pets.pet_id
         AND p.owner_id = (SELECT auth.uid())
    )
  );

CREATE POLICY "Poster updates the pets on their job"
  ON public.job_pets
  FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM public.jobs j
       WHERE j.id = job_pets.job_id
         AND j.customer_id = (SELECT auth.uid())
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.jobs j
       WHERE j.id = job_pets.job_id
         AND j.customer_id = (SELECT auth.uid())
    )
    AND EXISTS (
      SELECT 1 FROM public.pet_profiles p
       WHERE p.id = job_pets.pet_id
         AND p.owner_id = (SELECT auth.uid())
    )
  );

CREATE POLICY "Poster detaches pets from their job"
  ON public.job_pets
  FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM public.jobs j
       WHERE j.id = job_pets.job_id
         AND j.customer_id = (SELECT auth.uid())
    )
  );
