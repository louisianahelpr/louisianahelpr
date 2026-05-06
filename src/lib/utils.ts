import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/** Format a full name as "First L." for privacy. */
export function formatName(fullName: string | null | undefined, fallback = "User"): string {
  // Trim FIRST, then check for emptiness — without this, a whitespace-only
  // string ("   ") was truthy in the `||` check but trimmed to "" and
  // split into [""], returning an empty string. Caught by utils.test.ts.
  const trimmed = (fullName ?? "").trim();
  const name = trimmed.length > 0 ? trimmed : fallback;
  const parts = name.split(/\s+/).filter(Boolean);
  if (parts.length === 0) return fallback;
  if (parts.length > 1) {
    return `${parts[0]} ${parts[parts.length - 1][0]}.`;
  }
  return parts[0];
}
