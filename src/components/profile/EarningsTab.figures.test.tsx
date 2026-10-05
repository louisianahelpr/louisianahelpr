/**
 * Q1177: the one-page Earnings tab states the SAME money as the two-view page
 * it replaced, for the same data. Every figure below is hand-computed from the
 * fixture (not re-derived through the helpers under test), and the suite was
 * run unchanged against the two-view EarningsTab on origin/main before the
 * redesign (it reads both views when a view switcher is present) and passed
 * there too.
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
// @mutate src/components/profile/EarningsTab.tsx | sumHelperTakeHomeDollars(rangeJobs, helperFeeFallbackPct, firstPayoutFeeDueFrom(rangeJobs, firstPayoutFee)) | sumHelperTakeHomeDollars(rangeJobs, helperFeeFallbackPct)
// @mutate src/components/profile/EarningsTab.tsx | const rangeTips = sumHelperTipDollars(rangeTipRows); | const rangeTips = 0;
// @mutate src/components/profile/earningsTab/EarningHistory.tsx | const tipTotal = sumHelperTipDollars(jobTips); | const tipTotal = 0;
// @mutate src/components/profile/EarningsTab.tsx |               payoutLedger={payoutLedger}\n |
// @mutate src/components/profile/earningsTab/EarningHistory.tsx |         {orphanTransfers.map((t) => ( |         {[].map((t: PayoutLedgerRow) => (
// @mutate src/components/profile/earningsTab/EarningHistory.tsx |         {bankPayouts}\n |
// @mutate src/components/profile/earningsTab/EarningHistory.tsx | const paid = finished.filter(isEarnedJob); | const paid = finished;
// @mutate src/components/profile/earningsTab/EarningHistory.tsx | j.status === "in_progress" \|\| isAwaitingTransfer(j) | j.status === "in_progress"
// @mutate src/components/profile/earningsTab/EarningHistory.tsx | const payout = isEarnedJob(job) ? helperTakeHomeDollars(job, feeFallbackPct) : null; | const payout = isEarnedJob(job) ? helperTakeHomeDollars(job, feeFallbackPct, 2) : null;
// @mutate src/components/profile/earningsTab/EarningHistory.tsx | const noJobs = moneyJobs.length === 0 && payoutLedger.length === 0; | const noJobs = moneyJobs.length === 0 && payoutLedger.length === 0 && !bankPayouts;
import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { useEffect } from "react";
import type { Job, PayoutLedgerRow, StripePayoutData } from "./earningsTab/types";

vi.mock("@/hooks/useCurrentUser", () => ({
  useCurrentUser: () => ({
    user: { id: "helper-1" },
    profile: { subscription_tier: "free", subscription_expires_at: null, stripe_account_id: "acct_1" },
    loading: false,
  }),
}));
vi.mock("@/hooks/useFirstPayoutFee", () => ({ useFirstPayoutFeeDollars: () => 2 }));
vi.mock("@/hooks/useHelperMilestones", () => ({ useHelperMilestones: () => {} }));
vi.mock("@/components/profile/HelperStreakBadge", () => ({
  HelperStreakBadge: () => null,
  useHelperStreak: () => ({ settled: true }),
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

async function renderTab({ settle = true, earningsJobs = jobs } = {}) {
  render(
    <MemoryRouter initialEntries={["/profile?tab=earnings"]}>
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
    // The whole tip (ME-006), on the Tips figure and on its job's row.
    expect(text).toMatch(/\$5\.00\s*in tips · 1 tip/);
    expect(text).toContain("+$5");
    // Approved, transfer scheduled: $176 less the fee it will carry.
    expect(text).toContain("$174.00");
  });

  it("each row is its own job's take-home; the fee is one line, never a row", async () => {
    await renderTab();
    // Read each job's OWN row (the card's first block: title, chips, amount),
    // not the page: the transfer line inside job A's card also prints "$90",
    // so a page-wide match could not tell a missing row figure from it.
    const rowText = (title: string) => {
      const card = screen.getAllByRole("heading", { name: title })[0].closest(".rounded-ds-md");
      return (card?.firstElementChild?.textContent ?? "").replace(/\s+/g, " ");
    };
    expect(rowText("Fence repair")).toMatch(/\$90(?![.\d])\s*\+\$5/);
    expect(rowText("Fence repair")).not.toContain("AAAA1111");
    expect(rowText("Gutter cleaning")).toMatch(/\$176(?![.\d])\s*on its way/);
    const text = await pageText();
    // Neither row carries the $2: no $88, and $174 only as the summary's
    // "$174.00" line, never as a row's whole-dollar take-home.
    expect(text).not.toMatch(/\$88(?![.\d])|\$174(?![.\d])/);
    expect(count(text, "Your next payout is $2 less: the one-time payout setup fee.")).toBeGreaterThanOrEqual(1);
    expect(text).toContain("$50 budget");
    expect(text).toMatch(/Refunded[^$]*no payout/i);
  });

  it("wallet balances and the bank payout", async () => {
    await renderTab();
    const text = await pageText();
    expect(text).toContain("$245.00");
    expect(text).toContain("$80.00");
    expect(text).toContain("$120.00");
  });

  it("every ledger transfer is on the page, with its exact amount and fee", async () => {
    await renderTab();
    const text = await pageText();
    expect(text).toContain("AAAA1111");
    expect(text).toContain("ORPHAN22");
    expect(text).toContain("FAILED33");
    // formatPriceExact: the ledger's exact cents, whole dollars without ".00".
    expect(text).toMatch(/AAAA1111\s*\$90fee \$10/);
    expect(text).toMatch(/ORPHAN22\s*\$40/);
    expect(text).toMatch(/FAILED33\s*Account closed\s*\$30/);
  });
});

describe("one page, one list (Q1177)", () => {
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

  it("has no view switcher and states each transfer exactly once", async () => {
    await renderTab();
    expect(screen.queryAllByRole("tab")).toHaveLength(0);
    const text = (document.body.textContent ?? "").replace(/\s+/g, " ");
    expect(count(text, "AAAA1111")).toBe(1);
    expect(count(text, "ORPHAN22")).toBe(1);
    expect(count(text, "Your next payout is $2 less")).toBe(1);
  });

  it("orders the list: not paid out yet, sent to your bank, paid jobs, no payout, then other transfers", async () => {
    await renderTab();
    const text = (document.body.textContent ?? "").replace(/\s+/g, " ");
    const at = (s: string) => {
      const i = text.indexOf(s);
      expect(i, `${s} is missing`).toBeGreaterThanOrEqual(0);
      return i;
    };
    const order = [
      at("$245.00"), // wallet first
      at("$264.00"), // the Earned summary
      at("Not paid out yet"),
      at("Gutter cleaning"), // approved, transfer still scheduled
      at("Moving help"), // in progress
      at("Sent to your bank"),
      at("Paid jobs"),
      at("Fence repair"),
      at("AAAA1111"), // inside the job it paid
      // A refunded job is not a paid one (lh-money-escrow review): its own group.
      at("No payout"),
      at("Refunded job"),
      // Ledger rows whose job is not listed, whatever their status, under a
      // neutral heading; each carries its own status chip.
      at("Other transfers"),
      at("An older job"),
      at("A cancelled job"),
      at("More Insights"),
      at("bank account section"),
      at("Tax reporting:"),
    ];
    for (let i = 1; i < order.length; i++) expect(order[i]).toBeGreaterThan(order[i - 1]);
    // The group labels are headings, not row copy ("· no payout" on a row).
    for (const name of ["Not paid out yet", "Sent to your bank", "Paid jobs", "No payout", "Other transfers"]) {
      expect(screen.getByRole("heading", { name }), `${name} is not a heading`).toBeTruthy();
    }
    // Moving help (in progress) and Gutter cleaning (scheduled) are unpaid;
    // neither sits under Paid jobs.
    expect(at("Moving help")).toBeLessThan(at("Paid jobs"));
  });

  it("a connected Helpr with no jobs still gets the 'No earnings yet' state, above their bank payouts", async () => {
    earningsData = { ...earningsData, payoutLedger: [] };
    await renderTab({ earningsJobs: [] });
    const text = (document.body.textContent ?? "").replace(/\s+/g, " ");
    expect(text.indexOf("No earnings yet.")).toBeGreaterThanOrEqual(0);
    expect(text.indexOf("Sent to your bank")).toBeGreaterThan(text.indexOf("No earnings yet."));
    expect(text).not.toContain("Paid jobs");
  });

  it("holds the whole page on its skeleton until the transfer ledger is in", async () => {
    earningsData = { ...earningsData, ledgerPending: true };
    await renderTab({ settle: false });
    await act(async () => { await Promise.resolve(); });
    expect(screen.getByTestId("earnings-page-skeleton")).toBeTruthy();
    expect(screen.queryByText("Fence repair")).toBeNull();
  });
});
