/**
 * Pure helpers extracted from ApplicantsPanel. No hooks, no component state
 * — safe to unit-test. Behaviour is byte-identical to the inline logic they
 * replaced.
 */

/** Up-to-two-letter uppercase initials from a helper's display name.
    Mirrors the inline `name.split(...).map(w => w[0]).join(...)` chain. */
export function helperInitialsFrom(helperName: string): string {
  return helperName
    .split(/\s+/).filter(Boolean).map((w) => w[0]).join("").toUpperCase().slice(0, 2);
}

/** True when an attachment URL points at a raster image (used to pick the
    thumbnail vs. chip attachment variant). */
export function isImageAttachment(url: string): boolean {
  return /\.(jpg|jpeg|png|gif|webp)$/i.test(url);
}
