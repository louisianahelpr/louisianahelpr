-- Poster decides, per job, whether before/after photo proof is required.
--
-- Until now EVERY job demanded before + after photos from the helper, enforced
-- server-side by trg_helper_completion_gates → enforce_helper_completion_gates().
-- That is right for work with a visible result (cleaning, yard work, painting)
-- and meaningless for a delivery or a dog walk, where the helper is blocked
-- from marking the job done by a requirement nobody wanted.
--
-- DEFAULT true, deliberately: every row that exists today was posted under the
-- photos-always rule, and both parties have been told photos are "the proof
-- that releases your payment". Backfilling those to false would retroactively
-- weaken the evidence on live jobs. New posts get a category-derived pre-set
-- from the client, which the poster can override.
--
-- THE GATE MUST LEARN ABOUT THE COLUMN IN THIS SAME MIGRATION. Adding the
-- column without teaching the trigger would ship a toggle that lies: the
-- poster turns photos off, the helper skips them, and completion then raises
-- completion_requires_proof_photos with no explanation.

ALTER TABLE public.jobs
  ADD COLUMN IF NOT EXISTS require_photo_proof boolean NOT NULL DEFAULT true;

COMMENT ON COLUMN public.jobs.require_photo_proof IS
  'Poster-chosen, per job: does the helper have to upload before AND after photos before they can mark the job complete? Read by enforce_helper_completion_gates(). Defaults true — the historic, always-on behaviour.';

-- Re-declare the completion gate with the photo check made conditional.
-- Every other clause (arrival establishment, the 30-minute work floor, the
-- grandfather date) is verbatim from the live definition read out of prod at
-- 2026-09-11 — only the proof-photo block changes.
CREATE OR REPLACE FUNCTION public.enforce_helper_completion_gates()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
BEGIN
  IF auth.uid() IS NULL
     OR auth.uid() IS DISTINCT FROM OLD.helper_id
     OR auth.uid() = OLD.customer_id THEN
    RETURN NEW;
  END IF;

  IF NEW.helper_completed_at IS NOT NULL AND OLD.helper_completed_at IS NULL THEN
    -- ARRIVAL MUST BE ESTABLISHED. Either the server verified the helper was
    -- within 500ft when they marked arrived, or the poster vouched for them.
    -- Grandfathered for jobs that were already underway when this shipped —
    -- those helpers marked arrival under the old rules and must not be
    -- stranded mid-job by a deploy.
    IF OLD.helper_arrival_verified_at IS NULL
       AND OLD.poster_confirmed_arrival_at IS NULL
       AND NOT (OLD.helper_arrived_at IS NOT NULL
                AND OLD.helper_arrived_at < timestamptz '2026-08-28 00:00:00+00') THEN
      RAISE EXCEPTION 'completion_requires_confirmed_arrival'
        USING ERRCODE = '23514',
              HINT = 'Mark arrival at the job site, or ask the poster to confirm you arrived.';
    END IF;

    -- Photo proof is now the POSTER'S call, per job. COALESCE to true so a row
    -- written by a client that predates the column (or by any path that omits
    -- it) still gets the historic always-on behaviour rather than a silent
    -- opt-out. Read off NEW so a poster who turns the requirement off while the
    -- job is in flight releases the helper immediately.
    IF COALESCE(NEW.require_photo_proof, true)
       AND (COALESCE(array_length(NEW.proof_before_urls, 1), 0) = 0
            OR COALESCE(array_length(NEW.proof_after_urls, 1), 0) = 0) THEN
      RAISE EXCEPTION 'completion_requires_proof_photos'
        USING ERRCODE = '23514',
              HINT = 'Add before and after photos before marking the job done.';
    END IF;

    IF COALESCE(OLD.poster_confirmed_working_at, OLD.helper_arrived_at) IS NOT NULL
       AND now() - COALESCE(OLD.poster_confirmed_working_at, OLD.helper_arrived_at) < interval '30 minutes' THEN
      RAISE EXCEPTION 'completion_min_work_time'
        USING ERRCODE = '23514',
              HINT = 'A job cannot be marked done within 30 minutes of starting.';
    END IF;
  END IF;

  RETURN NEW;
END;
$function$;

-- Helpers need to see the requirement on the browse card BEFORE they apply —
-- "this one wants before/after photos" is a material part of the job. Project
-- it through the browse view. CREATE OR REPLACE cannot add a column to an
-- existing view, so drop and recreate; the definition below is otherwise
-- verbatim from prod.
DROP VIEW IF EXISTS public.open_jobs_browse;

CREATE VIEW public.open_jobs_browse
-- security_invoker=false is what prod carries today (pg_class.reloptions read
-- 2026-09-11). Recreating it as an invoker view would silently subject the
-- feed to the caller's RLS on `jobs` and change who sees what — the drop is
-- only here to add a column.
WITH (security_invoker = false)
AS
 SELECT id,
    title,
    description,
    category,
    budget,
    date_needed,
        CASE
            WHEN offered_to_helper_id = auth.uid() AND direct_offer_status = 'pending'::text THEN location
            ELSE mask_job_location(location)
        END AS location,
    is_urgent,
    urgent_fee,
    is_flexible_schedule,
    is_recurring,
    is_group_job,
    helpers_needed,
    estimated_hours,
    start_time,
    photos,
    special_requirements,
    status,
    created_at,
    updated_at,
    boosted_at,
    boost_expires_at,
    expires_at,
    recurrence_interval,
    recurrence_end_date,
    parent_job_id,
    payment_status,
    customer_id,
    offered_to_helper_id,
    direct_offer_status,
    direct_offer_expires_at,
    ( SELECT count(*)::integer AS count
           FROM applications a
          WHERE a.job_id = jobs.id) AS applicant_count,
    pricing_mode,
    round(latitude, 2) AS latitude,
    round(longitude, 2) AS longitude,
    parish,
    credential_tier,
    require_photo_proof
   FROM jobs
  WHERE status = 'open'::job_status AND customer_id IS NOT NULL AND (payment_status = ANY (ARRAY['escrow'::text, 'payout_pending'::text, 'released'::text])) AND (offered_to_helper_id IS NULL OR (direct_offer_status = ANY (ARRAY['declined'::text, 'expired'::text])) OR offered_to_helper_id = auth.uid()) AND (created_at <= early_access_cutoff() OR customer_id = auth.uid() OR offered_to_helper_id = auth.uid()) AND (NOT is_seed OR NOT seed_jobs_hidden_publicly()) AND (COALESCE(credential_tier, 0) = 0 OR customer_id = auth.uid() OR COALESCE(( SELECT my_credential_tier() AS my_credential_tier), 0) >= credential_tier);

-- Restore the grants the dropped view carried. Named roles explicitly:
-- a bare PUBLIC grant/revoke is not the same set of privileges Supabase's
-- ALTER DEFAULT PRIVILEGES hands out per-role.
GRANT SELECT ON public.open_jobs_browse TO anon, authenticated;
GRANT ALL    ON public.open_jobs_browse TO service_role;
