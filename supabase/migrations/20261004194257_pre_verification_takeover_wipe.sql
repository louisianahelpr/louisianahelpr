-- Q447(a) (docs/OPEN.md), OWNER DECISION 2026-10-04: when the real owner of an
-- email address takes over an account whose email was never verified, delete
-- everything that was typed into it before verification. The real owner then
-- fills in their own profile on /complete-profile.
--
-- THE TAKEOVER (Q446 step 4; GoTrue internal/models/linking.go +
-- external.go, as read 2026-09-25 and modelled in
-- scripts/sql/identity-linking-scenarios.sql case B): an UNconfirmed
-- email/password account + a provider sign-in with the same VERIFIED email ->
-- GoTrue links the provider identity, removes the password and the email
-- identity (RemoveUnconfirmedIdentities), then confirms the email
-- (email_confirmed_at := now()). Whoever typed the signup form, possibly an
-- attacker who registered the victim's address first, had filled the profile
-- through complete-signup's unauthenticated path (account < 30 min old, never
-- signed in, empty bio): name, phone, DOB, avatar, city/ZIP, bio, license and
-- insurance uploads, marketing consent, a legal_acceptances row and a
-- referral. Until now all of it survived into the real owner's account.
--
-- DETECTION, at the confirm (AFTER UPDATE OF email_confirmed_at on
-- auth.users, NULL -> set): the account no longer has an 'email' identity but
-- has another one, AND it began as an email account (app_metadata.provider
-- 'email', or it existed before its first non-email identity). An ordinary
-- email-link verification keeps the email identity, so it never matches; an
-- Apple "Hide My Email" account (created BY the provider) never matches either.
--
-- WHAT IS DELETED: the signup-form profile fields (name, phone, DOB, avatar,
-- city, ZIP and parish, bio, skills, the questionnaire answers, emergency
-- contact, license/insurance documents and their status/expiry, marketing
-- consent, the terms acceptance and its first-accepted stamp), every
-- legal_acceptances row, and the referral recorded at signup. Storage objects
-- cannot be deleted from SQL (storage.protect_delete), so the objects under
-- the user's folder in avatars and user-documents are recorded in
-- pre_verification_wipes and removed by cleanup-abandoned-accounts through the
-- Storage API, only while still unchanged since the wipe (a new avatar the
-- real owner uploads under the same key is never touched).
--
-- FAIL-OPEN FOR SIGN-IN, LOUD FOR THE WIPE: an error in the wipe must not
-- break the real owner's sign-in, so it is caught; the failure is recorded in
-- pre_verification_wipes.error (the row an operator reads) instead.
--
-- preserve_first_consent keeps accepted_terms_at from ever moving; it gains a
-- carve-out for this one definer function's transaction-local flag, because
-- the acceptance it would preserve is the one being deleted.
--
-- Replay-safe: CREATE TABLE IF NOT EXISTS; CREATE OR REPLACE; DROP TRIGGER IF EXISTS.

-- ── 1. The record of each wipe (server-only) ────────────────────────────────
CREATE TABLE IF NOT EXISTS public.pre_verification_wipes (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         uuid NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  wiped_at        timestamptz NOT NULL DEFAULT now(),
  objects         jsonb NOT NULL DEFAULT '[]'::jsonb,
  storage_done_at timestamptz,
  error           text
);
ALTER TABLE public.pre_verification_wipes ENABLE ROW LEVEL SECURITY;
-- Q807: every new public table carries the unconfirmed-email gate (server-only here; GoTrue's
-- session reads session_email_unconfirmed() as false, so the takeover wipe still writes).
SELECT public.attach_unconfirmed_email_gate();
REVOKE ALL ON public.pre_verification_wipes FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.pre_verification_wipes TO service_role;
CREATE INDEX IF NOT EXISTS pre_verification_wipes_pending_idx
  ON public.pre_verification_wipes (wiped_at) WHERE storage_done_at IS NULL;
COMMENT ON TABLE public.pre_verification_wipes IS
  'Q447: one row per pre-verification takeover wipe. objects = the storage objects to remove; storage_done_at set by cleanup-abandoned-accounts; error = a wipe or removal that failed.';

-- ── 2. The first-consent pin lets the wipe clear the stamp ─────────────────
CREATE OR REPLACE FUNCTION public.preserve_first_consent()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
BEGIN
  -- Q447: the one exemption. wipe_pre_verification_account (SECURITY DEFINER,
  -- no client EXECUTE) sets this transaction-local flag around its UPDATE:
  -- the acceptance being cleared is the one typed before the email owner
  -- arrived, and its legal_acceptances row is deleted in the same transaction.
  IF current_setting('app.pre_verification_wipe', true) = '1' THEN
    RETURN NEW;
  END IF;

  -- Once a user has accepted, that moment is history. Every writer is free to
  -- keep sending `accepted_terms_at: now()` (they all do, and asking each of
  -- them to read-then-write would be a race); the database quietly keeps the
  -- first value instead of trusting the newest caller.
  --
  -- Deliberately NOT exempt for admins or service_role: there is no legitimate
  -- reason for any actor to move a recorded consent forward in time, and the
  -- one operation that would need it (correcting a wrong row) should be an
  -- explicit, reviewed statement that drops this trigger, not an accident.
  IF OLD.accepted_terms_at IS NOT NULL THEN
    NEW.accepted_terms_at := OLD.accepted_terms_at;
  END IF;

  -- A user cannot un-accept by clearing the column either.
  IF NEW.accepted_terms_at IS NULL AND OLD.accepted_terms_at IS NOT NULL THEN
    NEW.accepted_terms_at := OLD.accepted_terms_at;
  END IF;

  RETURN NEW;
END;
$$;

-- ── 3. The wipe ─────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.wipe_pre_verification_account(p_user_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_objects jsonb;
  v_id      uuid;
BEGIN
  IF p_user_id IS NULL THEN
    RETURN NULL;
  END IF;

  -- What is stored under the account's own folder. Nothing could be uploaded
  -- there without a session before the confirm except by complete-signup.
  SELECT coalesce(jsonb_agg(jsonb_build_object('bucket', o.bucket_id, 'name', o.name) ORDER BY o.bucket_id, o.name), '[]'::jsonb)
    INTO v_objects
    FROM storage.objects o
   WHERE o.bucket_id IN ('avatars', 'user-documents')
     AND o.name LIKE p_user_id::text || '/%';

  PERFORM set_config('app.pre_verification_wipe', '1', true);
  UPDATE public.profiles
     SET full_name               = '',
         phone                   = NULL,
         date_of_birth           = NULL,
         avatar_url              = NULL,
         location                = NULL,
         zip_code                = NULL,
         parish                  = NULL,
         parish_source           = NULL,
         bio                     = NULL,
         skills                  = NULL,
         availability            = NULL,
         transportation          = NULL,
         hear_about_us           = NULL,
         experience_level        = NULL,
         tools_equipment         = NULL,
         emergency_contact_name  = NULL,
         emergency_contact_phone = NULL,
         extra_comments          = NULL,
         license_url             = NULL,
         insurance_url           = NULL,
         license_expires_at      = NULL,
         insurance_expires_at    = NULL,
         marketing_consent       = false,
         terms_version_accepted  = '',
         terms_accepted_at       = NULL,
         accepted_terms_at       = NULL
   WHERE user_id = p_user_id;
  PERFORM set_config('app.pre_verification_wipe', '0', true);

  DELETE FROM public.legal_acceptances WHERE user_id = p_user_id;
  DELETE FROM public.referrals WHERE referred_id = p_user_id;

  INSERT INTO public.pre_verification_wipes (user_id, objects)
  VALUES (p_user_id, v_objects)
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$fn$;
REVOKE ALL ON FUNCTION public.wipe_pre_verification_account(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.wipe_pre_verification_account(uuid) TO service_role;

-- ── 4. Detection at the confirm ─────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.wipe_on_provider_takeover()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_first_provider timestamptz;
BEGIN
  IF OLD.email_confirmed_at IS NOT NULL OR NEW.email_confirmed_at IS NULL THEN
    RETURN NULL;
  END IF;
  IF to_regclass('auth.identities') IS NULL THEN
    RETURN NULL;
  END IF;
  -- An ordinary email-link verification keeps the email identity.
  IF EXISTS (SELECT 1 FROM auth.identities i WHERE i.user_id = NEW.id AND i.provider = 'email') THEN
    RETURN NULL;
  END IF;
  SELECT min(i.created_at) INTO v_first_provider
    FROM auth.identities i WHERE i.user_id = NEW.id AND i.provider <> 'email';
  IF v_first_provider IS NULL THEN
    RETURN NULL;
  END IF;
  -- Began as an email account (not one a provider created).
  IF coalesce(NEW.raw_app_meta_data->>'provider', '') <> 'email'
     AND NOT (NEW.created_at < v_first_provider - interval '5 seconds') THEN
    RETURN NULL;
  END IF;

  BEGIN
    PERFORM public.wipe_pre_verification_account(NEW.id);
  EXCEPTION WHEN OTHERS THEN
    -- Never break the real owner's sign-in; leave the failure where an
    -- operator reads it.
    INSERT INTO public.pre_verification_wipes (user_id, error)
    VALUES (NEW.id, 'wipe failed: ' || SQLERRM);
  END;
  RETURN NULL;
END;
$fn$;
REVOKE ALL ON FUNCTION public.wipe_on_provider_takeover() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS zz_wipe_on_provider_takeover ON auth.users;
CREATE TRIGGER zz_wipe_on_provider_takeover
  AFTER UPDATE OF email_confirmed_at ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.wipe_on_provider_takeover();

-- ── 5. The storage half, for cleanup-abandoned-accounts (service role) ─────
-- One wipe's objects that still exist UNCHANGED since the wipe: one the real
-- owner has since replaced (same key, newer updated_at) is not returned. The
-- sweep removes these through the Storage API, then stamps storage_done_at.
CREATE OR REPLACE FUNCTION public.pre_verification_wipe_objects(p_wipe_id uuid)
RETURNS TABLE (bucket text, name text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
  SELECT o.bucket_id::text, o.name
    FROM public.pre_verification_wipes w
    CROSS JOIN LATERAL jsonb_to_recordset(w.objects) AS x(bucket text, name text)
    JOIN storage.objects o ON o.bucket_id = x.bucket AND o.name = x.name
   WHERE w.id = p_wipe_id
     AND w.storage_done_at IS NULL
     AND coalesce(o.updated_at, o.created_at) <= w.wiped_at
   ORDER BY o.bucket_id, o.name
$fn$;
REVOKE ALL ON FUNCTION public.pre_verification_wipe_objects(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.pre_verification_wipe_objects(uuid) TO service_role;
