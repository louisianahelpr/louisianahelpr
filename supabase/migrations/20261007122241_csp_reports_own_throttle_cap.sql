-- Q1351 (lh-authz-rls review of Q1318, 2026-10-05): CSP violation reports get
-- their OWN per-minute budget in throttle_client_error_log.
--
-- csp-report writes one guest row (user_id NULL, origin 'client',
-- tags.source = 'csp') per report it keeps. Those rows counted against the
-- 300/min ALL-GUESTS cap, so a bad CSP deploy that every visitor trips could
-- spend the budget ErrorBoundary / BootWatchdog crash rows need. Now:
--   * a csp row is capped at 60/min across all csp guest rows (its own
--     drop kind 'csp' in error_log_throttle_drops), after the existing
--     per-fingerprint cap (20/min) that still applies to it;
--   * the all-guests cap counts only NON-csp guest rows, so csp rows never
--     consume it.
-- Accepted trade (lh-authz-rls review, 2026-10-07): tags.source is the
-- sender's word (any anon caller can write source='csp' straight to
-- error_logs), so the guest TOTAL is now up to 360 rows a minute (300 non-csp
-- + 60 csp) where it was 300; and a spammer can fill the 60 csp slots, as
-- 300 junk rows could hide CSP reports before.
-- Everything else is the live definition (pg_get_functiondef, 2026-10-07)
-- unchanged. Replay-safe: the CHECK is dropped and re-added, the function is
-- CREATE OR REPLACE.

ALTER TABLE public.error_log_throttle_drops
  DROP CONSTRAINT IF EXISTS error_log_throttle_drops_drop_kind_check;
ALTER TABLE public.error_log_throttle_drops
  ADD CONSTRAINT error_log_throttle_drops_drop_kind_check
  CHECK (drop_kind = ANY (ARRAY['guest'::text, 'guest_fp'::text, 'account'::text, 'csp'::text]));

CREATE OR REPLACE FUNCTION public.throttle_client_error_log()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path = public, pg_temp
AS $function$
DECLARE
  v_account_cap  CONSTANT int := 60;   -- per signed-in account per minute
  v_guest_cap    CONSTANT int := 300;  -- all NON-csp guests together per minute (Q113: was 120)
  v_guest_fp_cap CONSTANT int := 20;   -- one guest fingerprint per minute (Q113)
  v_csp_cap      CONSTANT int := 60;   -- all CSP reports together per minute (Q1351)
  v_n  int;
  v_fp text;
  v_is_csp boolean;
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

      -- Q1351: CSP reports spend their own budget, never the crash rows'.
      v_is_csp := coalesce(NEW.tags ->> 'source', '') = 'csp';
      IF v_is_csp THEN
        SELECT count(*) INTO v_n FROM (
          SELECT 1 FROM public.error_logs e
           WHERE e.user_id IS NULL
             AND e.created_at > now() - interval '1 minute'
             AND e.tags ->> 'origin' = 'client'
             AND e.tags ->> 'source' = 'csp'
           LIMIT v_csp_cap) x;
        IF v_n >= v_csp_cap THEN
          PERFORM public.record_error_log_throttle_drop('csp');
          RETURN NULL;
        END IF;
      ELSE
        SELECT count(*) INTO v_n FROM (
          SELECT 1 FROM public.error_logs e
           WHERE e.user_id IS NULL
             AND e.created_at > now() - interval '1 minute'
             AND e.tags ->> 'origin' = 'client'
             AND coalesce(e.tags ->> 'source', '') <> 'csp'
           LIMIT v_guest_cap) x;
        IF v_n >= v_guest_cap THEN
          PERFORM public.record_error_log_throttle_drop('guest');
          RETURN NULL;
        END IF;
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
$function$;

-- A trigger function: no caller needs EXECUTE (restated per the default ACL).
REVOKE ALL ON FUNCTION public.throttle_client_error_log() FROM PUBLIC, anon, authenticated;
