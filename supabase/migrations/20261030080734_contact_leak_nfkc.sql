-- Q1881 (finding lh-trust-safety@4326e0ccc#7): the shared contact-leak filter
-- let a phone number or a payment app through when it was written in
--   * Unicode math digits ("𝟓𝟎𝟒𝟓𝟓𝟓𝟏𝟐𝟏𝟐") or fullwidth letters ("ｃａｓｈａｐｐ"),
--   * single digits spaced out ("5 0 4 5 5 5 1 2 1 2", "5-0-4-..."),
--   * single digits mixed with number words ("five 0 four 5 5 5 one 2 1 2").
-- contact_leak_reason guards Declutter titles, descriptions, questions and
-- answers, job text, bios, reviews and messages.
--
-- Now: the text is NFKC-normalised first (normalize(.., NFKC) maps math and
-- fullwidth digits and letters to ASCII), and EVERY check reads the normalised
-- text (the email and payment checks read p_text before, so "ｃａｓｈａｐｐ"
-- passed). One more phone rule: ten or more single-digit tokens (a number word
-- counts as its digit) separated only by short runs of non-letters. A plain
-- 10-digit run and the 3-3-4 groups were already caught. Not collapsed in
-- general on purpose: "10/30/26 10:30" would read as ten digits. Four number
-- words alone ("five zero four five") stay allowed in the shared filter, since
-- ordinary job text says "four or five hours"; seven or more words in a row
-- were already refused and still are.
--
-- Body restated from the EFFECTIVE prod definition (pg_get_functiondef on prod
-- 2026-10-30, identical to the newest migration 20260915030812). The checks and
-- their order are unchanged apart from the above. Grants restated exactly as
-- prod holds them (authenticated and service_role, never anon or PUBLIC).
-- Replay-safe: CREATE OR REPLACE.

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

  IF v_norm ~* '(^|[^0-9])(1[^0-9a-zA-Z]{0,4})?[0-9]{3}[^0-9a-zA-Z]{0,4}[0-9]{3}[^0-9a-zA-Z]{0,4}[0-9]{4}(?![0-9])|[0-9]{3}[^0-9a-zA-Z]{1,4}[0-9]{3}[^0-9a-zA-Z]{1,4}[0-9]{4}' THEN
    RETURN 'Phone number detected';
  ELSIF v_tokens ~ '(^|[^0-9])[0-9]([^0-9a-z]{1,3}[0-9]){9}(?![0-9])' THEN
    RETURN 'Phone number detected';
  ELSIF v_norm ~* '(zero|one|two|three|four|five|six|seven|eight|nine|oh)([^a-z0-9]+(zero|one|two|three|four|five|six|seven|eight|nine|oh)){6,}' THEN
    RETURN 'Phone number detected';
  ELSIF v_norm ~* '[a-z0-9._]+@[a-z0-9-]+(\.[a-z0-9-]+)*\.[a-z]{2,}' THEN
    RETURN 'Email address detected';
  ELSIF v_norm ~* '\mvenmo\M|\mcashapp\M|\mcash app\M|\mzelle\M|\mpaypal\M|\mapple\s*pay\M|\mgoogle\s*pay\M|\mcrypto\M|\mbitcoin\M|\mbtc\M|\meth\M' THEN
    RETURN 'Off-platform payment service mentioned';
  ELSIF v_norm ~* '\mpay me direct\M|\moff the app\M|\moutside the app\M|\mskip the fee\M|\mavoid the fee\M|\mcash only\M|\min cash\M|\mtext me\M|\mcall me\M|\mwhatsapp\M|\mtelegram\M|\mdm me\M|\mhit me up\M|\mcontact me at\M|\mreach me at\M|\msend money to\M|\mpay outside\M' THEN
    RETURN 'Off-platform payment intent detected';
  END IF;

  RETURN NULL;
END;
$function$;

REVOKE ALL ON FUNCTION public.contact_leak_reason(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.contact_leak_reason(text) TO authenticated, service_role;
