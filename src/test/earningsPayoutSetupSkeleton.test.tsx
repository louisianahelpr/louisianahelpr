/*
 * GUARD (docs/OPEN.md Q429, bot PR #2148): the Money tab (was "Earnings & Payouts") skeleton is
 * DATA-AWARE (owner, 2026-10-03: "data-aware skeletons", the state known
 * before the data). A Helpr with no payout account gets PaymentTab's connect
 * card at the top of the page once Stripe answers (it sat above a view
 * switcher, with an activity card, until the one-page Earnings, Q1177); the skeleton
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
// @mutate src/components/profile/EarningsTab.tsx | {!hasStripeAccount && (stripeLoading \|\| (showConnect && !connectSettled)) && <EarningsPayoutSetupSkeleton />} | {false && <EarningsPayoutSetupSkeleton />}
// @mutate src/components/profile/earningsTab/EarningsPageSkeleton.tsx | const wallet = !!profile?.stripe_account_id; | const wallet = false;
import { describe, it, expect, vi, beforeEach } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
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

  it("draws the connect block when the profile has no Stripe account", () => {
    mockProfile = { stripe_account_id: null };
    renderSkeleton();
    expect(screen.queryByTestId("earnings-payout-setup-skeleton")).not.toBeNull();
    expect(screen.queryByTestId("earnings-wallet-skeleton")).toBeNull();
  });

  // One page (Q1177): a connected Helpr's page opens on the WalletCard, so a
  // profile with a Stripe account holds that slot with the wallet's bones, in
  // the full-page skeleton and in the in-tab data wait alike.
  it("draws the wallet's bones for a profile with a Stripe account", () => {
    mockProfile = { stripe_account_id: "acct_123" };
    renderSkeleton();
    expect(screen.queryByTestId("earnings-wallet-skeleton")).not.toBeNull();
    cleanup();
    // The in-tab wait leaves the wallet to EarningsTab, which draws it (or
    // its bones) ABOVE the real switcher (owner, 2026-10-08).
    renderSkeleton({ withHeader: false });
    expect(screen.queryByTestId("earnings-wallet-skeleton")).toBeNull();
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
      "{!hasStripeAccount && (stripeLoading || (showConnect && !connectSettled)) && <EarningsPayoutSetupSkeleton />}",
    );
  });
});

describe("the ghost copy is the real copy, so it wraps like the real lines", () => {
  const skel = read("src/components/profile/earningsTab/EarningsPageSkeleton.tsx");
  const ghosts = [...skel.matchAll(/<GhostLine[^>]*>\s*([^<]+?)\s*<\/GhostLine>/g)].map((m) => m[1].trim());

  it("every ghost line is printed verbatim by PayoutSetupForm or PaymentTab", () => {
    // 2: the connect card's title and body. The activity card's three lines
    // left with that card (Q1177).
    expect(ghosts.length).toBe(2);
    const real = read("src/components/PayoutSetupForm.tsx") + read("src/components/PaymentTab.tsx");
    for (const g of ghosts) expect(real, g).toContain(g);
  });
});
