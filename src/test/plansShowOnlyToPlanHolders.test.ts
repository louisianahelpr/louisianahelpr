/**
 * Owner 2026-10-21 (#23): the Membership row and the Advanced analytics entry
 * show only to a member who HOLDS a plan (holdsPaidPlan: a paid tier, not
 * lapsed); the analytics entry only to a plan that INCLUDES analytics
 * (profileHasPerk advancedAnalytics, the server's own gate: Basic does not).
 * Nobody is offered an upgrade (AnalyticsUpgradePanel is gone), and the empty
 * state never claims "no paid plans" (false for a Basic holder; money review).
 *
 * @mutate src/lib/subscriptionTiers.ts |   return !lapsed && toSubscriptionTier((rawTier ?? "").toLowerCase()) !== "free"; |   return toSubscriptionTier((rawTier ?? "").toLowerCase()) !== "free";
 * @mutate src/lib/subscriptionTiers.ts |   if (p.stripe_subscription_id) return true; |   if (p.stripe_subscription_id) return false;
 * @mutate src/lib/subscriptionTiers.ts | <= MEMBERSHIP_GRACE_DAYS * 86_400_000; | <= 0;
 * @mutate src/components/profile/SubscriptionTab.tsx | <MembershipStillBilled profile={profile} onManage={handleManageSubscription} loading={loadingPortal} /> | {null}
 * @mutate src/lib/subscriptionTiers.ts | p.subscription_billing_cycle === "one_time") return false; | p.subscription_billing_cycle === "never") return false;
 * @mutate supabase/functions/stripe-webhook/handlers/customerSubscriptionUpdated.ts | ...(STILL_BILLING_STATUSES.includes(subscription.status) ? { stripe_subscription_id: subscription.id } : {}), | ,
 * @mutate src/components/profile/EarningsTab.tsx | {membershipsOn && profileHasPerk(profile?.subscription_tier, profile?.subscription_expires_at, "advancedAnalytics") && (<button | {membershipsOn && (<button
 */
import { describe, it, expect } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { holdsPaidPlan, mayStillBeBilled } from "@/lib/subscriptionTiers";

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
  it("anyone who may still be billed keeps the Membership row and a Manage billing door (lead 2026-10-21)", () => {
    const day = 86_400_000;
    const ago = (d: number) => new Date(Date.now() - d * day).toISOString();
    expect(mayStillBeBilled({ subscription_tier: "pro", subscription_expires_at: null })).toBe(true);
    expect(mayStillBeBilled({ subscription_tier: null, subscription_expires_at: null, stripe_subscription_id: "sub_1" })).toBe(true);
    expect(mayStillBeBilled({ subscription_tier: "pro", subscription_expires_at: ago(13) })).toBe(true);
    expect(mayStillBeBilled({ subscription_tier: "pro", subscription_expires_at: ago(15) })).toBe(false);
    // A one-time pass is never rebilled: no grace door.
    expect(mayStillBeBilled({ subscription_tier: "pro", subscription_expires_at: ago(3), subscription_billing_cycle: "one_time" })).toBe(false);
    expect(mayStillBeBilled({ subscription_tier: null, subscription_expires_at: ago(1) })).toBe(false);
    expect(mayStillBeBilled(null)).toBe(false);
    // past_due / unpaid: Stripe still retries, so the webhook keeps the subscription link.
    const wh = read("supabase/functions/stripe-webhook/handlers/customerSubscriptionUpdated.ts");
    expect(wh).toMatch(/const STILL_BILLING_STATUSES: string\[\] = \["past_due", "unpaid"\];/);
    expect(wh).toMatch(/\.\.\.\(STILL_BILLING_STATUSES\.includes\(subscription\.status\) \? \{ stripe_subscription_id: subscription\.id \} : \{\}\)/);
    expect(read("src/components/profile/SubscriptionTab.tsx")).toMatch(/<MembershipStillBilled profile=\{profile\} onManage=\{handleManageSubscription\}/);
  });
});
