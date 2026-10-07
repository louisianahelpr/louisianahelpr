import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import type { EnrichedJob } from "@/components/dashboard/types";
import { JobPrice } from "./JobPrice";
import { CompactJobCard } from "./CompactJobCard";

/**
 * Q753 (ME-008 follow-up) — the feed chip, the job-detail pill and the compact
 * row must not read higher than the first payout that actually lands. The mocks
 * sit at the data boundary (the viewer's profile row and the platform's fee
 * setting), so the real "is a fee due" predicate runs.
 */
// @mutate src/components/dashboard/JobPrice.tsx | const owedFee = useFirstPayoutFeeDollars(); | const owedFee = 0;
// @mutate src/components/dashboard/JobPrice.tsx | const firstPayoutFee = jobStatus === "disputed" ? 0 : owedFee; | const firstPayoutFee = owedFee;
// @mutate src/components/dashboard/JobPrice.tsx | {!showBudget && firstPayoutFee > 0 && ( | {false && (
// @mutate src/components/dashboard/CompactJobCard.tsx | const firstPayoutFee = useFirstPayoutFeeDollars(); | const firstPayoutFee = 0;

const profileMock = vi.fn<() => { onboarding_fee_paid: boolean | null } | null>();
vi.mock("@/hooks/useCurrentUser", () => ({
  useCurrentUser: () => ({ profile: profileMock() }),
}));
const feeCentsMock = vi.fn<() => number | null>();
vi.mock("@/hooks/useOnboardingFee", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/hooks/useOnboardingFee")>()),
  useOnboardingFeeCents: () => feeCentsMock(),
}));

afterEach(() => {
  cleanup();
  profileMock.mockReset();
  feeCentsMock.mockReset();
});

const compactJob = {
  id: "j", title: "Mow the lawn", category: "other", budget: 100, urgent_fee: 0,
  is_group_job: false, helpers_needed: 1, location: "Baton Rouge, LA",
} as unknown as EnrichedJob;

describe("first-payout fee on the price surfaces (Q753)", () => {
  it.each(["chip", "detail"] as const)("JobPrice %s shows 88, not 90, to an unpaid account", (variant) => {
    profileMock.mockReturnValue({ onboarding_fee_paid: false });
    feeCentsMock.mockReturnValue(200);
    render(<JobPrice budget={100} effectiveFee={10} variant={variant} />);
    expect(screen.getByText(/88/)).toBeInTheDocument();
    expect(screen.queryByText(/90/)).not.toBeInTheDocument();
  });

  it("Q1272 (2): the chip tells a screen reader why the figure is lower", () => {
    profileMock.mockReturnValue({ onboarding_fee_paid: false });
    feeCentsMock.mockReturnValue(200);
    const { container } = render(<JobPrice budget={100} effectiveFee={10} />);
    expect(container.querySelector(".sr-only")?.textContent).toMatch(/one-time \$2 setup fee taken from your first payout/);
  });

  it("Q1272 (3): a disputed job never shows the setup fee taken (the split never takes it)", () => {
    profileMock.mockReturnValue({ onboarding_fee_paid: false });
    feeCentsMock.mockReturnValue(200);
    render(<JobPrice budget={100} effectiveFee={10} jobStatus="disputed" />);
    expect(screen.getByText(/90/)).toBeInTheDocument();
  });

  it("JobPrice is unchanged once the fee is paid", () => {
    profileMock.mockReturnValue({ onboarding_fee_paid: true });
    feeCentsMock.mockReturnValue(200);
    render(<JobPrice budget={100} effectiveFee={10} />);
    expect(screen.getByText(/90/)).toBeInTheDocument();
  });

  it("JobPrice is unchanged for a guest (no profile)", () => {
    profileMock.mockReturnValue(null);
    feeCentsMock.mockReturnValue(200);
    render(<JobPrice budget={100} effectiveFee={10} />);
    expect(screen.getByText(/90/)).toBeInTheDocument();
  });

  it("the gross budget on a poster/guest surface is never reduced", () => {
    profileMock.mockReturnValue({ onboarding_fee_paid: false });
    feeCentsMock.mockReturnValue(200);
    render(<JobPrice budget={100} effectiveFee={10} showBudget />);
    expect(screen.getByText(/100/)).toBeInTheDocument();
  });

  it("CompactJobCard's row and its aria-label both say $88", () => {
    profileMock.mockReturnValue({ onboarding_fee_paid: null });
    feeCentsMock.mockReturnValue(200);
    render(<ul><CompactJobCard job={compactJob} effectiveFee={10} onSelect={() => {}} /></ul>);
    expect(screen.getByRole("button").getAttribute("aria-label")).toContain("you earn $88");
    expect(screen.getByText("$88")).toBeInTheDocument();
  });
});
