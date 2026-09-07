-- Helper proximity becomes a BAND. Both position oracles close before the
-- column that would arm them gets its first writer.
--
-- `profiles.latitude/longitude` are about to get a writer for the first time
-- (device geolocation, persisted). Two SECURITY DEFINER functions read those
-- columns and have been harmless for exactly one reason: the columns have
-- always been NULL. The day the first coordinate is written, both become live
-- ways to locate a person's home. So they are fixed FIRST, in their own
-- migration, ahead of the write path.
--
-- ---------------------------------------------------------------------------
-- ORACLE 1 — get_helper_distances_from_job (FABLE-LEAD-2026-08-23 R4)
-- ---------------------------------------------------------------------------
-- It returned `ROUND(<km>, 1)` — 100 m precision — for any applicant, to the
-- poster. R4's fix was an ownership gate (`j.customer_id = auth.uid()`), and
-- that gate does NOT close the attack, because the attacker owns the jobs:
-- post three jobs at chosen coordinates, query the same applicant against
-- each, intersect three 100 m circles, get a house.
--
-- Rounding is not the fix either. Rounding to the nearest mile still
-- trilaterates — three circles of +/-0.5 mi intersect to a city block. Only
-- BANDS wide enough that their intersection stays an area defeat it:
--
--     under 5 mi  /  5-15 mi  /  15-30 mi  /  30+ mi
--
-- No band is narrower than 5 miles, and there is deliberately NO "under 1 mi"
-- band even though the product would like one: a 1-mile disc is ~3 sq mi and
-- three of them intersect to a street. The worst case here is "under 5 mi"
-- from three probes, which still leaves ~78 sq mi.
--
-- The bucketing happens HERE, inside the function, not in the client. If the
-- RPC returned a number and the UI rounded it, the number would still be in
-- the API response and the attack would be completely unchanged. That is the
-- whole point of this migration; a client-side band is decoration.
--
-- `band_rank` exists so the poster can still ORDER applicants by proximity
-- while never holding a distance. Miles, not km — every product surface in
-- this app is miles (`miles_between`, `saved_searches.radius_miles`, the card
-- pill), and the old km return was the odd one out.
--
-- ---------------------------------------------------------------------------
-- ORACLE 2 — get_neighbor_hire_count, which fixing its own bug would ARM
-- ---------------------------------------------------------------------------
-- This one has never worked at all: it joined `profiles p ON p.id =
-- j.customer_id`, but `jobs.customer_id` holds a `user_id` while `profiles.id`
-- is a separate key. Measured on prod 2026-09-06: **0 of 44** profiles satisfy
-- `id = user_id`, so the join matched nothing even on the hand-seeded rows
-- that did carry coordinates.
--
-- Repairing that join alone would have been the more dangerous change of the
-- two, because this function had no ownership gate whatsoever and took the
-- probe point AND the radius as caller-supplied arguments:
--
--   * sweep `p_lat`/`p_lng` over a grid and every past customer of a chosen
--     helper lights up a disc -- customer home addresses, in bulk;
--   * hold the point still and BINARY-SEARCH `p_radius_km` until the count
--     changes, and you have the EXACT distance to the nearest one. A
--     caller-tunable radius is a distance oracle by construction, and it is
--     strictly worse than the 100 m rounding this migration is removing.
--
-- The generalisation, because "it only returns a count" is the reason nobody
-- looked at this function for months:
--
--     AN AGGREGATE IS ONLY PRIVATE IF THE CALLER CANNOT CHOOSE THE SET IT
--     AGGREGATES OVER.
--
-- Count-not-position is not protection when the attacker supplies the circle.
-- The output shape is irrelevant; what matters is who controls the geometry.
--
-- So the signature changes rather than the join alone. The caller now names a
-- JOB they own; the point comes from that job server-side, and the radius is
-- fixed internally. Probing now costs a funded job per point.
--
-- Plus k-anonymity: a count of exactly 1, next to a job location the caller
-- already knows, isolates one household. Counts below 2 return 0. That is also
-- the better product — "2 neighbours hired them" is a stronger signal than
-- "1 neighbour hired them" ever was.
--
-- ---------------------------------------------------------------------------
-- THE STANDING RULE this establishes
-- ---------------------------------------------------------------------------
-- No client-visible surface returns a precise distance, or another PERSON's
-- raw coordinate. Job SITES keep the mask they already have — `open_jobs_browse`
-- projects `round(latitude, 2)` (~1.1 km) and `mask_job_location()` reduces the
-- address to "City, ST" — because a job site is disclosed to whoever gets hired
-- anyway. A helper's home is not.
--
-- Swept for other position leaks once coordinates exist, all clear:
--   notify_saved_searches_on_new_job  message carries no distance
--   open_jobs_browse / get_open_jobs_for_map  job sites, already 2dp-masked
--   admin surfaces  render no profile coordinate
--
-- Replay-safe: guarded drops, idempotent creates, explicit grants naming anon
-- (a bare `REVOKE ... FROM PUBLIC` leaves Supabase's per-role grants intact).
-- Proven by applying this file three times consecutively under PGlite.

-- ---------------------------------------------------------------------------
-- 1. `location_captured_at` — when the device fix was taken.
--    `profiles.latitude/longitude` mean ONE thing after this change: a real
--    device fix. A ZIP centroid is never copied here; it lives on
--    `louisiana_zip_parishes` and is joined at read time, so a consumer that
--    needs sub-mile precision reads this column and simply finds NULL for a
--    centroid user. The misuse is unrepresentable rather than merely
--    forbidden — no reader has to remember a `location_source` flag.
-- ---------------------------------------------------------------------------

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS location_captured_at timestamptz;

COMMENT ON COLUMN public.profiles.latitude IS
  'PRECISE DEVICE FIX ONLY, from granted geolocation. NULL for every user who '
  'declined the permission, which is expected to be most of them. A ZIP '
  'centroid is NEVER written here — centroids live on '
  'louisiana_zip_parishes and are joined at read time, so any consumer needing '
  'sub-mile accuracy (see get_neighbor_hire_count) gets NULL rather than a '
  'point shared by everyone in the ZIP.';

COMMENT ON COLUMN public.profiles.longitude IS
  'See profiles.latitude. Precise device fix only; never a ZIP centroid.';

COMMENT ON COLUMN public.profiles.location_captured_at IS
  'When latitude/longitude were last captured from the device. Lets a reader '
  'age out a stale fix; NULL whenever the coordinates are NULL.';

-- ---------------------------------------------------------------------------
-- 2. get_helper_distances_from_job -> bands.
--    The RETURN TYPE changes, so this is a DROP and CREATE; CREATE OR REPLACE
--    cannot change a function's result type.
-- ---------------------------------------------------------------------------

DROP FUNCTION IF EXISTS public.get_helper_distances_from_job(uuid, uuid[]);

CREATE OR REPLACE FUNCTION public.get_helper_distances_from_job(
  p_job_id   uuid,
  p_user_ids uuid[]
)
RETURNS TABLE(user_id uuid, band text, band_rank integer)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT
    p.user_id,
    CASE
      WHEN public.miles_between(p.latitude, p.longitude, j.latitude, j.longitude) < 5  THEN 'Under 5 mi'
      WHEN public.miles_between(p.latitude, p.longitude, j.latitude, j.longitude) < 15 THEN '5-15 mi'
      WHEN public.miles_between(p.latitude, p.longitude, j.latitude, j.longitude) < 30 THEN '15-30 mi'
      ELSE '30+ mi'
    END AS band,
    CASE
      WHEN public.miles_between(p.latitude, p.longitude, j.latitude, j.longitude) < 5  THEN 1
      WHEN public.miles_between(p.latitude, p.longitude, j.latitude, j.longitude) < 15 THEN 2
      WHEN public.miles_between(p.latitude, p.longitude, j.latitude, j.longitude) < 30 THEN 3
      ELSE 4
    END AS band_rank
  FROM profiles p
  JOIN jobs j ON j.id = p_job_id
  WHERE p.user_id = ANY(p_user_ids)
    -- OWNERSHIP GATE (R4). Necessary, and on its own not sufficient — see the
    -- header. The bands are what actually close the attack.
    AND j.customer_id = auth.uid()
    -- A PRECISE fix on both sides or nothing. p.latitude is device-only, so a
    -- ZIP-centroid user is absent from these results rather than being
    -- reported at their ZIP's shared point.
    AND p.latitude IS NOT NULL
    AND p.longitude IS NOT NULL
    AND j.latitude IS NOT NULL
    AND j.longitude IS NOT NULL;
$function$;

COMMENT ON FUNCTION public.get_helper_distances_from_job(uuid, uuid[]) IS
  'Proximity of applicants to a job the caller posted, as a BAND. Never '
  'returns a distance: several exact distances trilaterate to a home address, '
  'and the ownership gate does not prevent that because the attacker owns the '
  'jobs. Bands are >= 5 miles wide for that reason, and there is deliberately '
  'no sub-5-mile band. band_rank orders applicants by proximity without '
  'exposing a number.';

REVOKE ALL ON FUNCTION public.get_helper_distances_from_job(uuid, uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_helper_distances_from_job(uuid, uuid[]) TO authenticated;

-- ---------------------------------------------------------------------------
-- 3. get_neighbor_hire_count -> job-scoped, fixed radius, k-anonymous.
--    Old signature took (p_helper_id, p_lat, p_lng, p_radius_km) and is
--    dropped outright: leaving it callable would leave the grid-sweep and the
--    radius binary-search intact next to the safe one.
-- ---------------------------------------------------------------------------

DROP FUNCTION IF EXISTS public.get_neighbor_hire_count(uuid, numeric, numeric, numeric);

CREATE OR REPLACE FUNCTION public.get_neighbor_hire_count(
  p_helper_id uuid,
  p_job_id    uuid
)
RETURNS integer
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  WITH scope AS (
    -- The probe point is the caller's OWN job, read server-side. The caller
    -- cannot name an arbitrary coordinate, so sweeping a grid now costs one
    -- funded job per point instead of one cheap RPC call.
    SELECT j.latitude, j.longitude
    FROM jobs j
    WHERE j.id = p_job_id
      AND j.customer_id = auth.uid()
      AND j.latitude IS NOT NULL
      AND j.longitude IS NOT NULL
  ), hits AS (
    SELECT COUNT(DISTINCT j.customer_id)::integer AS n
    FROM jobs j
    -- THE BUG THIS FIXES: was `p.id = j.customer_id`. `jobs.customer_id` is a
    -- user_id; `profiles.id` is a different key, equal on 0 of 44 prod rows.
    JOIN profiles p ON p.user_id = j.customer_id
    CROSS JOIN scope s
    WHERE j.helper_id = p_helper_id
      AND j.status = 'completed'
      -- Device fix only. A ZIP centroid would place every customer in the ZIP
      -- on one point and report them all as neighbours of each other — the
      -- exact failure the provenance split exists to make impossible.
      AND p.latitude IS NOT NULL
      AND p.longitude IS NOT NULL
      AND public.miles_between(p.latitude, p.longitude, s.latitude, s.longitude) <= 1
  )
  -- k-anonymity: one neighbour, next to a job location the caller already
  -- knows, identifies a household. Two is also the better social proof.
  SELECT CASE WHEN COALESCE((SELECT n FROM hits), 0) >= 2
              THEN (SELECT n FROM hits)
              ELSE 0 END;
$function$;

COMMENT ON FUNCTION public.get_neighbor_hire_count(uuid, uuid) IS
  'How many of a helper''s past customers live within a mile of a job the '
  'caller posted. Takes a job id, never a raw coordinate, and the radius is '
  'fixed: a caller-tunable radius is a distance oracle (binary-search it until '
  'the count changes and you have the exact distance to the nearest customer). '
  'Counts below 2 return 0 so a single household cannot be isolated. Reads '
  'profiles.latitude, which is device-fix-only, so ZIP-centroid users are '
  'never counted as neighbours of each other.';

REVOKE ALL ON FUNCTION public.get_neighbor_hire_count(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_neighbor_hire_count(uuid, uuid) TO authenticated;
