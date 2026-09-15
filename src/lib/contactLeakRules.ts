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
