-- Q1502: an application's frozen job point is VOIDED when the job moves, not
-- refreshed and not left stale.
--
-- applications.job_latitude / job_longitude are the job's point rounded to 2dp
-- at the moment the Helpr applied (20260907061408). The proximity band the
-- poster sees ("Under 5 mi", get_helper_distances_from_job) and the crew
-- neighbour count measure against that frozen point, never the live job row,
-- because a poster who could move the point and re-ask would locate the
-- applicant (measured 2026-09-07: 202 calls, ~0.1 mile).
--
-- The gap (lh-authz-rls re-review of Q1499): after an address change (an
-- open-job edit, or Q1254's agreed detail change) the frozen point still
-- describes the OLD place, so the band the poster reads is about somewhere
-- the job no longer is.
--
-- Why not refresh it, as the finding suggested: a refresh on every move is
-- exactly the ruler 20260907061408 closed (move, ask, move, ask). Even the
-- one sanctioned late write, NULL -> value on a job's first geocode, would
-- become repeatable: an edit of jobs.location clears the job's point
-- (jobs_location_clears_coords), so "clear the snapshot, let the next geocode
-- fill it" lets the poster pick the point again on every edit.
--
-- THE FIX: when a job that had a point moves to a different 2dp cell (or
-- loses its point), every application on it drops its snapshot and is marked
-- job_point_void. A voided row is never filled again, so the band for that
-- applicant reads "unknown" (the client already shows an absent band as
-- unknown, not far) instead of a distance from the old address. A Helpr who
-- applies after the move snapshots the new point as usual.
--
-- job_point_void is not client-readable: authenticated is granted no SELECT
-- on it (column grants, 20261004191007), and the pin below holds it on UPDATE
-- for every end-user session the same way it holds the point. The applicant's
-- own export (export_my_data, whole own row) does include it, which is fine.
--
-- Side effect, same as the first-geocode fill: a move bumps updated_at on
-- every application on the job (update_applications_updated_at) and sends a
-- realtime UPDATE for each, the hired one included.

ALTER TABLE public.applications
  ADD COLUMN IF NOT EXISTS job_point_void boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.applications.job_point_void IS
  'true once the job moved after this application snapshotted its point '
  '(Q1502). The snapshot is NULL and is never filled again, so the poster '
  'cannot re-point the job to probe the applicant. Not client-readable.';

-- ---------------------------------------------------------------------------
-- 1. Stamp on INSERT, pin on UPDATE (now also the void flag).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.snapshot_application_job_point()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  IF TG_OP = 'INSERT' THEN
    -- Whatever the client sent for these is ignored; the job row is the only
    -- source. SECURITY DEFINER because the applying helper has no SELECT on
    -- the job's raw coordinates.
    SELECT round(j.latitude, 2), round(j.longitude, 2)
      INTO NEW.job_latitude, NEW.job_longitude
      FROM public.jobs j
     WHERE j.id = NEW.job_id;
    NEW.job_point_void := false;
    RETURN NEW;
  END IF;

  IF public.is_server_context() THEN
    RETURN NEW;
  END IF;

  -- Q1502: the void trigger on jobs runs in the poster's own session; it may
  -- only ever clear the point and set the flag, never write a point.
  IF current_setting('app.job_point_void', true) = 'on' THEN
    NEW.job_latitude   := NULL;
    NEW.job_longitude  := NULL;
    NEW.job_point_void := true;
    RETURN NEW;
  END IF;

  -- An end user (either party — the poster has UPDATE on this row — or anon)
  -- never sets the flag; only the first-geocode fill may touch the point.
  NEW.job_point_void := OLD.job_point_void;
  IF current_setting('app.first_geocode_fill', true) IS DISTINCT FROM 'on' THEN
    NEW.job_latitude  := OLD.job_latitude;
    NEW.job_longitude := OLD.job_longitude;
  END IF;
  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.snapshot_application_job_point() FROM PUBLIC, anon;

-- ---------------------------------------------------------------------------
-- 2. The first-geocode fill skips a voided row.
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
     AND a.job_longitude IS NULL
     AND NOT a.job_point_void;
  PERFORM set_config('app.first_geocode_fill', 'off', true);
  RETURN NULL;
END;
$$;

REVOKE ALL ON FUNCTION public.fill_application_job_point_on_first_geocode() FROM PUBLIC, anon;

-- ---------------------------------------------------------------------------
-- 3. A job that had a point and moves voids its applications' snapshots.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.void_application_job_point_on_move()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_prev text := current_setting('app.job_point_void', true);
BEGIN
  PERFORM set_config('app.job_point_void', 'on', true);
  UPDATE public.applications a
     SET job_latitude = NULL,
         job_longitude = NULL,
         job_point_void = true
   WHERE a.job_id = NEW.id
     AND NOT a.job_point_void;
  PERFORM set_config('app.job_point_void', COALESCE(v_prev, 'off'), true);
  RETURN NULL;
END;
$$;

REVOKE ALL ON FUNCTION public.void_application_job_point_on_move() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_void_application_job_point ON public.jobs;
-- No column list: an edit that sends only `location` has its point cleared by
-- the BEFORE trigger zzzzzz_jobs_location_clears_coords, and a column-list
-- trigger fires only for columns named in the client's SET (PostgreSQL), so
-- `UPDATE OF latitude, longitude` would miss exactly that move.
CREATE TRIGGER trg_void_application_job_point
  AFTER UPDATE ON public.jobs
  FOR EACH ROW
  WHEN ((OLD.latitude IS NOT NULL OR OLD.longitude IS NOT NULL)
        AND (round(NEW.latitude, 2) IS DISTINCT FROM round(OLD.latitude, 2)
             OR round(NEW.longitude, 2) IS DISTINCT FROM round(OLD.longitude, 2)))
  EXECUTE FUNCTION public.void_application_job_point_on_move();

-- ---------------------------------------------------------------------------
-- 4. Rows already stale: a snapshot that no longer matches its job's point
--    can only come from a move after the Helpr applied (INSERT copies the
--    job's rounded point). Void them the same way.
-- ---------------------------------------------------------------------------
UPDATE public.applications a
   SET job_latitude = NULL,
       job_longitude = NULL,
       job_point_void = true
  FROM public.jobs j
 WHERE j.id = a.job_id
   AND NOT a.job_point_void
   AND a.job_latitude IS NOT NULL
   AND (round(j.latitude, 2) IS DISTINCT FROM a.job_latitude
        OR round(j.longitude, 2) IS DISTINCT FROM a.job_longitude);
