-- Proximity bands are measured against the point the job had when the helper
-- APPLIED, not wherever the poster moves it next.
--
-- REFUTES the claim in 20260907051731 that bands close the oracle. They do
-- not, because that migration's own standing rule was only half applied:
--
--     AN AGGREGATE IS ONLY PRIVATE IF THE CALLER CANNOT CHOOSE THE SET IT
--     AGGREGATES OVER.
--
-- The caller could not choose the set (`p_user_ids` is filtered to the
-- caller's own job) — but the caller could choose the POINT, freely and for
-- nothing. `jobs.latitude` / `jobs.longitude` are writable by the poster on
-- INSERT (enforce_jobs_insert_column_lock does not touch them) and on UPDATE
-- (neither enforce_poster_jobs_money_lock nor prevent_job_field_escalation
-- lists them, and they cannot: useJobSubmit.ts writes them itself after the
-- post, from the geocoder). Nothing in either RPC required the job to be
-- funded. So "probing now costs a funded job per point" was false — a probe
-- cost one UPDATE.
--
-- Measured against prod 2026-09-07, in a rolled-back transaction, as the
-- poster test account against the helper test account, on ONE unpaid job
-- that never saw checkout:
--
--   sweep jobs.latitude in 0.005° steps at a fixed longitude, ask for the
--   band each time, take the midpoint of the 'Under 5 mi' run  -> 30.4500
--   sweep jobs.longitude the same way                         -> -91.1875
--   profiles.latitude / longitude (device fix)                 ->  30.4515 / -91.1871
--
-- 202 calls, ~0.1 mile. Finer steps give a finer answer; there is no floor.
-- A disc of any width is a ruler when the caller holds one end of it.
--
-- THE FIX: freeze the point. The job's coordinates are snapshotted onto the
-- application row at the moment the helper applies (rounded to 2dp — the same
-- masked pair open_jobs_browse already hands to anonymous callers, so the
-- helper learns nothing new by being able to read their own row). Both RPCs
-- measure against that snapshot and only for a helper who actually applied.
-- The poster now gets exactly ONE band per (helper, job) pair, from a point
-- fixed before the helper chose to apply, and the 5-open-jobs cap bounds
-- the whole budget. That is the "three probes, ~78 sq mi" worst case the
-- band migration described, actually delivered.
--
-- The one legitimate late write — useJobSubmit's async geocode landing after
-- a very fast applicant, or backfill-job-geocode catching up — is honoured
-- ONCE: when a job's coordinates go from NULL to a value, applications that
-- have no snapshot yet take it. NULL -> value can only happen once per job,
-- so it is not a second ruler.
--
-- The poster holds UPDATE on application rows ("Job owners can update
-- application status"), so the snapshot columns are pinned on UPDATE for every
-- end-user session. Service role (auth.uid() IS NULL) is exempt, as everywhere.

-- ---------------------------------------------------------------------------
-- 1. The snapshot columns.
-- ---------------------------------------------------------------------------
ALTER TABLE public.applications
  ADD COLUMN IF NOT EXISTS job_latitude  numeric,
  ADD COLUMN IF NOT EXISTS job_longitude numeric;

COMMENT ON COLUMN public.applications.job_latitude IS
  'jobs.latitude rounded to 2dp, captured when the application was created. '
  'get_helper_distances_from_job and get_neighbor_hire_count measure against '
  'THIS, never the live job row, so a poster cannot move the job to locate the '
  'applicant. Pinned on UPDATE for end-user sessions.';
COMMENT ON COLUMN public.applications.job_longitude IS
  'See applications.job_latitude.';

-- ---------------------------------------------------------------------------
-- 2. Stamp on INSERT, pin on UPDATE.
-- ---------------------------------------------------------------------------
-- The pin honours one transaction-local flag, `app.first_geocode_fill`, set
-- only by the fill trigger in §3 — which runs inside the poster's own
-- session (useJobSubmit writes the geocode as the poster), so without the
-- flag the pin would silently undo the fill. Same style as
-- app.trusted_ladder_write.
CREATE OR REPLACE FUNCTION public.snapshot_application_job_point()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    -- Whatever the client sent for these is ignored; the job row is the only
    -- source. SECURITY DEFINER because the applying helper has no SELECT on
    -- the job's raw coordinates.
    SELECT round(j.latitude, 2), round(j.longitude, 2)
      INTO NEW.job_latitude, NEW.job_longitude
      FROM public.jobs j
     WHERE j.id = NEW.job_id;
    RETURN NEW;
  END IF;

  -- UPDATE. Service role may repair; an end user (either party — the poster
  -- has UPDATE on this row) may not touch the point.
  IF auth.uid() IS NOT NULL
     AND current_setting('app.first_geocode_fill', true) IS DISTINCT FROM 'on' THEN
    NEW.job_latitude  := OLD.job_latitude;
    NEW.job_longitude := OLD.job_longitude;
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.snapshot_application_job_point() FROM PUBLIC, anon;

DROP TRIGGER IF EXISTS trg_snapshot_application_job_point ON public.applications;
CREATE TRIGGER trg_snapshot_application_job_point
  BEFORE INSERT OR UPDATE ON public.applications
  FOR EACH ROW
  EXECUTE FUNCTION public.snapshot_application_job_point();

-- ---------------------------------------------------------------------------
-- 3. The one sanctioned late fill: a job's FIRST coordinates.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fill_application_job_point_on_first_geocode()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  PERFORM set_config('app.first_geocode_fill', 'on', true);
  UPDATE public.applications a
     SET job_latitude  = round(NEW.latitude, 2),
         job_longitude = round(NEW.longitude, 2)
   WHERE a.job_id = NEW.id
     AND a.job_latitude IS NULL
     AND a.job_longitude IS NULL;
  PERFORM set_config('app.first_geocode_fill', 'off', true);
  RETURN NULL;
END;
$$;

REVOKE ALL ON FUNCTION public.fill_application_job_point_on_first_geocode() FROM PUBLIC, anon;

DROP TRIGGER IF EXISTS trg_fill_application_job_point ON public.jobs;
CREATE TRIGGER trg_fill_application_job_point
  AFTER UPDATE OF latitude, longitude ON public.jobs
  FOR EACH ROW
  WHEN (OLD.latitude IS NULL AND OLD.longitude IS NULL
        AND NEW.latitude IS NOT NULL AND NEW.longitude IS NOT NULL)
  EXECUTE FUNCTION public.fill_application_job_point_on_first_geocode();

-- ---------------------------------------------------------------------------
-- 4. Backfill what exists. One row on prod today; written generally.
-- ---------------------------------------------------------------------------
UPDATE public.applications a
   SET job_latitude  = round(j.latitude, 2),
       job_longitude = round(j.longitude, 2)
  FROM public.jobs j
 WHERE j.id = a.job_id
   AND a.job_latitude IS NULL
   AND j.latitude IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 5. get_helper_distances_from_job — applicants only, snapshot only.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_helper_distances_from_job(p_job_id uuid, p_user_ids uuid[])
RETURNS TABLE(user_id uuid, band text, band_rank integer)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  WITH d AS (
    SELECT
      p.user_id,
      public.miles_between(p.latitude, p.longitude, a.job_latitude, a.job_longitude) AS miles
    FROM public.applications a
    JOIN public.jobs j     ON j.id = a.job_id
    JOIN public.profiles p ON p.user_id = a.helper_id
    WHERE a.job_id = p_job_id
      AND a.helper_id = ANY (p_user_ids)
      -- Ownership gate, still necessary.
      AND j.customer_id = auth.uid()
      -- The point is the application's, never the job's. A NULL snapshot
      -- (job never geocoded) means the helper is simply absent — the client
      -- already reads absent as "unknown", not "far".
      AND a.job_latitude  IS NOT NULL
      AND a.job_longitude IS NOT NULL
      -- Device fix only on the helper side, as before.
      AND p.latitude  IS NOT NULL
      AND p.longitude IS NOT NULL
  )
  SELECT
    user_id,
    CASE
      WHEN miles < 5  THEN 'Under 5 mi'
      WHEN miles < 15 THEN '5-15 mi'
      WHEN miles < 30 THEN '15-30 mi'
      ELSE '30+ mi'
    END AS band,
    CASE
      WHEN miles < 5  THEN 1
      WHEN miles < 15 THEN 2
      WHEN miles < 30 THEN 3
      ELSE 4
    END AS band_rank
  FROM d;
$$;

REVOKE ALL ON FUNCTION public.get_helper_distances_from_job(uuid, uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_helper_distances_from_job(uuid, uuid[]) TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 6. get_neighbor_hire_count — same ruler, same fix.
-- ---------------------------------------------------------------------------
-- The probe point becomes the helper's application snapshot on this job. The
-- count is only meaningful on an applicant card anyway (ApplicantsPanel), and
-- a helper who has not applied returns 0 rather than being measurable.
CREATE OR REPLACE FUNCTION public.get_neighbor_hire_count(p_helper_id uuid, p_job_id uuid)
RETURNS integer
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  WITH scope AS (
    SELECT a.job_latitude AS latitude, a.job_longitude AS longitude
    FROM public.applications a
    JOIN public.jobs j ON j.id = a.job_id
    WHERE a.job_id = p_job_id
      AND a.helper_id = p_helper_id
      AND j.customer_id = auth.uid()
      AND a.job_latitude  IS NOT NULL
      AND a.job_longitude IS NOT NULL
  ), hits AS (
    SELECT COUNT(DISTINCT j.customer_id)::integer AS n
    FROM public.jobs j
    JOIN public.profiles p ON p.user_id = j.customer_id
    CROSS JOIN scope s
    WHERE j.helper_id = p_helper_id
      AND j.status = 'completed'
      AND p.latitude  IS NOT NULL
      AND p.longitude IS NOT NULL
      AND public.miles_between(p.latitude, p.longitude, s.latitude, s.longitude) <= 1
  )
  SELECT CASE WHEN COALESCE((SELECT n FROM hits), 0) >= 2
              THEN (SELECT n FROM hits)
              ELSE 0 END;
$$;

REVOKE ALL ON FUNCTION public.get_neighbor_hire_count(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_neighbor_hire_count(uuid, uuid) TO authenticated, service_role;
