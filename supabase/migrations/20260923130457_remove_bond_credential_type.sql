-- Q141 (docs/OPEN.md, OWNER DECISION 2026-09-23): remove the unused 'bond'
-- credential type. Also closes Q134 (a submitted bond had no reviewer:
-- get_pending_credentials() and review_credential() never handled it).
--
-- Measured on prod 2026-09-23 before this migration:
--   * no screen or edge function names bond (grep of src/ and
--     supabase/functions: 0 hits);
--   * public functions whose body names 'bond': get_user_credential_tier
--     (counted a verified bond as insured) and helper_credential_document_ok
--     (accepted a bond document path); no policy or view names it;
--   * constraints naming it: helper_credentials_credential_type_check and
--     helper_credentials_pending_bond_needs_document (Q130);
--   * helper_credentials rows with credential_type = 'bond': 1, the prod-seed
--     row 0320ce09-b544-5716-bea2-a9d491cd3485 (helper-e2e, profiles.is_seed,
--     rejected, no document), referenced by no verification_checks /
--     verification_exceptions row.
--
-- Both functions are restated from their LIVE definitions
-- (pg_get_functiondef, 2026-09-23) with only the bond branch removed.
-- CREATE OR REPLACE keeps ACLs and comments; the REVOKE/GRANT lines restate
-- the live pg_proc.proacl anyway.
-- Replay-safe: the seed check, DELETE and DROP CONSTRAINT IF EXISTS are no-ops
-- on a fresh replay, the type CHECK is dropped and re-added under its own
-- name, and both functions exist from earlier migrations.

-- 1. Only seed rows may be deleted. A bond row owned by a real (non-seed)
--    account stops the migration.
DO $q141$
DECLARE
  v_real int;
BEGIN
  SELECT count(*) INTO v_real
    FROM public.helper_credentials hc
   WHERE hc.credential_type = 'bond'
     AND NOT EXISTS (
       SELECT 1 FROM public.profiles p
        WHERE p.user_id = hc.user_id AND p.is_seed IS TRUE
     );
  IF v_real > 0 THEN
    RAISE EXCEPTION 'Q141: % bond credential row(s) belong to a non-seed account; resolve them before removing the bond type', v_real;
  END IF;
END
$q141$;

DELETE FROM public.helper_credentials WHERE credential_type = 'bond';

-- 2. The bond-only CHECK (Q130) goes, and bond leaves the type CHECK.
-- DESTRUCTIVE-DDL-ACK: DROP CONSTRAINT public.helper_credentials.helper_credentials_pending_bond_needs_document
-- ACK-REASON: Q141 owner decision removes the bond credential type; this CHECK constrained bond rows only.
-- ACK-DATA-LOSS: no rows change; only the constraint definition goes, and no bond row can exist after step 1.
ALTER TABLE public.helper_credentials
  DROP CONSTRAINT IF EXISTS helper_credentials_pending_bond_needs_document;

ALTER TABLE public.helper_credentials
  DROP CONSTRAINT IF EXISTS helper_credentials_credential_type_check;
ALTER TABLE public.helper_credentials
  ADD CONSTRAINT helper_credentials_credential_type_check
  CHECK (credential_type = ANY (ARRAY['identity'::text, 'background_check'::text, 'trade_license'::text, 'insurance'::text]));

-- 3. The document-path helper no longer accepts a bond document.
CREATE OR REPLACE FUNCTION public.helper_credential_document_ok(p_user_id uuid, p_type text, p_path text)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'public'
AS $fn$
BEGIN
  IF p_user_id IS NULL OR p_type IS NULL OR p_path IS NULL THEN
    RETURN false;
  END IF;
  IF p_type NOT IN ('trade_license', 'insurance') THEN
    RETURN false;
  END IF;
  IF p_path !~ ('^' || p_user_id::text || '/credentials/' || p_type || '-[0-9]{13}\.([Pp][Dd][Ff]|[Pp][Nn][Gg]|[Jj][Pp][Ee]?[Gg]|[Ww][Ee][Bb][Pp]|[Hh][Ee][Ii][Cc])$') THEN
    RETURN false;
  END IF;
  RETURN EXISTS (
    SELECT 1 FROM storage.objects o
     WHERE o.bucket_id = 'user-documents' AND o.name = p_path
  );
END;
$fn$;

REVOKE ALL ON FUNCTION public.helper_credential_document_ok(uuid, text, text) FROM PUBLIC, anon, authenticated;

-- 4. The tier counts insurance only (a verified bond no longer counts as insured).
CREATE OR REPLACE FUNCTION public.get_user_credential_tier(p_user_id uuid)
 RETURNS integer
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
 SET "TimeZone" TO 'America/Chicago'
AS $function$
  WITH src AS (
    SELECT
      -- Admin-reviewed via review_credential(); pinned by prevent_self_escalation().
      -- A NULL expiry earns nothing here.
      EXISTS (
        SELECT 1 FROM profiles p
        WHERE p.user_id = p_user_id
          AND p.license_status = 'verified'
          AND p.license_expires_at IS NOT NULL
          AND p.license_expires_at > current_date
      ) AS prof_licensed,
      EXISTS (
        SELECT 1 FROM profiles p
        WHERE p.user_id = p_user_id
          AND p.insurance_status = 'verified'
          AND p.insurance_expires_at IS NOT NULL
          AND p.insurance_expires_at > current_date
      ) AS prof_insured,
      -- idv_status added 2026-09-06: without it a helper who completed Stripe
      -- Identity stayed tier 0 and was hidden from every credential-gated job.
      EXISTS (
        SELECT 1 FROM profiles p
        WHERE p.user_id = p_user_id
          AND (p.stripe_identity_verified
               OR p.id_verification_status = 'verified'
               OR p.idv_status = 'verified')
      ) AS prof_identity,
      -- Vendor-verified via sync_credential_from_check().
      EXISTS (
        SELECT 1 FROM helper_credentials hc
        WHERE hc.user_id = p_user_id
          AND hc.credential_type = 'trade_license'
          AND hc.status = 'verified'
          AND (hc.expiration_date IS NULL OR hc.expiration_date > now())
      ) AS cred_licensed,
      EXISTS (
        SELECT 1 FROM helper_credentials hc
        WHERE hc.user_id = p_user_id
          AND hc.credential_type = 'insurance'
          AND hc.status = 'verified'
          AND (hc.expiration_date IS NULL OR hc.expiration_date > now())
      ) AS cred_insured,
      EXISTS (
        SELECT 1 FROM helper_credentials hc
        WHERE hc.user_id = p_user_id
          AND hc.credential_type = 'identity'
          AND hc.status = 'verified'
      ) AS cred_identity
  )
  SELECT CASE
    WHEN (prof_licensed OR cred_licensed) AND (prof_insured OR cred_insured) THEN 3
    WHEN (prof_licensed OR cred_licensed)                                    THEN 2
    WHEN (prof_identity OR cred_identity)                                    THEN 1
    ELSE 0
  END
  FROM src;
$function$;

REVOKE ALL ON FUNCTION public.get_user_credential_tier(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_user_credential_tier(uuid) TO authenticated, service_role;
