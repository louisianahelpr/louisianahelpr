-- Live prod definitions (pg_get_functiondef, read 2026-10-07) for the Q1351 PGlite proof:
-- the error_logs throttle as it stands BEFORE 20261007122241, and what it calls.
CREATE TABLE public.error_log_throttle_drops (minute timestamptz NOT NULL, backend_pid integer NOT NULL, drop_kind text NOT NULL CHECK (drop_kind = ANY (ARRAY['guest'::text, 'guest_fp'::text, 'account'::text])), dropped integer NOT NULL DEFAULT 1, first_at timestamptz NOT NULL DEFAULT now(), last_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY (minute, backend_pid, drop_kind));
CREATE OR REPLACE FUNCTION public.ops_alert_normalise(p_text text)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public'
AS $function$
  SELECT left(btrim(replace(regexp_replace(
    regexp_replace(
    regexp_replace(
    regexp_replace(
    regexp_replace(
    regexp_replace(
    regexp_replace(
    regexp_replace(
    regexp_replace(lower(coalesce(p_text, '')),
      '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}', '<id>', 'g'),
      '\m(pi|ch|tr|po|py|re|in|cs|pm|acct|cus|evt|sub|seti|txn|src|ba|card|dp|ipi|price|prod|whsec)_[a-z0-9]{6,}', '<id>', 'g'),
      '[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}', '<email>', 'g'),
      'https?://[^ )]+', '<url>', 'g'),
      -- ISO date / timestamp, as one unit
      '\m[0-9]{4}-[0-9]{2}-[0-9]{2}([t ][0-9]{2}:[0-9]{2}(:[0-9]{2}(\.[0-9]+)?)?(z|[+-][0-9]{2}(:?[0-9]{2})?)?)?', '<ts>', 'g'),
      -- hex ids need a letter AND a digit; an all-digit run is a number below
      '\m(?=[0-9]*[a-f])(?=[a-f]*[0-9])[0-9a-f]{6,}\M', '<id>', 'g'),
      -- KEEP an HTTP-ish status code after its keyword: "returned 500", "status: 404", "http 502"
      '\m(https?|status|returned|responded|code|error)([ :=]{0,3})([1-5])([0-9])([0-9])(?![0-9])',
      '\1\2' || chr(1) || '\3' || chr(1) || '\4' || chr(1) || '\5', 'g'),
      -- every other number (with its sign), unless glued to a name (v2, job_7)
      '(?<![0-9a-z_' || chr(1) || '])-?[0-9]+([.,:][0-9]+)*', '#', 'g'),
    '\s+', ' ', 'g'), chr(1), '')), 200)
$function$
;
CREATE OR REPLACE FUNCTION public.record_error_log_throttle_drop(p_kind text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_prev text := current_setting('lock_timeout');
BEGIN
  BEGIN
    -- Keyed by backend pid: the only row this can meet was written by an
    -- earlier transaction on this same connection. Bounded anyway.
    IF v_prev IN ('0', '') OR v_prev::interval > interval '50 milliseconds' THEN
      PERFORM set_config('lock_timeout', '50ms', true);
    END IF;
    INSERT INTO public.error_log_throttle_drops AS d (minute, backend_pid, drop_kind, dropped, first_at, last_at)
    VALUES (date_trunc('minute', now()), pg_backend_pid(), p_kind, 1, now(), now())
    ON CONFLICT (minute, backend_pid, drop_kind)
    DO UPDATE SET dropped = d.dropped + 1, last_at = EXCLUDED.last_at;
    PERFORM set_config('lock_timeout', v_prev, true);
  EXCEPTION WHEN lock_not_available OR deadlock_detected THEN
    -- The sub-block's abort restored lock_timeout. The row is still dropped.
    NULL;
  WHEN OTHERS THEN
    NULL;
  END;
END;
$function$
;
CREATE OR REPLACE FUNCTION public.throttle_client_error_log()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_account_cap  CONSTANT int := 60;   -- per signed-in account per minute
  v_guest_cap    CONSTANT int := 300;  -- all guests together per minute (Q113: was 120)
  v_guest_fp_cap CONSTANT int := 20;   -- one guest fingerprint per minute (Q113)
  v_n  int;
  v_fp text;
BEGIN
  -- Server rows (edge functions, cron, SECURITY DEFINER paths) are never
  -- throttled. tags.origin was stamped by trg_error_logs_00_stamp_origin and
  -- a client cannot claim 'server'.
  IF coalesce(NEW.tags ->> 'origin', '') <> 'client' THEN
    RETURN NEW;
  END IF;

  BEGIN
    IF NEW.user_id IS NULL THEN
      -- Q113: normalised message + normalised url path. Stored on the row
      -- (overwriting anything the client sent) so the count is an equality.
      v_fp := md5(
        coalesce(public.ops_alert_normalise(left(coalesce(NEW.message, ''), 300)), '') || '|' ||
        coalesce(public.ops_alert_normalise(
          substring(coalesce(NEW.url, '') from '^(?:[A-Za-z][A-Za-z0-9+.-]*://[^/?#]*)?([^?#]*)')), ''));
      NEW.tags := jsonb_set(NEW.tags, '{guest_fp}', to_jsonb(v_fp), true);

      SELECT count(*) INTO v_n FROM (
        SELECT 1 FROM public.error_logs e
         WHERE e.user_id IS NULL
           AND e.created_at > now() - interval '1 minute'
           AND e.tags ->> 'origin' = 'client'
           AND e.tags ->> 'guest_fp' = v_fp
         LIMIT v_guest_fp_cap) x;
      IF v_n >= v_guest_fp_cap THEN
        PERFORM public.record_error_log_throttle_drop('guest_fp');
        RETURN NULL;
      END IF;

      SELECT count(*) INTO v_n FROM (
        SELECT 1 FROM public.error_logs e
         WHERE e.user_id IS NULL
           AND e.created_at > now() - interval '1 minute'
           AND e.tags ->> 'origin' = 'client'
         LIMIT v_guest_cap) x;
      IF v_n >= v_guest_cap THEN
        PERFORM public.record_error_log_throttle_drop('guest');
        RETURN NULL;
      END IF;
    ELSE
      SELECT count(*) INTO v_n FROM (
        SELECT 1 FROM public.error_logs e
         WHERE e.user_id = NEW.user_id
           AND e.created_at > now() - interval '1 minute'
           AND e.tags ->> 'origin' = 'client'
         LIMIT v_account_cap) x;
      IF v_n >= v_account_cap THEN
        PERFORM public.record_error_log_throttle_drop('account');
        RETURN NULL;
      END IF;
    END IF;
  EXCEPTION WHEN OTHERS THEN
    -- The logger must never break the app: on any failure, keep the row.
    RETURN NEW;
  END;

  RETURN NEW;
END;
$function$
;
