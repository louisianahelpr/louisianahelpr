/**
 * Q1177: the Money tab's Earned half states the SAME money as the two-view
 * (Earnings | Payouts) page it replaced, for the same data. Every figure below
 * is hand-computed from the fixture (not re-derived through the helpers under
 * test), and the figures suite was run unchanged against the two-view
 * EarningsTab on origin/main before the redesign (it reads both views when a
 * "Payouts" tab is present) and passed there too.
 *
 * Fixture: job A released $100 with its stamped $10 fee (take-home $90, one
 * $5 tip, one $90 ledger transfer with a $10 fee), job B approved and waiting
 * for its transfer, $200 (an UNSETTLED row shows the viewer's own tier fee,
 * Free = 12%, so $176; isSettledForDisplay in helperEarnings.ts), job C in
 * progress ($50 budget), job D completed then refunded (no payout), one $40
 * ledger transfer for a job not in the list, and a $2 one-time payout setup
 * fee still due (Q753).
 *
 *   lifetime earned  = 90 + 176 - 2 (fee, once)        = $264.00
 *   tips             = 5 (whole tip, ME-006)            = $5.00
 *   releasing        = 176 - 2                          = $174.00
 *   rows             = $90 (A) · $176 (B) · no fee on either row
 *   wallet           = $245.00 available · $80.00 pending
 *   bank payout      = $120.00
 */
// @mutate src/components/profile/EarningsTab.tsx | earnedDollarsWithLedger(rangeJobs, helperFeeFallbackPct, firstPayoutFee, payoutLedger) | earnedDollarsWithLedger(rangeJobs, helperFeeFallbackPct, 0, payoutLedger)
// @mutate src/components/profile/EarningsTab.tsx | const rangeTips = sumHelperTipDollars(rangeTipRows); | const rangeTips = 0;
// @mutate src/components/profile/EarningsTab.tsx | const pageReady = useArrivalGate(!loading, streakState.settled && !ledgerPending); | const pageReady = useArrivalGate(!loading && !stripeLoading, streakState.settled && !ledgerPending);
// @mutate src/components/profile/EarningsTab.tsx | ) : stripeBones ? <EarningsWalletBones /> : null} | ) : null}
// @mutate src/components/profile/EarningsTab.tsx | useState<MoneyView>(() => moneyViewFromSearch(searchParams)) | useState<MoneyView>("earned")
// @mutate src/components/profile/EarningsTab.tsx |       {view === "spent" && <SpentSection />} |       {false && <SpentSection />}
// @mutate src/components/profile/EarningsTab.tsx |           {feeDue > 0 && ( |           {false && (
// @mutate src/pages/profile/types.ts |   earnings: "Money", |   earnings: "Earnings & Payouts",
import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { useEffect } from "react";
import type { Job, PayoutLedgerRow, StripePayoutData } from "./earningsTab/types";

vi.mock("@/hooks/useCurrentUser", () => ({
  useCurrentUser: () => ({
    user: { id: "helper-1" },
    profile: profileRow,
    loading: false,
  }),
}));
vi.mock("@/hooks/useFirstPayoutFee", () => ({ useFirstPayoutFeeDollars: () => 2 }));
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
// PaymentTab's own figures are pinned by PaymentTab.onePage.test.tsx; here it
// only has to settle, the way the real one reports once its reads are in.
vi.mock("@/components/PaymentTab", () => ({
  PaymentTab: ({ onSettled }: { onSettled?: () => void }) => {
    useEffect(() => { onSettled?.(); }, [onSettled]);
    return <p>bank account section</p>;
  },
}));
// The Spent half is pinned by SpentSection.test.tsx.
vi.mock("@/components/profile/earningsTab/SpentSection", () => ({ SpentSection: () => <p>spent section</p> }));

let profileRow: Record<string, unknown> = { subscription_tier: "free", subscription_expires_at: null, stripe_account_id: "acct_1" };

const day = 86_400_000;
const ago = (d: number) => new Date(Date.now() - d * day).toISOString();
const job = (over: Partial<Job>): Job =>
  ({
    title: "Job",
    location: "Baton Rouge",
    date_needed: ago(3),
    is_group_job: false,
    helpers_needed: 1,
    urgent_fee: 0,
    helper_fee_percent: 10,
    platform_fee_amount: null,
    payout_scheduled_at: null,
    created_at: ago(5),
    updated_at: ago(2),
    helper_completed_at: ago(2),
    poster_completed_at: ago(2),
    ...over,
  }) as Job;

const jobs: Job[] = [
  job({ id: "job-a", title: "Fence repair", status: "completed", payment_status: "released", budget: 100, platform_fee_amount: 10 }),
  job({ id: "job-b", title: "Gutter cleaning", status: "completed", payment_status: "payout_pending", budget: 200, payout_scheduled_at: new Date(Date.now() + 2 * day).toISOString() }),
  job({ id: "job-c", title: "Moving help", status: "in_progress", payment_status: "escrow", budget: 50, helper_completed_at: null, poster_completed_at: null }),
  job({ id: "job-d", title: "Refunded job", status: "completed", payment_status: "refunded", budget: 70 }),
];
const tips = [{ amount: 5, job_id: "job-a", created_at: ago(1) }];
const ledger: PayoutLedgerRow[] = [
  { id: "t1", job_id: "job-a", amount_cents: 9000, platform_fee_cents: 1000, status: "paid", created_at: ago(1), paid_at: ago(1), failed_at: null, failure_reason: null, stripe_transfer_id: "tr_xxAAAA1111", jobs: { title: "Fence repair" } },
  { id: "t2", job_id: "job-gone", amount_cents: 4000, platform_fee_cents: 0, status: "paid", created_at: ago(40), paid_at: ago(40), failed_at: null, failure_reason: null, stripe_transfer_id: "tr_xxORPHAN22", jobs: { title: "An older job" } },
  { id: "t3", job_id: "job-cancelled", amount_cents: 3000, platform_fee_cents: 0, status: "failed", created_at: ago(50), paid_at: null, failed_at: ago(50), failure_reason: "Account closed", stripe_transfer_id: "tr_xxFAILED33", jobs: { title: "A cancelled job" } },
];
const stripeData: StripePayoutData = {
  connected: true,
  payouts_enabled: true,
  available: [{ amount: 24_500, currency: "usd" }],
  pending: [{ amount: 8_000, currency: "usd" }],
  payouts: [{ id: "po_1", amount: 12_000, currency: "usd", status: "paid", arrival_date: Math.floor(Date.now() / 1000), method: "standard", created: Math.floor(Date.now() / 1000), description: null }],
};

let earningsData: Record<string, unknown>;
vi.mock("@/components/profile/earningsTab/useEarningsData", () => ({ useEarningsData: () => earningsData }));

import { EarningsTab } from "./EarningsTab";

async function renderTab({ settle = true, earningsJobs = jobs, url = "/profile?tab=earnings" } = {}) {
  render(
    <MemoryRouter initialEntries={[url]}>
      <EarningsTab earningsJobs={earningsJobs} tips={tips} loading={false} onBack={() => {}} helperId="helper-1" helperName="Test Helpr" />
    </MemoryRouter>,
  );
  // The two-view page shows "Tax reporting:" only on its Payouts view, so the
  // settle point is the Earned card, present on both designs.
  if (settle) await screen.findAllByText(/total earned/i, undefined, { timeout: 3000 });
}

/** Every word the page states. On the two-view page (origin/main before
 *  Q1177) that is both views' text; on the one page it is one read. */
async function pageText(): Promise<string> {
  const payoutsTab = screen.queryByRole("tab", { name: "Payouts" });
  let text = document.body.textContent ?? "";
  if (payoutsTab) {
    await act(async () => { fireEvent.click(payoutsTab); });
    text += " " + (document.body.textContent ?? "");
  }
  return text.replace(/\s+/g, " ");
}

const count = (text: string, needle: string) => text.split(needle).length - 1;

describe("the one-page Earnings tab states the same money for the same data (Q1177)", () => {
  beforeEach(() => {
    earningsData = {
      stripeData,
      stripeLoading: false,
      stripeError: false,
      ledgerError: false,
      ledgerPending: false,
      payoutLedger: ledger,
      refreshing: false,
      handleRefresh: () => {},
    };
  });

  it("totals, tips and the money on its way", async () => {
    await renderTab();
    const text = await pageText();
    // Lifetime take-home: $90 + $176, the $2 setup fee off ONCE (Q753).
    expect(text).toMatch(/\$264\.00\s*total earned · 2 jobs/);
    // The whole tip (ME-006).
    expect(text).toMatch(/\$5\.00\s*in tips · 1 tip/);
    // Approved, transfer scheduled: $176 less the fee it will carry.
    expect(text).toContain("$174.00");
  });

  it("the one-time setup fee is stated once, as its own line", async () => {
    await renderTab();
    expect(count(await pageText(), "Your next payout is $2 less: the one-time payout setup fee.")).toBe(1);
  });

  it("wallet balances", async () => {
    await renderTab();
    const text = await pageText();
    expect(text).toContain("$245.00");
    expect(text).toContain("$80.00");
  });
});

describe("Money: wallet, then Earned | Spent, no payouts list (owner, 2026-10-08)", () => {
  beforeEach(() => {
    profileRow = { subscription_tier: "free", subscription_expires_at: null, stripe_account_id: "acct_1" };
    earningsData = {
      stripeData,
      stripeLoading: false,
      stripeError: false,
      ledgerError: false,
      ledgerPending: false,
      payoutLedger: ledger,
      refreshing: false,
      handleRefresh: () => {},
    };
  });

  it("is titled Money and switches Earned | Spent; Payouts is not a tab of its own", async () => {
    await renderTab();
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Money");
    expect(screen.getAllByRole("tab").map((t) => t.textContent)).toEqual(["Earned", "Spent"]);
    expect(screen.getByRole("tab", { name: "Earned" }).getAttribute("aria-selected")).toBe("true");
    expect(screen.queryByText("spent section")).toBeNull();
    await act(async () => { fireEvent.click(screen.getByRole("tab", { name: "Spent" })); });
    expect(screen.getByText("spent section")).toBeTruthy();
  });

  it("?view=spent opens on Spent", async () => {
    await renderTab({ settle: false, url: "/profile?tab=earnings&view=spent" });
    expect(await screen.findByText("spent section")).toBeTruthy();
    expect(screen.getByRole("tab", { name: "Spent" }).getAttribute("aria-selected")).toBe("true");
  });

  it("the wallet sits above the Earned | Spent switcher, on both halves", async () => {
    await renderTab();
    const before = (a: Node, b: Node) => !!(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);
    const tabs = screen.getByRole("tablist");
    expect(before(screen.getByText("$245.00"), tabs)).toBe(true);
    await act(async () => { fireEvent.click(screen.getByRole("tab", { name: "Spent" })); });
    expect(before(screen.getByText("$245.00"), screen.getByRole("tablist"))).toBe(true);
  });

  it("lists no payouts: no Payouts heading, no per-job rows, no Sent to your bank", async () => {
    await renderTab();
    expect(screen.queryByRole("heading", { name: "Payouts" })).toBeNull();
    expect(screen.queryByText("Sent to your bank")).toBeNull();
    expect(screen.queryByText("No earnings yet.")).toBeNull();
    const text = await pageText();
    for (const gone of ["Fence repair", "AAAA1111", "Not paid out yet", "Paid jobs", "$120.00"]) {
      expect(text, gone).not.toContain(gone);
    }
  });

  it("does not wait for Stripe: the Earned half paints, the wallet holds its own bones", async () => {
    earningsData = { ...earningsData, stripeData: undefined, stripeLoading: true };
    await renderTab();
    expect(screen.getByText(/\$264\.00/)).toBeTruthy();
    expect(screen.getByTestId("earnings-wallet-loading")).toBeTruthy();
    expect(screen.queryByTestId("earnings-page-skeleton")).toBeNull();
  });

  it("without a Stripe account, the connect card's bones hold the top slot while Stripe answers", async () => {
    profileRow = { ...profileRow, stripe_account_id: null };
    earningsData = { ...earningsData, stripeData: undefined, stripeLoading: true };
    await renderTab();
    expect(screen.getByTestId("earnings-payout-setup-skeleton")).toBeTruthy();
    expect(screen.queryByTestId("earnings-wallet-loading")).toBeNull();
    expect(screen.getByText(/\$264\.00/)).toBeTruthy();
  });

  it("orders the page: wallet, switcher, the Earned summary, the fee line, then insights and the bank account", async () => {
    await renderTab();
    const text = (document.body.textContent ?? "").replace(/\s+/g, " ");
    const at = (s: string) => {
      const i = text.indexOf(s);
      expect(i, `${s} is missing`).toBeGreaterThanOrEqual(0);
      return i;
    };
    const order = [
      at("$245.00"), // wallet first
      at("EarnedSpent"), // the switcher
      at("$264.00"), // the Earned summary
      at("Your next payout is $2 less"),
      at("More Insights"),
      at("bank account section"),
      at("Tax reporting:"),
    ];
    for (let i = 1; i < order.length; i++) expect(order[i]).toBeGreaterThan(order[i - 1]);
  });

  it("holds the whole page on its skeleton until the transfer ledger is in", async () => {
    earningsData = { ...earningsData, ledgerPending: true };
    await renderTab({ settle: false });
    await act(async () => { await Promise.resolve(); });
    expect(screen.getByTestId("earnings-page-skeleton")).toBeTruthy();
    expect(screen.queryByText(/total earned/)).toBeNull();
  });
});
