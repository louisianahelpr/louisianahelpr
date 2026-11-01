-- NOID-24 M6 (admin audit E4, 10-30): a report whose target no longer exists sits in the admin Reports queue for
-- ever. Measured on prod (read-only, 10-31 ~16:18 CT): report 219ec2ff-850c-435b-b385-4cecfebe90d7, a 'user' report
-- ("Fake profile", status investigating, filed 2026-06-23, 130 days old) whose reported_id
-- 11111111-1111-1111-1111-111111111102 is a demo-seed id (supabase/seed-demo-data.sql) with no auth.users row and no
-- profile: nobody can act on it. The other 3 open reports have a live target or are support rows.
--
-- 1. Once: every open 'user' or 'job' report whose target is gone is set to 'dismissed' (nothing left to act on).
-- 2. From now on: deleting a profile or a job dismisses that target's open reports.
-- Support rows (reported_id NULL, guest messages) and every other report type are left alone (b35 10-30: "M6 must
-- leave nil reported_id rows alone"). No row is deleted. 'dismissed' is one of reports_status_check's values.
-- The UPDATE runs only when a row matches, so a delete that touches no report never fires the reports statement
-- triggers (zz_refuse_unconfirmed_email_write); a session that may delete a profile or a job has passed that same
-- check on profiles/jobs already.
-- Proof: src/test/pglite/reportsCloseWhenTargetDeleted.pglite.mjs (applied 3x; NEW_MIGRATION=skip and 4 mutants fail).

UPDATE public.reports r
   SET status = 'dismissed'
 WHERE r.status IN ('pending', 'new', 'investigating', 'reviewed')
   AND r.reported_id IS NOT NULL
   AND (
     (r.reported_type = 'user'
       AND NOT EXISTS (SELECT 1 FROM auth.users u WHERE u.id = r.reported_id)
       AND NOT EXISTS (SELECT 1 FROM public.profiles p WHERE p.user_id = r.reported_id))
     OR (r.reported_type = 'job' AND NOT EXISTS (SELECT 1 FROM public.jobs j WHERE j.id = r.reported_id))
   );

CREATE OR REPLACE FUNCTION public.reports_dismiss_for_deleted_target()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $fn$
DECLARE
  v_type text;
  v_id uuid;
BEGIN
  -- Separate statements: each field is read only on its own table (a CASE would plan both).
  IF TG_TABLE_NAME = 'profiles' THEN
    v_type := 'user';
    v_id := OLD.user_id;
  ELSE
    v_type := 'job';
    v_id := OLD.id;
  END IF;
  IF v_id IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.reports r
     WHERE r.reported_type = v_type AND r.reported_id = v_id
       AND r.status IN ('pending', 'new', 'investigating', 'reviewed')
  ) THEN
    UPDATE public.reports
       SET status = 'dismissed'
     WHERE reported_type = v_type AND reported_id = v_id
       AND status IN ('pending', 'new', 'investigating', 'reviewed');
  END IF;
  RETURN OLD;
END;
$fn$;

REVOKE ALL ON FUNCTION public.reports_dismiss_for_deleted_target() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_reports_dismiss_deleted_profile ON public.profiles;
CREATE TRIGGER trg_reports_dismiss_deleted_profile
  AFTER DELETE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.reports_dismiss_for_deleted_target();

DROP TRIGGER IF EXISTS trg_reports_dismiss_deleted_job ON public.jobs;
CREATE TRIGGER trg_reports_dismiss_deleted_job
  AFTER DELETE ON public.jobs
  FOR EACH ROW EXECUTE FUNCTION public.reports_dismiss_for_deleted_target();
