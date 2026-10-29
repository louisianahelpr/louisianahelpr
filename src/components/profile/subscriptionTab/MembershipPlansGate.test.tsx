/**
 * A3-C14 (app audit 2026-10-29): /profile?tab=subscription showed the full
 * paid membership price table, and a Free tier "20 min after posting" line, to
 * members for whom the `memberships` switch is off. While it is off the plans
 * are not rendered: the member reads "Memberships aren't available right now."
 * Someone who holds a plan or may still be billed keeps the tab (Manage
 * billing). Until the switch's answer is in, a skeleton, never the table.
 */
import { describe, expect, it, vi, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { readFileSync } from "node:fs";
import { blankComments } from "@/test/helpers/blankNonCode";

const sw = vi.hoisted(() => ({ on: false, settled: true }));
vi.mock("@/hooks/useFeature", () => ({
  useFeature: () => sw.on,
  useFeatureStatus: () => ({ on: sw.on, settled: sw.settled, lastAnswer: null }),
}));
vi.mock("@/lib/nativeInit", () => ({ isNativePlatform: false }));

import { MembershipPlansGate, membershipPlansView } from "./MembershipPlansGate";

type Billing = { subscription_tier: string | null; subscription_expires_at: string | null; stripe_subscription_id: string | null; subscription_billing_cycle: string | null };
const FREE: Billing = { subscription_tier: null, subscription_expires_at: null, stripe_subscription_id: null, subscription_billing_cycle: null };
const HOLDER: Billing = { ...FREE, subscription_tier: "pro", subscription_expires_at: new Date(Date.now() + 30 * 86_400_000).toISOString() };

function renderGate(profile: Billing) {
  render(
    <MemoryRouter>
      <MembershipPlansGate profile={profile} onBack={() => {}}>
        <div data-testid="plans">$9.99 a month</div>
      </MembershipPlansGate>
    </MemoryRouter>,
  );
}

afterEach(() => {
  cleanup();
  sw.on = false;
  sw.settled = true;
});

describe("the Membership tab shows no plan prices while memberships are off", () => {
  it("decides from the switch, the answer being in, and billing", () => {
    const cases: [boolean, boolean, Billing, string][] = [
      [false, true, FREE, "closed"],
      [false, false, FREE, "loading"],
      [true, true, FREE, "plans"],
      [false, true, HOLDER, "plans"],
    ];
    expect(cases.length).toBeGreaterThan(3);
    for (const [on, settled, profile, want] of cases) {
      expect(membershipPlansView({ on, settled }, profile)).toBe(want);
    }
  });

  it("switch off: no prices, the plain sentence instead", () => {
    renderGate(FREE);
    expect(screen.queryByTestId("plans")).toBeNull();
    expect(screen.getByTestId("memberships-unavailable").textContent).toBe("Memberships aren't available right now.");
  });

  it("answer not in yet: neither the table nor the 'not available' line", () => {
    sw.settled = false;
    renderGate(FREE);
    expect(screen.queryByTestId("plans")).toBeNull();
    expect(screen.queryByTestId("memberships-unavailable")).toBeNull();
  });

  it("switch on, or a plan holder: the tab as before", () => {
    sw.on = true;
    renderGate(FREE);
    expect(screen.getByTestId("plans")).toBeTruthy();
    cleanup();
    sw.on = false;
    renderGate(HOLDER);
    expect(screen.getByTestId("plans")).toBeTruthy();
  });

  it("the Profile panels render SubscriptionTab only inside the gate", () => {
    const src = blankComments(readFileSync("src/pages/profile/ProfileTabPanels.tsx", "utf8"));
    expect(src).toMatch(/<MembershipPlansGate[^>]*>\s*<SubscriptionTab\b/);
    expect(src.match(/<SubscriptionTab\b/g)?.length).toBe(1);
  });
});

// @mutate src/components/profile/subscriptionTab/MembershipPlansGate.tsx |   if (status.on \|\| mayStillBeBilled(profile)) return "plans"; |   return "plans";
