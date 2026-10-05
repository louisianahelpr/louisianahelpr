-- Q1285 (docs/OPEN.md; lh-authz-rls review of Q1206, 2026-10-04):
-- applications.decline_reason was not scanned for contact details.
-- scan_application_contact_info judged message and offer_message only; a
-- poster's decline reason (useOfferHandlers.declineApplication writes it with
-- the status flip, notify_on_application folds it into the Helpr's decline
-- notice) could carry a phone number or payment handle to the Helpr unchecked.
--
-- Now a third trigger, BEFORE UPDATE OF decline_reason, runs the same function
-- with direction 'decline', and a reason contact_leak_reason() flags is
-- dropped (set NULL) before the notice is written; the decline itself still
-- lands. Clients only reach applications through apply_to_job on INSERT
-- (20261004184135), so the INSERT path never carries a decline reason.
--
-- Restated from its newest definition, 20261004192410 (md5(prosrc) live
-- 2026-10-05 a905d83f72cd8fd3d227a68f24a6ce8b = that file), plus the branch.
-- Replay-safe: CREATE OR REPLACE; DROP TRIGGER IF EXISTS before CREATE TRIGGER.
-- Guard: src/test/declineReasonContactWithheld.test.ts +
-- src/test/pglite/declineReasonContactWithheld.pglite.mjs.

CREATE OR REPLACE FUNCTION public.scan_application_contact_info()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_dir    text := coalesce(TG_ARGV[0], 'both');
  r_note   text;
  r_offer  text;
BEGIN
  -- Q1285: the poster's decline reason, judged by its own trigger
  -- (UPDATE OF decline_reason -> 'decline'). It reaches the Helpr in the
  -- decline notice (notify_on_application reads NEW.decline_reason in the same
  -- statement), so a phone number, email or payment handle in it is dropped
  -- before that notice is written: the Helpr gets the plain decline. The
  -- applicant-side flag columns and flag_reason are not touched.
  IF v_dir = 'decline' THEN
    IF public.contact_leak_reason(NEW.decline_reason) IS NOT NULL THEN
      NEW.decline_reason := NULL;
    END IF;
    RETURN NEW;
  END IF;

  -- Each direction is judged on its own, and only by the trigger for its own
  -- column (UPDATE OF message -> 'note', UPDATE OF offer_message -> 'offer';
  -- on INSERT both). That trigger fires only when its column is in the
  -- statement's SET list, so the value judged is exactly what was written:
  -- an explicit NULL is a clear and drops the withheld copy, and a write of
  -- the OTHER direction never touches this one.
  IF v_dir IN ('both', 'note') THEN
    r_note := public.contact_leak_reason(NEW.message);
    IF r_note IS NOT NULL THEN
      NEW.flagged_hidden   := true;
      NEW.message_withheld := NEW.message;
      NEW.message          := NULL;
    ELSE
      -- Clear on edit: a corrected (or cleared) note un-flags itself.
      NEW.flagged_hidden   := false;
      NEW.message_withheld := NULL;
    END IF;
  END IF;

  IF v_dir IN ('both', 'offer') THEN
    r_offer := public.contact_leak_reason(NEW.offer_message);
    IF r_offer IS NOT NULL THEN
      NEW.offer_message_flagged_hidden := true;
      NEW.offer_message_withheld       := NEW.offer_message;
      NEW.offer_message                := NULL;
    ELSE
      NEW.offer_message_flagged_hidden := false;
      NEW.offer_message_withheld       := NULL;
    END IF;
  END IF;

  -- The moderation note: the applicant's reason first, as before. Read from
  -- the withheld columns, which hold exactly the texts that are flagged now.
  NEW.flag_reason := COALESCE(public.contact_leak_reason(NEW.message_withheld),
                              public.contact_leak_reason(NEW.offer_message_withheld));

  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.scan_application_contact_info() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS applications_scan_contact_info_decline ON public.applications;
CREATE TRIGGER applications_scan_contact_info_decline
  BEFORE UPDATE OF decline_reason ON public.applications
  FOR EACH ROW EXECUTE FUNCTION public.scan_application_contact_info('decline');
