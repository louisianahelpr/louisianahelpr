-- Admin "New member joined" notices about a test account are taken back the
-- moment the account is marked a test account (owner 2026-10-27, screenshot
-- of the bell: "Stop showing test stuff in my notification").
--
-- Why 20261027154114 was not enough: fixtures such as the nightly privacy
-- journey (e2e/privacy/privacy-requests.spec.ts) create the user already
-- confirmed (email_confirm: true), so notify_admins_new_member runs at insert,
-- while the profile is not yet is_seed; the fixture PATCHes is_seed = true a
-- second later. Measured on prod 2026-10-27: "SEED Privacy Journey" and
-- "SEED Privacy Incomplete" reached all 3 admins at 20:27 and 20:55 UTC.
--
-- Now: when profiles.is_seed turns true, every admin notice that announced
-- that account (link '/admin?view=people&user=<id>') is deleted. One cleanup
-- below removes the ones already sent about test accounts or about fixture
-- accounts since deleted (their notice named a "SEED ..." fixture).

CREATE OR REPLACE FUNCTION public.retract_new_member_notice_for_test_account()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
BEGIN
  IF NEW.is_seed IS TRUE AND OLD.is_seed IS DISTINCT FROM TRUE THEN
    DELETE FROM public.notifications n
     WHERE n.user_id IN (SELECT r.user_id FROM public.user_roles r WHERE r.role = 'admin')
       AND n.title = 'New member joined'
       AND n.link = '/admin?view=people&user=' || NEW.user_id::text;
  END IF;
  RETURN NEW;
END;
$fn$;
REVOKE ALL ON FUNCTION public.retract_new_member_notice_for_test_account() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS retract_new_member_notice_for_test_account ON public.profiles;
CREATE TRIGGER retract_new_member_notice_for_test_account
  AFTER UPDATE OF is_seed ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.retract_new_member_notice_for_test_account();

DELETE FROM public.notifications n
 WHERE n.user_id IN (SELECT r.user_id FROM public.user_roles r WHERE r.role = 'admin')
   AND n.title = 'New member joined'
   AND (n.message LIKE 'SEED %'
        OR EXISTS (SELECT 1 FROM public.profiles p
                    WHERE p.is_seed
                      AND n.link = '/admin?view=people&user=' || p.user_id::text));
