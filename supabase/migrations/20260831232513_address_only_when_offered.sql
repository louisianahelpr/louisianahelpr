-- "Should only see address when they are offered the job."
--
-- 20260828012503 + 20260828013351 built the masked read path
-- (`get_jobs_for_my_applications`, `get_my_pending_direct_offers`) and said in
-- its own header: "The policies themselves are dropped in the FOLLOWING
-- migration, so that the client can be switched over first." The client WAS
-- switched over (useActivityData.ts reads both RPCs), but that following
-- migration was never written. Verified against prod on 2026-08-31 as seed
-- helper 11111111-…-1104, who holds only a PENDING application on job
-- 5eed0827-…-0002:
--
--   GET /rest/v1/jobs?select=*&id=eq.5eed0827-0000-4000-8000-000000000002
--     → "location": "1408 Rue Beauregard, Delcambre, LA 70528"
--       "latitude": 29.9480, "longitude": -91.9880
--
-- Anyone may apply to any open job, so that is: any helper can obtain any
-- poster's street address and doorstep coordinates by tapping Apply. The same
-- row also came back through `public.jobs_helper_safe`, which is
-- `security_invoker = on` and therefore rides whatever RLS grants — it selects
-- `location, latitude, longitude` explicitly.
--
-- Two things are fixed here, both server-side:
--
--   1. The RLS policy "Applicants can view their pending applied jobs" is
--      dropped. RLS is row-level: once it grants the row, PostgREST returns
--      every column no matter what the UI renders.
--
--   2. `get_jobs_for_my_applications` / `get_my_pending_direct_offers` masked
--      `location` but returned `jobs.latitude` / `jobs.longitude` RAW — up to
--      7 decimal places (≈1 cm) for a pending applicant. A precise coordinate
--      IS an address. They are now coarsened to 2 dp (≈1.1 km), the exact
--      precision `get_open_jobs_for_map` has used since 20260608120000, so the
--      two surfaces cannot be cross-referenced to recover the original.
--
-- WHAT "OFFERED" MEANS HERE — `public.user_may_see_job_address()` below is the
-- single definition, and everything in this migration derives from it:
--
--   * `jobs.customer_id = me`  — the poster. Their own address; untouched.
--   * `jobs.helper_id = me`    — assigned. Set atomically by
--       `accept_application` (which also stamps applications.status
--       = 'accepted'), `accept_group_application` (lead slot),
--       `instant_book_claim`, and `respond_to_direct_offer(accept)`. It is
--       also self-cleaning: `expire_unanswered_offers` and
--       `decline_job_offer` reset `status='open', helper_id=NULL` when the
--       helper misses `response_deadline`, so access lapses with the offer and
--       no separate deadline test is needed.
--   * an `applications` row for me with status = 'accepted', and membership in
--       `group_job_helpers` — these are the SAME event for a multi-helper job.
--       `accept_group_application` only points `jobs.helper_id` at the FIRST
--       accepted helper ("Keep the legacy single-helper column pointing at the
--       first accepted helper"), so helpers 2..N are chosen but are not
--       `helper_id`. They were leaning on the dropped policy (a partially
--       staffed group job stays `status='open'`); without them here, dropping
--       it would strand accepted group helpers with no address at all. Too
--       tight is as bad as too loose.
--   * `offered_to_helper_id = me AND direct_offer_status = 'pending'` and the
--       offer has not run out. A direct offer is the poster naming one helper
--       and handing them the job; that is what "offered" means, and it is the
--       reading the existing "Targeted helper can view direct offer" policy
--       and `open_jobs_browse` already take. The `direct_offer_expires_at`
--       test is added because the RLS policy has none — it trusts
--       `expire_pending_direct_offers` to have run.
--
-- NOT offered: a pending application. That is the helper raising their hand,
-- not the poster choosing them. That distinction is the whole rule.
--
-- Counting a live direct offer as "offered" means `get_my_pending_direct_offers`
-- now returns the full address to its target instead of "City, ST". That is a
-- consistency change, not a widening: "Targeted helper can view direct offer"
-- is retained verbatim and already hands that helper the raw `public.jobs` row
-- (address and exact coordinates) over PostgREST, and `open_jobs_browse` has
-- printed their full `location` since 20260423025644. Masking one of three
-- doors was decorative. If the rule should instead be "only once they ACCEPT",
-- the change is to drop the direct-offer branch from
-- `user_may_see_job_address` AND drop that policy — both, or neither.
--
-- Deliberately NOT changed:
--   * "Users can view their own jobs" (customer_id / helper_id) — verbatim.
--   * "Targeted helper can view direct offer" — verbatim. It matches the
--     definition above; the new policy simply also covers it with the expiry
--     test, and a permissive policy set is OR'd.
--   * `get_ranked_open_jobs`, `get_open_jobs_for_map`, `get_public_open_jobs`,
--     `open_jobs_browse` — all already correct (verified on prod: masked
--     "City, LA", map coords at 2 dp, no lat/lng on the browse surfaces,
--     `anon` has no SELECT on `public.jobs` at all).
--
-- REPLAY-SAFETY: every object touched here (public.jobs, public.applications,
-- public.group_job_helpers, public.mask_job_location, and the two RPCs from
-- 20260828012503/20260828013351) is created by an EARLIER migration; nothing
-- defined later is referenced. Guards are still used so a partial replay from
-- an older point cannot fail.

-- ---------------------------------------------------------------------------
-- 1. The one definition of "offered".
--
-- SECURITY DEFINER + a fixed search_path for the same reason
-- `user_has_pending_application` is (20260529111503): it is called from an RLS
-- policy on `public.jobs` and reads `public.group_job_helpers`, whose own
-- policy reads `public.jobs`. A plain subquery there would recurse.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.user_may_see_job_address(_job_id uuid, _user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT _user_id IS NOT NULL AND (
    EXISTS (
      SELECT 1 FROM public.jobs j
      WHERE j.id = _job_id
        AND (
          j.customer_id = _user_id
          OR j.helper_id = _user_id
          OR (
            j.offered_to_helper_id = _user_id
            AND j.direct_offer_status = 'pending'
            AND (j.direct_offer_expires_at IS NULL OR j.direct_offer_expires_at > now())
          )
        )
    )
    OR EXISTS (
      SELECT 1 FROM public.group_job_helpers g
      WHERE g.job_id = _job_id AND g.helper_id = _user_id
    )
    OR EXISTS (
      SELECT 1 FROM public.applications a
      WHERE a.job_id = _job_id AND a.helper_id = _user_id AND a.status = 'accepted'
    )
  );
$$;

-- Explicit grant — defensive against the Supabase-advisor ACL strip that has
-- bitten has_role, mask_job_location and user_has_pending_application before
-- (see 20260528162153, 20260529111503). `authenticated` only: `anon` has no
-- SELECT on public.jobs and must not gain a probe for who is on a job.
REVOKE ALL ON FUNCTION public.user_may_see_job_address(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.user_may_see_job_address(uuid, uuid) TO authenticated;

COMMENT ON FUNCTION public.user_may_see_job_address(uuid, uuid) IS
  'True when this user has been OFFERED or assigned this job and is therefore '
  'entitled to jobs.location and the precise jobs.latitude/longitude: the '
  'poster, the assigned helper, an accepted applicant / group-roster helper, '
  'or the target of a live pending direct offer. A merely PENDING application '
  'is NOT enough. Single source of truth for the address-visibility rule — '
  'change it here, not at the call sites.';

-- ---------------------------------------------------------------------------
-- 2. Replacement SELECT policy.
--
-- Additive (RLS permissive policies are OR'd), so it cannot take away a row
-- anyone can read today. It exists to keep the parties the dropped policy
-- covered INCIDENTALLY — accepted group-roster helpers on a still-'open'
-- partially staffed job — reading their job after step 3.
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "Selected helpers can view their job" ON public.jobs;
CREATE POLICY "Selected helpers can view their job"
ON public.jobs
FOR SELECT
TO authenticated
USING (public.user_may_see_job_address(id, (SELECT auth.uid())));

-- ---------------------------------------------------------------------------
-- 3. THE FIX: stop handing the raw row to pending applicants.
--
-- The read path that replaces it shipped in 20260828012503 and the client has
-- been on it since (useActivityData.ts calls get_jobs_for_my_applications()).
-- `public.jobs_helper_safe` is security_invoker, so it stops leaking with this
-- drop and needs no separate change.
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "Applicants can view their pending applied jobs" ON public.jobs;

-- ---------------------------------------------------------------------------
-- 4. Coarsen the coordinates in the two masked RPCs, and route their unmask
--    test through user_may_see_job_address() so there is one rule.
--
-- Row sets, ordering, return shape and grants are unchanged from
-- 20260828013351 — only the projected `location`/`latitude`/`longitude` move.
-- The `(r.rec).*` LATERAL shape is kept verbatim; see that migration for why
-- `RETURN QUERY SELECT jsonb_populate_record(...)` alone does not compile.
--
-- 2 dp ≈ 1.1 km at Louisiana latitudes — identical to
-- `get_open_jobs_for_map`, on purpose: the same job seen on the map and in the
-- applied list yields the same coarse point, so the two cannot be differenced.
-- NULL would have been simpler but breaks the distance/ETA affordance on the
-- applied-jobs card, and the browse feed already publishes this precision.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_jobs_for_my_applications()
RETURNS SETOF public.jobs
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT (r.rec).*
  FROM public.jobs j
  CROSS JOIN LATERAL (
    SELECT public.user_may_see_job_address(j.id, v_uid) AS ok
  ) e
  CROSS JOIN LATERAL (
    SELECT jsonb_populate_record(
             NULL::public.jobs,
             to_jsonb(j) || jsonb_build_object(
               'location',
               CASE WHEN e.ok THEN j.location ELSE public.mask_job_location(j.location) END,
               'latitude',
               CASE WHEN e.ok THEN j.latitude ELSE ROUND(j.latitude, 2) END,
               'longitude',
               CASE WHEN e.ok THEN j.longitude ELSE ROUND(j.longitude, 2) END
             )
           ) AS rec
  ) r
  WHERE EXISTS (
          SELECT 1 FROM public.applications a
          WHERE a.job_id = j.id AND a.helper_id = v_uid
        )
    AND (
          j.customer_id = v_uid
          OR j.helper_id = v_uid
          OR j.status = 'open'
        );
END;
$$;

CREATE OR REPLACE FUNCTION public.get_my_pending_direct_offers()
RETURNS SETOF public.jobs
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT (r.rec).*
  FROM public.jobs j
  CROSS JOIN LATERAL (
    SELECT public.user_may_see_job_address(j.id, v_uid) AS ok
  ) e
  CROSS JOIN LATERAL (
    SELECT jsonb_populate_record(
             NULL::public.jobs,
             to_jsonb(j) || jsonb_build_object(
               'location',
               CASE WHEN e.ok THEN j.location ELSE public.mask_job_location(j.location) END,
               'latitude',
               CASE WHEN e.ok THEN j.latitude ELSE ROUND(j.latitude, 2) END,
               'longitude',
               CASE WHEN e.ok THEN j.longitude ELSE ROUND(j.longitude, 2) END
             )
           ) AS rec
  ) r
  WHERE j.offered_to_helper_id = v_uid
    AND j.direct_offer_status = 'pending'
  ORDER BY j.created_at DESC;
END;
$$;

-- ACLs restated verbatim from 20260828013351. CREATE OR REPLACE preserves
-- them, but an advisor strip does not, and these are load-bearing for the
-- helper Activity tab.
REVOKE ALL ON FUNCTION public.get_jobs_for_my_applications() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.get_my_pending_direct_offers() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_jobs_for_my_applications() TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_my_pending_direct_offers() TO authenticated;
