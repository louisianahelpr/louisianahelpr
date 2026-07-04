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
    expect(screen.getByText("$100.00")).toBeInTheDocument();
    expect(screen.getByText("Take-home")).toBeInTheDocument();
    expect(screen.getByText("$90.00")).toBeInTheDocument();
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
    expect(screen.getByText("$50.00")).toBeInTheDocument();
    expect(screen.getByText("$45.00")).toBeInTheDocument();
  });

  it("adds the urgent bonus into take-home", () => {
    // budget 100, 10% fee, +$15 urgent -> 100 - 10 + 15 = $105 take-home.
    render(
      <ApplyConfirmDialog
        {...makeProps({ confirmApplyJob: makeJob({ urgent_fee: 15 }) })}
      />,
    );
    expect(screen.getByText(/urgent bonus/)).toBeInTheDocument();
    expect(screen.getByText("$105.00")).toBeInTheDocument();
  });

  it("shows a generic prompt when no job is resolved", () => {
    render(<ApplyConfirmDialog {...makeProps({ confirmApplyJob: null })} />);
    expect(screen.getByText("Apply for this job")).toBeInTheDocument();
    expect(
      screen.getByText("Are you sure you want to apply for this job?"),
    ).toBeInTheDocument();
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
    fireEvent.click(screen.getByRole("button", { name: "Apply now" }));
    expect(props.handleApplyConfirm).toHaveBeenCalledTimes(1);
  });

  it("shows a loading label and disables the actions while submitting", () => {
    render(<ApplyConfirmDialog {...makeProps({ applyLoading: true })} />);
    const submit = screen.getByRole("button", { name: "Applying…" });
    expect(submit).toBeDisabled();
    expect(screen.getByRole("button", { name: "Cancel" })).toBeDisabled();
  });

  it("lists attached files", () => {
    const file = new File(["resume contents"], "resume.pdf", { type: "application/pdf" });
    render(<ApplyConfirmDialog {...makeProps({ applyFiles: [file] })} />);
    expect(screen.getByText("resume.pdf")).toBeInTheDocument();
  });
});
