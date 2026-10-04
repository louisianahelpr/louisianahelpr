/**
 * Q753 (lh-money-escrow review): the one-time setup fee is ONE line above the
 * history, never pinned to a row. The server takes it from whichever payout
 * transfers first, and a row settled by Quick Release or a dispute split never
 * paid it, so every row shows the job's own take-home.
 */
// @mutate src/components/profile/earningsTab/EarningHistory.tsx | {firstPayoutFeeDollars > 0 && moneyJobs.length > 0 && ( | {false && (
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { EarningHistory } from "./EarningHistory";
import type { Job } from "./types";

const job = (over: Partial<Job>): Job =>
  ({
    id: "j1",
    title: "Yard work",
    status: "completed",
    payment_status: "payout_pending",
    budget: 100,
    helper_fee_percent: 10,
    urgent_fee: 0,
    created_at: "2026-10-01T12:00:00Z",
    helper_completed_at: "2026-10-01T15:00:00Z",
    ...over,
  }) as Job;

const props = (jobs: Job[], fee: number) => ({
  earningsJobs: jobs,
  tips: [],
  loading: false,
  historyVisible: 10,
  page: 10,
  onLoadMore: () => {},
  onBrowseJobs: () => {},
  feeFallbackPct: 10,
  firstPayoutFeeDollars: fee,
});

describe("EarningHistory and the one-time setup fee (Q753)", () => {
  it("states the fee once and shows every row's own take-home", () => {
    render(<EarningHistory {...props([job({ id: "a" }), job({ id: "b", payment_status: "released" })], 2)} />);
    expect(screen.getByText(/Your next payout is \$2 less: the one-time payout setup fee\./)).toBeTruthy();
    // $100 budget, 10% fee: both rows read $90, neither carries the $2.
    expect(screen.getAllByText(/\$90/).length).toBeGreaterThanOrEqual(2);
    expect(screen.queryByText(/\$88/)).toBeNull();
  });

  it("says nothing when no fee is due", () => {
    render(<EarningHistory {...props([job({ id: "a" })], 0)} />);
    expect(screen.queryByText(/one-time payout setup fee/)).toBeNull();
  });
});
