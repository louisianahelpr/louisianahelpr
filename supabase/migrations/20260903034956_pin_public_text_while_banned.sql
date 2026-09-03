-- A banned member can still rewrite the two fields everyone else can see.
--
-- MEASURED LIVE:
--     currently banned accounts                                  1
--     authenticated UPDATE grants on full_name / bio             2 (both)
--     either column pinned by profiles_locked_update_columns()   no
--
-- `enforce_ban_gate` now covers eight tables (applications, jobs, messages,
-- reviews, skill_endorsements, message_reactions, pet_report_cards,
-- job_revisions) and `prevent_self_escalation` pins ~52 trust columns. Neither
-- touches `full_name` or `bio`. So a banned harasser cannot post, apply, message
-- or review — and can still change the display name and biography that appear
-- next to every trace of them the platform kept, including on the reviews other
-- people wrote about them.
--
-- WHY NOT A GRANT REVOKE, AND WHY NOT THE LOCK SET. Both are unconditional, and
-- these two columns must stay editable for everyone who is not banned — it is an
-- ordinary profile edit. `profiles_locked_update_columns()` is for columns no
-- member may ever write; this is a column no member may write WHILE BANNED. A
-- different question needs a different mechanism.
--
-- WHY A SEPARATE TRIGGER AND NOT A CLAUSE INSIDE prevent_self_escalation. That
-- function has been reproduced by hand three times today to add pins, and each
-- time the check that made it safe was diffing its ~52-line pin list against the
-- live definition. A fourth reproduction to add a conditional is a fourth chance
-- to drop a pin, and a dropped pin is a silent escalation hole. Nothing here
-- needs to be inside it.
--
-- NO RAISE, DELIBERATELY. It pins the values rather than refusing the statement,
-- for two reasons. The Apple-required in-app deletion path and the legal-consent
-- writes both UPDATE this row while banned, and a raise would break them — which
-- is exactly why a blanket UPDATE gate was rejected. And BEFORE-row triggers fire
-- alphabetically: `enforce_banned_profile_text_lock` sorts before
-- `tr_prevent_self_escalation`, so raising here would abort statements that the
-- ban gate is not meant to touch at all. Pinning is silent to the caller and
-- exact in effect.
--
-- The bypasses match the ones every other guard on this table uses, so
-- service_role, admins and the trusted-ladder path are unaffected.
--
-- Replay-safe: CREATE OR REPLACE plus DROP TRIGGER IF EXISTS.

CREATE OR REPLACE FUNCTION public.enforce_banned_profile_text_lock()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF auth.uid() IS NULL OR has_role(auth.uid(), 'admin') THEN
    RETURN NEW;
  END IF;

  IF current_setting('app.trusted_ladder_write', true) = 'on' THEN
    RETURN NEW;
  END IF;

  -- OLD, not NEW: the question is whether they are banned RIGHT NOW, and
  -- prevent_self_escalation already pins ban_status so NEW cannot differ for a
  -- member anyway. Reading OLD makes that independent of trigger order.
  IF OLD.ban_status IN ('banned', 'temp_banned', 'permanently_banned') THEN
    NEW.full_name := OLD.full_name;
    NEW.bio       := OLD.bio;
  END IF;

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS enforce_banned_profile_text_lock ON public.profiles;
CREATE TRIGGER enforce_banned_profile_text_lock
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.enforce_banned_profile_text_lock();

COMMENT ON FUNCTION public.enforce_banned_profile_text_lock() IS
  'Pins profiles.full_name and profiles.bio while the row is banned. The ban '
  'gate stops a banned member writing to eight tables; without this they could '
  'still rewrite the display name and biography shown beside every trace of '
  'them, including on other people''s reviews. Pins rather than raises, because '
  'the Apple-required in-app deletion path and the legal-consent writes both '
  'UPDATE this row while banned.';
