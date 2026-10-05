-- Q446 — one account per person: an Apple or Google sign-in that matches no
-- account never silently creates one.
--
-- THE INCIDENT. 2026-05-05 the owner signed in with Apple and chose "Hide My
-- Email". GoTrue received a ...@privaterelay.appleid.com address, its linking
-- step (supabase/auth internal/models/linking.go DetermineAccountLinking)
-- matched no account, so it created a second account beside the owner's
-- real one, with nothing asked.
--
-- WHERE THIS RUNS. GoTrue v2.197.0 (prod, /auth/v1/health 2026-10-05) calls
-- the Before User Created hook from triggerBeforeUserCreatedExternal
-- (internal/api/hooks.go), for the web OAuth callback (external.go) AND the
-- native id-token grant (token_oidc.go), and ONLY when that linking step
-- decided CreateAccount. A same-email sign-in links to the existing account
-- and never reaches the hook (kept, Q446), and linkIdentity (a signed-in
-- person connecting Apple/Google) skips it too.
--
-- WHAT IT DOES. For provider apple/google:
--   * a choice row for this identity (provider + the provider's `sub`) marked
--     "I'm new here" in the last 30 minutes -> consume it, allow the account;
--   * otherwise record a pending choice row and REFUSE with
--     `lh_account_choice:<row id>[:relay]` (HTTP 403). The app reads that
--     message (src/lib/accountChoice.ts) and asks: "I already have an account"
--     (sign in to it, then Connect Apple/Google in Profile > Security) or
--     "I'm new here" (public.choose_new_social_account(<row id>), then the
--     same sign-in again, which this hook now allows).
-- Hide My Email still works for a new person (App Store guideline 4.8): it is
-- asked the same one question, never refused.
--
-- GoTrue calls the hook outside any transaction (hooks.go checkTX), so the
-- `select hook(...)` autocommits and GoTrue reads the returned error after
-- it (internal/hooks/hookspgfunc): the pending row persists although the
-- sign-in is refused. The "I'm new here" row is consumed before GoTrue
-- inserts the user in a later transaction; if that insert fails the person is
-- simply asked again (fails closed; lh-authz-rls review of 9182fce5a).
--
-- PRIVACY. The row keeps provider + sub + whether the address was an Apple
-- relay. No email, no name. Rows older than a day are deleted on every call.
--
-- ENABLING IT is an auth-config change (dashboard: Authentication > Hooks >
-- Before User Created > Postgres > public.hook_one_account_per_person), made
-- by the owner; scripts/check-identity-linking.mjs FAILS until it is on.
--
-- REPLAY-SAFE: CREATE ... IF NOT EXISTS, CREATE OR REPLACE, role-guarded grants.

CREATE TABLE IF NOT EXISTS public.social_signup_choices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  social_provider text NOT NULL CHECK (social_provider IN ('apple', 'google')),
  provider_sub text NOT NULL,
  relay boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  chose_new_at timestamptz
);

CREATE INDEX IF NOT EXISTS social_signup_choices_identity_idx
  ON public.social_signup_choices (social_provider, provider_sub);
-- The daily purge runs on every hook call.
CREATE INDEX IF NOT EXISTS social_signup_choices_created_idx
  ON public.social_signup_choices (created_at);

-- Server-only: no client policy, no client grant.
ALTER TABLE public.social_signup_choices ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.social_signup_choices FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.social_signup_choices TO service_role;

CREATE OR REPLACE FUNCTION public.hook_one_account_per_person(event jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $fn$
DECLARE
  v_provider text := event->'user'->'app_metadata'->>'provider';
  v_key text;
  v_relay boolean;
  v_id uuid;
  v_allowed int;
BEGIN
  -- Email/password sign-ups, invites and admin-created users are not ours.
  IF v_provider IS NULL OR v_provider NOT IN ('apple', 'google') THEN
    RETURN '{}'::jsonb;
  END IF;

  v_key := coalesce(
    nullif(event->'user'->'user_metadata'->>'sub', ''),
    nullif(lower(event->'user'->>'email'), '')
  );
  IF v_key IS NULL THEN
    -- No subject and no email: GoTrue refuses such an identity itself
    -- (error_code email_address_not_provided / bad id token).
    RETURN '{}'::jsonb;
  END IF;
  v_relay := lower(coalesce(event->'user'->>'email', '')) LIKE '%@privaterelay.appleid.com';

  DELETE FROM public.social_signup_choices WHERE created_at < now() - interval '1 day';

  -- The person already answered "I'm new here" for this identity.
  DELETE FROM public.social_signup_choices
   WHERE social_provider = v_provider
     AND provider_sub = v_key
     AND chose_new_at IS NOT NULL
     AND chose_new_at > now() - interval '30 minutes';
  GET DIAGNOSTICS v_allowed = ROW_COUNT;
  IF v_allowed > 0 THEN
    RETURN '{}'::jsonb;
  END IF;

  INSERT INTO public.social_signup_choices (social_provider, provider_sub, relay)
  VALUES (v_provider, v_key, v_relay)
  RETURNING id INTO v_id;

  RETURN jsonb_build_object(
    'error', jsonb_build_object(
      'http_code', 403,
      'message', 'lh_account_choice:' || v_id::text || CASE WHEN v_relay THEN ':relay' ELSE '' END
    )
  );
END;
$fn$;

REVOKE ALL ON FUNCTION public.hook_one_account_per_person(jsonb) FROM PUBLIC, anon, authenticated;

DO $grant$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'supabase_auth_admin') THEN
    GRANT EXECUTE ON FUNCTION public.hook_one_account_per_person(jsonb) TO supabase_auth_admin;
  END IF;
END
$grant$;

-- "I'm new here": the person on the choice screen marks THEIR pending row
-- (the id only reaches the browser/app that was refused; 122 random bits).
-- Signed out at this point, so anon may call it. Marking someone else's row
-- would gain nothing: the account is still created only by that identity's
-- own next Apple/Google sign-in.
CREATE OR REPLACE FUNCTION public.choose_new_social_account(p_choice uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $fn$
DECLARE
  v_n int;
BEGIN
  UPDATE public.social_signup_choices
     SET chose_new_at = now()
   WHERE id = p_choice
     AND chose_new_at IS NULL
     AND created_at > now() - interval '30 minutes';
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN v_n > 0;
END;
$fn$;

REVOKE ALL ON FUNCTION public.choose_new_social_account(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.choose_new_social_account(uuid) TO anon, authenticated;

SELECT public.attach_unconfirmed_email_gate();
