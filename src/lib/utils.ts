import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/** Format a full name as "First L." for privacy. */
export function formatName(fullName: string | null | undefined, fallback = "A neighbor"): string {
  // Trim FIRST, then check for emptiness — without this, a whitespace-only
  // string ("   ") was truthy in the `||` check but trimmed to "" and
  // split into [""], returning an empty string. Caught by utils.test.ts.
  const trimmed = (fullName ?? "").trim();
  // No real name → return the fallback verbatim. It's a literal display
  // label ("A neighbor", "this applicant", "Unknown helpr"), NOT a name to
  // run through the "First L." abbreviation — otherwise a multi-word
  // fallback gets mangled ("A neighbor" → "A n.").
  if (trimmed.length === 0) return fallback;
  const parts = trimmed.split(/\s+/).filter(Boolean);
  if (parts.length === 0) return fallback;
  if (parts.length > 1) {
    return `${parts[0]} ${parts[parts.length - 1][0]}.`;
  }
  return parts[0];
}
