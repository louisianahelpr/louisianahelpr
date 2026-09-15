/**
 * The ONE phone-number rule shared by the client scanner (messageScanner.ts,
 * advisory) and the server gate (public.contact_leak_reason, authoritative,
 * which messages, applications, job posts and bios all go through).
 *
 * A phone number is 10 digits, or 11 digits starting with 1 (+1), with up to
 * four separator characters between the groups: 225-555-0199,
 * (225) 555 0199, +1 225 555 0199, 2255550199. It is never a window INSIDE a
 * longer digit run: the rule used to be an unanchored 3-3-4 window, so the
 * 14-digit timestamp "20260914215014" in a message read as a phone number and
 * struck two accounts with real off-platform warnings (docs/OPEN.md queue #1,
 * 2026-09-14). Now a digit may not sit directly before or after the number.
 *
 * Two alternatives, joined by `|`:
 *   1. any 3-3-4 shape (separators optional, optional leading 1) with NO digit
 *      directly before or after: covers bare runs "2255550199", "12255550199";
 *   2. a 3-3-4 shape whose BOTH gaps are real separators, with no boundary
 *      rule: a digit glued on the front or back ("0225 555 0199",
 *      "225-555-01990") no longer hides a visibly formatted number
 *      (lh-trust-safety review 2026-09-14). A bare digit run never reaches this
 *      alternative, so "20260914215014" stays clean.
 * Both are subsets of the old rule, so nothing the old rule allowed is now
 * flagged.
 *
 * The SQL cannot import this file, so the migration carries the same string as
 * a literal, and src/lib/contactFilterParity.test.ts fails unless the newest
 * migration defining contact_leak_reason holds this exact string. That test
 * also runs the shared fixture list (contactLeakPhoneFixtures.json) through
 * both, and scripts/probes/contact-scan-phone.probe.mjs runs it through real
 * Postgres.
 *
 * Syntax is deliberately limited to what Postgres AREs and JavaScript read the
 * same way: character classes, `{m,n}`, `?`, `^`/`$` alternation, and a
 * negative LOOKAHEAD. No lookbehind: `(?<!...)` is a SyntaxError in Safari
 * before 16.4, and the iOS app supports iOS 15, where a lookbehind regex in
 * the bundle would break the chunk that loads it. No `\d`, `\b`, `\m` either
 * (they differ between the two engines). The parity test enforces this.
 *
 * Case-insensitive (`i` / `~*`); callers normalise fullwidth digits first.
 */
export const PHONE_PATTERN =
  "(^|[^0-9])(1[^0-9a-zA-Z]{0,4})?[0-9]{3}[^0-9a-zA-Z]{0,4}[0-9]{3}[^0-9a-zA-Z]{0,4}[0-9]{4}(?![0-9])" +
  "|[0-9]{3}[^0-9a-zA-Z]{1,4}[0-9]{3}[^0-9a-zA-Z]{1,4}[0-9]{4}";

/**
 * The app-generated location-share shape (RichMessageInput's "Share
 * Location" button): `📍 Location: <lat>,<lng>`, both rounded to 6 decimals
 * by `toFixed(6)`. Anchored to the WHOLE message (`^...$`) so this only ever
 * exempts a message that IS exactly this shape — never one that merely
 * mentions it.
 *
 * A 3-digit-integer longitude (west of -100 — most of the continental US
 * outside Louisiana, e.g. "-118.243700") coincidentally lines up with
 * PHONE_PATTERN's 3-3-4 shape once its own fractional digits are counted in:
 * "18.243700" reads as 3 digits, a ".", 3 more, then 4 of the 6 decimal
 * digits. That is a coordinate, never a phone number, so this exact shape is
 * exempted from PHONE_PATTERN on both sides (docs/OPEN.md queue #1 residual,
 * 2026-09-14/15). Louisiana coordinates (2-digit integer parts on both axes)
 * never needed this; the exemption is for the rest of the map.
 *
 * Checked BEFORE PHONE_PATTERN by contact_leak_reason (server) and scanMessage
 * (client, belt-and-suspenders alongside sendMessage's `isLocationShare`
 * skip) — src/lib/contactFilterParity.test.ts fails unless the newest
 * migration's exemption literal equals this string.
 */
export const LOCATION_SHARE_PATTERN =
  "^📍 Location: -?[0-9]{1,3}\\.[0-9]{6},-?[0-9]{1,3}\\.[0-9]{6}$";
