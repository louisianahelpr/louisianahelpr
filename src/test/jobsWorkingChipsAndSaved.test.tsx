/**
 * F107 (owner UI audit 11-09: "Jobs has Browse / Posted / Working tabs only; there's no Applied, Completed or Saved",
 * owner pick 11-09: filters inside the existing tabs, keep the three tabs; lead 11-09 kept Needs you):
 *   - Working's chips: All · Needs you · Applied · Active · Completed (Not picked under All only);
 *   - Posted keeps its five bucket chips;
 *   - an old Working link's bucket (?filter=scheduled from a notification) opens the chip it lives under;
 *   - Browse's chip row gets "Saved" (the feed's own Only-saved filter) once a job is saved.
 *
 * @mutate src/components/job-card/embeddedActivity.tsx |   const chips: readonly string[] = tab === "posted" ? BOX_BUCKETS : WORKING_CHIPS; |   const chips: readonly string[] = BOX_BUCKETS;
 * @mutate src/lib/activityBuckets.ts |   if (filter === "scheduled") return "active"; |   if (filter === "scheduled") return "scheduled";
 * @mutate src/components/job-card/activityFilters.ts |   return app.status === "accepted" ? "active" : "applied"; |   return "applied";
 * @mutate src/components/dashboard/JobActiveFilters.tsx |   if (savedOn && onClearSaved) pills.push | if (false) pills.push
 * @mutate src/pages/home/Dashboard.tsx |       savedOn={savedOnly} onClearSaved={toggleSavedOnly} /> |       />
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { EmbeddedActivityHeader } from "@/components/job-card/embeddedActivity";
import { JobActiveFilters } from "@/components/dashboard/JobActiveFilters";
import { workingChip } from "@/components/job-card/activityFilters";
import { WORKING_CHIPS, workingChipForFilter } from "@/lib/activityBuckets";
import type { AppliedApp } from "@/components/job-card/activityConstants";
import { blankComments } from "./helpers/blankNonCode";

afterEach(cleanup);

const draw = (tab: "posted" | "applied", counts: Record<string, number>, onFilter = vi.fn()) => {
  render(
    <MemoryRouter>
      <EmbeddedActivityHeader header={null} tab={tab} statusFilter="all" counts={counts} onFilter={onFilter} search="" onSearch={() => {}} />
    </MemoryRouter>,
  );
  return onFilter;
};
const chips = () => within(screen.getByRole("group", { name: "Filter by status" })).getAllByRole("button").map((b) => (b.textContent ?? "").replace(/\u00a0/g, " ").trim());

const app = (status: string, job: Record<string, unknown> | null): AppliedApp =>
  ({ id: `a-${status}-${String(job?.status)}`, job_id: "j", helper_id: "h", status, created_at: "2026-11-01T00:00:00Z", job: job ? { id: "j", title: "T", description: "", location: "", helper_id: "h", ...job } : null }) as unknown as AppliedApp;

describe("F107: Working's chips and Browse's Saved chip", () => {
  it("Working: All · Needs you · Applied · Active · Completed, each filtering by its own key", () => {
    const onFilter = draw("applied", { all: 6, needs_you: 1, applied: 2, active: 2, completed: 1, cancelled: 3 });
    expect(chips()).toEqual(["All · 6", "Needs you · 1", "Applied · 2", "Active · 2", "Completed · 1"]);
    fireEvent.click(screen.getByRole("button", { name: /^Applied/ }));
    fireEvent.click(screen.getByRole("button", { name: /^Active/ }));
    fireEvent.click(screen.getByRole("button", { name: /^Completed/ }));
    expect(onFilter.mock.calls.map((c) => c[0])).toEqual(["applied", "active", "completed"]);
    expect(WORKING_CHIPS.length).toBeGreaterThan(3);
  });

  it("Posted keeps its five bucket chips", () => {
    draw("posted", { all: 4, needs_you: 1, done: 1, cancelled: 2 });
    expect(chips()).toEqual(["All · 4", "Needs you · 1", "Waiting", "Upcoming", "Done · 1", "Cancelled · 2"]);
  });

  it("each Working row is in one chip: an application is Applied, booked work Active, done Completed, not picked none", () => {
    expect(workingChip(app("pending", { status: "open" }))).toBe("applied");
    expect(workingChip(app("accepted", { status: "accepted", helper_confirmed_at: "2026-11-01T00:00:00Z", date_needed: "2099-01-01" }))).toBe("active");
    expect(workingChip(app("accepted", { status: "completed" }))).toBe("completed");
    expect(workingChip(app("rejected", { status: "open" }))).toBeNull();
    expect(workingChip(app("pending", null))).toBeNull();
  });

  it("an old Working link's bucket opens the chip it lives under", () => {
    expect(workingChipForFilter("scheduled")).toBe("active");
    expect(workingChipForFilter("done")).toBe("completed");
    expect(workingChipForFilter("waiting")).toBe("all");
    expect(workingChipForFilter("cancelled")).toBe("all");
    expect(workingChipForFilter("needs_you")).toBe("needs_you");
    const page = blankComments(readFileSync(join(__dirname, "..", "components", "job-card", "JobListPage.tsx"), "utf8"));
    expect(page).toContain('return tab === "applied" ? workingChipForFilter(f) : f;');
  });

  // Owner 11-25: Browse's chip row left for Filters (where "Only saved jobs" lives); a saved-only filter that is on
  // shows as a removable "Saved" chip under the tabs, and pressing it turns the filter off.
  it("Browse: the saved-only filter, when on, is a removable Saved chip; off, nothing", () => {
    const onClear = vi.fn();
    const { rerender, container } = render(<JobActiveFilters category={null} onClearCategory={() => {}} savedOn={false} onClearSaved={onClear} />);
    expect(container.innerHTML).toBe("");
    rerender(<JobActiveFilters category={null} onClearCategory={() => {}} savedOn onClearSaved={onClear} />);
    fireEvent.click(screen.getByRole("button", { name: "Remove filter: Saved" }));
    expect(onClear).toHaveBeenCalledTimes(1);
    const dash = blankComments(readFileSync(join(__dirname, "..", "pages", "home", "Dashboard.tsx"), "utf8"));
    expect(dash).toContain("savedOn={savedOnly} onClearSaved={toggleSavedOnly} />");
  });
});
