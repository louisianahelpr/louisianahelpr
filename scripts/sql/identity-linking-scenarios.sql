-- OA-018: the email-to-social identity-linking cases, run against OUR database
-- layer (handle_new_user, sync_email_verified, every other trigger on
-- auth.users / public.profiles) with the exact row writes GoTrue performs.
--
-- WHAT GOTRUE DOES (supabase/auth, read 2026-09-25 from master:
-- internal/models/linking.go DetermineAccountLinking, internal/api/external.go
-- createAccountFromExternalIdentity, internal/models/user.go
-- RemoveUnconfirmedIdentities). Linking is automatic and keyed on a VERIFIED
-- provider email; there is no project setting that turns it off.
--   A  verified email account + provider with the same verified email
--      -> LinkAccount: INSERT auth.identities for the SAME user, merge the
--         provider data into raw_user_meta_data, update app_metadata.providers.
--         No auth.users INSERT, so handle_new_user must not run again.
--   B  UNconfirmed email account + provider with the same verified email
--      -> LinkAccount, then (user not confirmed) RemoveUnconfirmedIdentities:
--         encrypted_password := NULL, raw_user_meta_data := provider data,
--         DELETE the email identity; then Confirm (email_confirmed_at := now).
--   C  Apple "Hide My Email" (a @privaterelay.appleid.com address) -> no match
--      -> CreateAccount: a NEW auth.users row (then identity, then Confirm).
--   D  provider email NOT verified and already used by an account
--      -> CreateAccount with the email BLANKED (IsDuplicatedEmail), identity
--         inserted, user left unconfirmed, and the sign-in refused with
--         provider_email_needs_verification — but the rows are COMMITTED
--         (storage.NewCommitWithError), so our INSERT path must accept a
--         user with no email.
--
-- SAFETY: one DO block, and it always ends in RAISE EXCEPTION, so every row
-- it wrote is rolled back — including on prod. Nothing persists; no email is
-- sent (pg_net's queue is transactional). The verdict travels in the
-- exception text as `OA018_RESULT:<json>`; scripts/check-identity-linking.mjs
-- reads it. Any OTHER error means the scenario could not run, and the script
-- fails closed on it.
DO $oa018$
DECLARE
  v_tag      text := substr(md5(random()::text || clock_timestamp()::text), 1, 12);
  v_email_a  text := 'oa018-a-' || v_tag || '@example.invalid';
  v_email_b  text := 'oa018-b-' || v_tag || '@example.invalid';
  v_email_d  text := 'oa018-d-' || v_tag || '@example.invalid';
  v_relay    text := v_tag || '@privaterelay.appleid.com';
  v_inst     uuid := '00000000-0000-0000-0000-000000000000';
  v_a uuid := gen_random_uuid();
  v_b uuid := gen_random_uuid();
  v_c uuid := gen_random_uuid();
  v_d uuid := gen_random_uuid();
  v_has_ident boolean := to_regclass('auth.identities') IS NOT NULL;
  v_profiles_before int;
  v_n int;
  v_row record;
  v_checks jsonb := '[]'::jsonb;
  v_google jsonb;
BEGIN
  -- ── Pre-state: two email/password accounts that went through signup ──────
  -- (auth.users INSERT fires handle_new_user; the UPDATE is what
  -- complete-signup writes.) A is confirmed, B is not.
  INSERT INTO auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
                          raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
  VALUES (v_inst, v_a, 'authenticated', 'authenticated', v_email_a, '$2a$10$oa018probeoa018probeoa018probeoa018probeoa018probeo', now(),
          '{"provider":"email","providers":["email"]}', '{"full_name":"Oa Eighteen"}', now(), now()),
         (v_inst, v_b, 'authenticated', 'authenticated', v_email_b, '$2a$10$oa018probeoa018probeoa018probeoa018probeoa018probeo', NULL,
          '{"provider":"email","providers":["email"]}', '{"full_name":"Oa Eighteen"}', now(), now());
  IF v_has_ident THEN
    INSERT INTO auth.identities (provider_id, user_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
    VALUES (v_a::text, v_a, jsonb_build_object('sub', v_a::text, 'email', v_email_a, 'email_verified', false), 'email', now(), now(), now()),
           (v_b::text, v_b, jsonb_build_object('sub', v_b::text, 'email', v_email_b, 'email_verified', false), 'email', now(), now(), now());
  END IF;
  UPDATE public.profiles
     SET full_name = 'Oa Eighteen', phone = '(504) 555-0118', location = 'Lafayette, LA', date_of_birth = '1990-01-18'
   WHERE user_id IN (v_a, v_b);

  SELECT count(*) INTO v_profiles_before FROM public.profiles;

  -- ── A: verified account + Google, same verified email ─────────────────────
  v_google := jsonb_build_object('sub', 'oa018-google-a-' || v_tag, 'email', v_email_a, 'email_verified', true,
                                 'full_name', 'Google Display Name', 'name', 'Google Display Name', 'iss', 'https://accounts.google.com');
  IF v_has_ident THEN
    INSERT INTO auth.identities (provider_id, user_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
    VALUES (v_google->>'sub', v_a, v_google, 'google', now(), now(), now());
  END IF;
  UPDATE auth.users
     SET raw_user_meta_data = coalesce(raw_user_meta_data, '{}'::jsonb) || v_google,
         raw_app_meta_data  = coalesce(raw_app_meta_data, '{}'::jsonb) || '{"providers":["email","google"]}'::jsonb,
         updated_at = now()
   WHERE id = v_a;

  SELECT count(*) INTO v_n FROM auth.users WHERE lower(email) = v_email_a;
  v_checks := v_checks || jsonb_build_object('case', 'A', 'check', 'one auth user for the address', 'ok', v_n = 1, 'got', v_n);
  SELECT count(*) INTO v_n FROM public.profiles WHERE user_id = v_a;
  v_checks := v_checks || jsonb_build_object('case', 'A', 'check', 'one profile for the user', 'ok', v_n = 1, 'got', v_n);
  SELECT count(*) INTO v_n FROM public.profiles;
  v_checks := v_checks || jsonb_build_object('case', 'A', 'check', 'linking created no profile', 'ok', v_n = v_profiles_before, 'got', v_n - v_profiles_before);
  SELECT full_name, phone, location, date_of_birth::text AS dob, email INTO v_row FROM public.profiles WHERE user_id = v_a;
  v_checks := v_checks || jsonb_build_object('case', 'A', 'check', 'profile data kept (name not overwritten by the provider)',
    'ok', v_row.full_name = 'Oa Eighteen' AND v_row.phone = '(504) 555-0118' AND v_row.location = 'Lafayette, LA'
          AND v_row.dob = '1990-01-18' AND lower(v_row.email) = v_email_a,
    'got', to_jsonb(v_row));

  -- ── B: UNconfirmed account + Google, same verified email ──────────────────
  v_google := jsonb_build_object('sub', 'oa018-google-b-' || v_tag, 'email', v_email_b, 'email_verified', true,
                                 'full_name', 'Google Display Name', 'iss', 'https://accounts.google.com');
  IF v_has_ident THEN
    INSERT INTO auth.identities (provider_id, user_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
    VALUES (v_google->>'sub', v_b, v_google, 'google', now(), now(), now());
  END IF;
  UPDATE auth.users SET encrypted_password = NULL, raw_user_meta_data = v_google, updated_at = now() WHERE id = v_b;
  IF v_has_ident THEN
    DELETE FROM auth.identities WHERE user_id = v_b AND provider = 'email';
  END IF;
  UPDATE auth.users SET raw_app_meta_data = coalesce(raw_app_meta_data, '{}'::jsonb) || '{"providers":["google"]}'::jsonb WHERE id = v_b;
  UPDATE auth.users SET email_confirmed_at = now(), updated_at = now() WHERE id = v_b;

  SELECT count(*) INTO v_n FROM public.profiles WHERE user_id = v_b;
  v_checks := v_checks || jsonb_build_object('case', 'B', 'check', 'one profile for the user', 'ok', v_n = 1, 'got', v_n);
  SELECT count(*) INTO v_n FROM public.profiles;
  v_checks := v_checks || jsonb_build_object('case', 'B', 'check', 'linking created no profile', 'ok', v_n = v_profiles_before, 'got', v_n - v_profiles_before);
  SELECT full_name, phone, location, date_of_birth::text AS dob, email_verified INTO v_row FROM public.profiles WHERE user_id = v_b;
  v_checks := v_checks || jsonb_build_object('case', 'B', 'check', 'signup data kept through the confirm',
    'ok', v_row.full_name = 'Oa Eighteen' AND v_row.phone = '(504) 555-0118' AND v_row.dob = '1990-01-18',
    'got', to_jsonb(v_row));
  v_checks := v_checks || jsonb_build_object('case', 'B', 'check', 'profiles.email_verified follows the confirm',
    'ok', v_row.email_verified IS TRUE, 'got', v_row.email_verified);

  -- ── C: Apple "Hide My Email" -> a new account ─────────────────────────────
  INSERT INTO auth.users (instance_id, id, aud, role, email, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
  VALUES (v_inst, v_c, 'authenticated', 'authenticated', v_relay, NULL,
          '{"provider":"apple","providers":["apple"]}',
          jsonb_build_object('sub', 'oa018-apple-' || v_tag, 'email', v_relay, 'email_verified', true, 'is_private_email', true),
          now(), now());
  IF v_has_ident THEN
    INSERT INTO auth.identities (provider_id, user_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
    VALUES ('oa018-apple-' || v_tag, v_c,
            jsonb_build_object('sub', 'oa018-apple-' || v_tag, 'email', v_relay, 'email_verified', true, 'is_private_email', true),
            'apple', now(), now(), now());
  END IF;
  UPDATE auth.users SET email_confirmed_at = now() WHERE id = v_c;

  SELECT count(*) INTO v_n FROM public.profiles WHERE user_id = v_c;
  v_checks := v_checks || jsonb_build_object('case', 'C', 'check', 'exactly one new profile', 'ok', v_n = 1, 'got', v_n);
  SELECT email, phone, date_of_birth, avatar_url, location, email_verified, coalesce(ban_status, 'active') AS ban_status
    INTO v_row FROM public.profiles WHERE user_id = v_c;
  -- Incomplete by design: ProtectedRoute's gate (full_name, avatar, DOB,
  -- phone, city) sends it to /complete-profile — a form, not a dead end.
  v_checks := v_checks || jsonb_build_object('case', 'C', 'check', 'new profile is incomplete, verified, not banned (routes to /complete-profile)',
    'ok', lower(v_row.email) = v_relay AND v_row.phone IS NULL AND v_row.date_of_birth IS NULL
          AND v_row.email_verified IS TRUE AND v_row.ban_status = 'active',
    'got', to_jsonb(v_row));
  SELECT full_name, phone INTO v_row FROM public.profiles WHERE user_id = v_a;
  v_checks := v_checks || jsonb_build_object('case', 'C', 'check', 'the existing email account is untouched',
    'ok', v_row.full_name = 'Oa Eighteen' AND v_row.phone = '(504) 555-0118', 'got', to_jsonb(v_row));

  -- ── D: unverified provider email that collides -> user with NO email ──────
  BEGIN
    INSERT INTO auth.users (instance_id, id, aud, role, email, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
    VALUES (v_inst, v_d, 'authenticated', 'authenticated', NULL, '{"provider":"google","providers":["google"]}',
            jsonb_build_object('sub', 'oa018-google-d-' || v_tag, 'email', v_email_d, 'email_verified', false), now(), now());
    SELECT count(*) INTO v_n FROM public.profiles WHERE user_id = v_d;
    v_checks := v_checks || jsonb_build_object('case', 'D', 'check', 'an email-less provider user is accepted (no 500 on the callback)',
      'ok', v_n = 1, 'got', v_n);
  EXCEPTION WHEN OTHERS THEN
    v_checks := v_checks || jsonb_build_object('case', 'D', 'check', 'an email-less provider user is accepted (no 500 on the callback)',
      'ok', false, 'got', SQLERRM);
  END;

  RAISE EXCEPTION 'OA018_RESULT:%', jsonb_build_object('identities_table', v_has_ident, 'checks', v_checks)::text;
END;
$oa018$;
