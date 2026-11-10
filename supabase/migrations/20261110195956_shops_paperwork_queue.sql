-- Shops paperwork (docs/NOT-LAUNCHED.md Q1952; spec L47, L52, L56, L73, L75; lh-authz-rls review of d439419a1 notes 1-2).
--
-- 1. "Permit on file" (L47, L52): a shop owner sends a food permit or an inflatable (bounce house) registration with
--    its expiry date; an admin checks it; shop_badges.permit is true only while a CHECKED permit has not expired.
--    Kept in its own table (shop_permits), not in helper_credentials: helper_credentials is fed by the profiles
--    license/insurance columns through trg_auto_pending_credentials and read by the credential tier, the hire
--    gates and the Profile credentials screen, none of which should see a shop permit. The Licensed / Insured
--    badges keep reading helper_credentials (the existing credentials queue), as before.
-- 2. The one Shops admin queue (L73) gains its paperwork part: shops_admin_paperwork() returns the permits waiting
--    for a check and the shops whose Secretary of State number waits for a check, with the number itself. It is the
--    admin-only read of sos_number the review asked for (note 1): no column grant on shops widens.
-- 3. Admins skip the shops switch (note 2): shops_admin_check_registration and shops_admin_set_hidden check the
--    admin role first and call require_feature('shops') only for a non-admin (who is then refused anyway), so an
--    admin can still hide a shop after the switch is set back to off. Both bodies are restated from their newest
--    definitions (20261103050349, 20261103052255) with only that order changed.
--
-- 4. A sent or checked permit's file stays put: is_submitted_credential_object (the user-documents owner update /
--    delete policies' test) also names a pending or verified shop_permits document, so an owner cannot swap or delete
--    the file behind a badge (lh-authz-rls review of this change, note 1). Restated from 20261019051407 verbatim plus
--    one branch.
--
-- Test data (owner 2026-10-27): every paperwork row says is_seed when the shop is a seed shop or its owner is a test
-- account, and the admin screen drops those rows.
-- Replay-safe: CREATE TABLE / INDEX IF NOT EXISTS, CREATE OR REPLACE, DROP POLICY IF EXISTS; grants restated.

CREATE TABLE IF NOT EXISTS public.shop_permits (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id uuid NOT NULL REFERENCES public.shops(id) ON DELETE CASCADE,
  owner_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('food_permit', 'inflatable_registration')),
  document_path text NOT NULL,
  expires_on date NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'verified', 'rejected')),
  review_note text,
  reviewed_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  reviewed_at timestamptz,
  is_seed boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT shop_permits_reviewed_has_reviewer CHECK (status = 'pending' OR reviewed_at IS NOT NULL)
);
-- One row per shop and kind: a new copy replaces the old one and goes back to pending.
CREATE UNIQUE INDEX IF NOT EXISTS shop_permits_shop_kind_key ON public.shop_permits (shop_id, kind);
CREATE INDEX IF NOT EXISTS shop_permits_owner_id_idx ON public.shop_permits (owner_id);
CREATE INDEX IF NOT EXISTS shop_permits_reviewed_by_idx ON public.shop_permits (reviewed_by);
CREATE INDEX IF NOT EXISTS shop_permits_pending_idx ON public.shop_permits (created_at) WHERE status = 'pending';

-- Server-owned: no client reads or writes the table; the owner reads their own rows through shops_my_permits().
ALTER TABLE public.shop_permits ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.shop_permits FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.shop_permits TO service_role;

-- The owner sends (or replaces) a permit. The document must already be the caller's own upload in user-documents,
-- under <uid>/shop-permits/<kind>-<13-digit time>.<ext> (the bucket's upload policy only lets a member write their own
-- folder). The expiry date must be today or later and within 5 years.
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

-- The owner's own permits: kind, state, expiry and the admin's note when one was turned down. Never who reviewed it.
CREATE OR REPLACE FUNCTION public.shops_my_permits()
RETURNS TABLE (kind text, status text, expires_on date, review_note text, sent_at timestamptz, expired boolean)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
SET "TimeZone" TO 'America/Chicago'
AS $fn$
DECLARE
  v_uid uuid := (SELECT auth.uid());
BEGIN
  PERFORM public.require_feature('shops');
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
    SELECT p.kind, p.status, p.expires_on, CASE WHEN p.status = 'rejected' THEN p.review_note END, p.created_at,
           p.expires_on < current_date
      FROM public.shop_permits p
      JOIN public.shops s ON s.id = p.shop_id
     WHERE s.owner_id = v_uid
     ORDER BY p.kind;
END;
$fn$;
REVOKE ALL ON FUNCTION public.shops_my_permits() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.shops_my_permits() TO authenticated, service_role;

-- The paperwork part of the one Shops admin queue (L73): permits waiting for a check, and shops whose Secretary of
-- State number waits for a check (with the number: the admin-only read of sos_number). Admin only; skips the switch.
CREATE OR REPLACE FUNCTION public.shops_admin_paperwork()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid uuid := (SELECT auth.uid());
BEGIN
  IF v_uid IS NULL OR NOT public.has_role(v_uid, 'admin') THEN
    PERFORM public.require_feature('shops');
    RAISE EXCEPTION 'not_admin' USING ERRCODE = '42501';
  END IF;
  IF public.is_caller_banned() THEN
    RAISE EXCEPTION 'account_restricted' USING ERRCODE = '42501';
  END IF;
  RETURN jsonb_build_object(
    'permits', (SELECT COALESCE(jsonb_agg(jsonb_build_object(
                  'permit_id', p.id, 'shop_id', s.id, 'shop_name', s.name, 'owner_id', s.owner_id, 'kind', p.kind,
                  'document_path', p.document_path, 'expires_on', p.expires_on, 'sent_at', p.created_at,
                  'is_seed', (p.is_seed OR s.is_seed OR public.is_test_subject(s.owner_id))) ORDER BY p.created_at), '[]'::jsonb)
                  FROM public.shop_permits p JOIN public.shops s ON s.id = p.shop_id
                 WHERE p.status = 'pending'),
    'registrations', (SELECT COALESCE(jsonb_agg(jsonb_build_object(
                  'shop_id', s.id, 'shop_name', s.name, 'owner_id', s.owner_id, 'sos_number', s.sos_number,
                  'area_label', s.area_label, 'updated_at', s.updated_at,
                  'is_seed', (s.is_seed OR public.is_test_subject(s.owner_id))) ORDER BY s.updated_at), '[]'::jsonb)
                  FROM public.shops s
                 WHERE s.sos_number IS NOT NULL AND s.sos_verified_at IS NULL));
END;
$fn$;
REVOKE ALL ON FUNCTION public.shops_admin_paperwork() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.shops_admin_paperwork() TO authenticated, service_role;

-- An admin checks a permit: verified (the badge shows until expires_on) or turned down with a note the owner reads.
-- Only a pending row, never the admin's own shop; audited; the owner gets a bell notice.
CREATE OR REPLACE FUNCTION public.shops_admin_review_permit(p_permit_id uuid, p_approve boolean, p_note text)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid uuid := (SELECT auth.uid());
  r public.shop_permits;
  v_owner uuid;
  v_status text;
  v_what text;
BEGIN
  IF v_uid IS NULL OR NOT public.has_role(v_uid, 'admin') THEN
    PERFORM public.require_feature('shops');
    RAISE EXCEPTION 'not_admin' USING ERRCODE = '42501';
  END IF;
  IF public.is_caller_banned() THEN
    RAISE EXCEPTION 'account_restricted' USING ERRCODE = '42501';
  END IF;
  IF p_approve IS NULL THEN
    RAISE EXCEPTION 'invalid_decision' USING ERRCODE = '22023';
  END IF;
  IF NOT p_approve AND (p_note IS NULL OR char_length(btrim(p_note)) < 3) THEN
    RAISE EXCEPTION 'reject_reason_required' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO r FROM public.shop_permits WHERE id = p_permit_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'permit_not_found' USING ERRCODE = 'PT404';
  END IF;
  SELECT owner_id INTO v_owner FROM public.shops WHERE id = r.shop_id;
  IF v_owner = v_uid THEN
    RAISE EXCEPTION 'own_shop' USING ERRCODE = '22023';
  END IF;
  IF r.status <> 'pending' THEN
    RAISE EXCEPTION 'permit_already_reviewed' USING ERRCODE = '22023';
  END IF;
  v_status := CASE WHEN p_approve THEN 'verified' ELSE 'rejected' END;
  UPDATE public.shop_permits
     SET status = v_status, review_note = NULLIF(left(btrim(COALESCE(p_note, '')), 500), ''),
         reviewed_by = v_uid, reviewed_at = now(), updated_at = now()
   WHERE id = r.id;
  INSERT INTO public.admin_audit_log (admin_id, action, target_type, target_id, details)
  VALUES (v_uid, 'shop_permit_review', 'shop', r.shop_id::text,
          jsonb_build_object('permit_id', r.id, 'kind', r.kind, 'status', v_status, 'note', left(btrim(COALESCE(p_note, '')), 500)));
  v_what := CASE r.kind WHEN 'food_permit' THEN 'food permit' ELSE 'inflatable registration' END;
  IF p_approve THEN
    PERFORM public.declutter_notify(v_owner, 'info', 'Permit on file',
      format('We checked your %s. Your shop now shows "Permit on file" until %s.', v_what, to_char(r.expires_on, 'FMMonth FMDD, YYYY')),
      '/shops/mine');
  ELSE
    PERFORM public.declutter_notify(v_owner, 'warning', 'We could not check your permit',
      format('We could not check your %s: %s Send a new copy from My shop.', v_what, left(btrim(p_note), 300)),
      '/shops/mine');
  END IF;
  RETURN v_status;
END;
$fn$;
REVOKE ALL ON FUNCTION public.shops_admin_review_permit(uuid, boolean, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.shops_admin_review_permit(uuid, boolean, text) TO authenticated, service_role;

-- shop_badges: restated from 20261021074131 with only 'permit' changed (false until now).
CREATE OR REPLACE FUNCTION public.shop_badges(p_shop_id uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
SET "TimeZone" TO 'America/Chicago'
AS $fn$
  SELECT jsonb_build_object(
    'id_checked', COALESCE((SELECT (p.idv_status IS NOT DISTINCT FROM 'verified')
                              FROM public.profiles p WHERE p.user_id = s.owner_id), false),
    'licensed', EXISTS (SELECT 1 FROM public.helper_credentials c
                         WHERE c.user_id = s.owner_id AND c.credential_type = 'trade_license'
                           AND c.status = 'verified'
                           AND (c.expiration_date IS NULL OR c.expiration_date >= current_date)),
    'insured', EXISTS (SELECT 1 FROM public.helper_credentials c
                        WHERE c.user_id = s.owner_id AND c.credential_type = 'insurance'
                          AND c.status = 'verified'
                          AND (c.expiration_date IS NULL OR c.expiration_date >= current_date)),
    'registered', s.sos_verified_at IS NOT NULL,
    'permit', EXISTS (SELECT 1 FROM public.shop_permits sp
                       WHERE sp.shop_id = s.id AND sp.status = 'verified' AND sp.expires_on >= current_date))
  FROM public.shops s
  WHERE s.id = p_shop_id;
$fn$;
REVOKE ALL ON FUNCTION public.shop_badges(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.shop_badges(uuid) TO service_role;

-- Admins skip the switch (review note 2). Restated from 20261103050349 with the admin check moved first.
CREATE OR REPLACE FUNCTION public.shops_admin_check_registration(p_shop_id uuid, p_verified boolean)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid uuid := (SELECT auth.uid());
  v_owner uuid;
BEGIN
  IF v_uid IS NULL OR NOT public.has_role(v_uid, 'admin') THEN
    PERFORM public.require_feature('shops');
    RAISE EXCEPTION 'not_admin' USING ERRCODE = '42501';
  END IF;
  IF public.is_caller_banned() THEN
    RAISE EXCEPTION 'account_restricted' USING ERRCODE = '42501';
  END IF;
  SELECT owner_id INTO v_owner FROM public.shops WHERE id = p_shop_id AND sos_number IS NOT NULL FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'shop_not_found' USING ERRCODE = 'PT404';
  END IF;
  IF v_owner = v_uid THEN
    RAISE EXCEPTION 'own_shop' USING ERRCODE = '22023';
  END IF;
  UPDATE public.shops
     SET sos_verified_at = CASE WHEN p_verified THEN now() END,
         sos_verified_by = CASE WHEN p_verified THEN v_uid END,
         updated_at = now()
   WHERE id = p_shop_id;
  INSERT INTO public.admin_audit_log (admin_id, action, target_type, target_id, details)
  VALUES (v_uid, 'shop_registration_check', 'shop', p_shop_id::text, jsonb_build_object('verified', COALESCE(p_verified, false)));
  RETURN COALESCE(p_verified, false);
END;
$fn$;
REVOKE ALL ON FUNCTION public.shops_admin_check_registration(p_shop_id uuid, p_verified boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.shops_admin_check_registration(p_shop_id uuid, p_verified boolean) TO authenticated, service_role;

-- Restated from 20261103052255 with the admin check moved first.
CREATE OR REPLACE FUNCTION public.shops_admin_set_hidden(p_shop_id uuid, p_hidden boolean, p_reason text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid uuid := (SELECT auth.uid());
  v_owner uuid;
BEGIN
  IF v_uid IS NULL OR NOT public.has_role(v_uid, 'admin') THEN
    PERFORM public.require_feature('shops');
    RAISE EXCEPTION 'not_admin' USING ERRCODE = '42501';
  END IF;
  IF public.is_caller_banned() THEN
    RAISE EXCEPTION 'account_restricted' USING ERRCODE = '42501';
  END IF;
  IF p_hidden IS NULL THEN
    RAISE EXCEPTION 'invalid_hidden' USING ERRCODE = '22023';
  END IF;
  IF p_hidden AND (p_reason IS NULL OR char_length(btrim(p_reason)) < 3) THEN
    RAISE EXCEPTION 'hide_reason_required' USING ERRCODE = '22023';
  END IF;
  SELECT owner_id INTO v_owner FROM public.shops WHERE id = p_shop_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'shop_not_found' USING ERRCODE = 'PT404';
  END IF;
  IF v_owner = v_uid THEN
    RAISE EXCEPTION 'own_shop' USING ERRCODE = '22023';
  END IF;
  UPDATE public.shops
     SET hidden_at = CASE WHEN p_hidden THEN now() END,
         hidden_by = CASE WHEN p_hidden THEN v_uid END,
         hidden_reason = CASE WHEN p_hidden THEN left(btrim(p_reason), 500) END,
         updated_at = now()
   WHERE id = p_shop_id;
  INSERT INTO public.admin_audit_log (admin_id, action, target_type, target_id, details)
  VALUES (v_uid, CASE WHEN p_hidden THEN 'shop_hidden' ELSE 'shop_unhidden' END, 'shop', p_shop_id::text,
          jsonb_build_object('reason', p_reason));
  RETURN p_hidden;
END;
$fn$;
REVOKE ALL ON FUNCTION public.shops_admin_set_hidden(p_shop_id uuid, p_hidden boolean, p_reason text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.shops_admin_set_hidden(p_shop_id uuid, p_hidden boolean, p_reason text) TO authenticated, service_role;

-- 4. Restated from 20261019051407 verbatim plus the shop_permits branch.
CREATE OR REPLACE FUNCTION public.is_submitted_credential_object(p_name text)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF auth.uid() IS NULL OR p_name IS NULL THEN
    RETURN false;
  END IF;
  RETURN EXISTS (
    SELECT 1 FROM public.profiles p
     WHERE p.user_id = auth.uid()
       AND (p.license_url = p_name OR p.insurance_url = p_name)
  ) OR EXISTS (
    SELECT 1 FROM public.helper_credentials c
     WHERE c.user_id = auth.uid()
       AND c.document_url = p_name
  ) OR EXISTS (
    SELECT 1 FROM public.rental_properties rp
     WHERE rp.owner_id = auth.uid()
       AND rp.ownership_proof_path = p_name
       AND rp.ownership_status IN ('pending_review', 'approved')
  ) OR EXISTS (
    SELECT 1 FROM public.maintenance_request_photos mp
     WHERE mp.tenant_id = auth.uid()
       AND mp.storage_path = p_name
  ) OR EXISTS (
    SELECT 1 FROM public.landlord_id_reviews lr
     WHERE lr.user_id = auth.uid()
       AND lr.images_deleted_at IS NULL
       AND (lr.front_path = p_name OR lr.back_path = p_name)
  ) OR EXISTS (
    SELECT 1 FROM public.shop_permits sp
     WHERE sp.owner_id = auth.uid()
       AND sp.document_path = p_name
       AND sp.status IN ('pending', 'verified')
  );
END;
$function$;
REVOKE ALL ON FUNCTION public.is_submitted_credential_object(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_submitted_credential_object(text) TO authenticated, service_role;
