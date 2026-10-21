import { useFeature } from "@/hooks/useFeature";
import { isNativePlatform } from "@/lib/nativeInit";

/**
 * Memberships are never shown or sold inside the store app (owner, 2026-10-21,
 * via the lead: "the new build must not show or sell memberships at all").
 *
 * WHY THE NATIVE APP IS DIFFERENT. Roadmap F4/F4a turned every paid perk off,
 * and the hidden "memberships" switch keeps them for testers only. The App
 * Review account is a tester, so with the switch alone Apple's reviewer still
 * saw the Membership plans and could buy one through StoreKit (Q1841), and a
 * plan that grants nothing is a 3.1.1/2.1 rejection. Where the purchase goes
 * is a store rule, i.e. a genuine native capability: the native build answers
 * false whatever the switch says, the web keeps the switch.
 *
 * Every membership surface reads THIS hook, never useFeature("memberships")
 * directly (src/test/membershipsOffInNativeApp.test.ts).
 */
export const MEMBERSHIPS_HIDDEN_IN_THIS_APP: boolean = isNativePlatform;

export function useMembershipsOn(): boolean {
  const on = useFeature("memberships");
  return on && !MEMBERSHIPS_HIDDEN_IN_THIS_APP;
}
