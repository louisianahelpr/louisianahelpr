// Pure helpers extracted from src/pages/Signup.tsx as the first step of
// breaking that 1267-line file apart. Nothing here touches React state —
// each function is a deterministic transform that can be unit-tested.
//
// Keep this file React-free so it can be imported by any sub-component
// (Step1/Step2/Step3) once those land in follow-up PRs.

import { toast } from "sonner";

export const ALLOWED_IMAGE_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
];

const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5 MB

export const SIGNUP_COOLDOWN_MS = 60_000; // 1 minute between attempts
export const SIGNUP_COOLDOWN_KEY = "helpr_signup_last";

/**
 * Validates a file against an allowlist of MIME types and the global
 * file-size cap. Surfaces a toast on failure (matches existing UX).
 * Returns true on pass, false on fail — caller bails out of the upload.
 */
export function validateFile(
  file: File,
  allowedTypes: string[],
  label: string,
): boolean {
  if (!allowedTypes.includes(file.type)) {
    toast.error(`${label}: that file type isn't supported — try JPG, PNG, or WEBP.`);
    return false;
  }
  if (file.size > MAX_FILE_SIZE) {
    toast.error(`${label}: that file is over 5 MB — try a smaller one.`);
    return false;
  }
  return true;
}

/**
 * Format a 10-digit US phone number into "(XXX) XXX-XXXX" as the user
 * types. Drops everything past the 10th digit; partial-input friendly so
 * `(504` and `(504) 555` both render correctly mid-typing.
 *
 * If the raw input has 11 digits starting with 1 (e.g. user pasted
 * "+1 (504) 555-1234"), drops the leading country-code 1 first so the
 * result is the local 10-digit number rather than a mis-grouped 10
 * digits including the country code.
 */
export function formatPhone(raw: string): string {
  let digits = raw.replace(/\D/g, "");
  if (digits.length === 11 && digits.startsWith("1")) {
    digits = digits.slice(1);
  }
  digits = digits.slice(0, 10);
  if (digits.length === 0) return "";
  if (digits.length < 4) return `(${digits}`;
  if (digits.length < 7) return `(${digits.slice(0, 3)}) ${digits.slice(3)}`;
  return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
}

/**
 * Read a File as base64 (without the `data:...,` prefix). Used to ship
 * file payloads through the complete-signup edge function which expects
 * raw base64 strings.
 */
export function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () =>
      resolve((reader.result as string).split(",")[1]);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

/**
 * Free-email domains we check signup addresses against. A mistyped domain
 * means the verification email never arrives — the single biggest silent
 * killer of activations — so we offer a one-tap correction.
 */
const POPULAR_EMAIL_DOMAINS = [
  "gmail.com",
  "yahoo.com",
  "hotmail.com",
  "outlook.com",
  "icloud.com",
  "aol.com",
  "live.com",
  "msn.com",
  "comcast.net",
  "att.net",
];

// Levenshtein edit distance (insert / delete / substitute). Small and
// dependency-free — only used on the short domain part of an email.
function editDistance(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  const dp: number[][] = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + cost);
    }
  }
  return dp[m][n];
}

/**
 * If the email's domain looks like a near-miss of a popular provider
 * (e.g. "gmial.com" → "gmail.com"), return the corrected full address;
 * otherwise null. Suggests only for edit distance 1–2, and never when the
 * domain already matches a known provider exactly — legitimate custom
 * domains (further than 2 edits from any provider) are left untouched.
 */
export function suggestEmailCorrection(email: string): string | null {
  const at = email.lastIndexOf("@");
  if (at < 1) return null;
  const local = email.slice(0, at);
  const domain = email.slice(at + 1).toLowerCase();
  if (!domain.includes(".") || POPULAR_EMAIL_DOMAINS.includes(domain)) return null;

  let best: string | null = null;
  let bestDist = Infinity;
  for (const candidate of POPULAR_EMAIL_DOMAINS) {
    const d = editDistance(domain, candidate);
    if (d < bestDist) {
      bestDist = d;
      best = candidate;
    }
  }
  return best && bestDist >= 1 && bestDist <= 2 ? `${local}@${best}` : null;
}

/**
 * Password strength score (0–4) + label for the signup strength meter.
 * Distinct from the hard requirement chips (8+/uppercase/number): this
 * rewards length and character variety to nudge toward a *better*
 * password, not just a passing one.
 */
export function passwordStrength(password: string): { score: number; label: string } {
  if (!password) return { score: 0, label: "" };
  let score = 0;
  if (password.length >= 8) score++;
  if (password.length >= 12) score++;
  if (/[A-Z]/.test(password) && /[a-z]/.test(password)) score++;
  if (/\d/.test(password)) score++;
  if (/[^A-Za-z0-9]/.test(password)) score++;
  score = Math.min(score, 4);
  return { score, label: ["", "Weak", "Fair", "Good", "Strong"][score] };
}

/**
 * Compute age in whole years from a YYYY-MM-DD date-of-birth string.
 * Used by the 18+ age gate; centralized here so any future age check
 * (e.g. mobile app) can call the same logic.
 */
export function ageFromDob(dob: string): number {
  const d = new Date(dob);
  const today = new Date();
  let age = today.getFullYear() - d.getFullYear();
  const monthDiff = today.getMonth() - d.getMonth();
  if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < d.getDate())) {
    age--;
  }
  return age;
}
