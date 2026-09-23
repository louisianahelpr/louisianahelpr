-- Q120 (docs/OPEN.md): a blank or whitespace-only license_url / insurance_url
-- is ABSENT, not a document.
--
-- auto_pending_credentials() (BEFORE UPDATE on public.profiles) decided a URL
-- was present with `NEW.license_url IS NOT NULL AND NEW.license_url <> ''`.
-- That is not trimmed, so a member PATCHing license_url = ' ' got
-- license_status 'pending' and is_licensed true with nothing to review. Only
-- get_pending_credentials()'s nullif(btrim(..),'') kept it off the admin
-- queue; the member's own profile said "pending review" for ever, and every
-- other reader of license_status (CredentialBadge, RecognitionRow,
-- AccountPending, helpr-pass-wallet) believed it.
--
-- Now, when the URL column changes:
--   * a blank / whitespace-only value is normalised to NULL on write, so no
--     reader ever sees a "present" URL that is only spaces. The test is "no
--     non-whitespace character" (`!~ '[^[:space:]]'`), a superset of
--     nullif(btrim(..),''): btrim() strips only spaces, so a tab or newline
--     would otherwise still count as a document;
--   * if, after that, the value is unchanged (NULL -> ' ' -> NULL), the write
--     is a no-op for this trigger, exactly as a NULL -> NULL write is;
--   * otherwise the existing present / absent branches run unchanged.
-- A real path is stored as written (not trimmed). The business-name branch is
-- unchanged.
--
-- Body = the LIVE definition (pg_get_functiondef, 2026-09-23) with only the
-- two URL blocks changed. Header, SECURITY DEFINER and search_path unchanged.
-- Prod measured before this migration: 0 of 60 profiles had a blank URL or a
-- 'pending' status without a URL, so no data repair is needed.
--
-- REPLAY-SAFETY: CREATE OR REPLACE only; the REVOKE restates the live ACL
-- ({postgres=X, service_role=X}) and is idempotent.

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
