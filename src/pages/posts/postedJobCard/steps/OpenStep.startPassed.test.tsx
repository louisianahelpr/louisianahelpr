/**
 * JOBS-5: a no-show report reopens the job after its start, when job_starts_too_soon refuses every hire. "Pick another
 * applicant" could not happen; the card offers the two moves that can: a new date, or cancelling.
 *
 * @mutate src/pages/posts/postedJobCard/steps/OpenStep.tsx |   const startPassed = !crewBooked |   const startPassed = false && !crewBooked
 */
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { openMore } from "@/test/helpers/openMore";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { OpenStep } from "./OpenStep";
import type { PosterStepCtx } from "./posterStepContract";
import type { Job } from "@/components/job-card/activityConstants";

const draw = (over: Partial<Job>, ctxOver: Partial<PosterStepCtx> = {}) => {
  const onEdit = vi.fn();
  const onCancel = vi.fn();
  const ctx = {
    job: { id: "j1", title: "Yard", status: "open", budget: 100, category: "other", start_time: "09:00", ...over } as unknown as Job,
    onBoost: vi.fn(), onEdit, onCancel, crewBooked: false,
    applicantsPrimary: { count: 2, onOpen: vi.fn() },
    ...ctxOver,
  } as unknown as PosterStepCtx;
  render(
    <QueryClientProvider client={new QueryClient()}>
      <MemoryRouter><OpenStep {...ctx} /></MemoryRouter>
    </QueryClientProvider>,
  );
  return { onEdit, onCancel };
};

describe("an open job past its start offers a new date or cancelling", () => {
  it("past the start: Pick a new date opens Edit, Cancel (under More) opens the cancel, and Applicants is not the primary", async () => {
    const { onEdit, onCancel } = draw({ date_needed: "2020-01-01" });
    expect(screen.getByText(/The start time has passed, so nobody can be hired for it\./)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Applicants/ })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Pick a new date" }));
    expect(onEdit).toHaveBeenCalledTimes(1);
    await openMore();
    fireEvent.click(screen.getByRole("button", { name: "Cancel job" }));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it("before the start: the normal row, with Applicants as the primary", () => {
    draw({ date_needed: "2099-01-01" });
    expect(screen.getByRole("button", { name: /^Applicants \(2\)/ })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Pick a new date" })).not.toBeInTheDocument();
    expect(screen.queryByText(/The start time has passed/)).not.toBeInTheDocument();
  });

  it("a booked crew and a series parent keep the normal row: neither has one date to pick here", () => {
    draw({ date_needed: "2020-01-01" }, { crewBooked: true });
    expect(screen.queryByRole("button", { name: "Pick a new date" })).not.toBeInTheDocument();
    document.body.innerHTML = "";
    draw({ date_needed: "2020-01-01", recurrence_days: [1] });
    expect(screen.queryByRole("button", { name: "Pick a new date" })).not.toBeInTheDocument();
  });
});
