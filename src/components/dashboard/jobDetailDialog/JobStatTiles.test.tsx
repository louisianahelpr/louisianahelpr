import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { JobStatTiles } from "./JobStatTiles";
import type { EnrichedJob } from "../types";
import { jobLocalDateISO } from "@/test/helpers/jobLocalDate";

/**
 * THE EMPTY BLOCK the owner photographed on 2026-09-19 ("rn its just an empty
 * block"), and the rule that replaces it.
 *
 * The compact row is a CSS grid whose column count used to be written as
 * `rowItems.length === 4 ? "grid-cols-4" : "grid-cols-3"`. Where and Date are
 * the only unconditional cells, so a job with no start time and no Helprs count
 * — 184 of the 260 rows on prod — laid TWO tiles into THREE columns. The third
 * column is the empty block: nothing renders in it, but the two real tiles are
 * squeezed to two-thirds width beside a visible gap.
 *
 * So the assertion is not "is the Time tile absent" (it was already absent);
 * it is COLUMN COUNT === CHILD COUNT, which is the property that was violated
 * and the one that stays true when a future optional tile is added.
 */

function makeJob(overrides: Partial<EnrichedJob> = {}): EnrichedJob {
  return {
    id: "job-1",
    title: "Move a couch",
    description: "Second floor, no lift.",
    category: "moving",
    budget: 100,
    // The owner's screenshot: Lake Charles, Wed Dec 30, no time.
    date_needed: jobLocalDateISO(101),
    location: "1 Ryan St, Lake Charles, LA 70601",
    customer_id: "poster",
    status: "open",
    created_at: "2026-09-19T12:00:00Z",
    start_time: null,
    is_flexible_schedule: false,
    expires_at: null,
    is_group_job: false,
    helpers_needed: 1,
    ...overrides,
  } as unknown as EnrichedJob;
}

function renderTiles(job: EnrichedJob) {
  const { container } = render(
    <JobStatTiles job={job} distMilesForDriving={null} drivingLabel={null} />,
  );
  const row = container.querySelector<HTMLElement>('[class*="grid-cols-"]');
  expect(row, "the compact meta row did not render").not.toBeNull();
  const cols = Number(/grid-cols-(\d+)/.exec(row!.className)?.[1]);
  return { row: row!, cols, cells: Array.from(row!.children) as HTMLElement[] };
}

afterEach(cleanup);

describe("JobStatTiles — the compact row never reserves an empty cell", () => {
  it("no start time, not flexible: two tiles in TWO columns, and no Time tile", () => {
    const { cols, cells } = renderTiles(makeJob());
    // THE regression. Before the fix this was 2 cells in 3 columns.
    expect(cols).toBe(cells.length);
    expect(cols).toBe(2);
    expect(screen.queryByText("Flexible")).toBeNull();
    // Every cell that did render says something.
    for (const cell of cells) expect(cell.textContent?.trim()).not.toBe("");
  });

  it("no start time but the poster ticked flexible: the Time tile reads Flexible", () => {
    const { cols, cells } = renderTiles(makeJob({ is_flexible_schedule: true }));
    expect(cols).toBe(cells.length);
    expect(cols).toBe(3);
    expect(screen.getByText("Flexible")).toBeTruthy();
  });

  it("a real start time wins over the flag and prints the clock", () => {
    const { cols, cells } = renderTiles(
      makeJob({ start_time: "14:30:00", is_flexible_schedule: true }),
    );
    expect(cols).toBe(cells.length);
    expect(screen.getByText("2:30 PM")).toBeTruthy();
    expect(screen.queryByText("Flexible")).toBeNull();
  });

  it("holds with the fourth (Helprs) tile too", () => {
    const { cols, cells } = renderTiles(
      makeJob({ start_time: "08:00:00", is_group_job: true, helpers_needed: 3 }),
    );
    expect(cols).toBe(cells.length);
    expect(cols).toBe(4);
    expect(screen.getByText("8:00 AM")).toBeTruthy();
  });

  it("column count tracks cell count across EVERY combination of the optional tiles", () => {
    const combos = [
      { start_time: null, is_flexible_schedule: false, is_group_job: false, helpers_needed: 1 },
      { start_time: null, is_flexible_schedule: true, is_group_job: false, helpers_needed: 1 },
      { start_time: "09:00", is_flexible_schedule: false, is_group_job: false, helpers_needed: 1 },
      { start_time: null, is_flexible_schedule: false, is_group_job: true, helpers_needed: 4 },
      { start_time: null, is_flexible_schedule: true, is_group_job: true, helpers_needed: 4 },
      { start_time: "09:00", is_flexible_schedule: false, is_group_job: true, helpers_needed: 4 },
    ];
    expect(combos.length).toBeGreaterThan(4);
    for (const combo of combos) {
      const { cols, cells } = renderTiles(makeJob(combo as Partial<EnrichedJob>));
      expect(cols, JSON.stringify(combo)).toBe(cells.length);
      for (const cell of cells) expect(cell.textContent?.trim(), JSON.stringify(combo)).not.toBe("");
      cleanup();
    }
  });
});

/**
 * MOUNT WIRING. Rendering JobStatTiles proves JobStatTiles; it proves nothing
 * about the dialog that mounts it, or about whether the flag ever reaches the
 * component at all. Both are read from the source here rather than mocked,
 * because the dialog's own render path is a live Supabase read and CLAUDE.md
 * forbids adding new mocked-Supabase specs.
 */
describe("JobStatTiles is mounted with a job that carries the flexible flag", () => {
  const ROOT = resolve(__dirname, "../../../..");
  const read = (rel: string) => readFileSync(resolve(ROOT, rel), "utf8");

  it("JobDetailDialog renders JobStatTiles with the whole job row", () => {
    const dialog = read("src/components/dashboard/JobDetailDialog.tsx");
    expect(dialog).toMatch(/<JobStatTiles\s+job=\{job\}/);
  });

  it("every feed that opens that dialog selects is_flexible_schedule", () => {
    // Derived from the queries themselves: if a feed stops selecting the
    // column, the tile silently loses its ability to say "Flexible" and this
    // fails on the query rather than on a screenshot weeks later.
    const feeds = [
      "src/hooks/useDashboardData.ts",
      "src/pages/home/DashboardGuest.tsx",
      "src/components/browseMap/fetchJobForPin.ts",
    ];
    expect(feeds.length).toBeGreaterThan(2);
    const missing = feeds.filter((f) => {
      const src = read(f);
      // Only the selects that already ask for the start time are in scope.
      return src.includes("start_time") && !src.includes("is_flexible_schedule");
    });
    expect(
      missing,
      "These feed the job-detail dialog with a start time but no flexible flag, " +
        "so a flexible job would render as a job with no time at all.",
    ).toEqual([]);
  });
});

// The exact line the owner photographed on 2026-09-19: two tiles laid into
// three columns leaves the third one empty.
// @mutate src/components/dashboard/jobDetailDialog/JobStatTiles.tsx | rowItems.length >= 4 ? "grid-cols-4" : rowItems.length === 3 ? "grid-cols-3" : "grid-cols-2" | rowItems.length === 4 ? "grid-cols-4" : "grid-cols-3"
