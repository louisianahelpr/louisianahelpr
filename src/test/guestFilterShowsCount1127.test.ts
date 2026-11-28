/**
 * Polish audit 11-27 #115 (filter half): signed out, the Jobs filter sheet's button read "Show jobs" while signed in it
 * read "Show N jobs" (a number, live 2026-11-27). The guest page now hands the toolbar the same exact-only count (sheetResultCount, board 24): a
 * number only when the guest read is complete (under GUEST_JOBS_LIMIT rows), the list is on screen and loaded.
 *
 * @mutate src/pages/home/DashboardGuest.tsx |       resultCount={sheetResultCount({ | data-was-result-count={sheetResultCount({
 * @mutate src/pages/home/DashboardGuest.tsx | listComplete: baseJobs.length < GUEST_JOBS_LIMIT, | listComplete: true,
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { blankComments } from "./helpers/blankNonCode";
import { sheetResultCount } from "@/pages/home/headerJobCount";

const guest = blankComments(readFileSync("src/pages/home/DashboardGuest.tsx", "utf8"));

describe("signed out, the filter button says how many jobs it will show (#115)", () => {
  const toolbar = guest.slice(guest.indexOf("<BrowseTasksToolbar"), guest.indexOf("/>", guest.indexOf("hideViewToggle")));

  it("is not vacuous", () => {
    expect(toolbar.length).toBeGreaterThan(200);
    expect(toolbar).toContain("filters={filters}");
  });

  it("passes the exact-only count to the toolbar, never a total it did not read", () => {
    expect(toolbar).toContain("resultCount={sheetResultCount({");
    expect(toolbar).toContain("listedCount: filters.filteredJobs.length");
    expect(toolbar).toContain("listComplete: baseJobs.length < GUEST_JOBS_LIMIT");
    expect(toolbar).toMatch(/listOnScreen: view === "list" && feedReady && !isError && phase === "ready"/);
  });

  it("the shared rule gives a number only when the list is complete and on screen", () => {
    expect(sheetResultCount({ listedCount: 4, listComplete: true, listOnScreen: true })).toBe(4);
    expect(sheetResultCount({ listedCount: 4, listComplete: false, listOnScreen: true })).toBeNull();
    expect(sheetResultCount({ listedCount: 4, listComplete: true, listOnScreen: false })).toBeNull();
  });
});
