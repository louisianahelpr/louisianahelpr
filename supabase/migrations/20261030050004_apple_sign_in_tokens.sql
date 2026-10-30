-- Q1791: deleting an account never revoked its Sign in with Apple token.
--
-- App Store Review 5.1.1(v): an app that offers Sign in with Apple must revoke
-- the person's Apple tokens (POST https://appleid.apple.com/auth/revoke) when
-- the account is deleted. Revoking needs a token Apple issued to us, and until
-- now we kept none: Supabase Auth stores the Apple identity (sub, email, name in
-- auth.identities.identity_data) but not Apple's refresh token, and
-- auth.flow_state.provider_refresh_token was empty on every one of its 269
-- Apple rows (measured on prod 2026-10-30, count only).
--
-- This table holds the one Apple refresh token per member that the
-- apple-token-store edge function gets by exchanging the sign-in authorization
-- code with Apple (server side, client secret signed with the Sign in with
-- Apple key). accountPurge's apple_revoke step reads it, calls /auth/revoke and
-- deletes the row, before the auth row goes. client_id is the Apple client the
-- code was issued to (the App ID com.Helpr on iOS, the Services ID on web);
-- Apple refuses a revoke sent under a different client_id.
--
-- Nobody but the service role can read it: RLS on with no policy, and every
-- grant to anon/authenticated revoked. ON DELETE CASCADE so no token outlives
-- the account even if the revoke step could not run.

CREATE TABLE IF NOT EXISTS public.apple_sign_in_tokens (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  refresh_token text NOT NULL CHECK (length(refresh_token) BETWEEN 1 AND 4096),
  client_id text NOT NULL CHECK (client_id ~ '^[A-Za-z0-9.\-]{1,200}$'),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.apple_sign_in_tokens IS
  'Q1791: Apple refresh token per member, kept only so account deletion can call Apple /auth/revoke (App Store Review 5.1.1(v)). Service role only.';

ALTER TABLE public.apple_sign_in_tokens ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.apple_sign_in_tokens FROM PUBLIC;
DO $$
BEGIN
  EXECUTE 'REVOKE ALL ON TABLE public.apple_sign_in_tokens FROM anon, authenticated';
EXCEPTION WHEN undefined_object THEN
  -- A from-scratch PGlite/CI replay has no Supabase roles. Nothing to revoke.
  NULL;
END;
$$;
DO $$
BEGIN
  EXECUTE 'GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.apple_sign_in_tokens TO service_role';
EXCEPTION WHEN undefined_object THEN
  -- No service_role in a bare replay.
  NULL;
END;
$$;
