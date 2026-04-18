-- 1. Add email_verified column to profiles (mirrors auth.users.email_confirmed_at)
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS email_verified boolean NOT NULL DEFAULT false;

-- 2. Backfill from auth.users
UPDATE public.profiles p
SET email_verified = (u.email_confirmed_at IS NOT NULL)
FROM auth.users u
WHERE p.user_id = u.id;

-- 3. Trigger function: keep profiles.email_verified in sync with auth.users.email_confirmed_at
CREATE OR REPLACE FUNCTION public.sync_email_verified()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Only update when the verification state actually changes
  IF (OLD.email_confirmed_at IS NULL) IS DISTINCT FROM (NEW.email_confirmed_at IS NULL) THEN
    UPDATE public.profiles
    SET email_verified = (NEW.email_confirmed_at IS NOT NULL)
    WHERE user_id = NEW.id;
  END IF;
  RETURN NEW;
END;
$$;

-- 4. Attach trigger to auth.users (Supabase allows triggers on auth.users for this purpose)
DROP TRIGGER IF EXISTS sync_email_verified_trigger ON auth.users;
CREATE TRIGGER sync_email_verified_trigger
  AFTER UPDATE OF email_confirmed_at ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.sync_email_verified();

-- 5. Also handle inserts (in case email_confirmed_at is set at signup, e.g., admin-created users)
CREATE OR REPLACE FUNCTION public.sync_email_verified_on_insert()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.email_confirmed_at IS NOT NULL THEN
    UPDATE public.profiles
    SET email_verified = true
    WHERE user_id = NEW.id;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS sync_email_verified_insert_trigger ON auth.users;
CREATE TRIGGER sync_email_verified_insert_trigger
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.sync_email_verified_on_insert();

-- 6. Index for filtering admin pending list quickly
CREATE INDEX IF NOT EXISTS idx_profiles_pending_verified
  ON public.profiles (approval_status, email_verified)
  WHERE approval_status = 'pending';