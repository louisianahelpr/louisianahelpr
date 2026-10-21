/**
 * Owner 2026-10-21 (#23): the Membership row and the Advanced analytics entry
 * show only to a member who HOLDS a plan (holdsPaidPlan: a paid tier, not
 * lapsed); the analytics entry only to a plan that INCLUDES analytics
 * (profileHasPerk advancedAnalytics, the server's own gate: Basic does not).
 * Nobody is offered an upgrade (AnalyticsUpgradePanel is gone), and the empty
 * state never claims "no paid plans" (false for a Basic holder; money review).
 *
 * @mutate src/lib/subscriptionTiers.ts |   return !lapsed && toSubscriptionTier((rawTier ?? "").toLowerCase()) !== "free"; |   return toSubscriptionTier((rawTier ?? "").toLowerCase()) !== "free";
 * @mutate src/components/profile/EarningsTab.tsx | {membershipsOn && profileHasPerk(profile?.subscription_tier, profile?.subscription_expires_at, "advancedAnalytics") && (<button | {membershipsOn && (<button
 */
import { describe, it, expect } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { holdsPaidPlan } from "@/lib/subscriptionTiers";

const ROOT = resolve(__dirname, "..", "..");
const read = (f: string) => readFileSync(join(ROOT, f), "utf8");

describe("plans show only to plan holders (#23)", () => {
  it("holdsPaidPlan: a paid tier that has not lapsed", () => {
    expect(holdsPaidPlan("pro", null)).toBe(true);
    expect(holdsPaidPlan("PRO", new Date(Date.now() + 86_400_000).toISOString())).toBe(true);
    expect(holdsPaidPlan("pro", new Date(Date.now() - 86_400_000).toISOString())).toBe(false);
    expect(holdsPaidPlan("free", null)).toBe(false);
    expect(holdsPaidPlan(null, null)).toBe(false);
  });
  it("the Advanced analytics entry needs a plan, and no upgrade panel exists", () => {
    expect(read("src/components/profile/EarningsTab.tsx")).toMatch(/membershipsOn && profileHasPerk\(profile\?\.subscription_tier, profile\?\.subscription_expires_at, "advancedAnalytics"\) && \(<button/);
    expect(read("src/pages/profile/HelperAnalytics.tsx")).not.toMatch(/no paid plans/);
    expect(existsSync(join(ROOT, "src/components/analytics/AnalyticsUpgradePanel.tsx"))).toBe(false);
    expect(read("src/pages/profile/HelperAnalytics.tsx")).not.toMatch(/AnalyticsUpgradePanel/);
  });
});
