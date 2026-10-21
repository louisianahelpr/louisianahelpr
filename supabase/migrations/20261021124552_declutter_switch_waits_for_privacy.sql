-- Q2274 / Q2278 (lh-authz-rls review of the Declutter rework, 2026-10-21, note 1): Declutter must not open to
-- everyone while members can still read who is on the other side of a Declutter deal. Today a signed-in member can
-- read declutter_offers rows (a seller sees the buyer's user id on every offer, and on a Wanted "I have this" answer,
-- the poster's), declutter_offer_events, and declutter_questions.asker_id (who asked a question, while the page says
-- "Asked by a neighbor"). Those reads are taken away by ready/declutter-narrow-floor2, which lands
-- only with the next App Store build because it raises client_compat_floor() to 2. Until then the only gate was a
-- sentence in docs/OPEN.md.
--
-- This makes it a database rule: feature_switches refuses audience 'everyone' for 'declutter' or 'declutter_wanted'
-- while authenticated still holds any of those three reads, whoever makes the change (the admin switch screen through
-- admin_set_feature_switch, a service-role call, a migration). It checks the live privileges, so it lets the flip
-- through by itself the moment the narrowing is live; nothing has to be undone. 'off' and 'testers' are never refused.
-- The admin screen shows the message as is (under 280 characters, plain words: userFacingError).
--
-- The trigger function is not SECURITY DEFINER and is not callable by clients (REVOKE from PUBLIC, anon,
-- authenticated): it runs only as the trigger. Replay-safe: CREATE OR REPLACE, DROP TRIGGER IF EXISTS.

CREATE OR REPLACE FUNCTION public.feature_switches_declutter_waits_for_privacy()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public', 'pg_temp'
AS $fn$
BEGIN
  IF NEW.key IN ('declutter', 'declutter_wanted')
     AND NEW.audience = 'everyone'
     AND (has_table_privilege('authenticated', 'public.declutter_offers', 'SELECT')
          OR has_table_privilege('authenticated', 'public.declutter_offer_events', 'SELECT')
          OR has_column_privilege('authenticated', 'public.declutter_questions', 'asker_id', 'SELECT')) THEN
    RAISE EXCEPTION 'Declutter cannot open to everyone yet: members can still see who made an offer or asked a question. It can open once the next app update is live.'
      USING ERRCODE = '55000',
            DETAIL = format('switch %s: the member reads of declutter_offers, declutter_offer_events and declutter_questions.asker_id are still granted', NEW.key),
            HINT = 'Land ready/declutter-narrow-floor2 with the App Store build first.';
  END IF;
  RETURN NEW;
END;
$fn$;
REVOKE ALL ON FUNCTION public.feature_switches_declutter_waits_for_privacy() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS feature_switches_declutter_waits_for_privacy ON public.feature_switches;
CREATE TRIGGER feature_switches_declutter_waits_for_privacy
  BEFORE INSERT OR UPDATE OF audience ON public.feature_switches
  FOR EACH ROW EXECUTE FUNCTION public.feature_switches_declutter_waits_for_privacy();
