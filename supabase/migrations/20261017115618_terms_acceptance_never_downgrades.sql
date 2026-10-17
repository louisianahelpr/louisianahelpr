-- An accepted Terms version never moves BACKWARD (Q?schedule-double-modal, 2026-10-17).
--
-- Measured on prod: at 2026-10-17 09:13:20Z a node script run from a checkout
-- still on "Sep 2026" (the shared ~/louisianahelpr checkout, before the
-- 2026-10-06 bump and before acceptCurrentTerms learned to refuse a downgrade)
-- PATCHed poster-e2e's profiles.terms_version_accepted from "Oct 2026" back to
-- "Sep 2026" (edge_logs: PATCH /rest/v1/profiles?user_id=eq.951264df... 200, ua
-- node; legal_acceptances row 61e4429d "Sep 2026"). For 49 s every current
-- build showed that account the non-dismissible re-agree dialog, and
-- press-every-control run 39014836855 leg 2 could not press day "28" on
-- /profile?tab=schedule under it. The same thing happens to a real member
-- whenever an OLDER app build (an iPhone not yet updated) sees a NEWER
-- acceptance: its dialog compares with != , prompts, and its I Agree writes
-- its own older version, so the member's newer devices prompt again.
--
-- Every writer that is current already writes the latest version; only a
-- stale writer goes backward, and no writer can be updated after it ships.
-- So the database keeps the newer of the two, quietly (an old build's
-- `.select("user_id")` still gets its row back and its dialog closes), the
-- same way tr_preserve_first_consent keeps the first accepted_terms_at.
--
-- Versions are "Mon YYYY" (src/lib/consent.ts). Anything else (NULL, '', a
-- legacy value) is not ranked and is left to the writer, so clearing the
-- column (wipe_pre_verification_account) is unchanged.
--
-- And never moves into the FUTURE: a member holds column UPDATE on their own
-- terms_version_accepted, and since the dialog now treats a newer acceptance as
-- current, a self-written "Dec 2099" would have opted them out of every future
-- re-consent (lh-authz-rls review of ea33dff87, finding 1). A version later
-- than the current UTC month is kept at OLD. A Terms version is the month it
-- was published, so the live one is never in the future;
-- src/test/termsAcceptanceNeverDowngrades.test.ts fails a LATEST_TERMS_VERSION
-- that is.
--
-- Not exempt for service_role or admins, like preserve_first_consent: moving
-- a recorded acceptance back to an older version has no legitimate caller.
-- The rank is inlined (no helper function), so the trigger needs no EXECUTE
-- grant on anything for the member whose UPDATE fires it.

CREATE OR REPLACE FUNCTION public.keep_newest_terms_acceptance()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $fn$
DECLARE
  months constant text[] := ARRAY['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  old_m text[];
  new_m text[];
  old_rank int;
  new_rank int;
  now_rank int := extract(year FROM now() AT TIME ZONE 'UTC')::int * 100 + extract(month FROM now() AT TIME ZONE 'UTC')::int;
BEGIN
  old_m := regexp_match(btrim(coalesce(OLD.terms_version_accepted, '')), '^([A-Z][a-z]{2}) ([0-9]{4})$');
  new_m := regexp_match(btrim(coalesce(NEW.terms_version_accepted, '')), '^([A-Z][a-z]{2}) ([0-9]{4})$');
  IF new_m IS NULL OR array_position(months, new_m[1]) IS NULL THEN
    RETURN NEW;
  END IF;
  new_rank := new_m[2]::int * 100 + array_position(months, new_m[1]);
  IF new_rank > now_rank THEN
    NEW.terms_version_accepted := OLD.terms_version_accepted;
    NEW.terms_accepted_at := OLD.terms_accepted_at;
    RETURN NEW;
  END IF;
  IF old_m IS NULL OR array_position(months, old_m[1]) IS NULL THEN
    RETURN NEW;
  END IF;
  old_rank := old_m[2]::int * 100 + array_position(months, old_m[1]);
  IF new_rank < old_rank THEN
    NEW.terms_version_accepted := OLD.terms_version_accepted;
    NEW.terms_accepted_at := OLD.terms_accepted_at;
  END IF;
  RETURN NEW;
END;
$fn$;

REVOKE ALL ON FUNCTION public.keep_newest_terms_acceptance() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS tr_keep_newest_terms_acceptance ON public.profiles;
CREATE TRIGGER tr_keep_newest_terms_acceptance
  BEFORE UPDATE OF terms_version_accepted ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.keep_newest_terms_acceptance();
