-- TS-012: report intake had no rate limit. Any signed-in account could insert
-- reports without bound (the "Users can create reports" policy only checks
-- reporter_id = auth.uid()), and each one lands in an admin queue and on the
-- ops ledger. Cap it per reporter: 10 in an hour, 30 in a day. Measured peak on
-- prod (2026-09-24) is 2 per reporter per hour, so no real use comes near it.
--
-- Client inserts only: a service-role / SQL insert (is_server_context(), not a
-- bare NULL uid, which anon has too) is not a user flooding the queue. The advisory lock serialises one reporter's
-- concurrent inserts, so a burst cannot all count the same N-1 and pass.
-- The client maps 'report_rate_limited' to copy (src/lib/reportErrors.ts).

CREATE INDEX IF NOT EXISTS idx_reports_reporter_created
  ON public.reports (reporter_id, created_at DESC);

CREATE OR REPLACE FUNCTION public.reports_rate_limit()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_hour int;
  v_day  int;
BEGIN
  IF public.is_server_context() THEN
    RETURN NEW;
  END IF;
  PERFORM pg_advisory_xact_lock(hashtext('reports_rate_limit:' || NEW.reporter_id::text));
  SELECT count(*) FILTER (WHERE created_at > now() - interval '1 hour'),
         count(*)
    INTO v_hour, v_day
    FROM public.reports
   WHERE reporter_id = NEW.reporter_id
     AND created_at > now() - interval '24 hours';
  IF v_hour >= 10 OR v_day >= 30 THEN  -- TS-012 cap
    RAISE EXCEPTION 'report_rate_limited'
      USING ERRCODE = 'P0001',
            DETAIL = format('%s reports in the last hour, %s in the last day', v_hour, v_day);
  END IF;
  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.reports_rate_limit() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS reports_rate_limit_tg ON public.reports;
CREATE TRIGGER reports_rate_limit_tg
  BEFORE INSERT ON public.reports
  FOR EACH ROW EXECUTE FUNCTION public.reports_rate_limit();
