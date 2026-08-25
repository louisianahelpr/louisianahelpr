-- Optional business name on the Licensed & Insured credential.
--
-- Owner decision (2026-08-25): "Optional for company name, but only for
-- licensed and insured. It will show as a badge in their profile."
--
-- A licence or COI is issued TO A NAMED BUSINESS. So the name is not a free
-- profile field that happens to sit near the badge — it is part of the claim
-- the admin verifies against the document. Three things follow, and all three
-- are enforced here rather than in the client:
--
--   1. Changing `business_name` while a credential is VERIFIED sends that
--      credential back to 'pending' — exactly what already happens when the
--      document itself changes (auto_pending_credentials). Without this, a
--      helper could verify as "Bob's Plumbing" and then rename to anything,
--      and the badge would be forgeable-by-rename.
--   2. `get_safe_profiles()` only emits the name when a credential is
--      verified. An unverified/pending/rejected name is never public, so even
--      a client that forgot to gate it cannot leak an unvetted claim.
--   3. `get_pending_credentials()` returns it so the reviewing admin can read
--      the claimed name off the screen and check it against the document.
--
-- `business_name` is deliberately NOT pinned in prevent_self_escalation():
-- the helper is the one who types it. It is (1) that keeps it honest.

-- ── 1. Column ─────────────────────────────────────────────────────────────
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS business_name text;

COMMENT ON COLUMN public.profiles.business_name IS
  'Optional business/company name on the licence or COI. Only ever public '
  'while a credential is verified; editing it re-opens review.';

-- Length guard, idempotent (ADD CONSTRAINT has no IF NOT EXISTS).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.profiles'::regclass
      AND conname = 'profiles_business_name_len'
  ) THEN
    ALTER TABLE public.profiles
      ADD CONSTRAINT profiles_business_name_len
      CHECK (business_name IS NULL OR char_length(business_name) <= 80);
  END IF;
END $$;

-- ── 2. Re-review on rename ────────────────────────────────────────────────
-- Trigger order matters and is alphabetical: tr_prevent_self_escalation runs
-- FIRST (pinning license_status/insurance_status back to their OLD values for
-- a non-admin writer), then trg_auto_pending_credentials runs and is the one
-- component allowed to move them. Adding the business_name branch here — not
-- to a new trigger — keeps that ordering guarantee.
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
    IF NEW.license_url IS NOT NULL AND NEW.license_url <> '' THEN
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
    IF NEW.insurance_url IS NOT NULL AND NEW.insurance_url <> '' THEN
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
    IF OLD.license_status = 'verified' THEN
      NEW.license_status := 'pending';
      NEW.license_reviewed_at := NULL;
      NEW.license_reviewed_by := NULL;
      NEW.license_rejection_reason := NULL;
    END IF;
    IF OLD.insurance_status = 'verified' THEN
      NEW.insurance_status := 'pending';
      NEW.insurance_reviewed_at := NULL;
      NEW.insurance_reviewed_by := NULL;
      NEW.insurance_rejection_reason := NULL;
    END IF;
  END IF;

  RETURN NEW;
END;
$function$;

-- The WHEN clause has to widen too, or the function above never runs on a
-- name-only edit.
DROP TRIGGER IF EXISTS trg_auto_pending_credentials ON public.profiles;
CREATE TRIGGER trg_auto_pending_credentials
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW
  WHEN (
    OLD.license_url IS DISTINCT FROM NEW.license_url
    OR OLD.insurance_url IS DISTINCT FROM NEW.insurance_url
    OR OLD.business_name IS DISTINCT FROM NEW.business_name
  )
  EXECUTE FUNCTION public.auto_pending_credentials();

-- ── 3. Public read — verified only ────────────────────────────────────────
-- Return type changes require DROP + CREATE; grants re-established explicitly
-- (previous ACL: anon + authenticated + service_role).
--
-- This body is the 20260827120000 intro-video-removal shape plus one column.
-- It must NOT reintroduce `intro_video_*`: that migration DROPs those columns
-- earlier in replay order, so naming them here would abort a from-scratch
-- rebuild and red the Preview check.
DROP FUNCTION IF EXISTS public.get_safe_profiles(uuid[]);

CREATE FUNCTION public.get_safe_profiles(user_ids uuid[])
RETURNS TABLE(
  user_id uuid, full_name text, avatar_url text, bio text, location text,
  skills text, hourly_rate numeric, role text, subscription_tier text,
  portfolio_urls text[], created_at timestamptz,
  is_id_verified boolean, profile_id uuid,
  is_licensed boolean, license_status text,
  is_insured boolean, insurance_status text,
  business_name text
)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT
    p.user_id, p.full_name, p.avatar_url, p.bio, p.location,
    p.skills, p.hourly_rate,
    (
      SELECT CASE WHEN ur.role = 'admin'::app_role THEN 'admin' ELSE 'member' END
      FROM public.user_roles ur WHERE ur.user_id = p.user_id
      ORDER BY CASE ur.role WHEN 'admin'::app_role THEN 1 ELSE 2 END LIMIT 1
    ) AS role,
    p.subscription_tier, p.portfolio_urls, p.created_at,
    (p.idv_status = 'verified') AS is_id_verified,
    p.id AS profile_id,
    p.is_licensed, p.license_status,
    p.is_insured, p.insurance_status,
    -- Never emit an unvetted business name. The badge is the trust signal
    -- and the name is part of it, so the two go public together or not at all.
    CASE
      WHEN (p.is_licensed AND p.license_status = 'verified')
        OR (p.is_insured AND p.insurance_status = 'verified')
      THEN p.business_name
    END AS business_name
  FROM public.profiles p
  WHERE (p.user_id = ANY(user_ids) OR p.id = ANY(user_ids))
    AND p.approval_status = 'approved'
    AND (p.ban_status IS NULL OR p.ban_status NOT IN ('temp_banned', 'permanently_banned'));
$function$;

REVOKE ALL ON FUNCTION public.get_safe_profiles(uuid[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_safe_profiles(uuid[]) TO anon, authenticated, service_role;

-- ── 4. Admin review queue sees the claimed name ───────────────────────────
DROP FUNCTION IF EXISTS public.get_pending_credentials();

CREATE FUNCTION public.get_pending_credentials()
RETURNS TABLE(
  user_id uuid, full_name text, email text, avatar_url text,
  license_url text, insurance_url text,
  license_status text, insurance_status text,
  is_licensed boolean, is_insured boolean,
  business_name text,
  submitted_at timestamptz
)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT
    p.user_id,
    p.full_name,
    p.email,
    p.avatar_url,
    p.license_url,
    p.insurance_url,
    p.license_status,
    p.insurance_status,
    p.is_licensed,
    p.is_insured,
    p.business_name,
    p.updated_at AS submitted_at
  FROM public.profiles p
  WHERE has_role(auth.uid(), 'admin')
    AND (p.license_status = 'pending' OR p.insurance_status = 'pending')
  ORDER BY p.updated_at ASC;
$function$;

REVOKE ALL ON FUNCTION public.get_pending_credentials() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_pending_credentials() TO authenticated, service_role;
