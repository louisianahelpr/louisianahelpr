-- Q1501 (lh-authz-rls review of Q1254, finding e1f83f9e9#4): no rate limit on
-- change requests. request_job_detail_change replaces the pending request and
-- notifies every booked Helpr on every call, and request_job_schedule_change
-- does the same to the other party, so one person could spam a crew or a
-- Helpr with a notification per call.
--
-- THE CAP: 5 requests of one kind, per requester, per job, in any 24 hours.
-- A real change is one or two asks (a typo, then the fix); the fifth in a day
-- is already noise. Counted on the request tables themselves, so a replaced
-- or answered request still counts.
--
-- One trigger function on both tables (BEFORE INSERT), the reports pattern
-- (20260924061853): the RPCs need no restating, the refusal rolls back the
-- RPC's own "replace the pending one" update with it, and the advisory lock
-- serialises one requester's burst on one job so concurrent calls cannot all
-- count the same N-1. Server context (service role, SQL) is not a person and
-- is exempt.
--
-- The client maps 'change_request_rate_limited' to copy (src/lib/lifecycleErrors.ts).
-- Proof: src/test/pglite/changeRequestDailyCap.pglite.mjs (applied 3x).
-- Guard: src/test/changeRequestDailyCap.test.ts.
CREATE INDEX IF NOT EXISTS idx_job_detail_change_requests_job_requester_created
  ON public.job_detail_change_requests (job_id, requested_by, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_job_schedule_change_requests_job_requester_created
  ON public.job_schedule_change_requests (job_id, requested_by, created_at DESC);

CREATE OR REPLACE FUNCTION public.change_request_daily_cap()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  v_count int;
BEGIN
  IF public.is_server_context() THEN
    RETURN NEW;
  END IF;
  PERFORM pg_advisory_xact_lock(
    hashtext('change_request_daily_cap:' || TG_TABLE_NAME || ':' || NEW.job_id::text || ':' || NEW.requested_by::text));
  IF TG_TABLE_NAME = 'job_detail_change_requests' THEN
    SELECT count(*) INTO v_count FROM public.job_detail_change_requests r
     WHERE r.job_id = NEW.job_id AND r.requested_by = NEW.requested_by
       AND r.created_at > now() - interval '24 hours';
  ELSE
    SELECT count(*) INTO v_count FROM public.job_schedule_change_requests r
     WHERE r.job_id = NEW.job_id AND r.requested_by = NEW.requested_by
       AND r.created_at > now() - interval '24 hours';
  END IF;
  IF v_count >= 5 THEN  -- Q1501 cap
    RAISE EXCEPTION 'change_request_rate_limited'
      USING ERRCODE = 'P0001',
            DETAIL = format('%s requests on this job in the last day', v_count);
  END IF;
  RETURN NEW;
END;
$fn$;

REVOKE ALL ON FUNCTION public.change_request_daily_cap() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS change_request_daily_cap_tg ON public.job_detail_change_requests;
CREATE TRIGGER change_request_daily_cap_tg
  BEFORE INSERT ON public.job_detail_change_requests
  FOR EACH ROW EXECUTE FUNCTION public.change_request_daily_cap();

DROP TRIGGER IF EXISTS change_request_daily_cap_tg ON public.job_schedule_change_requests;
CREATE TRIGGER change_request_daily_cap_tg
  BEFORE INSERT ON public.job_schedule_change_requests
  FOR EACH ROW EXECUTE FUNCTION public.change_request_daily_cap();
