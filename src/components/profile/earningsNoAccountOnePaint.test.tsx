/**
 * Q1816 / Q169: the Money tab paints ONCE for a member with no payout account.
 *
 * Prod-audit run 43691657529 (2026-11-15), page-settle at 375 on /profile?tab=earnings and tab=payment: 0.12 at
 * ~487 ms (the connect slot's bones took the not-hired-yet note's shape, then grew to the connect card's 252px when
 * the hire answer landed, and Earned | Spent moved 158px) plus 0.07 at ~1.4 s (the real connect card, 386px,
 * replaced those bones and everything moved 134px more). 1440: 0.046 + 0.017, the same two steps.
 *
 * The rule pinned here: with no payout account, everything below the money tiles is ONE fixed-shape skeleton until
 * the Stripe status, the hire answer and PaymentTab's reads are all in (capped at ARRIVAL_CAP_MS), and nothing inside
 * it changes shape while they land. A member with a payout account never waits on it.
 */
// @mutate src/components/profile/EarningsTab.tsx | const holdBody = !hasStripeAccount && !noAccountBodyReady; | const holdBody = false;
// @mutate src/components/profile/EarningsTab.tsx | payoutHireSettled && (!showConnect \|\| connectSettled) && streakState.settled | (!showConnect \|\| connectSettled) && streakState.settled
// @mutate src/components/profile/EarningsTab.tsx | !stripeLoading && payoutHireSettled && | payoutHireSettled &&
// @mutate src/components/profile/EarningsTab.tsx |     !loading,\n    !stripeLoading && payoutHireSettled |     !loading && !stripeLoading,\n    payoutHireSettled
// @mutate src/components/profile/EarningsTab.tsx | payoutHireSettled && (!showConnect \|\| connectSettled) && streakState.settled | payoutHireSettled && streakState.settled
// @mutate src/components/profile/EarningsTab.tsx | <div id="earnings-bank-connect" hidden={!connectSettled \|\| holdBody}> | <div id="earnings-bank-connect" hidden={!connectSettled}>
// @mutate src/components/profile/EarningsTab.tsx | const settled = !!profile && !holdBody && | const settled = !!profile &&
// @mutate src/components/profile/earningsTab/EarningsPageSkeleton.tsx |       <EarningsPayoutSetupSkeleton /> |       <EarningsPayoutSetupSkeleton hireAllowed />
import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { useEffect } from "react";
import type { StripePayoutData } from "./earningsTab/types";

let profileRow: Record<string, unknown>;
vi.mock("@/hooks/useCurrentUser", () => ({
  useCurrentUser: () => ({ user: { id: "helper-1" }, profile: profileRow, loading: false }),
}));
vi.mock("@/components/money/FeesOwedLine", () => ({ FeesOwedLine: () => null }));
vi.mock("@/hooks/useFeature", () => ({ useFeature: () => false }));
vi.mock("@/hooks/useFirstPayoutFee", () => ({ useFirstPayoutFeeDollars: () => 0 }));
vi.mock("@/pages/home/homeDashboard/homeMoney", () => ({ useHomeMoney: () => ({ coming: null, held: null }) }));
vi.mock("@/hooks/useHelperMilestones", () => ({ useHelperMilestones: () => {} }));
vi.mock("@/components/profile/HelperStreakBadge", () => ({
  HelperStreakBadge: () => null,
  useHelperStreak: () => ({ settled: true, streak: 0 }),
  streakShows: () => false,
}));
vi.mock("@/components/EarningsExport", () => ({ EarningsExport: () => null }));
vi.mock("@/components/InstantPayoutDialog", () => ({ default: () => null }));
vi.mock("@/components/ProUpgradeSheet", () => ({ default: () => null }));
vi.mock("@/components/wallet/PayoutCelebration", () => ({ PayoutCelebration: () => null }));
vi.mock("@/components/profile/EarningsBreakdownCharts", () => ({ EarningsBreakdownCharts: () => null }));
vi.mock("@/components/profile/earningsTab/SpentSection", () => ({ SpentSection: () => <p>spent section</p> }));

// The hire answer (payout_setup_hire_allowed_for_me), held until the test releases it.
let hire = { allowed: false, settled: false };
vi.mock("@/hooks/usePayoutSetupHireAllowed", () => ({
  usePayoutSetupHireStatus: () => hire,
  usePayoutSetupHireAllowed: () => hire.allowed,
}));

// PaymentTab reports settled only when the test says its reads are in.
let paymentSettled = false;
vi.mock("@/components/PaymentTab", () => ({
  PaymentTab: ({ onSettled }: { onSettled?: () => void }) => {
    useEffect(() => { if (paymentSettled) onSettled?.(); });
    return <p>Where should we send your money?</p>;
  },
}));

const notConnected: StripePayoutData = { connected: false, payouts_enabled: false, available: [], pending: [], payouts: [] };
let earningsData: Record<string, unknown>;
vi.mock("@/components/profile/earningsTab/useEarningsData", () => ({ useEarningsData: () => earningsData }));

import { EarningsTab } from "./EarningsTab";

const onSettled = vi.fn();
function tab() {
  return (
    <MemoryRouter initialEntries={["/profile?tab=earnings"]}>
      <EarningsTab earningsJobs={[]} tips={[]} loading={false} onBack={() => {}} helperId="helper-1" helperName="Test Helpr" onSettled={onSettled} />
    </MemoryRouter>
  );
}

const hold = () => screen.queryByTestId("earnings-no-account-hold");
const switcher = () => screen.queryByRole("tablist", { name: "Money sections" });
const connectCard = () => document.getElementById("earnings-bank-connect");
const shapes = () => [...document.querySelectorAll("[data-testid='earnings-payout-setup-skeleton']")].map((n) => n.getAttribute("data-shape"));

beforeEach(() => {
  profileRow = { subscription_tier: "free", subscription_expires_at: null, stripe_account_id: null };
  hire = { allowed: false, settled: false };
  paymentSettled = false;
  onSettled.mockClear();
  earningsData = {
    stripeData: notConnected, stripeLoading: false, stripeError: false, ledgerError: false, ledgerPending: false,
    payoutLedger: [], refreshing: false, handleRefresh: () => {}, salePayouts: [], salesError: null, refetchSales: () => {},
  };
});

describe("no payout account: the body below the tiles paints once (Q1816)", () => {
  it("holds one skeleton through the hire answer and PaymentTab, then paints the card and the switcher together", async () => {
    const { rerender } = render(tab());
    // Nothing answered: one hold, no switcher, the connect card mounted (its reads run) but hidden.
    expect(hold()).not.toBeNull();
    expect(switcher()).toBeNull();
    expect(connectCard()).not.toBeNull();
    expect(connectCard()!.hidden).toBe(true);
    expect(shapes()).toEqual(["needs-hire"]);

    // The hire answer lands (cleared to set up payouts): the hold keeps its shape, no connect-shaped bones appear.
    hire = { allowed: true, settled: true };
    rerender(tab());
    expect(hold()).not.toBeNull();
    expect(switcher()).toBeNull();
    expect(shapes()).toEqual(["needs-hire"]);
    expect(connectCard()!.hidden).toBe(true);
    expect(onSettled).not.toHaveBeenCalledWith(true);

    // PaymentTab's reads are in: the hold goes, and the card and the switcher are there in the same commit.
    paymentSettled = true;
    await act(async () => { rerender(tab()); });
    expect(hold()).toBeNull();
    expect(switcher()).not.toBeNull();
    expect(connectCard()!.hidden).toBe(false);
    expect(shapes()).toEqual([]);
    expect(onSettled).toHaveBeenLastCalledWith(true);
  });

  it("waits on the hire answer even when PaymentTab is in first, and reports unsettled until then", async () => {
    paymentSettled = true;
    const { rerender } = render(tab());
    await act(async () => {});
    expect(hold()).not.toBeNull();
    expect(switcher()).toBeNull();
    expect(onSettled).not.toHaveBeenCalledWith(true);
    hire = { allowed: false, settled: true };
    await act(async () => { rerender(tab()); });
    expect(hold()).toBeNull();
    expect(switcher()).not.toBeNull();
    expect(onSettled).toHaveBeenLastCalledWith(true);
  });

  it("waits on the Stripe status too, but at most ARRIVAL_CAP_MS (owner: \"Don't wait for Stripe\")", async () => {
    earningsData = { ...earningsData, stripeData: undefined, stripeLoading: true };
    hire = { allowed: false, settled: true };
    const { rerender } = render(tab());
    expect(hold()).not.toBeNull();
    expect(switcher()).toBeNull();
    await act(async () => { await new Promise((r) => setTimeout(r, 300)); });
    expect(hold()).not.toBeNull();
    // Stripe answers inside the cap: the body paints with the answer, not before it.
    earningsData = { ...earningsData, stripeData: { ...notConnected }, stripeLoading: false };
    paymentSettled = true;
    await act(async () => { rerender(tab()); });
    expect(hold()).toBeNull();
    expect(switcher()).not.toBeNull();
  });

  it("a Stripe status that never comes holds the body at most ARRIVAL_CAP_MS, then the slot keeps its own bones", async () => {
    earningsData = { ...earningsData, stripeData: undefined, stripeLoading: true };
    hire = { allowed: false, settled: true };
    render(tab());
    expect(hold()).not.toBeNull();
    await screen.findByRole("tablist", { name: "Money sections" }, { timeout: 3000 });
    expect(hold()).toBeNull();
    expect(shapes()).toEqual(["needs-hire"]);
  });

  it("a hire answer that never comes holds the body at most ARRIVAL_CAP_MS", async () => {
    render(tab());
    expect(hold()).not.toBeNull();
    await screen.findByRole("tablist", { name: "Money sections" }, { timeout: 3000 });
    expect(hold()).toBeNull();
  });

  it("a member with a payout account never waits on it", () => {
    profileRow = { ...profileRow, stripe_account_id: "acct_1" };
    earningsData = { ...earningsData, stripeData: undefined, stripeLoading: true };
    render(tab());
    expect(hold()).toBeNull();
    expect(switcher()).not.toBeNull();
  });
});

describe("the hold is wired in the source (inventory)", () => {
  it("EarningsTab draws the hold and keeps PaymentTab mounted under it", async () => {
    const { readFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    const src = readFileSync(join(__dirname, "EarningsTab.tsx"), "utf8");
    const holds = [...src.matchAll(/<EarningsNoAccountHold\b/g)].length;
    expect(holds).toBeGreaterThan(0);
    expect(src).toContain("hidden={!connectSettled || holdBody}");
  });
});
