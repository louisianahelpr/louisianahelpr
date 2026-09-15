-- A direct offer can't be re-opened on a job that already has a Helpr, or on a
-- job that is no longer open (owner decision, 2026-09-15 pop-up: "Block it").
--
-- THE LEAK. jobs has a third client UPDATE seat besides the poster and the
-- assigned Helpr: "Targeted helper can respond to direct offer"
-- (offered_to_helper_id = uid AND direct_offer_status = 'pending'). Nothing
-- stopped the poster writing those two columns on a hired, funded job, which
-- hands a second account UPDATE on that row. 20260915074058 locked the arrival
-- columns from that seat, but the seat itself could still be re-armed (VN-33(b)
-- authz review; 0 pending offers of any kind on prod, 2026-09-15).
--
-- THE RULE. A client (not is_server_context()) may not make an offer pending —
-- a new offeree or pending again — unless the job is open with no Helpr.
-- Everything legitimate still works:
--   * posting with an offer is an INSERT (jobSubmitHelpers), not affected;
--   * respond_to_direct_offer writes 'accepted' / 'declined', never 'pending';
--   * clearing or declining an offer on any job is still allowed;
--   * server tooling (service role, cron) is exempt.
-- A NEW trigger rather than an edit to enforce_poster_jobs_money_lock or
-- prevent_job_field_escalation, both just rebuilt by 20260915101102.
--
-- REPLAY-SAFETY: CREATE OR REPLACE; DROP TRIGGER IF EXISTS before CREATE; the
-- is_server_context() dependency is created by 20260915101102.

CREATE OR REPLACE FUNCTION public.enforce_direct_offer_not_rearmed()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
BEGIN
  IF public.is_server_context() THEN
    RETURN NEW;
  END IF;

  IF NEW.direct_offer_status = 'pending'
     AND NEW.offered_to_helper_id IS NOT NULL
     AND (NEW.offered_to_helper_id IS DISTINCT FROM OLD.offered_to_helper_id
          OR NEW.direct_offer_status IS DISTINCT FROM OLD.direct_offer_status)
     AND (OLD.helper_id IS NOT NULL OR OLD.status::text <> 'open') THEN
    RAISE EXCEPTION 'direct_offer_job_not_open'
      USING ERRCODE = '42501',
            HINT = 'This job already has a Helpr or is no longer open, so it can''t be offered to someone else.';
  END IF;

  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.enforce_direct_offer_not_rearmed() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_direct_offer_not_rearmed ON public.jobs;
CREATE TRIGGER trg_direct_offer_not_rearmed
  BEFORE UPDATE OF offered_to_helper_id, direct_offer_status ON public.jobs
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_direct_offer_not_rearmed();
