import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import type { EnrichedJob } from "@/components/dashboard/types";
import { ApplyEarningsBreakdown } from "./ApplyEarningsBreakdown";

/**
 * ME-008 — the take-home shown before applying must not read higher than the
 * payout that actually lands.
 *
 * `release-payout` and `process-scheduled-payouts` deduct the one-time
 * onboarding fee (`platform_settings.onboarding_fee_cents`) from the FIRST
 * payout of any account whose `profiles.onboarding_fee_paid` is not true. The
 * breakdown used to show "You earn $90" to that account and pay $88.
 *
 * The mocks sit at the data boundary (the viewer's profile row and the
 * platform's fee setting), so the real predicate that decides whether a fee is
 * due runs here, not a stub of it.
 */
// @mutate src/components/dashboard/applyConfirmDialog/ApplyEarningsBreakdown.tsx | const payout = netAfterFirstPayoutFee(beforeFirstPayoutFee, firstPayoutFee); | const payout = beforeFirstPayoutFee;

const profileMock = vi.fn<() => { onboarding_fee_paid: boolean | null } | null>();
vi.mock("@/hooks/useCurrentUser", () => ({
  useCurrentUser: () => ({ profile: profileMock() }),
}));
const feeCentsMock = vi.fn<() => number | null>();
vi.mock("@/hooks/useOnboardingFee", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/hooks/useOnboardingFee")>()),
  useOnboardingFeeCents: () => feeCentsMock(),
}));

function job(overrides: Partial<EnrichedJob> = {}): EnrichedJob {
  return { id: "j", title: "t", budget: 100, is_group_job: false, helpers_needed: 1, urgent_fee: 0, ...overrides } as unknown as EnrichedJob;
}

function renderBreakdown(j = job()) {
  render(<ApplyEarningsBreakdown confirmApplyJob={j} platformFee={10} />);
  fireEvent.click(screen.getByRole("button", { expanded: false }));
}

afterEach(() => {
  cleanup();
  profileMock.mockReset();
  feeCentsMock.mockReset();
});

describe("ApplyEarningsBreakdown — one-time first-payout fee (ME-008)", () => {
  it.each([false, null])("subtracts the fee from take-home when onboarding_fee_paid is %s", (paid) => {
    profileMock.mockReturnValue({ onboarding_fee_paid: paid });
    feeCentsMock.mockReturnValue(200);
    renderBreakdown();
    // $100 budget − 10% = $90, − $2 one-time fee = $88, in the headline AND the Take-home row.
    expect(screen.getAllByText("$88")).toHaveLength(2);
    expect(screen.queryByText("$90")).not.toBeInTheDocument();
    expect(screen.getByText(/one-time setup fee/i)).toBeInTheDocument();
    expect(screen.getByText("−$2")).toBeInTheDocument();
  });

  it("takes the amount from platform_settings, never a constant", () => {
    profileMock.mockReturnValue({ onboarding_fee_paid: false });
    feeCentsMock.mockReturnValue(350);
    renderBreakdown();
    expect(screen.getAllByText("$86")).toHaveLength(2); // 90 − 3.50 = 86.50, floored
    expect(screen.getByText("−$3.50")).toBeInTheDocument();
  });

  it("shows no fee line once the fee is paid", () => {
    profileMock.mockReturnValue({ onboarding_fee_paid: true });
    feeCentsMock.mockReturnValue(200);
    renderBreakdown();
    expect(screen.getAllByText("$90")).toHaveLength(2);
    expect(screen.queryByText(/one-time setup fee/i)).not.toBeInTheDocument();
  });

  it("copy addresses any account, not only Helprs", () => {
    profileMock.mockReturnValue({ onboarding_fee_paid: false });
    feeCentsMock.mockReturnValue(200);
    renderBreakdown();
    expect(screen.getByText(/one-time setup fee/i).textContent).not.toMatch(/helpr/i);
  });
});
