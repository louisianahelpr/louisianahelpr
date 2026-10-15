-- Q1757 (docs/OPEN.md): an admin could rewrite jobs.stripe_session_id, and
-- since test mode for test accounts that prefix (cs_test_ / cs_live_) decides
-- which Stripe key moves the job's escrow: an admin setting a live job's
-- session to cs_test_ could have a test-mode payout mark it paid while the
-- live escrow stayed on the platform (lh-authz-rls re-review of the test-mode
-- branch, 2026-10-12).
--
-- Posters (enforce_poster_jobs_money_lock, Q1366) and Helprs
-- (enforce_helper_jobs_column_whitelist, prevent_job_field_escalation) were
-- already locked out; admins pass every jobs lock ("Admins can update all
-- jobs"). This trigger makes the column server-only for EVERY caller that is
-- not a server context.
--
-- Writers traced 2026-10-15 before locking (read-only SQL on prod):
--   - live pg_proc: only redeem_gift_card assigns it (`stripe_session_id =
--     null`), and its EXECUTE is postgres + service_role only
--     ({postgres=X/postgres,service_role=X/postgres}), so it runs where
--     is_server_context() is true; detect_stuck_payments and
--     ops_alert_condition only compare it;
--   - supabase/functions write it only through the service-role client
--     (create-payment stampSession, stripe-webhook checkoutSessionExpired);
--   - src/ (and the iOS 7119 build, c16b0f0dc) only READ it, so the review
--     freeze (no narrowing of a privilege the 7119 client uses) holds.
-- is_server_context() (20260915101102): auth.uid() IS NULL and the role is
-- neither anon nor authenticated: service_role, postgres, pg_cron.
--
-- A no-op write (the same value, e.g. a full-row PATCH) is not refused.
-- Replay-safe: CREATE OR REPLACE, DROP TRIGGER IF EXISTS.

CREATE OR REPLACE FUNCTION public.enforce_jobs_checkout_session_server_only()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.stripe_session_id IS DISTINCT FROM OLD.stripe_session_id
     AND NOT public.is_server_context() THEN
    RAISE EXCEPTION 'Only the server may change jobs.stripe_session_id (job_id=%)', OLD.id
      USING ERRCODE = '42501',
            HINT = 'The Checkout Session decides which Stripe key moves this job''s money; it is written only by create-payment and stripe-webhook.';
  END IF;
  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.enforce_jobs_checkout_session_server_only() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_jobs_checkout_session_server_only ON public.jobs;
CREATE TRIGGER trg_jobs_checkout_session_server_only
  BEFORE UPDATE OF stripe_session_id ON public.jobs
  FOR EACH ROW EXECUTE FUNCTION public.enforce_jobs_checkout_session_server_only();
