-- scan_message_content()'s off-platform-payment branches matched as bare
-- substrings, with no word-boundary guard anywhere except the two entries
-- (`btc`, `eth`) added specifically to stop "ethics"/"depth" false-striking.
-- Everything else in the function had the identical exposure and nobody had
-- gone looking for it.
--
-- Reproduced live (read-only, no rows written) against a corpus built from a
-- prior fix's own test suite plus the new false-positive class:
--
--   "Just send me a text message when you get here"  -> matched "text me"
--   "I will call Melissa"                             -> matched "call me"
--   "I don't accept cryptocurrency, sorry"             -> matched "crypto"
--   "he calls himself a bitcoiner online"              -> matched "bitcoin"
--   "the paypalette design"                            -> matched "paypal"
--
-- Every one of those is an ordinary marketplace sentence, not off-platform
-- payment intent, and `messages_scan_consequence` is a live AFTER INSERT
-- trigger — a false match here isn't just a hidden message, it strikes the
-- sender's account against the same ladder that already auto-suspends at
-- 2 flags/24h. This is the exact phantom-delivery-plus-silent-strike shape
-- 20260903014624 was written to close, just on a wider surface than that
-- migration's own test corpus covered.
--
-- Fix: `\m...\M` (Postgres word-boundary start/end, the SAME construct
-- `\mbtc\M` / `\meth\M` already used) around every phrase and every bare
-- payment-service name. Verified against 26 cases live before writing this
-- (20 must-still-match violations, 6 must-not-match false positives) — every
-- true positive from the prior migration's own test suite still matches,
-- every new false positive is closed. Full corpus and results are in the
-- session transcript that produced this migration.
--
-- ONE KNOWN RESIDUAL, not fixed by word boundaries and not fixed here:
-- "the deadline is in cash flow terms" still matches "in cash", because
-- "in cash" is a genuine two-word phrase with real boundaries on both sides
-- in that sentence — this isn't a boundary bug, it's the same bigram
-- appearing in two different contexts, one a violation and one an idiom.
-- Distinguishing them needs more than substring matching; flagging as a
-- known limitation rather than attempting a fix that risks reintroducing a
-- different false-negative to chase one example.

CREATE OR REPLACE FUNCTION public.scan_message_content()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_matched boolean := false;
  v_reason text := null;
  v_norm text := translate(
    NEW.content,
    '０１２３４５６７８９',
    '0123456789'
  );
BEGIN
  IF v_norm ~* '[0-9]{3}[^0-9a-zA-Z]{0,4}[0-9]{3}[^0-9a-zA-Z]{0,4}[0-9]{4}' THEN
    v_matched := true; v_reason := 'Phone number detected';
  ELSIF NEW.content ~* '(zero|one|two|three|four|five|six|seven|eight|nine|oh)([^a-z0-9]+(zero|one|two|three|four|five|six|seven|eight|nine|oh)){6,}' THEN
    v_matched := true; v_reason := 'Phone number detected';
  ELSIF NEW.content ~* '[a-z0-9._]+@[a-z0-9]+\.[a-z]{2,}' THEN
    v_matched := true; v_reason := 'Email address detected';
  ELSIF NEW.content ~* '\mvenmo\M|\mcashapp\M|\mcash app\M|\mzelle\M|\mpaypal\M|\mapple\s*pay\M|\mgoogle\s*pay\M|\mcrypto\M|\mbitcoin\M|\mbtc\M|\meth\M' THEN
    v_matched := true; v_reason := 'Off-platform payment service mentioned';
  ELSIF NEW.content ~* '\mpay me direct\M|\moff the app\M|\moutside the app\M|\mskip the fee\M|\mavoid the fee\M|\mcash only\M|\min cash\M|\mtext me\M|\mcall me\M|\mwhatsapp\M|\mtelegram\M|\mdm me\M|\mhit me up\M|\mcontact me at\M|\mreach me at\M|\msend money to\M|\mpay outside\M' THEN
    v_matched := true; v_reason := 'Off-platform payment intent detected';
  END IF;

  IF v_matched THEN
    NEW.flagged_hidden := true;
    NEW.flag_reason := v_reason;
  END IF;

  RETURN NEW;
END;
$function$;
