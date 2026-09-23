-- Q130 (docs/OPEN.md): helper_credentials.document_url is the member's OWN
-- uploaded document, and a credential already submitted cannot have its
-- document or type swapped under the reviewer.
--
-- The sister of Q127 (20260923110759, profiles.license_url / insurance_url).
-- Measured on prod 2026-09-23 before this migration:
--   * members hold column INSERT and UPDATE on document_url and
--     credential_type; the only document test was the Q102 CHECK
--     helper_credentials_pending_review_needs_document =
--     nullif(btrim(document_url), '') IS NOT NULL, which chr(8203) passes;
--   * "Users can update own credentials" had USING and no WITH CHECK;
--   * enforce_credential_status_server_owned keeps OLD.status on a member
--     UPDATE, so a 'submitted' row's document could be swapped to anything
--     while it sat in the admin queue, status unchanged;
--   * identity / background_check / bond could be 'submitted' with no
--     document (a member INSERT is forced to 'submitted');
--   * 3 rows, all on the seed helper-e2e account (437de07d-…); the one with a
--     document holds a `data:image/png;base64,…` value (seed fixture, fixed
--     in scripts/audit/prod-seed.mjs and re-pointed on prod separately).
--   * No client code writes helper_credentials (src/ reads only); the one
--     server writer is stripe-webhook (service role), which INSERTs a
--     background_check row with no document.
--
-- Where the document lives. The admin queue (AdminCredentialQueue.tsx,
-- DocPreview / SignedOpenLink) signs document_url against the private
-- user-documents bucket, the same bucket Q127 governs. So the shape is Q127's,
-- with the credential_type as the kind:
--     ^<user_id>/credentials/<trade_license|insurance|bond>-<13 digits>.<ext>$
-- ext = the bucket's allowed_mime_types mapped to extensions (pdf, png,
-- jpg/jpeg, webp, heic; case-insensitive for older clients), and a
-- user-documents object with exactly that name must exist.
--
-- Rules, by who legitimately writes each type:
--   trade_license, insurance, bond — a member submits a document. A non-NULL
--     document_url must pass helper_credential_document_ok() for EVERY writer
--     (service role and admin included, like Q127); a pending bond now needs a
--     document too (new CHECK; the Q102 CHECK covered only trade_license and
--     insurance).
--   identity, background_check — recorded by the verification provider
--     (stripe-webhook INSERTs background_check with no document; Stripe
--     Identity writes profiles, nothing writes an identity row today). A
--     document is meaningless on them, so document_url must be NULL, and a
--     MEMBER may not INSERT them at all: a member INSERT was forced to
--     'submitted', i.e. a free "background check in progress" claim nobody
--     paid for and no vendor will ever resolve.
--
-- A member document swap is REFUSED, not re-armed. Why refuse:
--   * a 'submitted' row is already in review, so "re-arm" changes nothing an
--     admin can see — the reviewer may open document A and approve after the
--     member swapped in B, and review_credential() approves whatever the row
--     then names;
--   * re-submitting is already a first-class write: INSERT a new row, which
--     gets its own 'submitted' status and created_at;
--   * no client flow updates helper_credentials, so the refusal costs no
--     real user anything.
--   The same holds for credential_type (the document proves one kind of
--   claim). The column UPDATE grants on both columns are revoked as well, and
--   the trigger refuses it anyway (42501) should a grant ever come back.
--   A 'verified' row is still a silent no-op for its owner (unchanged).
--
-- Storage: is_submitted_credential_object() now also freezes an object a
-- helper_credentials row of the caller names (any status: the row is the
-- record, and there is no DELETE policy on the row), so the bytes behind a
-- submitted document cannot be upserted over or deleted and re-uploaded.
--
-- Existing rows: a stored value is only checked when document_url or
-- credential_type CHANGES (or on INSERT), so an unrelated UPDATE (e.g.
-- review_credential setting status, sync_credential_from_check) never trips
-- on the seed's data: URL.
--
-- REPLAY-SAFETY: CREATE OR REPLACE for functions; DROP TRIGGER IF EXISTS
-- before CREATE; the CHECK is added only if absent (after counting rows it
-- would refuse); table-dependent statements are skipped when
-- public.helper_credentials does not exist.

CREATE OR REPLACE FUNCTION public.helper_credential_document_ok(p_user_id uuid, p_type text, p_path text)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'public'
AS $fn$
BEGIN
  IF p_user_id IS NULL OR p_path IS NULL OR p_type NOT IN ('trade_license', 'insurance', 'bond') THEN
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

CREATE OR REPLACE FUNCTION public.enforce_helper_credential_document()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $fn$
DECLARE
  is_member boolean := NOT (
    public.is_server_context()
    OR has_role(auth.uid(), 'admin')
    OR coalesce(current_setting('app.trusted_ladder_write', true), '') = 'on'
  );
BEGIN
  -- Q120: blank / whitespace-only is absent.
  IF NEW.document_url IS NOT NULL AND NEW.document_url !~ '[^[:space:]]' THEN
    NEW.document_url := NULL;
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF is_member AND NEW.credential_type IN ('identity', 'background_check') THEN
      RAISE EXCEPTION '% is recorded by the verification provider, not submitted by a member', NEW.credential_type
        USING ERRCODE = '42501';
    END IF;
  ELSE
    IF NEW.document_url IS NOT DISTINCT FROM OLD.document_url
       AND NEW.credential_type IS NOT DISTINCT FROM OLD.credential_type THEN
      RETURN NEW;
    END IF;
    IF is_member THEN
      RAISE EXCEPTION 'A submitted credential''s document and type cannot be changed; submit a new credential instead'
        USING ERRCODE = '42501';
    END IF;
  END IF;

  IF NEW.credential_type IN ('identity', 'background_check') THEN
    IF NEW.document_url IS NOT NULL THEN
      RAISE EXCEPTION '% credentials carry no document', NEW.credential_type
        USING ERRCODE = '22023';
    END IF;
  ELSIF NEW.document_url IS NOT NULL
        AND NOT public.helper_credential_document_ok(NEW.user_id, NEW.credential_type, NEW.document_url) THEN
    RAISE EXCEPTION 'document_url must be a document you uploaded (<your id>/credentials/%-<time>.pdf|png|jpg|jpeg|webp|heic)', NEW.credential_type
      USING ERRCODE = '22023';
  END IF;

  RETURN NEW;
END;
$fn$;

REVOKE ALL ON FUNCTION public.enforce_helper_credential_document() FROM PUBLIC, anon, authenticated;

-- Q127's storage freeze, extended to the objects helper_credentials rows name.
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
  ) OR EXISTS (
    SELECT 1 FROM public.helper_credentials c
     WHERE c.user_id = auth.uid()
       AND c.document_url = p_name
  );
END;
$fn$;

REVOKE ALL ON FUNCTION public.is_submitted_credential_object(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_submitted_credential_object(text) TO authenticated;

DO $mig$
DECLARE
  v_bad int;
BEGIN
  IF to_regclass('public.helper_credentials') IS NULL THEN
    RAISE NOTICE 'public.helper_credentials absent: Q130 table changes skipped';
    RETURN;
  END IF;

  DROP TRIGGER IF EXISTS trg_helper_credential_document_is_own ON public.helper_credentials;
  -- Named to fire AFTER trg_credential_status_server_owned (BEFORE triggers run
  -- in name order), so it sees the final user_id, and a member's no-op UPDATE of
  -- a verified row (that trigger RETURNs OLD) arrives here unchanged.
  CREATE TRIGGER trg_helper_credential_document_is_own
    BEFORE INSERT OR UPDATE ON public.helper_credentials
    FOR EACH ROW EXECUTE FUNCTION public.enforce_helper_credential_document();

  REVOKE UPDATE (document_url, credential_type) ON public.helper_credentials FROM PUBLIC, anon, authenticated;

  IF EXISTS (SELECT 1 FROM pg_policies
              WHERE schemaname = 'public' AND tablename = 'helper_credentials'
                AND policyname = 'Users can update own credentials') THEN
  ALTER POLICY "Users can update own credentials" ON public.helper_credentials
    USING ((SELECT auth.uid()) = user_id)
    WITH CHECK ((SELECT auth.uid()) = user_id);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'public.helper_credentials'::regclass
       AND conname = 'helper_credentials_pending_bond_needs_document'
  ) THEN
    SELECT count(*) INTO v_bad
      FROM public.helper_credentials
     WHERE credential_type = 'bond'
       AND status IN ('unverified', 'submitted')
       AND nullif(btrim(document_url), '') IS NULL;
    IF v_bad > 0 THEN
      RAISE EXCEPTION 'Q130: % bond row(s) await review with no document; resolve them before adding helper_credentials_pending_bond_needs_document', v_bad;
    END IF;
    ALTER TABLE public.helper_credentials
      ADD CONSTRAINT helper_credentials_pending_bond_needs_document
      CHECK (
        credential_type <> 'bond'
        OR status NOT IN ('unverified', 'submitted')
        OR nullif(btrim(document_url), '') IS NOT NULL
      );
  END IF;
END
$mig$;
