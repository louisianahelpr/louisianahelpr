-- A quote-booked job's crew shape is part of what was agreed (lh-authz-rls review, 2026-10-21,
-- builder2f board 43 follow-up).
--
-- GAP: before checkout, lock_quote_booked_job_terms (20261015091114_job_quotes.sql, unchanged on prod:
-- md5(prosrc) a5e3cbe249c1923972938e07fae6d405, checked 2026-10-21) locked the price and the details but
-- not is_group_job / helpers_needed. A poster could book an agreed $220 quote, PATCH is_group_job=true,
-- helpers_needed=4 before paying, and pay $220 for a 4-person crew: each share ~$55, far below the agreed
-- take-home, and the quoter's direct offer could no longer be taken (accept_job_offer refuses a group job).
-- From checkout on, enforce_group_job_has_no_lead's crew_shape_locked already freezes both; this closes the
-- window before it. is_urgent joins the tuple too (the money lock already covers it; listed for clarity).
--
-- Restated from its NEWEST definition (20261015091114), with only helpers_needed, is_group_job and
-- is_urgent added to the compared tuple and to the trigger's column list (without the trigger list the
-- function never fires for an update touching only those columns). The pre-hire condition and the
-- is_server_context() bypass are unchanged.
--
-- NOTE for the next editor (lh-authz-rls review): "pre-hire" is OLD.helper_id IS NULL, and a group job never
-- sets helper_id. That is safe only because quote_insert_job inserts a single-Helpr job and this lock now
-- stops a client flipping is_group_job. If quote requests ever carry a crew shape, make the pre-hire test a
-- roster check (group_job_helpers) as well.
--
-- Replay-safe: CREATE OR REPLACE + DROP TRIGGER IF EXISTS. Grants by role name.
CREATE OR REPLACE FUNCTION public.lock_quote_booked_job_terms()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
BEGIN
  IF public.is_server_context() THEN
    RETURN NEW;
  END IF;
  IF (NEW.budget, NEW.title, NEW.description, NEW.category, NEW.date_needed, NEW.start_time,
      NEW.estimated_hours, NEW.location, NEW.latitude, NEW.longitude,
      NEW.helpers_needed, NEW.is_group_job, NEW.is_urgent)
     IS DISTINCT FROM
     (OLD.budget, OLD.title, OLD.description, OLD.category, OLD.date_needed, OLD.start_time,
      OLD.estimated_hours, OLD.location, OLD.latitude, OLD.longitude,
      OLD.helpers_needed, OLD.is_group_job, OLD.is_urgent)
     AND OLD.helper_id IS NULL
     AND EXISTS (SELECT 1 FROM public.job_quote_requests r
                  WHERE r.job_id = OLD.id AND r.status IN ('agreed', 'cancelled')) THEN
    RAISE EXCEPTION 'quote_terms_locked' USING ERRCODE = '42501',
      HINT = 'This job was booked from an agreed quote; its price and details are what was agreed.';
  END IF;
  RETURN NEW;
END;
$fn$;
REVOKE ALL ON FUNCTION public.lock_quote_booked_job_terms() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_lock_quote_booked_job_terms ON public.jobs;
CREATE TRIGGER trg_lock_quote_booked_job_terms
  BEFORE UPDATE OF budget, title, description, category, date_needed, start_time,
                   estimated_hours, location, latitude, longitude,
                   helpers_needed, is_group_job, is_urgent ON public.jobs
  FOR EACH ROW EXECUTE FUNCTION public.lock_quote_booked_job_terms();
