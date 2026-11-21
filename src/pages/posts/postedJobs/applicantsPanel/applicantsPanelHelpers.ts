import { avatarInitials } from "@/lib/avatarImage";

/**
 * Pure helpers extracted from ApplicantsPanel. No hooks, no component state
 * — safe to unit-test. Behaviour is byte-identical to the inline logic they
 * replaced.
 */

/** Up-to-two-letter uppercase initials from a helper's display name ("" for none).
    Audit 11-21 (P20): one rule for initials (avatarInitials: first and last word), so a member is "EH" on every screen. */
export function helperInitialsFrom(helperName: string): string {
  return avatarInitials(helperName, "");
}

/** True when an attachment URL points at a raster image (used to pick the
    thumbnail vs. chip attachment variant). */
export function isImageAttachment(url: string): boolean {
  return /\.(jpg|jpeg|png|gif|webp)$/i.test(url);
}
export { TopHelprChip } from "@/components/profile/TopHelprChip";
export { ApplicantNewTag, ApplicantTrustLine } from "@/components/TrustLine";
