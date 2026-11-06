-- Q2058 (owner Q42): the tenant sees the Helpr's before/after photos on their repair request.
--
-- A repair request (maintenance_requests) links one job (job_id) that the LANDLORD posts and pays. The Helpr's proof
-- photos sit on the job (jobs.proof_before_urls / proof_after_urls, and each crew member's row in
-- group_job_helpers) as bare paths in the private proof-photos bucket, under the job's id. The landlord already reads
-- them as the job's customer. The tenant is not a party to the job, so neither the job row (jobs RLS) nor the storage
-- objects ("Users can read proof photos for their jobs") are theirs to read.
--
-- This adds, for the request's two sides only:
--   1. rentals_request_photo_rows(request): the proof paths of the request's FUNDED job (internal, no grant).
--   2. rentals_request_job_photos(request): the RPC the request screen calls (tenant or landlord of that request,
--      Homes switch on).
--   3. a storage SELECT policy that lets the TENANT sign exactly those paths, and nothing else in the job's folder.
--      The folder also holds other files (dispute evidence, 20260925141905), so the policy matches the object name
--      against the listed proof paths, never the folder.
-- Paths are filtered as helpr_job_after_photos does (20261105172514): bare, no '://', no leading '/' or '..', and
-- under the job's own id, so a path copied in from another job is never served.

-- 1. The request's funded job's proof paths, before and after (crew rows included).
CREATE OR REPLACE FUNCTION public.rentals_request_photo_rows(p_request_id uuid)
RETURNS TABLE (kind text, photo_path text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
  SELECT DISTINCT x.kind, x.photo_path
    FROM public.maintenance_requests r
    JOIN public.jobs j ON j.id = r.job_id
    CROSS JOIN LATERAL (
      SELECT 'before'::text AS kind, u AS photo_path FROM unnest(coalesce(j.proof_before_urls, ARRAY[]::text[])) u
      UNION ALL
      SELECT 'after', u FROM unnest(coalesce(j.proof_after_urls, ARRAY[]::text[])) u
      UNION ALL
      SELECT 'before', u FROM public.group_job_helpers g
        CROSS JOIN LATERAL unnest(coalesce(g.proof_before_urls, ARRAY[]::text[])) u
       WHERE g.job_id = j.id
      UNION ALL
      SELECT 'after', u FROM public.group_job_helpers g
        CROSS JOIN LATERAL unnest(coalesce(g.proof_after_urls, ARRAY[]::text[])) u
       WHERE g.job_id = j.id
    ) x
   WHERE r.id = p_request_id
     -- Funded and not cancelled: the same 'booked' rentals_request_job_state shows (20261027185146).
     AND j.payment_status IN ('escrow', 'payout_pending', 'released', 'held')
     AND j.status::text <> 'cancelled'
     AND x.photo_path IS NOT NULL
     AND x.photo_path <> ''
     AND x.photo_path !~ '://'
     AND x.photo_path !~ '(^/|\.\.)'
     AND split_part(x.photo_path, '/', 1) = j.id::text;
$fn$;
REVOKE ALL ON FUNCTION public.rentals_request_photo_rows(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.rentals_request_photo_rows(uuid) TO service_role;

-- The tenant's window (owner, 11-06): while the request's tenancy is active and for 90 days after it ends (the same
-- window the rent sweep keeps an ended tenancy in, 20261019073106); then it stops. The landlord keeps access.
CREATE OR REPLACE FUNCTION public.rentals_request_tenant_window_open(p_request_id uuid, p_uid uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
  SELECT p_uid IS NOT NULL AND EXISTS (
    SELECT 1
      FROM public.maintenance_requests r
      JOIN public.rental_tenancies t ON t.id = r.tenancy_id
     WHERE r.id = p_request_id
       AND r.tenant_id = p_uid
       AND t.tenant_id = p_uid
       AND (t.status = 'active' OR (t.status = 'ended' AND t.ended_at > now() - interval '90 days')));
$fn$;
REVOKE ALL ON FUNCTION public.rentals_request_tenant_window_open(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.rentals_request_tenant_window_open(uuid, uuid) TO service_role;

-- 2. The request screen's read: the request's landlord, or its tenant inside their window, with the Homes switch on.
CREATE OR REPLACE FUNCTION public.rentals_request_job_photos(p_request_id uuid)
RETURNS TABLE (kind text, photo_path text)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid uuid := auth.uid();
BEGIN
  PERFORM public.require_feature('rentals');
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.maintenance_requests r
                  WHERE r.id = p_request_id
                    AND (r.landlord_id = v_uid OR public.rentals_request_tenant_window_open(r.id, v_uid))) THEN
    RETURN;
  END IF;
  RETURN QUERY SELECT p.kind, p.photo_path FROM public.rentals_request_photo_rows(p_request_id) p ORDER BY p.kind DESC, p.photo_path;
END;
$fn$;
REVOKE ALL ON FUNCTION public.rentals_request_job_photos(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rentals_request_job_photos(uuid) TO authenticated, service_role;

-- 3. The tenant may sign exactly those paths (storage RLS). Permissive: it widens nothing else.
CREATE OR REPLACE FUNCTION public.is_tenant_repair_photo(object_name text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
  SELECT auth.uid() IS NOT NULL
     AND public.feature_enabled_for_user('rentals', auth.uid())
     AND EXISTS (
       SELECT 1
         FROM public.maintenance_requests r
        WHERE r.tenant_id = auth.uid()
          AND public.rentals_request_tenant_window_open(r.id, auth.uid())
          AND r.job_id IS NOT NULL
          AND r.job_id::text = split_part(object_name, '/', 1)
          AND EXISTS (SELECT 1 FROM public.rentals_request_photo_rows(r.id) p WHERE p.photo_path = object_name));
$fn$;
REVOKE ALL ON FUNCTION public.is_tenant_repair_photo(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_tenant_repair_photo(text) TO authenticated, service_role;

DROP POLICY IF EXISTS "Tenants can read their repair job's proof photos" ON storage.objects;
CREATE POLICY "Tenants can read their repair job's proof photos"
  ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'proof-photos' AND public.is_tenant_repair_photo(name));
