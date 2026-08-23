-- job_pets — the missing link between a pet profile and a pet-care job.
--
-- WHAT WAS BROKEN. `pet_profiles` holds everything a sitter actually needs:
-- feeding schedule, medical notes, behavioural notes, vet name and phone,
-- emergency contact, microchip. Nothing could reference it. There is no column
-- on `jobs`, no join table, and no picker in Post a Job — so a poster filled in
-- a full profile for their dog and then had to retype the important half into
-- the free-text "special requirements" box, or not tell the sitter at all
-- (owner: "whats the point of adding a pet if it doesnt allow them to attach
-- that info for a pet posting").
--
-- The absurd part is that the OUTPUT side was already wired: `pet_report_cards`
-- lets a helper file a report against a `pet_id` — a pet whose row RLS forbids
-- them from reading, because "Owners manage their pets" is the only policy on
-- `pet_profiles`. A helper could write about a pet they could not look up.
--
-- WHAT THIS ADDS.
--   1. `job_pets` — many-to-many, because a walk can cover two dogs and a
--      house-sit can cover the whole menagerie.
--   2. RLS that hands the poster full control of their own job's list, and the
--      ASSIGNED helper read access — nobody else, including helpers who merely
--      applied.
--   3. `get_job_pets(job_id)` — the care sheet itself. `pet_profiles` stays
--      owner-only; this SECURITY DEFINER function is the single, audited hole
--      through which an assigned helper sees the fields they need, and only
--      for pets attached to a job that is actually theirs.

CREATE TABLE IF NOT EXISTS public.job_pets (
  job_id     uuid NOT NULL REFERENCES public.jobs(id)          ON DELETE CASCADE,
  pet_id     uuid NOT NULL REFERENCES public.pet_profiles(id)  ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (job_id, pet_id)
);

-- The helper's read path filters by job; the poster's cleanup filters by pet.
CREATE INDEX IF NOT EXISTS idx_job_pets_pet ON public.job_pets (pet_id);

ALTER TABLE public.job_pets ENABLE ROW LEVEL SECURITY;

-- The poster owns the list: attach, detach, and read it back while editing.
DROP POLICY IF EXISTS "Poster manages the pets on their job" ON public.job_pets;
CREATE POLICY "Poster manages the pets on their job"
  ON public.job_pets
  FOR ALL
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
    -- You may only attach a pet you own. Without this a poster could staple
    -- somebody else's pet id to their own job and read it back through
    -- get_job_pets below.
    AND EXISTS (
      SELECT 1 FROM public.pet_profiles p
       WHERE p.id = job_pets.pet_id
         AND p.owner_id = (SELECT auth.uid())
    )
  );

-- The ASSIGNED helper may see which pets a job covers. Applicants may not: a
-- pet list is care detail for whoever is doing the job, not a browse-time
-- attraction, and it names animals and a home.
DROP POLICY IF EXISTS "Assigned helper reads the pets on their job" ON public.job_pets;
CREATE POLICY "Assigned helper reads the pets on their job"
  ON public.job_pets
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.jobs j
       WHERE j.id = job_pets.job_id
         AND j.helper_id = (SELECT auth.uid())
    )
  );

-- ───────────────────────────────────────────────────────────────────────────
-- get_job_pets — the care sheet.
--
-- SECURITY DEFINER because `pet_profiles` is owner-only and stays that way:
-- widening that table's RLS to "or a helper on some job" would open every pet
-- row to a join nobody audits. This function is the one hole, it is explicit
-- about who may look, and it returns only care fields — no owner_id, no
-- evacuation registration, no timestamps.
-- ───────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_job_pets(p_job_id uuid)
RETURNS TABLE (
  id                uuid,
  name              text,
  species           text,
  breed             text,
  age_years         numeric,
  weight_lbs        numeric,
  color_markings    text,
  photo_url         text,
  feeding_schedule  text,
  medical_notes     text,
  behavioral_notes  text,
  vet_name          text,
  vet_phone         text,
  emergency_contact text,
  microchip_id      text
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_customer uuid;
  v_helper   uuid;
BEGIN
  SELECT j.customer_id, j.helper_id INTO v_customer, v_helper
    FROM public.jobs j WHERE j.id = p_job_id;

  IF v_customer IS NULL THEN
    RAISE EXCEPTION 'job_not_found';
  END IF;

  -- The poster, or the helper the job is actually assigned to. An applicant
  -- is neither.
  IF (SELECT auth.uid()) IS DISTINCT FROM v_customer
     AND ((SELECT auth.uid()) IS DISTINCT FROM v_helper OR v_helper IS NULL) THEN
    RAISE EXCEPTION 'not_authorized';
  END IF;

  RETURN QUERY
    SELECT p.id, p.name, p.species, p.breed, p.age_years, p.weight_lbs,
           p.color_markings, p.photo_url, p.feeding_schedule, p.medical_notes,
           p.behavioral_notes, p.vet_name, p.vet_phone, p.emergency_contact,
           p.microchip_id
      FROM public.job_pets jp
      JOIN public.pet_profiles p ON p.id = jp.pet_id
     WHERE jp.job_id = p_job_id
     ORDER BY p.name;
END;
$$;

REVOKE ALL ON FUNCTION public.get_job_pets(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_job_pets(uuid) TO authenticated;
