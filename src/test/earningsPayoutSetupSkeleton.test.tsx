/*
 * GUARD (docs/OPEN.md Q429, bot PR #2148): the Earnings & Payouts skeleton is
 * DATA-AWARE (owner, 2026-10-03: "data-aware skeletons", the state known
 * before the data). A Helpr with no payout account gets PaymentTab's connect
 * card and activity card ABOVE the switcher once Stripe answers; the skeleton
 * never drew them, so the page jumped +403px at 375 on both test accounts
 * (loading-states run 2026-10-02: rows 3->4, media 1->3 on earnings and
 * payment). The profile row says whether a Stripe account exists before any
 * query, so the skeleton draws that block exactly when it is coming.
 *
 * Measured after the fix (local, prod data, both test accounts): 0 breaches
 * by check-loading-state-shape's own rule at 375 light/dark and 1440
 * light/dark, on /profile?tab=earnings and /profile?tab=payment.
 */
// @mutate src/components/profile/earningsTab/EarningsPageSkeleton.tsx | const payoutSetup = withHeader && !profile?.stripe_account_id; | const payoutSetup = false;
// @mutate src/components/profile/EarningsTab.tsx | {!pageReady && !profile?.stripe_account_id && <EarningsPayoutSetupSkeleton />} | {false && <EarningsPayoutSetupSkeleton />}
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { readFileSync } from "node:fs";
import { join } from "node:path";

let mockProfile: { stripe_account_id: string | null } | undefined;
vi.mock("@/hooks/useCurrentUser", () => ({
  useCurrentUser: () => ({ user: { id: "user-1" }, profile: mockProfile, loading: false }),
}));

import { EarningsPageSkeleton } from "@/components/profile/earningsTab/EarningsPageSkeleton";

const ROOT = join(__dirname, "..", "..");
const read = (rel: string) => readFileSync(join(ROOT, rel), "utf8");
const renderSkeleton = (props: { withHeader?: boolean } = {}) =>
  render(
    <MemoryRouter>
      <EarningsPageSkeleton {...props} />
    </MemoryRouter>,
  );

describe("Earnings skeleton is data-aware (Q429)", () => {
  beforeEach(() => {
    mockProfile = undefined;
  });

  it("draws the connect + activity block when the profile has no Stripe account", () => {
    mockProfile = { stripe_account_id: null };
    renderSkeleton();
    expect(screen.queryByTestId("earnings-payout-setup-skeleton")).not.toBeNull();
  });

  it("draws it while the profile is still loading (the typical case before launch)", () => {
    renderSkeleton();
    expect(screen.queryByTestId("earnings-payout-setup-skeleton")).not.toBeNull();
  });

  it("draws no connect block for a profile that already has a Stripe account", () => {
    mockProfile = { stripe_account_id: "acct_123" };
    renderSkeleton();
    expect(screen.queryByTestId("earnings-payout-setup-skeleton")).toBeNull();
  });

  it("leaves the in-tab data wait (no header) to EarningsTab's own slot", () => {
    mockProfile = { stripe_account_id: null };
    renderSkeleton({ withHeader: false });
    expect(screen.queryByTestId("earnings-payout-setup-skeleton")).toBeNull();
    expect(read("src/components/profile/EarningsTab.tsx")).toContain(
      "{!pageReady && !profile?.stripe_account_id && <EarningsPayoutSetupSkeleton />}",
    );
  });
});

describe("the ghost copy is the real copy, so it wraps like the real lines", () => {
  const skel = read("src/components/profile/earningsTab/EarningsPageSkeleton.tsx");
  const ghosts = [...skel.matchAll(/<GhostLine[^>]*>\s*([^<]+?)\s*<\/GhostLine>/g)].map((m) => m[1].trim());

  it("every ghost line is printed verbatim by PayoutSetupForm or PaymentTab", () => {
    expect(ghosts.length).toBe(5);
    const real = read("src/components/PayoutSetupForm.tsx") + read("src/components/PaymentTab.tsx");
    for (const g of ghosts) expect(real, g).toContain(g);
  });
});
