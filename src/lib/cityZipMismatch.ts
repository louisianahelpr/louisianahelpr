import { parishForCity } from "@/lib/parishes";

/**
 * Soft mismatch hint (owner-requested 2026-09-04): only fires when the typed City is a RECOGNIZED
 * city of a DIFFERENT parish than the ZIP resolved to, never when the city is merely absent from the
 * registry (parishForCity's own contract: null means "unknown", not "no match"), so a real
 * small-town combination the registry doesn't list never gets flagged as wrong.
 */
export function cityZipMismatchHint(location: string, resolvedZipParish: string | null | undefined): string | null {
  if (!resolvedZipParish) return null;
  const cityParish = parishForCity(location);
  if (!cityParish || cityParish.name === resolvedZipParish) return null;
  return `That ZIP usually maps to ${resolvedZipParish} Parish, not where ${location.trim()} is (${cityParish.name} Parish) — double check it.`;
}
