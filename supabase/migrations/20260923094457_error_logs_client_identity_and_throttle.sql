-- Q106 + Q98 (docs/OPEN.md): the public.error_logs CLIENT insert path.
--
-- Q106. anyone_can_insert_errors checks `user_id IS NULL OR user_id =
--   auth.uid()`, so a SIGNED-IN session could insert user_id NULL. The AFTER
--   trigger trg_error_logs_zz_user_error_screen then handed NULL to
--   ops_alert_record_user_error_screen, which applied the guest repeat cap (20)
--   instead of the per-account cap (5) and spent the shared guest budget.
--   Fix: stamp_error_log_origin (the BEFORE INSERT that already stamps
--   tags.origin) sets NEW.user_id := auth.uid() whenever the caller's role is
--   'authenticated'. BEFORE ROW triggers run before RLS WITH CHECK, so the
--   policy still holds (user_id = auth.uid()). The only client writer,
--   src/lib/errorLogger.ts, sends the id it reads from the localStorage session
--   blob, or null when it cannot read one; the stamp makes that the JWT's id.
--
-- Q98. Client rows were stored without limit (Q96 capped only ledger bumps).
--   New BEFORE INSERT trigger trg_error_logs_01_throttle (sorts after
--   00_stamp_origin, so tags.origin and user_id are already stamped) drops a
--   client-origin row (RETURN NULL, never raises) once, in the last minute,
--   that account already has 60 client rows, or all guests together 120.
--   Measured on prod 2026-09-23 over 30 days: the peak per account per minute
--   was 20 (realtimeRecovery socket-closed burst; 15 among origin-stamped
--   client rows), the peak for guest browser rows (user_id NULL, user_agent
--   set) was 7. Server-origin rows are never throttled.
--   A client could previously also send created_at and back-date its rows out
--   of any window, so the stamp now sets created_at := now() on client rows.
--
-- The count is a bounded SELECT (LIMIT cap) over the last minute via
-- idx_error_logs_created / idx_error_logs_user: no locks, no waiting
-- (src/test/errorLogTriggersNeverWait.test.ts). The throttle is SECURITY
-- DEFINER only so it can read error_logs (clients have no SELECT); the stamp
-- stays SECURITY INVOKER because it exists to read the real role.

-- ── Q106: stamp the caller's identity (from the live definition) ──────────
CREATE OR REPLACE FUNCTION public.stamp_error_log_origin()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $function$
DECLARE
  -- Kept identical to CRITICAL_ERROR_LOG_SOURCES in
  -- supabase/functions/_shared/alertPolicy.ts and to v_critical_sources in
  -- notify_slack_on_error_log below; src/test/alertPolicy.test.ts compares all
  -- three.
  v_paging_sources CONSTANT text[] := ARRAY[
    'detect_stuck_payments',
    'auto_start_due_jobs',
    'detect_suspicious_user_patterns',
    'rls-escalation-refused'
  ];
  v_tags   jsonb;
  v_source text;
BEGIN
  -- tags is NOT NULL with a '{}' default, but nothing stops a caller sending an
  -- array or a scalar, and the stamp has to live on an object. Keep whatever
  -- came in rather than dropping it on the floor.
  IF jsonb_typeof(NEW.tags) = 'object' THEN
    v_tags := NEW.tags;
  ELSE
    v_tags := jsonb_build_object('claimed_tags', NEW.tags);
  END IF;

  -- Any role that is not one PostgREST hands a browser. That covers
  -- service_role (edge functions), postgres/supabase_admin (cron, migrations)
  -- and every SECURITY DEFINER path, which runs as its owner.
  IF current_user NOT IN ('anon', 'authenticated') THEN
    NEW.tags := jsonb_set(v_tags, '{origin}', '"server"', true);
    RETURN NEW;
  END IF;

  -- Q106: a signed-in client cannot log as a guest (nor as anyone else). The
  -- row belongs to the JWT's user, whatever user_id the request carried.
  IF current_user = 'authenticated' THEN
    NEW.user_id := auth.uid();
  END IF;

  -- Q98: the throttle windows on created_at; a client cannot back-date a row
  -- out of it.
  NEW.created_at := now();

  v_source := v_tags ->> 'source';

  -- The row is kept in full — message, stack, url, user agent — so client
  -- error logging is unchanged. Only the two fields that decide whether it
  -- PAGES are taken out of the client's hands.
  IF v_source = ANY (v_paging_sources) THEN
    v_tags := jsonb_set(v_tags, '{claimed_source}', to_jsonb(v_source), true);
    v_tags := jsonb_set(v_tags, '{source}', '"client-error"', true);
  END IF;

  -- 'fatal' is the other way into trg_error_logs_slack. A browser crash is a
  -- real 'error'; it is not an operator page.
  IF NEW.severity = 'fatal' THEN
    NEW.severity := 'error';
    v_tags := jsonb_set(v_tags, '{claimed_severity}', '"fatal"', true);
  END IF;

  NEW.tags := jsonb_set(v_tags, '{origin}', '"client"', true);
  RETURN NEW;
END;
$function$;

COMMENT ON FUNCTION public.stamp_error_log_origin() IS
  'BEFORE INSERT on error_logs. Stamps tags.origin from current_user (client for anon/authenticated, server otherwise) and strips a paging source or fatal severity off a client row, keeping the original under tags.claimed_source / tags.claimed_severity. On a client row it also sets created_at := now() and, for role authenticated, user_id := auth.uid() (Q106). SECURITY INVOKER deliberately: it exists to read the real role.';

REVOKE ALL ON FUNCTION public.stamp_error_log_origin() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.stamp_error_log_origin() TO service_role;

-- ── Q98: throttle client-origin rows ───────────────────────────────────────
CREATE OR REPLACE FUNCTION public.throttle_client_error_log()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $throttle$
DECLARE
  v_account_cap CONSTANT int := 60;   -- per signed-in account per minute
  v_guest_cap   CONSTANT int := 120;  -- all guests together per minute
  v_n int;
BEGIN
  -- Server rows (edge functions, cron, SECURITY DEFINER paths) are never
  -- throttled. tags.origin was stamped by trg_error_logs_00_stamp_origin and
  -- a client cannot claim 'server'.
  IF coalesce(NEW.tags ->> 'origin', '') <> 'client' THEN
    RETURN NEW;
  END IF;

  BEGIN
    IF NEW.user_id IS NULL THEN
      SELECT count(*) INTO v_n FROM (
        SELECT 1 FROM public.error_logs e
         WHERE e.user_id IS NULL
           AND e.created_at > now() - interval '1 minute'
           AND e.tags ->> 'origin' = 'client'
         LIMIT v_guest_cap) x;
      IF v_n >= v_guest_cap THEN
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
  'BEFORE INSERT on error_logs (after the origin stamp). Silently drops (RETURN NULL) a client-origin row once that account has 60 client rows in the last minute, or all guests together 120; never raises; server rows untouched (Q98).';

REVOKE ALL ON FUNCTION public.throttle_client_error_log() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.throttle_client_error_log() TO service_role;

DROP TRIGGER IF EXISTS trg_error_logs_01_throttle ON public.error_logs;
CREATE TRIGGER trg_error_logs_01_throttle
  BEFORE INSERT ON public.error_logs
  FOR EACH ROW EXECUTE FUNCTION public.throttle_client_error_log();
