-- Q127 (docs/OPEN.md): a credential URL is the member's OWN uploaded document,
-- not any text they type.
--
-- auto_pending_credentials() (BEFORE UPDATE on public.profiles) treated
-- license_url / insurance_url as a document if it had one non-[:space:]
-- character (Q120). A zero-width space (U+200B) is not [:space:], so a member
-- PATCHing license_url = chr(8203) got license_status 'pending' and
-- is_licensed true with nothing to review (evaluated on prod 2026-09-23).
-- Nothing checked that the value was a storage object, or the member's.
--
-- 1. ALLOWLIST, not more blank-stripping. A changed, non-NULL URL must be
--    exactly the shape both writers produce:
--      CredentialsTab.tsx   `${userId}/credentials/${kind}-${Date.now()}.${ext}`
--      complete-signup      `${userId}/credentials/${kind}-${Date.now()}.${safeDocumentExt(..)}`
--    i.e. ^<NEW.user_id>/credentials/<license|insurance>-<13 digits>.<ext>$,
--    where the kind matches the column and ext is one of the user-documents
--    bucket's allowed_mime_types (jpeg/png/webp/heic/pdf, prod 2026-09-23;
--    matched case-insensitively because older bundled clients took the
--    extension from the file name, e.g. IMG_0001.JPG) AND a user-documents
--    object with that exact name exists. Every writer uploads before it
--    writes the row. Another user's folder, a URL, a bare file name and any
--    invisible character all fail the anchored ASCII pattern.
--
--    A value that fails is REFUSED (RAISE, SQLSTATE 22023), never normalised
--    to NULL: normalising would answer the member's PATCH with 200 and a row
--    that silently says "no document", which the client would show as sent.
--    A refusal reaches the client's error path (CredentialsTab removes the
--    just-uploaded objects and says it could not submit). Blank / whitespace
--    stays Q120's "absent" (NULL), because that is what the writer meant.
--    Applies to every writer, admin and service role included.
--
-- 2. STORAGE: a submitted document cannot be swapped under its path. Before
--    this, "Owner update user-documents" / "Users can update their own
--    documents" (UPDATE) and "Owner delete user-documents" / "Users can delete
--    their own documents" (DELETE) let a member upsert new bytes over, or
--    delete-and-reupload, the very object an admin had verified, keeping the
--    badge. The four are replaced by one UPDATE and one DELETE policy with the
--    same own-folder test plus NOT public.is_submitted_credential_object(name):
--    the object named by the caller's own license_url / insurance_url is
--    frozen while it is on the profile. Withdrawing the document (URL -> NULL,
--    which drops the badge) unfreezes it. Every other object in the member's
--    folder (portfolio, orphaned uploads the client cleans up) is unchanged.
--    INSERT and SELECT policies are untouched.
--
-- Measured on prod before this migration (2026-09-23): 0 profiles rows with a
-- non-NULL license_url or insurance_url (so no existing row fails the shape;
-- the trigger's WHEN clause fires only when a URL or business_name changes,
-- and an unchanged URL is never re-checked); 3 user-documents objects under
-- */credentials/, all on the shape.
--
-- REPLAY-SAFETY: CREATE OR REPLACE for functions; plpgsql bodies (not
-- validated at CREATE) so storage.objects need not exist; storage policies
-- only when storage.objects exists, DROP POLICY IF EXISTS before each CREATE.

CREATE OR REPLACE FUNCTION public.credential_document_path_ok(p_user_id uuid, p_kind text, p_path text)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'public'
AS $fn$
BEGIN
  IF p_user_id IS NULL OR p_path IS NULL OR p_kind NOT IN ('license', 'insurance') THEN
    RETURN false;
  END IF;
  IF p_path !~ ('^' || p_user_id::text || '/credentials/' || p_kind || '-[0-9]{13}\.([Pp][Dd][Ff]|[Pp][Nn][Gg]|[Jj][Pp][Ee]?[Gg]|[Ww][Ee][Bb][Pp]|[Hh][Ee][Ii][Cc])$') THEN
    RETURN false;
  END IF;
  RETURN EXISTS (
    SELECT 1 FROM storage.objects o
     WHERE o.bucket_id = 'user-documents' AND o.name = p_path
  );
END;
$fn$;

REVOKE ALL ON FUNCTION public.credential_document_path_ok(uuid, text, text) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.auto_pending_credentials()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  is_admin_writer boolean := (auth.uid() IS NOT NULL AND has_role(auth.uid(), 'admin'));
BEGIN
  -- License document changed (and user is not admin doing the change)
  IF NEW.license_url IS DISTINCT FROM OLD.license_url THEN
    -- Q120: blank / whitespace-only is absent.
    IF coalesce(NEW.license_url, '') !~ '[^[:space:]]' THEN
      NEW.license_url := NULL;
    END IF;
    IF NEW.license_url IS NOT DISTINCT FROM OLD.license_url THEN
      NULL;
    ELSIF NEW.license_url IS NOT NULL THEN
      -- Q127: only the member's own uploaded document.
      IF NOT public.credential_document_path_ok(NEW.user_id, 'license', NEW.license_url) THEN
        RAISE EXCEPTION 'license_url must be a document you uploaded (<your id>/credentials/license-<time>.pdf|png|jpg|jpeg|webp|heic)'
          USING ERRCODE = '22023';
      END IF;
      NEW.is_licensed := true;
      IF NOT is_admin_writer THEN
        NEW.license_status := 'pending';
        NEW.license_reviewed_at := NULL;
        NEW.license_reviewed_by := NULL;
        NEW.license_rejection_reason := NULL;
      END IF;
    ELSE
      NEW.license_status := 'none';
      NEW.is_licensed := false;
    END IF;
  END IF;

  -- Insurance document changed
  IF NEW.insurance_url IS DISTINCT FROM OLD.insurance_url THEN
    -- Q120: blank / whitespace-only is absent.
    IF coalesce(NEW.insurance_url, '') !~ '[^[:space:]]' THEN
      NEW.insurance_url := NULL;
    END IF;
    IF NEW.insurance_url IS NOT DISTINCT FROM OLD.insurance_url THEN
      NULL;
    ELSIF NEW.insurance_url IS NOT NULL THEN
      -- Q127: only the member's own uploaded document.
      IF NOT public.credential_document_path_ok(NEW.user_id, 'insurance', NEW.insurance_url) THEN
        RAISE EXCEPTION 'insurance_url must be a document you uploaded (<your id>/credentials/insurance-<time>.pdf|png|jpg|jpeg|webp|heic)'
          USING ERRCODE = '22023';
      END IF;
      NEW.is_insured := true;
      IF NOT is_admin_writer THEN
        NEW.insurance_status := 'pending';
        NEW.insurance_reviewed_at := NULL;
        NEW.insurance_reviewed_by := NULL;
        NEW.insurance_rejection_reason := NULL;
      END IF;
    ELSE
      NEW.insurance_status := 'none';
      NEW.is_insured := false;
    END IF;
  END IF;

  -- The business name is part of the verified claim: the admin approved a
  -- document issued to THAT name. Renaming a live badge therefore re-enters
  -- review, the same way swapping the document does. Only 'verified' is
  -- affected — editing the name while 'none'/'pending'/'rejected' costs
  -- nothing, so there is nothing to protect and no reason to nag.
  IF NEW.business_name IS DISTINCT FROM OLD.business_name AND NOT is_admin_writer THEN
    IF OLD.license_status = 'verified' AND NEW.license_status = 'verified' THEN
      NEW.license_status := 'pending';
      NEW.license_reviewed_at := NULL;
      NEW.license_reviewed_by := NULL;
      NEW.license_rejection_reason := NULL;
    END IF;
    IF OLD.insurance_status = 'verified' AND NEW.insurance_status = 'verified' THEN
      NEW.insurance_status := 'pending';
      NEW.insurance_reviewed_at := NULL;
      NEW.insurance_reviewed_by := NULL;
      NEW.insurance_rejection_reason := NULL;
    END IF;
  END IF;

  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.auto_pending_credentials() FROM PUBLIC, anon, authenticated;

-- Is this user-documents object the caller's submitted credential? Evaluated
-- inside storage.objects policies as the caller, so it is SECURITY DEFINER and
-- scoped to auth.uid(): it can only ever answer about the caller's own row.
CREATE OR REPLACE FUNCTION public.is_submitted_credential_object(p_name text)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'public'
AS $fn$
BEGIN
  IF auth.uid() IS NULL OR p_name IS NULL THEN
    RETURN false;
  END IF;
  RETURN EXISTS (
    SELECT 1 FROM public.profiles p
     WHERE p.user_id = auth.uid()
       AND (p.license_url = p_name OR p.insurance_url = p_name)
  );
END;
$fn$;

REVOKE ALL ON FUNCTION public.is_submitted_credential_object(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_submitted_credential_object(text) TO authenticated;

DO $mig$
BEGIN
  IF to_regclass('storage.objects') IS NULL THEN
    RAISE NOTICE 'storage.objects absent: user-documents policies skipped';
    RETURN;
  END IF;

  DROP POLICY IF EXISTS "Owner update user-documents" ON storage.objects;
  DROP POLICY IF EXISTS "Users can update their own documents" ON storage.objects;
  DROP POLICY IF EXISTS "Owner delete user-documents" ON storage.objects;
  DROP POLICY IF EXISTS "Users can delete their own documents" ON storage.objects;

  DROP POLICY IF EXISTS "user-documents: owner update, not a submitted credential" ON storage.objects;
  CREATE POLICY "user-documents: owner update, not a submitted credential"
  ON storage.objects
  FOR UPDATE
  TO authenticated
  USING (
    bucket_id = 'user-documents'
    AND (storage.foldername(name))[1] = (SELECT auth.uid())::text
    AND NOT public.is_submitted_credential_object(name)
  )
  WITH CHECK (
    bucket_id = 'user-documents'
    AND (storage.foldername(name))[1] = (SELECT auth.uid())::text
    AND NOT public.is_submitted_credential_object(name)
  );

  DROP POLICY IF EXISTS "user-documents: owner delete, not a submitted credential" ON storage.objects;
  CREATE POLICY "user-documents: owner delete, not a submitted credential"
  ON storage.objects
  FOR DELETE
  TO authenticated
  USING (
    bucket_id = 'user-documents'
    AND (storage.foldername(name))[1] = (SELECT auth.uid())::text
    AND NOT public.is_submitted_credential_object(name)
  );
END
$mig$;
