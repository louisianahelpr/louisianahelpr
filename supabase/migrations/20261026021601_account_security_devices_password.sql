-- Board 175 (You › Security, owner 2026-10-25 "build the gaps"): sign out ONE device, and change the
-- password in the app (current password, then the new one). On for everyone, no switch (owner rule
-- 2026-10-25: these ship on for everyone).
--
-- 1. my_auth_sessions(): the caller's own live sign-ins from auth.sessions (one row per signed-in
--    device), newest first: the session id, the device's user agent, when it signed in, when it was
--    last active, and whether it is THIS session (auth.jwt() session_id). Never another member's.
--    The IP address is not returned (a screen that only needs "iPhone · Safari" does not need it).
-- 2. revoke_my_session(p_session_id): deletes ONE of the caller's own sessions (never the one making
--    the call: Log out does that). auth.refresh_tokens.session_id is ON DELETE CASCADE (measured on
--    prod 2026-10-26), so that device can no longer refresh; the access token it already holds runs
--    out at its own expiry, the same as Supabase's signOut({ scope: "others" }). Returns whether a
--    row was removed.
-- 3. verify_my_password(p_password): true when p_password is the caller's current password, compared
--    with pgcrypto's crypt() against auth.users.encrypted_password (GoTrue's bcrypt). Rate limited to
--    5 tries per 15 minutes and 20 per day per member through public.rate_limit_hit; past that it raises
--    'too_many_attempts' (P0001), and the raise rolls back that refused try's own hit row. An account with no
--    password (Apple/Google only) reads false. The client then calls auth.updateUser({ password }).
--
-- All three: SECURITY DEFINER, search_path pinned, a signed-in caller only, EXECUTE for
-- authenticated only (REVOKE FROM PUBLIC, anon). Replay-safe: new functions only.

CREATE OR REPLACE FUNCTION public.my_auth_sessions()
RETURNS TABLE(session_id uuid, user_agent text, signed_in_at timestamptz, last_active_at timestamptz, is_current boolean)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  v_uid uuid := auth.uid();
  v_current text := auth.jwt() ->> 'session_id';
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
    SELECT s.id,
           s.user_agent,
           s.created_at,
           greatest(s.created_at, coalesce(s.updated_at, s.created_at), coalesce(s.refreshed_at AT TIME ZONE 'UTC', s.created_at)),
           s.id::text = coalesce(v_current, '')
      FROM auth.sessions s
     WHERE s.user_id = v_uid
       AND (s.not_after IS NULL OR s.not_after > now())
     ORDER BY 4 DESC;
END;
$fn$;

CREATE OR REPLACE FUNCTION public.revoke_my_session(p_session_id uuid)
RETURNS boolean
LANGUAGE plpgsql
VOLATILE SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  v_uid uuid := auth.uid();
  v_current text := auth.jwt() ->> 'session_id';
  v_n integer;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501';
  END IF;
  IF p_session_id IS NULL THEN
    RAISE EXCEPTION 'session_required' USING ERRCODE = '22023';
  END IF;
  -- A token with no session id cannot prove which session is "this one": refuse rather than guess.
  IF v_current IS NULL THEN
    RAISE EXCEPTION 'session_unknown' USING ERRCODE = '42501';
  END IF;
  IF p_session_id::text = v_current THEN
    RAISE EXCEPTION 'this_session' USING ERRCODE = '22023',
      DETAIL = 'Use Log out to sign out of this device.';
  END IF;
  DELETE FROM auth.sessions s WHERE s.id = p_session_id AND s.user_id = v_uid;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN v_n > 0;
END;
$fn$;

CREATE OR REPLACE FUNCTION public.verify_my_password(p_password text)
RETURNS boolean
LANGUAGE plpgsql
VOLATILE SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  v_uid uuid := auth.uid();
  v_hash text;
  v_limit jsonb;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501';
  END IF;
  -- Two windows: 5 tries per 15 minutes, and 20 per day (a refused try's own hit rolls back with
  -- its raise, so the day bucket is what caps a steady 5-every-15-minutes guesser; authz review).
  v_limit := public.rate_limit_hit('verify_my_password', v_uid::text, NULL, 900, 5, 5);
  IF coalesce((v_limit ->> 'allowed')::boolean, false) THEN
    v_limit := public.rate_limit_hit('verify_my_password_day', v_uid::text, NULL, 86400, 20, 20);
  END IF;
  IF NOT coalesce((v_limit ->> 'allowed')::boolean, false) THEN
    RAISE EXCEPTION 'too_many_attempts' USING ERRCODE = 'P0001',
      DETAIL = 'Too many tries. Wait 15 minutes, or reset your password by email.';
  END IF;
  SELECT u.encrypted_password INTO v_hash FROM auth.users u WHERE u.id = v_uid;
  IF v_hash IS NULL OR v_hash = '' OR coalesce(p_password, '') = '' THEN
    RETURN false;
  END IF;
  RETURN v_hash = extensions.crypt(p_password, v_hash);
END;
$fn$;

REVOKE ALL ON FUNCTION public.my_auth_sessions() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.revoke_my_session(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.verify_my_password(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.my_auth_sessions() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.revoke_my_session(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.verify_my_password(text) TO authenticated, service_role;
