import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ApplyConfirmDialog } from "./ApplyConfirmDialog";
import type { EnrichedJob } from "@/components/dashboard/types";

// The dialog only imports `toast` for the over-5MB file guard, which
// these tests never trip — a thin stub satisfies the import.
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
    bidPrice: "",
    setBidPrice: vi.fn(),
    ...overrides,
  };
}

describe("ApplyConfirmDialog", () => {
  it("renders nothing when open is false", () => {
    render(<ApplyConfirmDialog {...makeProps({ open: false })} />);
    expect(screen.queryByText("Apply now")).not.toBeInTheDocument();
  });

  it("renders the job title and the take-home breakdown", () => {
    // budget 100, 10% fee, solo job -> $100 budget, $90 take-home.
    render(<ApplyConfirmDialog {...makeProps()} />);
    expect(screen.getByText(/Fix the fence/)).toBeInTheDocument();
    expect(screen.getByText("$100")).toBeInTheDocument();
    expect(screen.getByText("Take-home")).toBeInTheDocument();
    expect(screen.getByText("$90")).toBeInTheDocument();
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
    expect(screen.getByText("$50")).toBeInTheDocument();
    expect(screen.getByText("$45")).toBeInTheDocument();
  });

  it("adds the net urgent bonus into take-home", () => {
    // budget 100, 10% fee, +$15 urgent netted of its own 2.9% bundled Stripe
    // cost ($15 − $0.44 = $14.56) -> 100 - 10 + 14.56 = $104.56 take-home.
    render(
      <ApplyConfirmDialog
        {...makeProps({ confirmApplyJob: makeJob({ urgent_fee: 15 }) })}
      />,
    );
    expect(screen.getByText(/urgent bonus/)).toBeInTheDocument();
    expect(screen.getByText("$104.56")).toBeInTheDocument();
  });

  it("shows a generic prompt when no job is resolved", () => {
    render(<ApplyConfirmDialog {...makeProps({ confirmApplyJob: null })} />);
    expect(screen.getByText("Apply for This Job")).toBeInTheDocument();
  });

  it("calls setApplyMessage as the pitch is typed", () => {
    const props = makeProps();
    render(<ApplyConfirmDialog {...props} />);
    fireEvent.change(screen.getByPlaceholderText(/Introduce yourself/), {
      target: { value: "I have done this before." },
    });
    expect(props.setApplyMessage).toHaveBeenCalledWith("I have done this before.");
  });

  it("submits via handleApplyConfirm when Apply now is clicked", () => {
    const props = makeProps();
    render(<ApplyConfirmDialog {...props} />);
    fireEvent.click(screen.getByRole("button", { name: "Apply Now" }));
    expect(props.handleApplyConfirm).toHaveBeenCalledTimes(1);
  });

  it("shows a loading label and disables the actions while submitting", () => {
    render(<ApplyConfirmDialog {...makeProps({ applyLoading: true })} />);
    const submit = screen.getByRole("button", { name: "Applying…" });
    expect(submit).toBeDisabled();
    expect(screen.getByRole("button", { name: "Cancel" })).toBeDisabled();
  });

  it("uses the shared checkbox, not a native input inflated to 44px", () => {
    // index.css forces `input[type="checkbox"] { min-width/height: 44px }` for
    // the HIG touch minimum, which overrode this control's `w-[18px]` and drew
    // a 44px empty square next to a 12px label. The rule excludes
    // `[role="checkbox"]`, so the shared Radix control is the fix — assert the
    // native input is gone rather than trusting a class name.
    const { container } = render(<ApplyConfirmDialog {...makeProps()} />);
    expect(screen.getByRole("checkbox", { name: /save as my default pitch/i })).toBeInTheDocument();
    expect(container.ownerDocument.querySelector('input[type="checkbox"]')).toBeNull();
  });

  it("toggles the save-as-default checkbox exactly once per label click", () => {
    // The label both wraps the control and points at it with htmlFor; a
    // double-forwarded click would toggle twice and land back on unchecked.
    render(<ApplyConfirmDialog {...makeProps()} />);
    const box = screen.getByRole("checkbox", { name: /save as my default pitch/i });
    expect(box).toHaveAttribute("data-state", "unchecked");
    fireEvent.click(screen.getByText("Save as my default pitch"));
    expect(box).toHaveAttribute("data-state", "checked");
  });

  it("dismisses with an icon button that is still named Cancel", () => {
    render(<ApplyConfirmDialog {...makeProps()} />);
    const cancel = screen.getByRole("button", { name: "Cancel" });
    // Icon-only: the name comes from aria-label, not from visible text.
    expect(cancel.textContent?.trim()).toBe("");
  });

  it("gives pitch guidance exactly one home", () => {
    // "Tip: 30+ characters feels personal" used to sit directly above a panel
    // headed "TIPS" — same word, two meanings, adjacent rows.
    render(<ApplyConfirmDialog {...makeProps({ confirmApplyJob: makeJob({ is_urgent: true }) })} />);
    expect(screen.queryByText("Tips")).not.toBeInTheDocument();
    expect(screen.getByText(/30\+ characters feels personal/)).toBeInTheDocument();
    expect(screen.queryByText(/^Tip:/)).not.toBeInTheDocument();
    // The job-specific nudge survives the panel it used to live in.
    expect(screen.getByText(/earliest available start time/)).toBeInTheDocument();
  });

  it("labels the opener chips by intent, not by a sliced sentence", () => {
    // The chips used to be labelled with a 32-char slice of the sentence, so
    // the row had to scroll and the pill at the edge was cut mid-word.
    render(<ApplyConfirmDialog {...makeProps()} />);
    const chip = screen.getByRole("button", { name: /^Insert: I've done/ });
    expect(chip.textContent).toBe("Done this before");
    expect(screen.getByRole("group", { name: /suggested openers/i })).toBeInTheDocument();
  });

  it("lists attached files", () => {
    const file = new File(["resume contents"], "resume.pdf", { type: "application/pdf" });
    render(<ApplyConfirmDialog {...makeProps({ applyFiles: [file] })} />);
    expect(screen.getByText("resume.pdf")).toBeInTheDocument();
  });
});
