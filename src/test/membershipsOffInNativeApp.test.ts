/*
 * CLASS CHECK: the store app never shows or sells a membership (owner,
 * 2026-10-21, via the lead, for the 1.0.4 resubmission that replaces 7119).
 *
 * THE BUG (Q1841): memberships are off for members (roadmap F4/F4a), but the
 * hidden "memberships" switch is at TESTERS and Apple's App Review account is
 * a tester, so the iOS build showed the Membership plans to the reviewer and
 * could sell one through StoreKit: a plan that grants nothing.
 *
 * THE CHECKS, from the app's own inventory (every tracked non-test file in src
 * that reads the switch):
 *  1. only src/hooks/useMembershipsOn.ts calls useFeature("memberships");
 *     every other reader goes through useMembershipsOn, so no surface can read
 *     the raw switch and show plans in the native app;
 *  2. useMembershipsOn answers false on a native build even when the switch
 *     is on, and follows the switch on the web;
 *  3. the surfaces that are not switch-driven are closed in the native app
 *     too: the Profile Membership row for a plan holder, the
 *     /profile?tab=subscription deep link (SubscriptionTab's plans), and the
 *     Help Center's "Membership & Billing" answers (plan prices, "billed
 *     through Stripe": lh-money-escrow review, 2026-10-21).
 */
// @mutate src/hooks/useMembershipsOn.ts | export function useMembershipsOn(): boolean {\n  return false; | export function useMembershipsOn(): boolean {\n  return true;
// @mutate src/components/profile/EarningsTab.tsx |   const membershipsOn = useMembershipsOn(); |   const membershipsOn = useFeature("memberships");
// @mutate src/components/profile/profileLanding/useProfileLandingDerived.tsx | (mayStillBeBilled(profile) && !MEMBERSHIPS_HIDDEN_IN_THIS_APP) | mayStillBeBilled(profile)
// @mutate src/components/profile/SubscriptionTab.tsx |   if (MEMBERSHIPS_HIDDEN_IN_THIS_APP) return |   if (false) return
import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { renderHook } from "@testing-library/react";
import { trackedFiles } from "./helpers/trackedFiles";
import { blankComments } from "./helpers/blankNonCode";

const ROOT = process.cwd();
const HOOK = "src/hooks/useMembershipsOn.ts";
const read = (f: string) => blankComments(readFileSync(join(ROOT, f), "utf8"));

const SOURCES = trackedFiles("src").filter(
  (f) => /\.(ts|tsx)$/.test(f) && !/\.test\.(ts|tsx)$/.test(f) && !f.startsWith("src/test/"),
);

describe("memberships are never shown or sold in the store app", () => {
  it("nothing in the app reads the raw memberships switch (retired 2026-11-04)", () => {
    const raw = SOURCES.filter((f) => /useFeature(?:Status)?\(\s*["']memberships["']\s*\)/.test(read(f)));
    expect(raw).toEqual([]);
    expect(SOURCES).toContain(HOOK);
  });

  it("every membership surface reads useMembershipsOn (inventory floor)", () => {
    const readers = SOURCES.filter((f) => f !== HOOK && /\buseMemberships(?:On|Status)\(\s*\)/.test(read(f)));
    // Measured 2026-10-21 (#23): five. AnalyticsUpgradePanel was deleted and the
    // Profile row gates on holding, or maybe still being billed for, a plan (mayStillBeBilled) instead of the switch.
    // 2026-10-27 (no-early-access-wait): seven. useDashboardData and useDashboardFilters read it to drop the
    // early-access wait while memberships are off.
    // 2026-10-29 (A3-C14): eight. MembershipPlansGate reads useMembershipsStatus so the
    // Membership tab shows no plan prices while memberships are off.
    // 2026-10-28 (audit F15): nine. PaymentLifecycleSteps reads it for the payment-success "Live now" line.
    // 2026-11-03 (Q1158, B41): eight. useDashboardData dropped its redundant early-access pre-filter (the feed waited
    // on the profile for it); useDashboardFilters still drops the wait on what is shown, and the view gates the rows.
    // 2026-11-04 (memberships retired, B114): seven. usePaidTierBadge no longer reads it (always null).
    expect(readers.length).toBe(7);
  });

  it("the Profile row for a plan holder and the deep-linked plans are closed in the native app", () => {
    const landing = read("src/components/profile/profileLanding/useProfileLandingDerived.tsx");
    expect(landing).toMatch(/mayStillBeBilled\(profile\) && !MEMBERSHIPS_HIDDEN_IN_THIS_APP/);
    const tab = read("src/components/profile/SubscriptionTab.tsx");
    const early = tab.indexOf("if (MEMBERSHIPS_HIDDEN_IN_THIS_APP) return <MembershipsUnavailable");
    expect(early).toBeGreaterThan(-1);
    // The early return comes before the plans render.
    expect(early).toBeLessThan(tab.indexOf("tierConfig.map"));
    // Memberships retired (2026-11-04): the Help Center topic is gone everywhere, not only hidden in the app.
    expect(read("src/pages/info/helpCenter/helpCenterContent.ts")).not.toMatch(/topic: "Membership & Billing"/);
  });
});

describe("useMembershipsOn", () => {
  const featureOn = vi.fn(() => true);
  beforeEach(() => {
    vi.resetModules();
    vi.doMock("@/hooks/useFeature", () => ({ useFeature: featureOn }));
  });

  it("is false on a native build even with the switch on", async () => {
    vi.doMock("@/lib/nativeInit", () => ({ isNativePlatform: true }));
    const { useMembershipsOn } = await import("@/hooks/useMembershipsOn");
    expect(renderHook(() => useMembershipsOn()).result.current).toBe(false);
  });

  it("is false on the web too, even with the switch on (memberships retired 2026-11-04)", async () => {
    vi.doMock("@/lib/nativeInit", () => ({ isNativePlatform: false }));
    const { useMembershipsOn, useMembershipsStatus, MEMBERSHIPS_HIDDEN_IN_THIS_APP } = await import("@/hooks/useMembershipsOn");
    expect(renderHook(() => useMembershipsOn()).result.current).toBe(false);
    expect(renderHook(() => useMembershipsStatus()).result.current).toEqual({ on: false, settled: true });
    expect(MEMBERSHIPS_HIDDEN_IN_THIS_APP).toBe(true);
  });
});
