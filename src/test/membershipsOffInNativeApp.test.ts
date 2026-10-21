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
// @mutate src/hooks/useMembershipsOn.ts |   return on && !MEMBERSHIPS_HIDDEN_IN_THIS_APP; |   return on;
// @mutate src/components/profile/EarningsTab.tsx |   const membershipsOn = useMembershipsOn(); |   const membershipsOn = useFeature("memberships");
// @mutate src/components/profile/profileLanding/useProfileLandingDerived.tsx | (tier !== "free" && !MEMBERSHIPS_HIDDEN_IN_THIS_APP) | tier !== "free"
// @mutate src/components/profile/SubscriptionTab.tsx |   if (MEMBERSHIPS_HIDDEN_IN_THIS_APP) return |   if (false) return
// @mutate src/pages/info/HelpCenter.tsx | !(MEMBERSHIPS_HIDDEN_IN_THIS_APP && section.topic === "Membership & Billing") | true
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
  it("only useMembershipsOn reads the raw memberships switch", () => {
    const raw = SOURCES.filter((f) => /useFeature\(\s*["']memberships["']\s*\)/.test(read(f)));
    expect(raw).toEqual([HOOK]);
  });

  it("every membership surface reads useMembershipsOn (inventory floor)", () => {
    const readers = SOURCES.filter((f) => f !== HOOK && /\buseMembershipsOn\(\s*\)/.test(read(f)));
    // Measured 2026-10-21: JobBoostDialog, AnalyticsUpgradePanel, EarningsTab,
    // SubscriptionTab, useProfileLandingDerived, HelperAnalytics.
    expect(readers.length).toBeGreaterThan(5);
  });

  it("the Profile row for a plan holder and the deep-linked plans are closed in the native app", () => {
    const landing = read("src/components/profile/profileLanding/useProfileLandingDerived.tsx");
    expect(landing).toMatch(/tier !== "free" && !MEMBERSHIPS_HIDDEN_IN_THIS_APP/);
    const tab = read("src/components/profile/SubscriptionTab.tsx");
    const early = tab.indexOf("if (MEMBERSHIPS_HIDDEN_IN_THIS_APP) return <MembershipsUnavailable");
    expect(early).toBeGreaterThan(-1);
    // The early return comes before the plans render.
    expect(early).toBeLessThan(tab.indexOf("tierConfig.map"));
    const help = read("src/pages/info/HelpCenter.tsx");
    expect(help).toMatch(/!\(MEMBERSHIPS_HIDDEN_IN_THIS_APP && section\.topic === "Membership & Billing"\)/);
    // The topic it hides still exists under that exact name.
    expect(read("src/pages/info/helpCenter/helpCenterContent.ts")).toMatch(/topic: "Membership & Billing"/);
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

  it("follows the switch on the web", async () => {
    vi.doMock("@/lib/nativeInit", () => ({ isNativePlatform: false }));
    const { useMembershipsOn } = await import("@/hooks/useMembershipsOn");
    expect(renderHook(() => useMembershipsOn()).result.current).toBe(true);
    featureOn.mockReturnValueOnce(false);
    expect(renderHook(() => useMembershipsOn()).result.current).toBe(false);
  });
});
