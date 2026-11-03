-- Q2390 packet 1 (save_my_phone): "not found" answers HTTP 404, not 500.
--
-- PostgREST maps SQLSTATE P0001 to 400 but every other P0 code, P0002 included,
-- to 500, so save_my_phone's profile_not_found read as a server failure (retried
-- by shouldRetryQuery, counted in alerts). RAISE ... USING ERRCODE = 'PT404'
-- makes PostgREST answer 404 (src/lib/queryRetry.ts already reads PT<status>).
--
-- Restated VERBATIM from prod (pg_proc.prosrc md5 efec45a2e1dd79f334fc1e5147759efa,
-- 1826 chars, read 2026-11-02; equal to 20261102082018's body). The ONE change is
-- that ERRCODE. The message (profile_not_found) is unchanged, so the app's copy
-- (rpcErrorMessage, keyed on the message) is unchanged. Grants restated as on prod
-- (proacl: postgres, authenticated, service_role).

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
    RAISE EXCEPTION 'profile_not_found' USING ERRCODE = 'PT404';
  END IF;
  INSERT INTO public.phone_save_attempts (user_id, save_outcome) VALUES (v_uid, 'saved');
  RETURN jsonb_build_object('ok', true);
END;
$fn$;

REVOKE ALL ON FUNCTION public.save_my_phone(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.save_my_phone(text) TO authenticated, service_role;
