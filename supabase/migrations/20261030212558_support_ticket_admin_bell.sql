-- Every new support ticket rings every admin's bell (owner rule via the lead, 10-30).
--
-- Prod had no bell for one: the only reports trigger that writes a notification is auto_escalate_reports, for user and
-- application reports. The Profile support tab posts no Slack and Slack delivery is unproven, so an admin could learn of
-- a member's ticket only from the rail badge or the ledger. A signed-in member's /support message also stops emailing
-- admin@ in the same push, so this is what tells the owner.
--
-- Fixed words only: a guest's ticket comes from an open endpoint, and nothing anyone typed belongs in a push.
-- A test or seed reporter rings nobody. A guest has no account to test; a guest who typed a fixture address never files
-- a row (contact-support). A failing bell is logged and never fails the ticket.
-- Proof: src/test/pglite/supportTicketAdminBell.pglite.mjs.

CREATE OR REPLACE FUNCTION public.notify_admins_support_ticket()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  BEGIN
    IF NEW.reporter_id IS NOT NULL AND (
         public.is_test_subject(NEW.reporter_id)
         OR EXISTS (SELECT 1 FROM public.profiles p WHERE p.user_id = NEW.reporter_id AND p.is_seed IS TRUE)
       ) THEN
      RETURN NULL;
    END IF;

    INSERT INTO public.notifications (user_id, title, message, type, link)
    SELECT ur.user_id,
           'New support message',
           CASE WHEN NEW.reporter_id IS NULL THEN 'A guest wrote to support.' ELSE 'A member wrote to support.' END,
           'admin_alert',
           -- The ticket's id keeps two tickets in a row from reading as one duplicate notice.
           '/admin?view=support&ticket=' || NEW.id::text
      FROM (SELECT DISTINCT r.user_id FROM public.user_roles r WHERE r.role = 'admin') ur
     WHERE ur.user_id IS DISTINCT FROM NEW.reporter_id;
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO public.error_logs (severity, message, tags, context)
    VALUES ('error', 'support ticket bell could not be sent',
            jsonb_build_object('source', 'notify_admins_support_ticket'),
            jsonb_build_object('report_id', NEW.id::text, 'error', SQLERRM));
  END;
  RETURN NULL;
END;
$function$;

REVOKE ALL ON FUNCTION public.notify_admins_support_ticket() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_reports_zz_support_admin_bell ON public.reports;
CREATE TRIGGER trg_reports_zz_support_admin_bell
  AFTER INSERT ON public.reports
  FOR EACH ROW
  WHEN (NEW.reported_type = 'support')
  EXECUTE FUNCTION public.notify_admins_support_ticket();
