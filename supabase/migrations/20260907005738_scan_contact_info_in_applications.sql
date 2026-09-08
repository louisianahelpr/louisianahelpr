-- The contact-info filter guarded ONE table. The two fields strangers actually
-- use before anyone is hired were unguarded.
--
-- Found in review (2026-09-06), demonstrated in both directions with real
-- accounts: a phone number and an email travelled verbatim from helper to
-- poster in the application note, and from poster to helper in the offer
-- message, and rendered on the other person's screen. The whole purpose of the
-- filter is to stop a deal moving off-platform before escrow — and these two
-- fields are the EARLIEST point at which two strangers exchange free text, so
-- they are the easiest place to leak and were the only place with no guard.
--
-- scan_message_content() could not simply be re-pointed: it is hardcoded to
-- NEW.content / NEW.flagged_hidden / NEW.flag_reason, none of which exist on
-- `applications`. So the DETECTION is extracted into a pure function and both
-- triggers call it. One rule, two tables — rather than a second copy of a
-- regex list that would drift the moment either side is edited.

-- ── 1. The detection, extracted verbatim ────────────────────────────────────
-- Byte-for-byte the same patterns and the same precedence as the live
-- scan_message_content(), including the full-width digit normalisation that
-- defeats ０１２ evasion. Returns the reason, or NULL when the text is clean.
CREATE OR REPLACE FUNCTION public.contact_leak_reason(p_text text)
 RETURNS text
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path TO 'public'
AS $function$
DECLARE
  v_norm text;
BEGIN
  IF p_text IS NULL OR btrim(p_text) = '' THEN
    RETURN NULL;
  END IF;

  v_norm := translate(p_text, '０１２３４５６７８９', '0123456789');

  IF v_norm ~* '[0-9]{3}[^0-9a-zA-Z]{0,4}[0-9]{3}[^0-9a-zA-Z]{0,4}[0-9]{4}' THEN
    RETURN 'Phone number detected';
  ELSIF p_text ~* '(zero|one|two|three|four|five|six|seven|eight|nine|oh)([^a-z0-9]+(zero|one|two|three|four|five|six|seven|eight|nine|oh)){6,}' THEN
    RETURN 'Phone number detected';
  ELSIF p_text ~* '[a-z0-9._]+@[a-z0-9]+\.[a-z]{2,}' THEN
    RETURN 'Email address detected';
  ELSIF p_text ~* '\mvenmo\M|\mcashapp\M|\mcash app\M|\mzelle\M|\mpaypal\M|\mapple\s*pay\M|\mgoogle\s*pay\M|\mcrypto\M|\mbitcoin\M|\mbtc\M|\meth\M' THEN
    RETURN 'Off-platform payment service mentioned';
  ELSIF p_text ~* '\mpay me direct\M|\moff the app\M|\moutside the app\M|\mskip the fee\M|\mavoid the fee\M|\mcash only\M|\min cash\M|\mtext me\M|\mcall me\M|\mwhatsapp\M|\mtelegram\M|\mdm me\M|\mhit me up\M|\mcontact me at\M|\mreach me at\M|\msend money to\M|\mpay outside\M' THEN
    RETURN 'Off-platform payment intent detected';
  END IF;

  RETURN NULL;
END;
$function$;

REVOKE ALL ON FUNCTION public.contact_leak_reason(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.contact_leak_reason(text) TO authenticated, service_role;

-- ── 2. messages now delegates — same behaviour, one rule ────────────────────
-- Rewritten to call the extracted function. The observable outcome is
-- unchanged: same patterns, same precedence, same columns written.
CREATE OR REPLACE FUNCTION public.scan_message_content()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_reason text := public.contact_leak_reason(NEW.content);
BEGIN
  IF v_reason IS NOT NULL THEN
    NEW.flagged_hidden := true;
    NEW.flag_reason := v_reason;
  END IF;
  RETURN NEW;
END;
$function$;

-- ── 3. applications gets the same protection ────────────────────────────────
-- Mirrors the messages columns rather than inventing new semantics, so the
-- client has one concept to render and admin has one concept to review.
ALTER TABLE public.applications
  ADD COLUMN IF NOT EXISTS flagged_hidden boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS flag_reason text;

COMMENT ON COLUMN public.applications.flagged_hidden IS
  'True when contact_leak_reason() matched applications.message or offer_message. '
  'Same meaning as messages.flagged_hidden: the offending text must not be shown '
  'to the other party. Added 2026-09-06 after a review demonstrated phone numbers '
  'and emails travelling verbatim through both fields.';

-- SERVER-side is the point: these columns are client-writable in principle, so
-- the flag is set by a BEFORE trigger the client cannot skip, exactly like
-- messages. Also re-scanned on UPDATE — offer_message is written later than
-- message, by the OTHER party, so an insert-only trigger would leave the
-- poster's side permanently unscanned.
CREATE OR REPLACE FUNCTION public.scan_application_contact_info()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_reason text;
BEGIN
  -- The helper's note first, then the poster's offer message. Either one
  -- leaking is enough to flag the row.
  v_reason := public.contact_leak_reason(NEW.message);
  IF v_reason IS NULL THEN
    v_reason := public.contact_leak_reason(NEW.offer_message);
  END IF;

  IF v_reason IS NOT NULL THEN
    NEW.flagged_hidden := true;
    NEW.flag_reason := v_reason;
  ELSE
    -- Clear on edit: a corrected note must be able to un-flag itself, or the
    -- only way out is a new application.
    NEW.flagged_hidden := false;
    NEW.flag_reason := NULL;
  END IF;

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS applications_scan_contact_info ON public.applications;
CREATE TRIGGER applications_scan_contact_info
  BEFORE INSERT OR UPDATE OF message, offer_message ON public.applications
  FOR EACH ROW EXECUTE FUNCTION public.scan_application_contact_info();

-- ── 4. Backfill what is already in the table ────────────────────────────────
-- Rows written before this trigger existed are exactly the leaks the review
-- found, and they are still rendered to the other party today.
UPDATE public.applications
   SET flagged_hidden = true,
       flag_reason = COALESCE(
         public.contact_leak_reason(message),
         public.contact_leak_reason(offer_message))
 WHERE flagged_hidden IS NOT TRUE
   AND (public.contact_leak_reason(message) IS NOT NULL
        OR public.contact_leak_reason(offer_message) IS NOT NULL);
