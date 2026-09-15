-- Contact scanner residual #2 (docs/OPEN.md queue #1, found by the
-- 2026-09-14/15 fix, not fixed there): a location share reads as a phone
-- number on the server whenever the longitude's integer part is 3 digits
-- (west of -100 — most of the continental US outside Louisiana). Rounded to
-- 6 decimals, "📍 Location: 34.052235,-118.243700" contains "18.243700":
-- read as digits-and-separators that is 3 digits, a real separator, 3 more
-- digits, a real separator, 4 more digits — PHONE_PATTERN's second
-- alternative (a 3-3-4 shape with real separators in both gaps). That is a
-- coordinate, not a phone number; the client never sees this because
-- sendMessage's `isLocationShare` flag skips its scan entirely, but
-- contact_leak_reason (the server's scan_message_content trigger) scans
-- every inserted message regardless.
--
-- FIX: contact_leak_reason now exempts the EXACT app-generated location-
-- share shape, checked before PHONE_PATTERN (or anything else) can fire.
-- Anchored to the whole message (`^...$`), so this exempts a message that
-- IS this shape, never one that merely contains it. The pattern is
-- LOCATION_SHARE_PATTERN in src/lib/contactLeakRules.ts — the same string,
-- enforced by src/lib/contactFilterParity.test.ts reading this migration —
-- and RichMessageInput.tsx now sends bare "lat,lng" (never a URL) so the
-- stored content is exactly this shape; MessageBubble.tsx builds the
-- clickable maps.google.com link at render time instead of trusting one out
-- of message content.
--
-- Louisiana coordinates (2-digit integer parts on both axes) never
-- triggered this — the existing grid guard in contactFilterParity.test.ts
-- already proved 0 flagged there. This exemption is for the rest of the
-- map; a California share (-118.2437) is the repro this migration and its
-- guards use, alongside a Louisiana share proving no regression.
--
-- Every other branch is byte-for-byte the live body (20260915020258).
--
-- REPLAY-SAFETY: CREATE OR REPLACE, same signature as live, grants restated
-- to match live proacl, no DDL on tables. Resolves nothing but its own
-- arguments at call time, so this applies on a database of any age, any
-- number of times.

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

  -- App-generated location share ("📍 Location: lat,lng", both rounded to 6
  -- decimals) — see the migration header above. Checked first and exits
  -- early: a message that is exactly this shape can never also be a phone
  -- number, email, or off-platform-payment phrase.
  IF v_norm ~ '^📍 Location: -?[0-9]{1,3}\.[0-9]{6},-?[0-9]{1,3}\.[0-9]{6}$' THEN
    RETURN NULL;
  END IF;

  IF v_norm ~* '(^|[^0-9])(1[^0-9a-zA-Z]{0,4})?[0-9]{3}[^0-9a-zA-Z]{0,4}[0-9]{3}[^0-9a-zA-Z]{0,4}[0-9]{4}(?![0-9])|[0-9]{3}[^0-9a-zA-Z]{1,4}[0-9]{3}[^0-9a-zA-Z]{1,4}[0-9]{4}' THEN
    RETURN 'Phone number detected';
  ELSIF p_text ~* '(zero|one|two|three|four|five|six|seven|eight|nine|oh)([^a-z0-9]+(zero|one|two|three|four|five|six|seven|eight|nine|oh)){6,}' THEN
    RETURN 'Phone number detected';
  ELSIF p_text ~* '[a-z0-9._]+@[a-z0-9-]+(\.[a-z0-9-]+)*\.[a-z]{2,}' THEN
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
