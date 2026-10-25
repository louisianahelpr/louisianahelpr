import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
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
 *
 * Owner 2026-10-25: the sheet shows the take-home only (no fee name, rate or
 * maths); the one fee it may name is the one-time setup fee, on the job whose
 * payout it comes out of. The take-home figure itself is unchanged.
 */
// @mutate src/components/dashboard/applyConfirmDialog/applyTakeHome.ts | const payout = netAfterFirstPayoutFee(beforeFirstPayoutFee, firstPayoutFee); | const payout = beforeFirstPayoutFee;

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
}
const NO_FEE_WORDS = /platform fee|helpr fee|%|commission|card fee/i;
const text = () => document.body.textContent ?? "";

afterEach(() => {
  cleanup();
  profileMock.mockReset();
  feeCentsMock.mockReset();
});

describe("ApplyEarningsBreakdown — one-time first-payout fee (ME-008)", () => {
  it.each([false, null])("subtracts the setup fee from take-home when onboarding_fee_paid is %s", (paid) => {
    profileMock.mockReturnValue({ onboarding_fee_paid: paid });
    feeCentsMock.mockReturnValue(200);
    renderBreakdown();
    // $100 budget − 10% = $90, − $2 one-time fee = $88.
    expect(screen.getByText("$88")).toBeInTheDocument();
    expect(screen.queryByText("$90")).not.toBeInTheDocument();
    expect(screen.getByTestId("apply-setup-fee-line").textContent).toBe("After the one-time $2 setup fee, taken from your first payout.");
    expect(text()).not.toMatch(NO_FEE_WORDS);
  });

  it("takes the amount from platform_settings, never a constant", () => {
    profileMock.mockReturnValue({ onboarding_fee_paid: false });
    feeCentsMock.mockReturnValue(350);
    renderBreakdown();
    expect(screen.getByText("$86")).toBeInTheDocument(); // 90 − 3.50 = 86.50, floored
    expect(screen.getByTestId("apply-setup-fee-line").textContent).toMatch(/\$3\.50 setup fee/);
  });

  it("shows no setup line once the fee is paid", () => {
    profileMock.mockReturnValue({ onboarding_fee_paid: true });
    feeCentsMock.mockReturnValue(200);
    renderBreakdown();
    expect(screen.getByText("$90")).toBeInTheDocument();
    expect(screen.queryByText(/setup fee/i)).not.toBeInTheDocument();
  });

  it("copy addresses any account, not only Helprs", () => {
    profileMock.mockReturnValue({ onboarding_fee_paid: false });
    feeCentsMock.mockReturnValue(200);
    renderBreakdown();
    expect(screen.getByTestId("apply-setup-fee-line").textContent).not.toMatch(/helpr/i);
  });
});

// Q1839: a flat-model job's take-home is the job price minus its own stamped
// fee (helprFlatFeeCents), never the viewer's tier. $100 stamped 5% + 70c pays
// $94 ($100 - $5.70, floored); stamped 10% + 70c pays $89 ($100 - $10.70).
// @mutate src/components/dashboard/applyConfirmDialog/applyTakeHome.ts |   const flat = isFlatFeeJob(confirmApplyJob); |   const flat = false;
describe("ApplyEarningsBreakdown — flat-model jobs (Q1839)", () => {
  it("prices a stamped job from its stamp, not the viewer's tier, and names no fee", () => {
    profileMock.mockReturnValue({ onboarding_fee_paid: true });
    feeCentsMock.mockReturnValue(200);
    renderBreakdown(job({ helper_fee_flat_cents: 70, helper_fee_percent: 5 } as Partial<EnrichedJob>));
    expect(screen.getByText("$94")).toBeInTheDocument();
    expect(screen.queryByText("$90")).not.toBeInTheDocument();
    expect(text()).not.toMatch(NO_FEE_WORDS);
    cleanup();
    renderBreakdown(job({ helper_fee_flat_cents: 70, helper_fee_percent: 10 } as Partial<EnrichedJob>));
    expect(screen.getByText("$89")).toBeInTheDocument();
  });

  it("keeps the tier rate on a legacy job (no stamp)", () => {
    profileMock.mockReturnValue({ onboarding_fee_paid: true });
    feeCentsMock.mockReturnValue(200);
    renderBreakdown(job({ helper_fee_flat_cents: null } as Partial<EnrichedJob>));
    expect(screen.getByText("$90")).toBeInTheDocument();
    expect(text()).not.toMatch(NO_FEE_WORDS);
  });
});

// lh-money-escrow review #4 (jobs poster fee, owner 2026-10-18): a poster-fee
// job's Helpr pays nothing: the take-home is the whole budget.
describe("ApplyEarningsBreakdown — poster-fee jobs", () => {
  it("a poster-fee job: take-home is the whole budget, no fee named", () => {
    profileMock.mockReturnValue({ onboarding_fee_paid: true });
    feeCentsMock.mockReturnValue(200);
    renderBreakdown(job({ poster_fee_flat_cents: 70, helper_fee_flat_cents: 0, helper_fee_percent: 0 } as Partial<EnrichedJob>));
    expect(screen.getByText("$100")).toBeInTheDocument();
    expect(text()).not.toMatch(NO_FEE_WORDS);
  });
});
