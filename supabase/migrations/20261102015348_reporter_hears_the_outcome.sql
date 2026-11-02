-- A3-113 (Auditor 8, 11-01, Medium GAP): a member who reports a job, member, listing, message, review, question or
-- Wanted post never heard back. AdminReports.tsx updateStatus writes only reports.status; no trigger on public.reports
-- sent the reporter anything (prod 11-01: 14 reports closed, 0 notifications about a report).
--
-- NEW: when a report moves from open to 'resolved' or 'dismissed', the reporter gets one server-built notice
-- (bell + push, type system_alert). Fixed words only: never who was reported, never what was done, nothing anyone
-- typed. Only the kind of thing ("a listing") and the case number the reporter was shown (ReportDialog.tsx:
-- 'HLP-' + the first 8 hex digits of the report id, upper case), which also keeps two notices from reading as one
-- duplicate.
--   resolved:  "Thanks for your report about a listing (case HLP-…). We looked into it and took action."
--   dismissed: "… We looked into it and didn't find a rule broken. If it keeps happening, report it again or
--              contact support."  (link: /support?topic=message)
-- Nobody is told when:
--   * there is no reporter (guest support row) or the row is a support ticket (it is not a report);
--   * the reporter is a test or seed account (owner rule: test data never notifies) or no longer has an account;
--   * the report is dismissed while its member's profile or its job no longer exists (that is how
--     reports_dismiss_for_deleted_target, 20261031211327, closes them on delete): nobody looked into it, so neither
--     sentence would be true;
--   * the status moves between two closed values, or back to open.
-- A failing notice is logged to error_logs and never fails the admin's status change.
-- RESTATED FROM THE NEWEST CREATE (checked by name, only definition): declutter_admin_release_wanted_photos from
-- 20261030225143. CHANGED only: the report it is passed becomes 'dismissed' when a member filed it (the admin cleared the
-- photos, so no rule was broken); the automatic photo-check row (reporter NULL) stays 'resolved'. Gates, grants unchanged.
-- MONEY: none. REPLAY-SAFE: CREATE OR REPLACE, DROP TRIGGER IF EXISTS. Grants: the trigger function is not callable
-- by PUBLIC, anon or authenticated. Proof: src/test/pglite/reporterHearsTheOutcome.pglite.mjs (3x).

CREATE OR REPLACE FUNCTION public.notify_reporter_report_outcome()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_noun text;
  v_case text;
BEGIN
  BEGIN
    IF NEW.reporter_id IS NULL OR NEW.reported_type = 'support' THEN
      RETURN NULL;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM auth.users u WHERE u.id = NEW.reporter_id)
       OR public.is_test_subject(NEW.reporter_id)
       OR EXISTS (SELECT 1 FROM public.profiles p WHERE p.user_id = NEW.reporter_id AND p.is_seed IS TRUE) THEN
      RETURN NULL;
    END IF;
    -- Dismissed because the member or job is gone: no one reviewed it.
    IF NEW.status = 'dismissed' AND NEW.reported_id IS NOT NULL AND (
         -- The profile, not auth.users: account deletion removes the profile first and that delete is what
         -- dismisses the report, while the auth row may still exist inside the same transaction.
         (NEW.reported_type = 'user'
           AND NOT EXISTS (SELECT 1 FROM public.profiles p WHERE p.user_id = NEW.reported_id))
         OR (NEW.reported_type = 'job' AND NOT EXISTS (SELECT 1 FROM public.jobs j WHERE j.id = NEW.reported_id))
       ) THEN
      RETURN NULL;
    END IF;

    v_noun := CASE NEW.reported_type
      WHEN 'job' THEN 'a job'
      WHEN 'user' THEN 'a member'
      WHEN 'message' THEN 'a message'
      WHEN 'review' THEN 'a review'
      WHEN 'application' THEN 'an application'
      WHEN 'declutter_item' THEN 'a listing'
      WHEN 'declutter_wanted' THEN 'a Wanted post'
      WHEN 'declutter_question' THEN 'a question'
      WHEN 'declutter_answer' THEN 'an answer'
      ELSE 'a post'
    END;
    v_case := 'HLP-' || upper(left(replace(NEW.id::text, '-', ''), 8));

    INSERT INTO public.notifications (user_id, title, message, type, link)
    VALUES (
      NEW.reporter_id,
      'We looked into your report',
      'Thanks for your report about ' || v_noun || ' (case ' || v_case || '). '
        || CASE WHEN NEW.status = 'resolved'
             THEN 'We looked into it and took action.'
             ELSE 'We looked into it and didn''t find a rule broken. If it keeps happening, report it again or contact support.'
           END,
      'system_alert',
      CASE WHEN NEW.status = 'resolved' THEN NULL ELSE '/support?topic=message' END
    );
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO public.error_logs (severity, message, tags, context)
    VALUES ('error', 'report outcome notice could not be sent',
            jsonb_build_object('source', 'notify_reporter_report_outcome'),
            jsonb_build_object('report_id', NEW.id::text, 'error', SQLERRM));
  END;
  RETURN NULL;
END;
$fn$;

REVOKE ALL ON FUNCTION public.notify_reporter_report_outcome() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_reports_zz_reporter_outcome ON public.reports;
CREATE TRIGGER trg_reports_zz_reporter_outcome
  AFTER UPDATE OF status ON public.reports
  FOR EACH ROW
  WHEN (NEW.status IN ('resolved', 'dismissed')
        AND OLD.status IS DISTINCT FROM NEW.status
        AND OLD.status NOT IN ('resolved', 'dismissed'))
  EXECUTE FUNCTION public.notify_reporter_report_outcome();

-- Restated (see header): a member's report cleared by releasing the photos is 'dismissed'.
CREATE OR REPLACE FUNCTION public.declutter_admin_release_wanted_photos(p_wanted_id uuid, p_report_id uuid)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_uid uuid := (SELECT auth.uid());
  w public.declutter_wanted%ROWTYPE;
BEGIN
  PERFORM public.require_feature('declutter');
  IF public.is_caller_banned() THEN
    RAISE EXCEPTION 'account_restricted' USING ERRCODE = '42501';
  END IF;
  IF v_uid IS NULL OR NOT public.has_role(v_uid, 'admin'::public.app_role) THEN
    RAISE EXCEPTION 'not_admin' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO w FROM public.declutter_wanted WHERE id = p_wanted_id FOR UPDATE;
  IF NOT FOUND OR w.removed_at IS NOT NULL THEN
    RAISE EXCEPTION 'wanted_not_found' USING ERRCODE = 'P0002';
  END IF;
  IF w.user_id = v_uid THEN
    RAISE EXCEPTION 'own_post' USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.reports rp
                  WHERE rp.id = p_report_id AND rp.reported_type = 'declutter_wanted' AND rp.reported_id = p_wanted_id) THEN
    RAISE EXCEPTION 'report_not_for_post' USING ERRCODE = '22023';
  END IF;
  UPDATE public.declutter_wanted
     SET photos_cleared = photos_cleared || photos_held, photos_held = '{}'
   WHERE id = p_wanted_id;
  -- CHANGED (A3-113): releasing the photos means they were fine. A member's report on them is closed as 'dismissed', so
  -- trg_reports_zz_reporter_outcome tells that member "didn't find a rule broken", never "took action". The automatic
  -- photo-check row (no reporter) stays 'resolved', as before.
  UPDATE public.reports
     SET status = CASE WHEN reporter_id IS NULL THEN 'resolved' ELSE 'dismissed' END
   WHERE id = p_report_id;
  INSERT INTO public.admin_audit_log (admin_id, action, target_type, target_id, details)
  VALUES (v_uid, 'declutter_wanted_photos_released', 'declutter_wanted', p_wanted_id::text,
          jsonb_build_object('report_id', p_report_id, 'paths', to_jsonb(w.photos_held)));
  RETURN 'released';
END;
$function$;
REVOKE ALL ON FUNCTION public.declutter_admin_release_wanted_photos(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.declutter_admin_release_wanted_photos(uuid, uuid) TO authenticated, service_role;
