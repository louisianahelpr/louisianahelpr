// Advisory UX only — scan_message_content() in Postgres is the authoritative gate; keep patterns in sync.
import { PHONE_PATTERN } from "./contactLeakRules";

// Off-platform activity detection patterns
// The phone rule is NOT defined here: it is the shared PHONE_PATTERN, the same
// string the server's contact_leak_reason() uses (contactFilterParity.test.ts
// fails if they differ). Separators stay `[^0-9a-zA-Z]{0,4}` (V-016,
// lh-verifier 2026-09-04: a narrower client scope than the server meant a
// message composing clean here could still be struck on send), and the number
// may no longer sit inside a longer digit run (docs/OPEN.md queue #1,
// 2026-09-14: a 14-digit timestamp read as a phone number).
const PHONE_REGEX = new RegExp(PHONE_PATTERN, "gi");
// Spelled-out phone: 7+ consecutive number-words (mirrors the server heuristic).
const SPELLED_PHONE_REGEX = /(zero|one|two|three|four|five|six|seven|eight|nine|oh)([^a-z0-9]+(zero|one|two|three|four|five|six|seven|eight|nine|oh)){6,}/gi;
const EMAIL_REGEX = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/gi;
const PAYMENT_APPS = /\b(venmo|cashapp|cash\s*app|zelle|paypal|apple\s*pay|google\s*pay|crypto|bitcoin|btc|eth)\b/gi;
// `my number` / `my email` are deliberately CLIENT-ONLY (see the file header
// in messageScanner.test.ts, F-TRUST-01, 2026-06-18): the server's ladder
// auto-suspends on 2 flags/24h, so a signal this weak was dropped
// server-side to avoid false-positive suspensions, while the client still
// warns because the soft nudge has no punishment cost. That half is correct
// and unchanged.
//
// `cash only` / `in cash` were the other half, and they were NOT a safe
// asymmetry: the server DOES treat them as a real off-platform-payment
// violation and can strike the sender for one, but the client warned about
// NOTHING before send. A message like "cash only, I'll pay you Saturday"
// composed clean, appeared sent in the sender's own thread (RLS always shows
// your own messages), and only the recipient's copy was silently hidden —
// the sender could be struck with no warning and no visible reason. Added
// here so the client warns before send on exactly the phrases the server
// will act on after send.
const DIRECT_PAY_PHRASES = /\b(pay\s*me\s*direct|off\s*the\s*app|outside\s*the\s*app|text\s*me|call\s*me|whatsapp|telegram|my\s*number|my\s*email|dm\s*me|hit\s*me\s*up|contact\s*me\s*at|reach\s*me\s*at|send\s*money\s*to|pay\s*outside|skip\s*the\s*fee|avoid\s*the\s*fee|cash\s*only|in\s*cash)\b/gi;

// Normalize fullwidth digits (U+FF10-U+FF19) to ASCII so they can't evade the
// phone regex — mirrors the server-side translate(). (F-TRUST-02)
const normalizeDigits = (s: string): string =>
  s.replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0));

type ViolationType = "phone_number" | "email" | "payment_app" | "direct_pay";

export type DetectedViolation = {
  type: ViolationType;
  match: string;
  label: string;
};

export function scanMessage(content: string): DetectedViolation[] {
  const violations: DetectedViolation[] = [];

  // Group 1 is the boundary character in front of the number (or "" at the
  // start). Keep it only when it is part of how the number is written ("(" or
  // "+"), so the dialog quotes "(225) 555 0199", not ":2255550199".
  for (const m of normalizeDigits(content).matchAll(PHONE_REGEX)) {
    const lead = m[1] ?? "";
    const shown = (/[(+]/.test(lead) ? lead : "") + m[0].slice(lead.length);
    violations.push({ type: "phone_number", match: shown.trim(), label: "Phone number detected" });
  }

  const spelledPhones = content.match(SPELLED_PHONE_REGEX);
  if (spelledPhones) {
    spelledPhones.forEach((m) => violations.push({ type: "phone_number", match: m.trim(), label: "Phone number detected" }));
  }

  const emails = content.match(EMAIL_REGEX);
  if (emails) {
    emails.forEach((m) => violations.push({ type: "email", match: m.trim(), label: "Email address detected" }));
  }

  const payApps = content.match(PAYMENT_APPS);
  if (payApps) {
    payApps.forEach((m) => violations.push({ type: "payment_app", match: m.trim(), label: "Payment app mentioned" }));
  }

  const directPay = content.match(DIRECT_PAY_PHRASES);
  if (directPay) {
    directPay.forEach((m) => violations.push({ type: "direct_pay", match: m.trim(), label: "Off-platform language detected" }));
  }

  return violations;
}

export function hasViolation(content: string): boolean {
  return scanMessage(content).length > 0;
}
