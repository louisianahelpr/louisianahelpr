/**
 * Board 143: the payout-failed Home card and the fees-owed line render only
 * the server's own figures, and nothing at all when there is nothing open.
 *
 * @mutate src/components/money/PayoutFailedCard.tsx |   if (!latest) return null; |   if (false) return null;
 * @mutate src/components/money/FeesOwedLine.tsx |   if (!data \|\| data.length === 0) return null; |   if (!data) return null;
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

const state = vi.hoisted(() => ({ failures: [] as unknown[] | undefined, owed: [] as unknown[] | undefined }));
vi.mock("@/components/money/payoutProblems", async (orig) => ({
  ...(await orig<typeof import("@/components/money/payoutProblems")>()),
  useOpenPayoutFailures: () => ({ data: state.failures }),
  useFeesOwed: () => ({ data: state.owed }),
}));

import { PayoutFailedCard } from "@/components/money/PayoutFailedCard";
import { FeesOwedLine } from "@/components/money/FeesOwedLine";
import { payoutFailureWords } from "@/components/money/payoutProblems";

const renderIn = (el: JSX.Element) => render(<MemoryRouter>{el}</MemoryRouter>);

describe("PayoutFailedCard (board 143a)", () => {
  beforeEach(() => { state.failures = []; state.owed = []; });

  it("renders nothing with no open failure, or while loading", () => {
    expect(renderIn(<PayoutFailedCard />).container.querySelector("[data-payout-failed-card]")).toBeNull();
    state.failures = undefined;
    expect(renderIn(<PayoutFailedCard />).container.querySelector("[data-payout-failed-card]")).toBeNull();
  });

  it("shows the latest failure's real amount, plain reason and the fix link", () => {
    state.failures = [{ id: "f1", amount_cents: 8480, failure_code: "account_closed", failed_at: "2026-10-16T00:00:00Z" }];
    renderIn(<PayoutFailedCard />);
    expect(screen.getByText("Your payout didn't go through")).toBeTruthy();
    expect(screen.getByText("$84.80")).toBeTruthy();
    expect(screen.getByText(/The bank account is closed\./)).toBeTruthy();
    expect(screen.queryByText(/more payout/)).toBeNull();
    expect(screen.getByRole("link", { name: "Fix bank" }).getAttribute("href")).toBe("/profile?tab=earnings");
  });

  it("two open failures say there is more than one", () => {
    state.failures = [
      { id: "f2", amount_cents: 5000, failure_code: null, failed_at: "2026-10-18T00:00:00Z" },
      { id: "f1", amount_cents: 8480, failure_code: "account_closed", failed_at: "2026-10-16T00:00:00Z" },
    ];
    renderIn(<PayoutFailedCard />);
    expect(screen.getByText(/and 1 more payout too/)).toBeTruthy();
  });

  it("an unknown code says nothing about the reason", () => {
    expect(payoutFailureWords("something_new")).toBeNull();
    expect(payoutFailureWords(null)).toBeNull();
  });
});

describe("FeesOwedLine (board 143b)", () => {
  beforeEach(() => { state.failures = []; state.owed = []; });

  it("renders nothing when nothing is owed", () => {
    expect(renderIn(<FeesOwedLine />).container.querySelector("[data-fees-owed]")).toBeNull();
  });

  it("lists each debt as recorded, with where it comes out", () => {
    state.owed = [{ id: "a", kind: "fault", cents: 310 }, { id: "b", kind: "seller", cents: 125 }];
    renderIn(<FeesOwedLine />);
    expect(screen.getByText("−$3.10")).toBeTruthy();
    expect(screen.getByText("Comes out of your next job payout")).toBeTruthy();
    expect(screen.getByText("−$1.25")).toBeTruthy();
    expect(screen.getByText("Comes out of your next sale payout")).toBeTruthy();
  });
});
