import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ApplyConfirmDialog } from "./ApplyConfirmDialog";
import type { EnrichedJob } from "@/components/dashboard/types";

// The body only imports `toast` for the over-5MB file guard, which these
// tests never trip — a thin stub satisfies the import.
vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

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
    fireEvent.change(screen.getByLabelText(/add a note/i), {
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

  it("rises from the BOTTOM, like the job sheet it follows", () => {
    // The whole point of the rebuild (owner, 2026-08-28: "I don't like how one
    // opens at the bottom then the next is in the middle"). The job sheet
    // rises from the bottom edge; this used to be a centred AlertDialog that
    // faded in mid-viewport after that sheet had dropped away. Assert the
    // surface is anchored to the bottom, not centred.
    render(<ApplyConfirmDialog {...makeProps()} />);
    const sheet = screen.getByRole("dialog");
    expect(sheet.className).toContain("bottom-0");
    expect(sheet.className).not.toContain("translate-y-[-50%]");
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
    // The one job-specific nudge survives — as the placeholder, where the
    // helpr is already looking when they decide what to type.
    expect(screen.getByLabelText(/add a note/i)).toHaveAttribute(
      "placeholder",
      expect.stringMatching(/earliest available start time/) as unknown as string,
    );
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

  it("lists attached files", () => {
    const file = new File(["resume contents"], "resume.pdf", { type: "application/pdf" });
    render(<ApplyConfirmDialog {...makeProps({ applyFiles: [file] })} />);
    expect(screen.getByText("resume.pdf")).toBeInTheDocument();
  });
});
