-- Q1351 (docs/OPEN.md; LOW, from the lh-authz-rls review of Q1318):
-- CSP violation reports get their own error_logs budget.
--
-- WHAT WAS BROKEN. supabase/functions/csp-report inserts every report with the
-- PUBLISHABLE (anon) key, so its rows are guest client rows (user_id NULL,
-- tags.origin 'client', tags.source 'csp'). throttle_client_error_log
-- (20260923100454, live body read 2026-10-12, md5 c805f4b1...) counted them in
-- the ONE shared guest bucket (300 a minute, all guests together). A bad CSP
-- deploy that fires a report on every visitor's page view could spend that
-- whole bucket, and for the rest of each minute the ErrorBoundary/BootWatchdog
-- rows of real guest crashes were dropped.
--
-- MEASURED on prod 2026-10-12, last 30 days: 115 csp rows, peak 4 in one
-- minute; non-csp guest client rows peak 49 in one minute.
--
-- THE FIX. A guest row tagged source 'csp' is counted against its own bucket,
--     v_csp_cap = 100 per minute (25x the measured peak of 4),
-- and the shared guest bucket now counts only NON-csp guest rows. The
-- per-fingerprint cap (20) still applies to both, before either bucket. A
-- client can tag any row 'csp' (tags.source is client-written), but that only
-- moves it INTO the csp bucket: it can no longer spend the crash budget, and
-- it never could escape a cap. Drops of the new bucket are counted as
-- drop_kind 'csp' (the CHECK is widened; without that the recorder would
-- swallow its own CHECK violation and the drop would be invisible), so
-- check_error_log_throttle's sustained-drop alert sees them like any other.
-- That is intended: a CSP storm dropping reports in 2+ of 10 minutes now pages
-- as 'error-log-throttled' (by_kind shows 'csp'). Ceiling for one anonymous
-- caller rises from 300 to 400 stored rows a minute (lh-authz-rls review, noted).
--
-- Signed-in rows are unchanged (per-account cap 60, any source).
--
-- Replay-safe: DROP CONSTRAINT IF EXISTS + ADD, CREATE OR REPLACE; the trigger
-- (trg_error_logs_01_throttle) already points at this function by name.

-- DESTRUCTIVE-DDL-ACK: DROP CONSTRAINT public.error_log_throttle_drops.error_log_throttle_drops_drop_kind_check
-- ACK-REASON: the same CHECK is re-added on the next line with 'csp' added to its list.
-- ACK-DATA-LOSS: none; a CHECK constraint holds no rows, and every existing row satisfies the wider list.
ALTER TABLE public.error_log_throttle_drops DROP CONSTRAINT IF EXISTS error_log_throttle_drops_drop_kind_check;
ALTER TABLE public.error_log_throttle_drops ADD CONSTRAINT error_log_throttle_drops_drop_kind_check CHECK (drop_kind IN ('guest', 'guest_fp', 'account', 'csp'));

COMMENT ON TABLE public.error_log_throttle_drops IS
  'Q113: rows dropped by throttle_client_error_log, per minute x backend pid x drop_kind (guest | guest_fp | account | csp). Written only by record_error_log_throttle_drop; read by check_error_log_throttle and ops_alert_condition(''error-log-throttled''). 14 days kept. Column renamed from kind (Q122); csp added (Q1351).';

CREATE OR REPLACE FUNCTION public.throttle_client_error_log()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $throttle$
DECLARE
  v_account_cap  CONSTANT int := 60;   -- per signed-in account per minute
  v_guest_cap    CONSTANT int := 300;  -- all NON-csp guest rows together per minute (Q113: was 120)
  v_guest_fp_cap CONSTANT int := 20;   -- one guest fingerprint per minute (Q113)
  v_csp_cap      CONSTANT int := 100;  -- guest CSP reports together per minute (Q1351)
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

      IF coalesce(NEW.tags ->> 'source', '') = 'csp' THEN
        -- Q1351: CSP reports (csp-report posts them as anon) have their own
        -- bucket, so a CSP storm cannot spend the guest crash budget below.
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
$throttle$;

COMMENT ON FUNCTION public.throttle_client_error_log() IS
  'BEFORE INSERT on error_logs (after the origin stamp). Drops (RETURN NULL) a client-origin row once, in the last minute, that account has 60 client rows, that guest fingerprint (normalised message + url path, stored as tags.guest_fp) 20, guest CSP reports (tags.source csp) 100 (Q1351), or all other guest rows together 300; every drop is counted in error_log_throttle_drops (Q113). Never raises; server rows untouched (Q98).';

REVOKE ALL ON FUNCTION public.throttle_client_error_log() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.throttle_client_error_log() TO service_role;
