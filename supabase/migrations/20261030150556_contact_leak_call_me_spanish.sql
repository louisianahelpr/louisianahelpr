-- Messages audit E3 (10-30) M3, via the lead 09:12 (owner: fix all 13).
--
-- Before: contact_leak_reason refused "text me" and "call me" on their own, so "Call me when you get here" and
-- "Text me when you're outside" were hidden from the other person and flagged the sender, with no contact detail in
-- them. A phone number spelled in Spanish ("cinco cero cuatro ...") passed: both number-word rules knew English only.
--
-- After, restated from the NEWEST definition (20261030080734_contact_leak_nfkc, Q1881; prod was 20260915030812 when
-- that was written) changing only:
--   1. "text me" / "call me" are no longer refused on their own. With a phone number or email beside them the phone
--      and email checks above still refuse the message ("call me at 504-555-0100").
--   2. The Spanish number words (cero, uno, dos, tres, cuatro, cinco, seis, siete, ocho, nueve) count in the
--      spelled-number rule (7+ in a row, mixed freely with English) and as digits in the spaced-digit rule.
-- The client scanner (src/lib/messageScanner.ts) changes in the same commit.
-- Grants restated as before (authenticated and service_role, never anon or PUBLIC). Replay-safe: CREATE OR REPLACE.
-- Applied 3x in PGlite (src/test/pglite/contactLeakCallMeSpanish.pglite.mjs).

CREATE OR REPLACE FUNCTION public.contact_leak_reason(p_text text)
 RETURNS text
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path TO 'public'
AS $function$
DECLARE
  v_norm text;
  v_tokens text;
BEGIN
  IF p_text IS NULL OR btrim(p_text) = '' THEN
    RETURN NULL;
  END IF;

  -- NFKC: math, fullwidth and other compatibility digits and letters become
  -- plain ASCII. The translate is kept for any form NFKC leaves alone.
  v_norm := translate(normalize(p_text, NFKC), '０１２３４５６７８９', '0123456789');

  -- App-generated location share ("📍 Location: lat,lng", both rounded to 6
  -- decimals). Checked first and exits early: a message that is exactly this
  -- shape can never also be a phone number, email, or off-platform-payment phrase.
  IF v_norm ~ '^📍 Location: -?[0-9]{1,3}\.[0-9]{6},-?[0-9]{1,3}\.[0-9]{6}$' THEN
    RETURN NULL;
  END IF;

  -- Number words read as their digit, for the spaced-digit rule only.
  v_tokens := regexp_replace(lower(v_norm), '\mzero\M|\moh\M', '0', 'g');
  v_tokens := regexp_replace(v_tokens, '\mone\M', '1', 'g');
  v_tokens := regexp_replace(v_tokens, '\mtwo\M', '2', 'g');
  v_tokens := regexp_replace(v_tokens, '\mthree\M', '3', 'g');
  v_tokens := regexp_replace(v_tokens, '\mfour\M', '4', 'g');
  v_tokens := regexp_replace(v_tokens, '\mfive\M', '5', 'g');
  v_tokens := regexp_replace(v_tokens, '\msix\M', '6', 'g');
  v_tokens := regexp_replace(v_tokens, '\mseven\M', '7', 'g');
  v_tokens := regexp_replace(v_tokens, '\meight\M', '8', 'g');
  v_tokens := regexp_replace(v_tokens, '\mnine\M', '9', 'g');
  -- Messages audit M3: the Spanish number words too.
  v_tokens := regexp_replace(v_tokens, '\mcero\M', '0', 'g');
  v_tokens := regexp_replace(v_tokens, '\muno\M', '1', 'g');
  v_tokens := regexp_replace(v_tokens, '\mdos\M', '2', 'g');
  v_tokens := regexp_replace(v_tokens, '\mtres\M', '3', 'g');
  v_tokens := regexp_replace(v_tokens, '\mcuatro\M', '4', 'g');
  v_tokens := regexp_replace(v_tokens, '\mcinco\M', '5', 'g');
  v_tokens := regexp_replace(v_tokens, '\mseis\M', '6', 'g');
  v_tokens := regexp_replace(v_tokens, '\msiete\M', '7', 'g');
  v_tokens := regexp_replace(v_tokens, '\mocho\M', '8', 'g');
  v_tokens := regexp_replace(v_tokens, '\mnueve\M', '9', 'g');

  IF v_norm ~* '(^|[^0-9])(1[^0-9a-zA-Z]{0,4})?[0-9]{3}[^0-9a-zA-Z]{0,4}[0-9]{3}[^0-9a-zA-Z]{0,4}[0-9]{4}(?![0-9])|[0-9]{3}[^0-9a-zA-Z]{1,4}[0-9]{3}[^0-9a-zA-Z]{1,4}[0-9]{4}' THEN
    RETURN 'Phone number detected';
  ELSIF v_tokens ~ '(^|[^0-9])[0-9]([^0-9a-z]{1,3}[0-9]){9}(?![0-9])' THEN
    RETURN 'Phone number detected';
  ELSIF v_norm ~* '(zero|one|two|three|four|five|six|seven|eight|nine|oh|cero|uno|dos|tres|cuatro|cinco|seis|siete|ocho|nueve)([^a-z0-9]+(zero|one|two|three|four|five|six|seven|eight|nine|oh|cero|uno|dos|tres|cuatro|cinco|seis|siete|ocho|nueve)){6,}' THEN
    RETURN 'Phone number detected';
  ELSIF v_norm ~* '[a-z0-9._]+@[a-z0-9-]+(\.[a-z0-9-]+)*\.[a-z]{2,}' THEN
    RETURN 'Email address detected';
  ELSIF v_norm ~* '\mvenmo\M|\mcashapp\M|\mcash app\M|\mzelle\M|\mpaypal\M|\mapple\s*pay\M|\mgoogle\s*pay\M|\mcrypto\M|\mbitcoin\M|\mbtc\M|\meth\M' THEN
    RETURN 'Off-platform payment service mentioned';
  ELSIF v_norm ~* '\mpay me direct\M|\moff the app\M|\moutside the app\M|\mskip the fee\M|\mavoid the fee\M|\mcash only\M|\min cash\M|\mwhatsapp\M|\mtelegram\M|\mdm me\M|\mhit me up\M|\mcontact me at\M|\mreach me at\M|\msend money to\M|\mpay outside\M' THEN
    RETURN 'Off-platform payment intent detected';
  END IF;

  RETURN NULL;
END;
$function$;

REVOKE ALL ON FUNCTION public.contact_leak_reason(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.contact_leak_reason(text) TO authenticated, service_role;
