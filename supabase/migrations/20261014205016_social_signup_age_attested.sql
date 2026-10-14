-- Google/Apple sign-ups get the same 18+ box as an email sign-up (owner,
-- 2026-10-14 ~3 PM CT pop-up): Complete Profile shows "I confirm I am 18
-- years of age or older" and asks no birthday and no phone.
--
-- An email sign-up's box is checked by complete-signup (ageAttested) before
-- the account is completed, and the app's gate (ProtectedRoute
-- isProfileComplete) lets an email sign-up through on its provider. A
-- Google/Apple sign-up completes on Complete Profile with the member's own
-- profiles UPDATE, so its box needs a column the gate can read on every
-- device: age_attested_at, the moment the member ticked it.
--
-- Additive only (review freeze, release/app-review-freeze.json): a new
-- nullable column and a column UPDATE grant WIDEN what authenticated can do;
-- nothing the 1.0.4 (7119) client writes is narrowed, and 7119 never sends
-- the column.
--
-- Replay-safe: ADD COLUMN IF NOT EXISTS, GRANT is idempotent, CREATE OR
-- REPLACE FUNCTION, DROP TRIGGER IF EXISTS before CREATE TRIGGER.

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS age_attested_at timestamptz;

COMMENT ON COLUMN public.profiles.age_attested_at IS
  'When the member ticked "I confirm I am 18 years of age or older" on Complete Profile (Google/Apple sign-ups, owner 2026-10-14). NULL = not attested there. A saved birthday under 18 still greys out Apply/Post (member_under_18), whatever this says.';

-- profiles UPDATE is granted column by column to authenticated (87 of 101
-- columns, measured 2026-10-14 in information_schema.column_privileges), so a
-- new column is not writable until it is named. The member writes their own
-- row only (existing RLS); anon gets nothing.
GRANT UPDATE (age_attested_at) ON public.profiles TO authenticated;

-- The moment is the server's and the first one wins (lh-authz-rls review of
-- this change, should-fix 2: the column is member-writable, so without this a
-- member could clear it or write any time). Same contract as
-- preserve_first_consent for accepted_terms_at: once set it never moves or
-- clears; the first tick is stamped now(), never the client's clock. The one
-- exemption is the same transaction-local flag wipe_pre_verification_account
-- sets around its UPDATE.
CREATE OR REPLACE FUNCTION public.pin_age_attested_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public', 'pg_temp'
AS $fn$
BEGIN
  IF current_setting('app.pre_verification_wipe', true) = '1' THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.age_attested_at IS NOT NULL THEN
    NEW.age_attested_at := OLD.age_attested_at;
  ELSIF NEW.age_attested_at IS NOT NULL THEN
    NEW.age_attested_at := now();
  END IF;
  RETURN NEW;
END;
$fn$;
REVOKE ALL ON FUNCTION public.pin_age_attested_at() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_profiles_pin_age_attested_at ON public.profiles;
CREATE TRIGGER trg_profiles_pin_age_attested_at
  BEFORE INSERT OR UPDATE OF age_attested_at ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.pin_age_attested_at();
