-- Q2390 packet 7 (declutter_delete_porch_place, shops_remove_photo): "not
-- found" answers HTTP 404, not 500.
--
-- PostgREST maps SQLSTATE P0001 to 400 but every other P0 code, P0002 included,
-- to 500. RAISE ... USING ERRCODE = 'PT404' makes PostgREST answer 404.
--
-- Both delete one of the caller's own rows and raise when the DELETE matched
-- nothing (so nothing was deleted; the raise ends the call either way).
-- Restated VERBATIM from prod (pg_proc.prosrc read 2026-11-02, md5 equal to the
-- newest migration copy):
--   declutter_delete_porch_place  10b8912595ba0179f287223c1ecbfe9e 484 chars (20261030164712)
--   shops_remove_photo            b67a5672407099568657e318cf40bb33 555 chars (20261017061155)
-- The ONLY change is one ERRCODE 'P0002' -> 'PT404' in each. Messages
-- (porch_place_not_found, photo_not_found), the DELETE and control flow are
-- unchanged. Grants restated as on prod (proacl: postgres, authenticated,
-- service_role).

CREATE OR REPLACE FUNCTION public.declutter_delete_porch_place(p_place_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid uuid;
  v_id uuid;
BEGIN
  PERFORM public.require_feature('declutter');
  IF public.is_caller_banned() THEN
    RAISE EXCEPTION 'account_restricted' USING ERRCODE = '42501';
  END IF;
  v_uid := public.declutter_assert_member(true);
  DELETE FROM public.declutter_porch_places WHERE id = p_place_id AND seller_id = v_uid RETURNING id INTO v_id;
  IF v_id IS NULL THEN
    RAISE EXCEPTION 'porch_place_not_found' USING ERRCODE = 'PT404';
  END IF;
  RETURN v_id;
END;
$fn$;

REVOKE ALL ON FUNCTION public.declutter_delete_porch_place(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.declutter_delete_porch_place(uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.shops_remove_photo(p_photo_id uuid)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid uuid := (SELECT auth.uid());
  v_path text;
BEGIN
  PERFORM public.require_feature('shops');
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501';
  END IF;
  IF public.is_caller_banned() THEN
    RAISE EXCEPTION 'account_restricted' USING ERRCODE = '42501';
  END IF;
  DELETE FROM public.shop_photos WHERE id = p_photo_id AND owner_id = v_uid
  RETURNING storage_path INTO v_path;
  IF v_path IS NULL THEN
    RAISE EXCEPTION 'photo_not_found' USING ERRCODE = 'PT404';
  END IF;
  RETURN v_path;
END;
$fn$;

REVOKE ALL ON FUNCTION public.shops_remove_photo(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.shops_remove_photo(uuid) TO authenticated, service_role;

