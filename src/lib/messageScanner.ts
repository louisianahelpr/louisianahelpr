// Advisory UX only — scan_message_content() in Postgres is the authoritative gate; keep patterns in sync.
// Off-platform activity detection patterns
const PHONE_REGEX = /(\+?1?\s*[-.]?\s*\(?\d{3}\)?[\s.-]*\d{3}[\s.-]*\d{4})/gi;
// Spelled-out phone: 7+ consecutive number-words (mirrors the server heuristic).
const SPELLED_PHONE_REGEX = /(zero|one|two|three|four|five|six|seven|eight|nine|oh)([^a-z0-9]+(zero|one|two|three|four|five|six|seven|eight|nine|oh)){6,}/gi;
const EMAIL_REGEX = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/gi;
const PAYMENT_APPS = /\b(venmo|cashapp|cash\s*app|zelle|paypal|apple\s*pay|google\s*pay|crypto|bitcoin|btc|eth)\b/gi;
const DIRECT_PAY_PHRASES = /\b(pay\s*me\s*direct|off\s*the\s*app|outside\s*the\s*app|text\s*me|call\s*me|whatsapp|telegram|my\s*number|my\s*email|dm\s*me|hit\s*me\s*up|contact\s*me\s*at|reach\s*me\s*at|send\s*money\s*to|pay\s*outside|skip\s*the\s*fee|avoid\s*the\s*fee)\b/gi;

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

  const phones = normalizeDigits(content).match(PHONE_REGEX);
  if (phones) {
    phones.forEach((m) => violations.push({ type: "phone_number", match: m.trim(), label: "Phone number detected" }));
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
