/**
 * Q2609 / Q2610 (Jobs audit 1102b rows 23-24).
 * - Working, with only a not-picked application: All read "No jobs in this view / No jobs match the current view." as
 *   if a filter hid jobs, and the only button was "Show Not picked (1)". Now: "No jobs yet / Apply to jobs near you."
 *   with "Browse jobs", and Not picked as a quiet link.
 * - Posted, empty: "Nothing posted yet" told a poster to go earn ("browse open jobs near you and apply") with only
 *   "Browse jobs"; no Post a job button on the Posted tab. Now "Post a job". Six filter chips stood over the empty list
 *   (cut off at 375); the chip row is gone while every bucket is empty.
 *
 * @mutate src/components/job-card/ActivityEmptyState.tsx |   const isLiveEmpty = isTrulyEmpty \|\| (statusFilter === "all" && !hasSearch); |   const isLiveEmpty = isTrulyEmpty;
 * @mutate src/components/job-card/ActivityEmptyState.tsx |   const ctaLabel = isPosted ? "Post a job" : "Browse jobs"; |   const ctaLabel = isPosted ? "Browse jobs" : "Post a job";
 * @mutate src/components/job-card/ActivityEmptyState.tsx |         ? "Post a job and Helprs near you can apply." |         ? "While you wait for the right moment to post, you can earn by helping — browse open jobs near you and apply."
 * @mutate src/components/job-card/ActivityEmptyState.tsx |           isLiveEmpty && !isTrulyEmpty && jumpTo && onSelectStatusFilter ? ( |           false ? (
 * @mutate src/components/job-card/embeddedActivity.tsx |   const noRows = !search.trim() && Object.values(counts).every((n) => !n); |   const noRows = false;
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { readFileSync } from "node:fs";
import { blankComments } from "@/test/helpers/blankNonCode";

vi.mock("@/hooks/useAgeGate", () => ({ useAgeGate: () => ({ gate: (_k: string, fn: () => void) => fn, gatedProps: () => ({}) }) }));
import { ActivityEmptyState } from "@/components/job-card/ActivityEmptyState";

afterEach(cleanup);

const WORKING_LABELS = [
  { key: "all", label: "All" }, { key: "needs_you", label: "Needs you" }, { key: "not_picked", label: "Not picked" },
];

describe("Q2609: an empty Working tab is empty, not filtered", () => {
  it("only a not-picked application: No jobs yet, Browse jobs, Not picked as a quiet link", () => {
    const nav = vi.fn();
    const pick = vi.fn();
    render(
      <MemoryRouter>
        <ActivityEmptyState tab="applied" loadError={false} postedJobsCount={0} appliedAppsCount={1} statusFilter="all" hasSearch={false}
          statusCounts={{ all: 0, needs_you: 0, not_picked: 1 }} statusLabels={WORKING_LABELS}
          onRetry={vi.fn()} onNavigate={nav} onSelectStatusFilter={pick} />
      </MemoryRouter>,
    );
    expect(screen.getByText("No jobs yet")).toBeTruthy();
    expect(screen.getByText("Apply to jobs near you.")).toBeTruthy();
    expect(screen.queryByText(/No jobs match the current view/)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Browse jobs" }));
    expect(nav).toHaveBeenCalledWith("/home");
    const quiet = document.querySelector("[data-empty-jump]");
    expect(quiet?.textContent).toBe("Show Not picked (1)");
    fireEvent.click(quiet!);
    expect(pick).toHaveBeenCalledWith("not_picked");
  });

  it("a specific bucket that is empty still points at where the jobs are", () => {
    render(
      <MemoryRouter>
        <ActivityEmptyState tab="applied" loadError={false} postedJobsCount={0} appliedAppsCount={1} statusFilter="needs_you" hasSearch={false}
          statusCounts={{ all: 0, needs_you: 0, not_picked: 1 }} statusLabels={WORKING_LABELS}
          onRetry={vi.fn()} onNavigate={vi.fn()} onSelectStatusFilter={vi.fn()} />
      </MemoryRouter>,
    );
    expect(screen.getByRole("button", { name: "Show Not picked (1)" })).toBeTruthy();
    expect(document.querySelector("[data-empty-jump]")).toBeNull();
  });
});

describe("Q2610: an empty Posted tab offers Post a job", () => {
  it("Nothing posted yet: Post a job goes to /post-job; no 'go earn' line", () => {
    const nav = vi.fn();
    render(
      <MemoryRouter>
        <ActivityEmptyState tab="posted" loadError={false} postedJobsCount={0} appliedAppsCount={0} statusFilter="all" hasSearch={false}
          onRetry={vi.fn()} onNavigate={nav} />
      </MemoryRouter>,
    );
    expect(screen.getByText("Nothing posted yet")).toBeTruthy();
    expect(screen.queryByText(/earn by helping/)).toBeNull();
    expect(screen.queryByRole("button", { name: "Browse jobs" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Post a job" }));
    expect(nav).toHaveBeenCalledWith("/post-job");
  });

  it("the header draws no chip row while every bucket is empty and nothing is searched", () => {
    const src = blankComments(readFileSync("src/components/job-card/embeddedActivity.tsx", "utf8"));
    expect(src).toContain("const noRows = !search.trim() && Object.values(counts).every((n) => !n);");
    expect(src).toContain('{!noRows && <div data-jobs-toolbar="" className={JOBS_TOOLBAR_ROW}>');
  });
});
