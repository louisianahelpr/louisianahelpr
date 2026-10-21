-- Q1586(a): A MEMBER SAVES THEIR PHONE THROUGH ONE RATE-LIMITED RPC, AND THE
-- DIRECT profiles.phone WRITE IS GONE (owner, 2026-10-13: "Do it fully now";
-- the app has never been in the App Store, so no store-installed bundle is
-- stranded by the floor bump below).
--
-- What was open: trg_guard_profile_phone refuses a number another live
-- account already has (unique_violation, hint 'phone_in_use'), which tells a
-- signed-in member whether a number is registered. It RAISEs, so any attempt
-- counter written beside it rolled back with it (20260907231710: there is no
-- autonomous write on prod), and the refusal could be asked as often as one
-- liked.
--
-- What this does:
--   phone_save_attempts     one row per save the RPC judged (saved,
--                           phone_in_use, phone_invalid), gone with the
--                           account (FK ON DELETE CASCADE). RLS on, no policy,
--                           no grant to anon/authenticated: only the RPC and
--                           the service role read or write it.
--   save_my_phone(p_phone)  the ONE way a member writes their own phone. It
--                           runs the same UPDATE the app used to send, inside
--                           a sub-block, so the existing triggers judge it
--                           exactly as before (trg_guard_profile_phone, the
--                           ban-evasion flag, the retained-ban auto-ban of
--                           20261012042748), then catches ONLY the guard's two
--                           refusals and RETURNS them instead of raising, so
--                           the attempt row survives. Limits: 5 'phone_in_use'
--                           answers per member per 24 hours, 20 judged saves
--                           per hour; past either it answers 'rate_limited'
--                           without looking the number up.
--                           Answers {ok:true} | {ok:false, reason}.
--   grants                  UPDATE (phone) and every INSERT on profiles are
--                           revoked from anon and authenticated. No client
--                           inserts a profile: handle_new_user creates the row
--                           and UNIQUE(user_id) refuses a second one (read
--                           2026-10-13), so no column needed the INSERT grant
--                           (lh-authz-rls review of d1d6337b0, should-fix 2).
--   complete-signup         no longer writes the phone (its service-role
--                           write answered "in use" with no limit; must-fix 1).
--   client_compat_floor() -> 2 (CLIENT_COMPAT_EPOCH 2 in the same change): a
--                           bundle built before this still sends phone in its
--                           profiles UPDATE and would now get "permission
--                           denied"; below the floor it reloads (web) or shows
--                           "Update Helpr" (native).
--
-- Replay-safe: CREATE ... IF NOT EXISTS / CREATE OR REPLACE; REVOKE is idempotent.

CREATE TABLE IF NOT EXISTS public.phone_save_attempts (
  id         bigserial PRIMARY KEY,
  user_id    uuid NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  save_outcome text NOT NULL CHECK (save_outcome IN ('saved', 'phone_in_use', 'phone_invalid')),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS phone_save_attempts_user_created_idx
  ON public.phone_save_attempts (user_id, created_at DESC);
ALTER TABLE public.phone_save_attempts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.phone_save_attempts FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.phone_save_attempts TO service_role;

-- Q807: the unconfirmed-email gate goes on every public table through its own
-- attacher (idempotent; it skips tables that already carry it).
DO $gates$
BEGIN
  IF to_regprocedure('public.attach_unconfirmed_email_gate()') IS NOT NULL THEN
    PERFORM public.attach_unconfirmed_email_gate();
  END IF;
END
$gates$;
REVOKE ALL ON SEQUENCE public.phone_save_attempts_id_seq FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.save_my_phone(p_phone text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid     uuid := auth.uid();
  v_refused int;
  v_tries   int;
  v_rows    int;
  v_hint    text;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501';
  END IF;
  -- A suspended or banned account could not edit its profile (the profiles
  -- ban gate) and cannot save a phone here either.
  IF public.is_caller_banned() THEN
    RAISE EXCEPTION 'account_restricted' USING ERRCODE = '42501';
  END IF;

  -- One save per member at a time, so two taps cannot both pass the limit.
  PERFORM pg_advisory_xact_lock(hashtextextended('phone_save:' || v_uid::text, 0));

  SELECT count(*) FILTER (WHERE a.save_outcome = 'phone_in_use' AND a.created_at > now() - interval '24 hours'),
         count(*) FILTER (WHERE a.created_at > now() - interval '1 hour')
    INTO v_refused, v_tries
    FROM public.phone_save_attempts a
   WHERE a.user_id = v_uid
     AND a.created_at > now() - interval '24 hours';
  IF v_refused >= 5 OR v_tries >= 20 THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'rate_limited');
  END IF;

  BEGIN
    UPDATE public.profiles
       SET phone = NULLIF(btrim(COALESCE(p_phone, '')), '')
     WHERE user_id = v_uid;
    GET DIAGNOSTICS v_rows = ROW_COUNT;
  EXCEPTION WHEN unique_violation OR check_violation THEN
    GET STACKED DIAGNOSTICS v_hint = PG_EXCEPTION_HINT;
    IF v_hint IN ('phone_in_use', 'phone_invalid') THEN
      INSERT INTO public.phone_save_attempts (user_id, save_outcome) VALUES (v_uid, v_hint);
      RETURN jsonb_build_object('ok', false, 'reason', v_hint);
    END IF;
    RAISE;
  END;

  IF v_rows = 0 THEN
    RAISE EXCEPTION 'profile_not_found' USING ERRCODE = 'P0002';
  END IF;
  INSERT INTO public.phone_save_attempts (user_id, save_outcome) VALUES (v_uid, 'saved');
  RETURN jsonb_build_object('ok', true);
END;
$fn$;
REVOKE ALL ON FUNCTION public.save_my_phone(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.save_my_phone(text) TO authenticated, service_role;

DO $do$
BEGIN
  IF to_regclass('public.profiles') IS NULL THEN
    RETURN;
  END IF;
  REVOKE INSERT ON public.profiles FROM anon, authenticated;
  REVOKE UPDATE (phone) ON public.profiles FROM anon, authenticated;
END;
$do$;

CREATE OR REPLACE FUNCTION public.client_compat_floor()
RETURNS integer
LANGUAGE sql
STABLE
PARALLEL SAFE
SET search_path = public
AS $$ SELECT 2 $$;
REVOKE ALL ON FUNCTION public.client_compat_floor() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.client_compat_floor() TO anon, authenticated, service_role;
