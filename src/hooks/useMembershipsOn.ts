/**
 * Memberships are RETIRED (owner 2026-11-04: "no membership features should be
 * used anymore"). Every member gets the same standard experience, so every
 * membership surface (plans, upgrade sheets, Pro/Plus/Elite badges, tier
 * perks) is closed for everyone, in the web app and the store app alike.
 *
 * This hook no longer reads the 'memberships' switch: the answer is always
 * false. The switch itself is OFF (20261104143451_memberships_retired_off) and
 * is read only by the server's leftover paid-tier branches, which it keeps
 * unreachable. The follow-up removes those surfaces outright.
 *
 * Every membership surface reads THIS hook, never useFeature("memberships")
 * directly (src/test/membershipsOffInNativeApp.test.ts,
 * src/test/membershipsRetired.test.ts).
 */
export const MEMBERSHIPS_HIDDEN_IN_THIS_APP = true as const;

export function useMembershipsOn(): boolean {
  return false;
}

/** Same answer, already settled (the Membership tab never waits for it). */
export function useMembershipsStatus(): { on: boolean; settled: boolean } {
  return { on: false, settled: true };
}
