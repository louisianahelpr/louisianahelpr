-- Apple Guideline 1.2 (Q1799, found by the lh-compliance-store review of the
-- 1.0.4 build): user-generated content needs a filter for objectionable
-- material. Messages already pass through scan_message_content, which hides a
-- message from its recipient (flagged_hidden; the read policy shows a hidden
-- message only to its sender) when it shares contact details. This adds a
-- second reason, 'objectionable': slurs, explicit sexual language and direct
-- threats, matched on whole words so everyday Louisiana work words never trip
-- it (no "hoe", "screw", "nuts", "cock" as in stopcock, "ass" inside words).
-- The team thread (support with Helpr staff) stays unscanned, as before.
-- Restated scan_message_content from prod's live body (pg_get_functiondef
-- 2026-10-27) with the one added check.

CREATE OR REPLACE FUNCTION public.objectionable_reason(p_text text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path TO 'public', 'pg_temp'
AS $fn$
  SELECT CASE
    WHEN p_text IS NULL OR btrim(p_text) = '' THEN NULL
    -- Slurs (racial, ethnic, homophobic, ableist), whole words, with common plurals.
    WHEN lower(p_text) ~ '\m(nigg(a|er|az|ers)|faggots?|fags?|dykes?|trann(y|ies)|retards?|spics?|chinks?|kikes?|wetbacks?|beaners?|gooks?|coons?)\M' THEN 'objectionable'
    -- Explicit sexual language.
    WHEN lower(p_text) ~ '\m(cunts?|pussy|pussies|blowjobs?|handjobs?|dick ?pics?|nudes|send nudes|sexting|cum(shot|ming)?|jizz|porn)\M' THEN 'objectionable'
    -- Direct threats of violence aimed at the reader.
    WHEN lower(p_text) ~ '\m(i(''| wi)ll|gonna|going to) (kill|shoot|stab|rape|murder) (you|u|ya|your)\M' THEN 'objectionable'
    WHEN lower(p_text) ~ '\m(kill yourself|kys)\M' THEN 'objectionable'
    ELSE NULL
  END;
$fn$;

REVOKE ALL ON FUNCTION public.objectionable_reason(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.objectionable_reason(text) TO service_role;

CREATE OR REPLACE FUNCTION public.scan_message_content()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_reason text;
BEGIN
  -- Team thread (support conversation with Louisiana Helpr staff): never
  -- scanned. Sharing a phone number with the team is not off-platform dealing.
  IF NEW.team_thread_user_id IS NOT NULL THEN
    NEW.flagged_hidden := false;
    NEW.flag_reason := NULL;
    RETURN NEW;
  END IF;
  -- Q1799 (Apple 1.2): objectionable language is hidden from the recipient
  -- first; contact details second, as before.
  v_reason := COALESCE(public.objectionable_reason(NEW.content), public.contact_leak_reason(NEW.content));
  IF v_reason IS NOT NULL THEN
    NEW.flagged_hidden := true;
    NEW.flag_reason := v_reason;
  ELSE
    NEW.flagged_hidden := false;
    NEW.flag_reason := NULL;
  END IF;
  RETURN NEW;
END;
$function$;
