// The row has to actually be ON the screen.
//
// The defect this component fixes was not a wrong calculation — it was an
// absence. External QA (2026-09-06) went through Profile, Account Security and
// the whole settings list and found no ID-verification surface anywhere, while
// the `jobs` INSERT policy and `helper_award_block_reason()` both refused
// unverified members. `verificationPrompt.test.ts` pins the logic; this file
// pins the thing the logic is useless without — that a member sees a control,
// with the fee named on it, and that it opens the flow.
import { describe, it, expect, vi, beforeEach } from "vitest";
// `fireEvent`, not `@testing-library/user-event` — that package is not a
// dependency of this repo (see dialogConfirmBehaviour.test.tsx).
import { render, screen, fireEvent } from "@testing-library/react";
import { VerificationStatusRow } from "./VerificationStatusRow";
import type { Profile } from "./types";

// The real hook reads `platform_settings.onboarding_fee_cents` over the
// network. Mocked to a fixed $2 so an assertion about the copy is about the
// copy, not about a live admin setting.
vi.mock("@/hooks/useOnboardingFee", () => ({
  useOnboardingFeeCents: () => 200,
  formatFeeLabel: (cents: number | null) => (cents == null ? null : `$${cents / 100}`),
}));

// Stubbed to a marker rather than rendered: the dialog owns Stripe calls and
// portals into document.body, and what this file is proving is that the ROW
// can reach it at all.
vi.mock("@/components/IDVPromptDialog", () => ({
  IDVPromptDialog: ({ open }: { open: boolean }) =>
    open ? <div data-testid="idv-dialog" /> : null,
}));

function profile(over: Partial<Profile>): Profile {
  return {
    idv_status: "not_started",
    onboarding_fee_paid: false,
    stripe_identity_verified: false,
    idv_failure_reason: null,
    ...over,
  } as Profile;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("VerificationStatusRow", () => {
  it("shows an unverified member a control that names the fee", () => {
    render(<VerificationStatusRow profile={profile({})} />);

    const control = screen.getByRole("button");
    // Not just "some text appeared" — the price has to be readable BEFORE the
    // tap. Discovering it as a 402 afterwards is the bug.
    expect(control).toHaveTextContent("$2");
    expect(control).toHaveTextContent(/verify your id/i);
  });

  it("opens the verification flow when tapped", () => {
    render(<VerificationStatusRow profile={profile({})} />);
    expect(screen.queryByTestId("idv-dialog")).toBeNull();

    fireEvent.click(screen.getByRole("button"));
    expect(screen.getByTestId("idv-dialog")).toBeTruthy();
  });

  it("renders nothing at all for a verified member", () => {
    const { container } = render(
      <VerificationStatusRow profile={profile({ idv_status: "verified" })} />,
    );
    // `toBeEmptyDOMElement` rather than "no button": a leftover empty wrapper
    // would still add a gap to the card this row shares with PayoutStatusRow.
    expect(container).toBeEmptyDOMElement();
  });

  it("offers no button while a human is reviewing the check", () => {
    render(<VerificationStatusRow profile={profile({ idv_status: "manual_review" })} />);
    // An enabled control here would be an invitation to an action the server
    // refuses — `claim_idv_attempt` returns `in_manual_review` and the one
    // paid attempt is already spent.
    expect(screen.queryByRole("button")).toBeNull();
    expect(screen.getByRole("status")).toHaveTextContent(/with our team/i);
  });

  it("offers no button while Stripe is still deciding", () => {
    render(<VerificationStatusRow profile={profile({ idv_status: "processing" })} />);
    expect(screen.queryByRole("button")).toBeNull();
    expect(screen.getByRole("status")).toHaveTextContent(/running/i);
  });

  it("drops the fee from the copy once it is paid", () => {
    render(<VerificationStatusRow profile={profile({ onboarding_fee_paid: true })} />);
    const control = screen.getByRole("button");
    expect(control).not.toHaveTextContent("$2");
    expect(control).toHaveTextContent(/already covers it/i);
  });
});
