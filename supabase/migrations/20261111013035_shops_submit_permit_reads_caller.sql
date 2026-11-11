-- shops_submit_permit checks auth.uid() explicitly so the Q1284 live-privileges gate sees it reads the caller
--
-- Problem: DB Deploy 42936455645 pushed every migration, then its post-push
-- gate (scripts/check-live-privileges.mjs, Q1284) failed on
-- shops_submit_permit(text, text, date): a client-callable SECURITY DEFINER
-- body with no literal auth.uid() / is_server_context / has_role / is_admin.
-- The function DOES read the caller, through public.shops_assert_owner_eligible()
-- (which returns auth.uid() after the eligibility checks), but the gate's
-- regex cannot see through a helper. Listing it under "unscoped" would be a
-- lie, so instead the body states the scope itself: the uid the helper
-- returns must be the caller's own auth.uid(). Behaviour is otherwise the
-- 20261110195956 body verbatim (same checks, same errors, same upsert).
--
-- REPLAY-SAFETY: CREATE OR REPLACE; every referenced object exists by
-- 20261110195956.
CREATE OR REPLACE FUNCTION public.shops_submit_permit(p_kind text, p_document_path text, p_expires_on date)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
SET "TimeZone" TO 'America/Chicago'
AS $fn$
DECLARE
  v_uid uuid;
  v_shop uuid;
  v_seed boolean;
  v_id uuid;
BEGIN
  PERFORM public.require_feature('shops');
  IF public.is_caller_banned() THEN
    RAISE EXCEPTION 'account_restricted' USING ERRCODE = '42501';
  END IF;
  v_uid := public.shops_assert_owner_eligible();
  -- Q1284: the scope is the caller, stated here so the live-privileges gate
  -- (and a reader) sees it without following the helper.
  IF v_uid IS NULL OR v_uid IS DISTINCT FROM (SELECT auth.uid()) THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501';
  END IF;
  SELECT s.id, s.is_seed INTO v_shop, v_seed FROM public.shops s WHERE s.owner_id = v_uid;
  IF v_shop IS NULL THEN
    RAISE EXCEPTION 'shop_not_found' USING ERRCODE = 'PT404';
  END IF;
  IF p_kind IS NULL OR p_kind NOT IN ('food_permit', 'inflatable_registration') THEN
    RAISE EXCEPTION 'invalid_permit_kind' USING ERRCODE = '22023';
  END IF;
  IF p_expires_on IS NULL OR p_expires_on < current_date OR p_expires_on > current_date + 1826 THEN
    RAISE EXCEPTION 'invalid_permit_expiry' USING ERRCODE = '22023';
  END IF;
  IF p_document_path IS NULL
     OR p_document_path !~ ('^' || v_uid::text || '/shop-permits/' || p_kind || '-[0-9]{13}\.([Pp][Dd][Ff]|[Pp][Nn][Gg]|[Jj][Pp][Ee]?[Gg]|[Ww][Ee][Bb][Pp]|[Hh][Ee][Ii][Cc])$')
     OR NOT EXISTS (SELECT 1 FROM storage.objects o WHERE o.bucket_id = 'user-documents' AND o.name = p_document_path) THEN
    RAISE EXCEPTION 'invalid_permit_document' USING ERRCODE = '22023';
  END IF;
  INSERT INTO public.shop_permits (shop_id, owner_id, kind, document_path, expires_on, is_seed)
  VALUES (v_shop, v_uid, p_kind, p_document_path, p_expires_on, COALESCE(v_seed, false))
  ON CONFLICT (shop_id, kind) DO UPDATE
    SET document_path = EXCLUDED.document_path,
        expires_on = EXCLUDED.expires_on,
        owner_id = EXCLUDED.owner_id,
        status = 'pending',
        review_note = NULL,
        reviewed_by = NULL,
        reviewed_at = NULL,
        created_at = now(),
        updated_at = now()
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$fn$;
REVOKE ALL ON FUNCTION public.shops_submit_permit(text, text, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.shops_submit_permit(text, text, date) TO authenticated, service_role;
