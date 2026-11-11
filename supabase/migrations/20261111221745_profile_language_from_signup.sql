-- F260q (owner 11-11 "Spanish EVERYTHING now"; lead 11-11: a brand-new sign-up has no saved language).
--
-- profiles.language (20261111213927) is written only when a signed-in member picks a language, so every new account
-- started as 'en' even when the visitor had chosen Español on the site: their first notices, push banners and emails
-- came in English until they found the switch again. The sign-up form now sends the visitor's language as user
-- metadata `lang` (src/pages/auth/Signup.tsx: the English/Español switch, else the browser's language), and
-- handle_new_user copies it into the new profile row.
--
--   * Only an exact 'es' gives 'es'. Anything else (missing, 'en', junk, an OAuth sign-up with no such key) gives 'en',
--     the column default, so the CHECK (language IN ('en','es')) can never fail and the sign-up never fails here.
--   * Nothing else in the function changes: the body is the newest definition
--     (20260908002148_ban_survives_a_new_email_phone_and_identity.sql) with `language` added to the profiles INSERT.
--   * The member could already set their own language (column grant); this adds no new power. user_metadata is
--     member-written, which is fine for a display preference limited to two values.
--
-- REPLAY-SAFE: CREATE OR REPLACE; the language column is ensured first (ADD COLUMN IF NOT EXISTS, as 20261111213927),
-- so the function never references a missing column. EXECUTE stays revoked from PUBLIC/anon/authenticated (a trigger
-- function; only the auth.users trigger runs it).

ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS language text NOT NULL DEFAULT 'en';

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  INSERT INTO public.profiles (user_id, full_name, email, language)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'full_name', ''),
    NEW.email,
    CASE WHEN NEW.raw_user_meta_data->>'lang' = 'es' THEN 'es' ELSE 'en' END
  );

  -- Always 'customer' — the universal "member" value. Helper-vs-customer
  -- distinction lives nowhere in the UI; capability gates (IDV, Stripe
  -- Connect) determine what each user can do, not their role.
  INSERT INTO public.user_roles (user_id, role)
  VALUES (NEW.id, 'customer'::app_role);

  -- Every column takes its DEFAULT. Without this row transactional email is
  -- silently dead for the account and the push gate is skipped entirely.
  INSERT INTO public.notification_preferences (user_id)
  VALUES (NEW.id)
  ON CONFLICT (user_id) DO NOTHING;

  -- A ban this address — or this phone, for a provider that supplies one —
  -- carried out of a previous account. Email/password signup leaves
  -- NEW.phone NULL, which is why complete-signup runs the phone check again
  -- once it actually has the number.
  BEGIN
    IF to_regprocedure('public.enforce_retained_ban(uuid,text,text,text)') IS NOT NULL THEN
      PERFORM public.enforce_retained_ban(NEW.id, NEW.email, NEW.phone, NULL);
    END IF;
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'handle_new_user: retained-ban check failed for %: %', NEW.id, SQLERRM;
  END;

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.handle_new_user() IS
  'Seeds profiles/user_roles/notification_preferences for a new auth user (profiles.language from sign-up metadata '
  'lang: es or en), and re-applies any ban retained against this email or phone by a prior account '
  '(see retained_bans / enforce_retained_ban). Never raises: a failure here would fail the signup.';

REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated;
