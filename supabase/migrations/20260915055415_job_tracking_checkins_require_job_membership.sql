-- job_tracking / job_checkins writes only checked "am I who I say I am?",
-- never "am I on this job?" — a live-location spoof surface.
--
-- SYMPTOM (hole hunt authz AUTHZ-01 / AUTHZ-03, 2026-09-15).
--
--   job_tracking (AUTHZ-01, live): the INSERT/UPDATE policies
--   (20260311041556) are WITH CHECK (auth.uid() = helper_id) — they bind the
--   row's helper_id to the caller, but never check the caller is the job's
--   ASSIGNED helper. Any authenticated user M can read an open job's id from
--   open_jobs_browse, then POST /rest/v1/job_tracking with
--   { job_id: <that job>, helper_id: <M's own id>, status, latitude,
--   longitude, eta_minutes }: the CHECK passes. There is no
--   UNIQUE(job_id, helper_id), so M's row co-exists with the real helper's
--   and, being newest, is the row the poster's tracking card / map renders
--   (useActivityData.ts fetchTracking and JobTracking.tsx loadTracking both
--   take the latest row per job_id with no assigned-helper filter). The
--   poster is shown a false live location and ETA for their helper —
--   directly undermining the on-the-way / arrival safety feature.
--
--   job_checkins (AUTHZ-03, latent): INSERT policy (20260311040450) is
--   WITH CHECK (auth.uid() = user_id) with a party-scoped SELECT — same
--   shape, no membership check. Impact is nil TODAY because the table has no
--   reader or writer anywhere in src/ or supabase/functions (confirmed by
--   grep 2026-09-15; useActivityData.ts and arrivalGate.ts document that
--   nothing has ever inserted a job_checkins row). We GUARD rather than drop
--   it: it is still wired into the account-deletion purge RPC
--   (purge_user_account DELETEs FROM public.job_checkins,
--   20260913051340), the realtime authorization policy's job_checkins: topic
--   pattern, an FK index (idx_job_checkins_user_id, 20260907071400) and the
--   generated src/integrations/supabase/types.ts — a clean drop would ripple
--   into all of those and require regenerating types.ts. Guarding closes the
--   pre-wired spoofing surface with zero blast radius, so any future
--   consumer inherits the membership check for free.
--
-- FIX. Bind each write to job membership, matching the shape the legit
-- helper_mark_on_the_way RPC (20260829061546) already enforces
-- (auth.uid() = jobs.helper_id):
--
--   job_tracking INSERT/UPDATE: caller must be the row's helper_id AND the
--   job's assigned helper (jobs.helper_id = auth.uid()).
--   job_checkins  INSERT:       caller must be the row's user_id AND a party
--   to the job (poster or assigned helper) — check-ins are a two-party
--   safety feature, so either party may write their own.
--
-- The legit client insert (JobTracking.tsx:1132, helper_id = the assigned
-- helper) and the RPC path both continue to pass. SELECT policies are left
-- unchanged.
--
-- REPLAY-SAFETY: guarded on to_regclass so a from-scratch rebuild is a no-op
-- until each table exists (both date to the 2026-03-11 initial schema, well
-- before this file); DROP POLICY IF EXISTS before CREATE so a re-run never
-- fails on "already exists".
DO $$
BEGIN
  IF to_regclass('public.job_tracking') IS NOT NULL THEN
    DROP POLICY IF EXISTS "Helpers can insert tracking" ON public.job_tracking;
    CREATE POLICY "Helpers can insert tracking"
      ON public.job_tracking
      FOR INSERT
      WITH CHECK (
        auth.uid() = helper_id
        AND EXISTS (
          SELECT 1 FROM public.jobs j
          WHERE j.id = job_tracking.job_id
            AND j.helper_id = auth.uid()
        )
      );

    DROP POLICY IF EXISTS "Helpers can update their tracking" ON public.job_tracking;
    CREATE POLICY "Helpers can update their tracking"
      ON public.job_tracking
      FOR UPDATE
      USING (
        auth.uid() = helper_id
        AND EXISTS (
          SELECT 1 FROM public.jobs j
          WHERE j.id = job_tracking.job_id
            AND j.helper_id = auth.uid()
        )
      )
      WITH CHECK (
        auth.uid() = helper_id
        AND EXISTS (
          SELECT 1 FROM public.jobs j
          WHERE j.id = job_tracking.job_id
            AND j.helper_id = auth.uid()
        )
      );
  END IF;

  IF to_regclass('public.job_checkins') IS NOT NULL THEN
    DROP POLICY IF EXISTS "Users can create their own checkins" ON public.job_checkins;
    CREATE POLICY "Users can create their own checkins"
      ON public.job_checkins
      FOR INSERT
      WITH CHECK (
        auth.uid() = user_id
        AND EXISTS (
          SELECT 1 FROM public.jobs j
          WHERE j.id = job_checkins.job_id
            AND (j.customer_id = auth.uid() OR j.helper_id = auth.uid())
        )
      );
  END IF;
END $$;
