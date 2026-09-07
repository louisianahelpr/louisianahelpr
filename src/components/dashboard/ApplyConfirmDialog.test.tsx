import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { ApplyConfirmDialog } from "./ApplyConfirmDialog";
import type { EnrichedJob } from "@/components/dashboard/types";

// The body only imports `toast` for the over-5MB file guard, which these
// tests never trip — a thin stub satisfies the import.
vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

// ApplyBody now asks whether the CURRENT user can actually be awarded a job,
// so it can say so above the submit button (see useAwardBlockReason). That
// hook reads `useCurrentUser`, which is a React Query consumer — and these
// tests render the dialog bare, with no QueryClientProvider and no Router.
// Stubbing the hook keeps each test on the subject it was written for (the
// earnings math and the pitch field) instead of dragging two providers into
// all sixteen. `null` = nothing blocks this helper, which is the state every
// pre-existing test assumed. The notice's own behaviour is covered by its
// dedicated block at the bottom of this file.
const mockAwardBlockReason = vi.fn<[], string | null>(() => null);
vi.mock("@/hooks/useAwardBlockReason", () => ({
  useAwardBlockReason: () => mockAwardBlockReason(),
}));

function makeJob(overrides: Partial<EnrichedJob> = {}): EnrichedJob {
  return {
    id: "job-1",
    title: "Fix the fence",
    budget: 100,
    is_group_job: false,
    helpers_needed: 1,
    urgent_fee: 0,
    ...overrides,
  } as unknown as EnrichedJob;
}

function makeProps(overrides: Record<string, unknown> = {}) {
  return {
    open: true,
    onClose: vi.fn(),
    confirmApplyJob: makeJob(),
    platformFee: 10,
    applyMessage: "",
    setApplyMessage: vi.fn(),
    applyFiles: [] as File[],
    setApplyFiles: vi.fn(),
    applyLoading: false,
    handleApplyConfirm: vi.fn(),
    ...overrides,
  };
}

/** The itemised receipt is behind a disclosure now — open it. */
function expandMath() {
  fireEvent.click(screen.getByRole("button", { expanded: false, name: /budget/i }));
}

describe("ApplyConfirmDialog", () => {
  it("renders nothing when open is false", () => {
    render(<ApplyConfirmDialog {...makeProps({ open: false })} />);
    expect(screen.queryByText("Apply Now")).not.toBeInTheDocument();
  });

  it("leads with the take-home number, not the subtraction", () => {
    // budget 100, 10% fee, solo job -> $90 take-home. The FIGURE is the
    // headline; the receipt that justifies it is collapsed. This inverted a
    // block that opened with three rows of accounting and put the only number
    // the helpr decides on last.
    render(<ApplyConfirmDialog {...makeProps()} />);
    expect(screen.getByText(/Fix the fence/)).toBeInTheDocument();
    expect(screen.getByText("You earn")).toBeInTheDocument();
    expect(screen.getByText("$90")).toBeInTheDocument();
    // Collapsed by default: no itemised rows on arrival.
    expect(screen.queryByText("Take-home")).not.toBeInTheDocument();
    // …but the inputs are still named in words, so nothing is concealed.
    expect(screen.getByText(/\$100 budget − 10% fee/)).toBeInTheDocument();
  });

  it("shows the itemised receipt on tap", () => {
    render(<ApplyConfirmDialog {...makeProps()} />);
    expandMath();
    expect(screen.getByText("Budget")).toBeInTheDocument();
    expect(screen.getByText("− 10% platform fee")).toBeInTheDocument();
    expect(screen.getByText("Take-home")).toBeInTheDocument();
    expect(screen.getByText("$100")).toBeInTheDocument();
  });

  it("divides the budget across helpers for a group job", () => {
    // budget 200 split 4 ways -> $50 each, 10% fee -> $45 take-home.
    render(
      <ApplyConfirmDialog
        {...makeProps({
          confirmApplyJob: makeJob({ budget: 200, is_group_job: true, helpers_needed: 4 }),
        })}
      />,
    );
    expect(screen.getByText("$45")).toBeInTheDocument();
    expandMath();
    expect(screen.getByText("$50")).toBeInTheDocument();
  });

  it("adds the net urgent bonus into take-home", () => {
    // budget 100, 10% fee, +$15 urgent netted of its own 2.9% bundled Stripe
    // cost ($15 − $0.44 = $14.56) -> 100 - 10 + 14.56 = $104.56, and the
    // HEADLINE take-home floors to whole dollars (matching JobPrice) while
    // the bonus line item keeps its exact cents.
    render(
      <ApplyConfirmDialog
        {...makeProps({ confirmApplyJob: makeJob({ urgent_fee: 15 }) })}
      />,
    );
    expect(screen.getByText("$104")).toBeInTheDocument();
    // Named in the collapsed summary line too, so the bonus is never a
    // surprise that only shows up if you go looking for the receipt.
    expect(screen.getByText(/\+ urgent bonus$/)).toBeInTheDocument();
    expandMath();
    expect(screen.getByText("+$14.56")).toBeInTheDocument();
  });

  it("shows a generic prompt when no job is resolved", () => {
    render(<ApplyConfirmDialog {...makeProps({ confirmApplyJob: null })} />);
    expect(screen.getByText("Apply for This Job")).toBeInTheDocument();
  });

  it("calls setApplyMessage as the pitch is typed", () => {
    const props = makeProps();
    render(<ApplyConfirmDialog {...props} />);
    fireEvent.change(screen.getByLabelText(/note to the poster/i), {
      target: { value: "I have done this before." },
    });
    expect(props.setApplyMessage).toHaveBeenCalledWith("I have done this before.");
  });

  it("submits via handleApplyConfirm when Apply Now is clicked", () => {
    const props = makeProps();
    render(<ApplyConfirmDialog {...props} />);
    fireEvent.click(screen.getByRole("button", { name: "Apply Now" }));
    expect(props.handleApplyConfirm).toHaveBeenCalledTimes(1);
  });

  it("shows a loading label and disables the action while submitting", () => {
    render(<ApplyConfirmDialog {...makeProps({ applyLoading: true })} />);
    expect(screen.getByRole("button", { name: "Applying…" })).toBeDisabled();
  });

  it("is centered, matching every other sheet app-wide", () => {
    // Superseded 2026-08-30: sheets moved from bottom-anchored to centered
    // (owner reviewed centered-modal / inset-sheet / anchored-panel options
    // and picked centered for this group — see sheet.tsx's sheetVariants).
    // This dialog uses the SAME shared `side="bottom"` variant every other
    // sheet does, so it must track whatever that variant currently renders —
    // asserting a literal class string here would just re-break the next
    // time the shared variant changes, so assert the outcome (vertically
    // centered, not pinned to the bottom edge) instead.
    render(<ApplyConfirmDialog {...makeProps()} />);
    const sheet = screen.getByRole("dialog");
    expect(sheet.className).not.toContain("bottom-0");
    expect(sheet.className).toContain("my-auto");
  });

  it("dismisses from the TOP-RIGHT, like every other sheet", () => {
    render(<ApplyConfirmDialog {...makeProps()} />);
    const close = screen.getByRole("button", { name: "Close" });
    // Icon-only: the name comes from the sr-only span, not visible text.
    expect(close.textContent?.trim()).toBe("Close");
    expect(close.style.top).toBe("1rem");
  });

  it("offers the pitch ONCE — no chips, no bullets, no character coaching", () => {
    // This block used to stack three invitations to write the same optional
    // sentence: two hint bullets, three suggestion chips, and the field's own
    // placeholder — plus a "30+ characters feels personal" line that coached
    // against a threshold nothing enforces.
    render(<ApplyConfirmDialog {...makeProps({ confirmApplyJob: makeJob({ is_urgent: true }) })} />);
    expect(screen.queryByRole("group", { name: /suggested openers/i })).not.toBeInTheDocument();
    expect(screen.queryByText(/characters feels personal/)).not.toBeInTheDocument();
    expect(screen.queryByText(/reads personal/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Your pitch/i)).not.toBeInTheDocument();
    // The last coaching surface — the placeholder tip — is gone too (owner,
    // 2026-08-29). The field opens empty; the label carries the only prompt.
    expect(screen.getByLabelText(/note to the poster/i)).not.toHaveAttribute("placeholder");
  });

  it("tells the helpr the poster reads the note, in the label itself", () => {
    // One title, not a title plus a subtitle repeating it. "Add a note" alone
    // read like a private memo, so people left it blank or wrote carelessly.
    render(<ApplyConfirmDialog {...makeProps()} />);
    expect(screen.getByLabelText(/note to the poster/i)).toBeInTheDocument();
  });

  it("hides the character counter until the cap is in sight", () => {
    // The counter is information near the limit and pressure everywhere else.
    render(<ApplyConfirmDialog {...makeProps()} />);
    expect(screen.queryByText(/\/500$/)).not.toBeInTheDocument();
    render(<ApplyConfirmDialog {...makeProps({ applyMessage: "x".repeat(450) })} />);
    expect(screen.getByText("450/500")).toBeInTheDocument();
  });

  it("offers to save a default pitch only once there is one to save", () => {
    // The checkbox used to render on an empty field, offering to save nothing.
    render(<ApplyConfirmDialog {...makeProps()} />);
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();

    render(<ApplyConfirmDialog {...makeProps({ applyMessage: "I have done this before." })} />);
    const box = screen.getByRole("checkbox", { name: /save as my default pitch/i });
    // Shared Radix control, not a native input: index.css forces
    // `input[type="checkbox"] { min-width/height: 44px }` for the HIG touch
    // minimum, which would override the designed 20px box and draw a 44px
    // empty square. That rule excludes `[role="checkbox"]`.
    expect(document.querySelector('input[type="checkbox"]')).toBeNull();
    // The label both wraps the control and points at it with htmlFor; a
    // double-forwarded click would toggle twice and land back on unchecked.
    expect(box).toHaveAttribute("data-state", "unchecked");
    fireEvent.click(screen.getByText("Save as my default pitch"));
    expect(box).toHaveAttribute("data-state", "checked");
  });

  it("has no per-application file picker", () => {
    // Certs and work photos are uploaded ONCE on the profile (Edit Profile →
    // Recent work) and posters see them there via HelperWorkPhotos, so
    // re-attaching the same file on every application was repeated work.
    const file = new File(["resume contents"], "resume.pdf", { type: "application/pdf" });
    const { container } = render(<ApplyConfirmDialog {...makeProps({ applyFiles: [file] })} />);
    expect(screen.queryByText("resume.pdf")).not.toBeInTheDocument();
    expect(screen.queryByText(/add attachments/i)).not.toBeInTheDocument();
    expect(container.querySelector('input[type="file"]')).toBeNull();
  });

  /**
   * The award gate, told to the person it acts on.
   *
   * `helper_award_block_reason()` decides who may be handed a job. Both other
   * audiences were already served — the poster gets a message on a disabled
   * Hire button, and a helper who reaches the ACCEPT step gets
   * `AwardGateDialog`. The helper doing the APPLYING was told nothing, and
   * measured against prod on 2026-09-06 that was seven of eight non-seed
   * profiles: every one of them free to apply, none of them hireable, no
   * explanation anywhere. The silence reads as posters passing you over.
   *
   * Applying stays UNGATED on purpose (owner's decision, documented in
   * src/lib/awardGate.ts), so these assert an explanation that never becomes
   * a barrier: the submit button must survive.
   */
  describe("award-block notice", () => {
    it("says nothing when the helper can be hired", () => {
      mockAwardBlockReason.mockReturnValue(null);
      render(<ApplyConfirmDialog {...makeProps()} />);
      expect(screen.queryByText(/can't be hired yet/i)).not.toBeInTheDocument();
    });

    it("explains an unfinished payout account without blocking the apply", () => {
      mockAwardBlockReason.mockReturnValue("helper_payout_setup_incomplete");
      render(
        <MemoryRouter>
          <ApplyConfirmDialog {...makeProps()} />
        </MemoryRouter>,
      );
      expect(screen.getByText(/can't be hired yet/i)).toBeInTheDocument();
      expect(screen.getByText(/payout account exists/i)).toBeInTheDocument();
      // The fix is one tap away and points at the tab that actually holds it.
      expect(screen.getByRole("link", { name: /set up payouts/i })).toHaveAttribute(
        "href",
        "/profile?tab=payment",
      );
      // THE POINT: still applyable. A notice that disabled this would be the
      // opposite of the owner's decision.
      expect(screen.getByRole("button", { name: "Apply Now" })).toBeEnabled();
    });

    it("explains an unfinished identity check", () => {
      mockAwardBlockReason.mockReturnValue("helper_identity_unverified");
      render(
        <MemoryRouter>
          <ApplyConfirmDialog {...makeProps()} />
        </MemoryRouter>,
      );
      expect(screen.getByText(/confirming who you are/i)).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Apply Now" })).toBeEnabled();
    });

    it("stays silent on helper_unknown — a failed profile read is not news for this screen", () => {
      // That verdict means we could not read the profile at all. Reporting an
      // internal read failure to somebody mid-application helps nobody, and
      // the accept-step dialog still covers it if it persists.
      mockAwardBlockReason.mockReturnValue("helper_unknown");
      render(<ApplyConfirmDialog {...makeProps()} />);
      expect(screen.queryByText(/can't be hired yet/i)).not.toBeInTheDocument();
    });
  });
});
