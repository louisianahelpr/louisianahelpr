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

export const ALLOWED_DOC_TYPES = [
  ...ALLOWED_IMAGE_TYPES,
  "application/pdf",
];

export const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5 MB

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
    toast.error(
      `${label}: Invalid file type. Allowed: ${allowedTypes
        .map((t) => t.split("/")[1])
        .join(", ")}`,
    );
    return false;
  }
  if (file.size > MAX_FILE_SIZE) {
    toast.error(`${label}: File too large. Maximum 5MB.`);
    return false;
  }
  return true;
}

/**
 * Format a 10-digit US phone number into "(XXX) XXX-XXXX" as the user
 * types. Drops everything past the 10th digit; partial-input friendly so
 * `(504` and `(504) 555` both render correctly mid-typing.
 */
export function formatPhone(raw: string): string {
  const digits = raw.replace(/\D/g, "").slice(0, 10);
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
