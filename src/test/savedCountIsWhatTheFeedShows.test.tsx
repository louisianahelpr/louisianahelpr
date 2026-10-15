/**
 * Q1739: the saved count and the saved-only feed disagreed. The bookmark's
 * count was savedJobIds.size (every job ever saved), while the saved-only feed
 * showed only saved jobs that are still open to the viewer AND on a page
 * already loaded. Measured on prod 2026-10-15: the one saved_jobs row points
 * at a job open_jobs_browse no longer shows, so that member's bookmark said 1
 * over a feed that said "Nothing saved yet".
 *
 * Three layers are held here:
 *   1. the count every Browse surface prints is the server's count of saved
 *      jobs still shown (useDashboardFilters' savedShownCount), never the raw
 *      id set;
 *   2. while "Only saved jobs" is on, the feed reads further pages until the
 *      list reaches the server's count (useSavedOnlyPaging), and never pages
 *      without a server count to stop at;
 *   3. an empty saved-only list with saved jobs behind it says none are open,
 *      not "Nothing saved yet".
 */
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { blankComments } from "@/test/helpers/blankNonCode";
import { SavedOnlyState } from "@/components/dashboard/SavedOnlyState";
import { shouldReadNextSavedPage } from "@/pages/home/useSavedOnlyPaging";

afterEach(cleanup);

const root = process.cwd();
function tsxUnder(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) return tsxUnder(p);
    return /\.tsx$/.test(name) && !/\.test\.tsx$/.test(name) ? [p] : [];
  });
}

describe("the saved count (Q1739)", () => {
  // Every `savedCount=` prop handed to a Browse control, across src/pages.
  const props = tsxUnder(join(root, "src/pages")).flatMap((file) =>
    [...blankComments(readFileSync(file, "utf8")).matchAll(/savedCount=\{([^}]*)\}/g)].map((m) => ({
      file: file.slice(root.length + 1),
      expr: m[1].trim(),
    })),
  );

  it("finds the Browse controls that print it", () => {
    expect(props.length).toBeGreaterThan(2);
  });

  it("is the server's count of saved jobs still shown, never the raw saved-id set", () => {
    const wrong = props.filter((p) => !/^filters\.savedShownCount\b/.test(p.expr));
    expect(wrong.map((p) => `${p.file}: savedCount={${p.expr}}`)).toEqual([]);
  });

  it("is read with the header count's culls and none of the viewer's filters", () => {
    const code = blankComments(readFileSync(join(root, "src/hooks/useDashboardFilters.ts"), "utf8"));
    const call = code.match(/const \{ data: savedShownCount \} = useDashboardJobsCount\(\{([\s\S]*?)\}\);/);
    expect(call, "useDashboardFilters no longer reads savedShownCount from useDashboardJobsCount").not.toBeNull();
    const body = call![1];
    expect(body).toMatch(/savedOnlyJobIds:\s*savedAllIdsKey/);
    for (const cull of ["appliedJobIds: appliedIdsKey", "blockedUserIds: blockedIdsKey", "dismissedJobIds: dismissedIdsKey", "earlyAccessTier"]) {
      expect(body, `missing ${cull}`).toContain(cull);
    }
    for (const filter of ["selectedCategory: null", 'searchQuery: ""', 'minBudget: ""', 'maxBudget: ""', "urgentOnly: false", "boostedOnly: false", 'expiresWithin: ""']) {
      expect(body, `the saved count must not narrow by ${filter.split(":")[0]}`).toContain(filter);
    }
    expect(code).toMatch(/savedShownCount,\n/);
  });

  it("Dashboard hands every saved id to it", () => {
    const code = blankComments(readFileSync(join(root, "src/pages/home/Dashboard.tsx"), "utf8"));
    const call = code.match(/useDashboardFilters\(\{([\s\S]*?)\}\);/);
    expect(call?.[1]).toMatch(/\bsavedJobIds\b/);
  });
});

describe("the saved-only feed reads on until it has every saved job (Q1739)", () => {
  const base = { savedOnly: true, listedCount: 0, serverCount: 1, hasNextPage: true, isFetchingNextPage: false };

  it("reads the next page while the list is short of the server's count", () => {
    expect(shouldReadNextSavedPage(base)).toBe(true);
  });

  it("stops once the list has them all", () => {
    expect(shouldReadNextSavedPage({ ...base, listedCount: 1 })).toBe(false);
  });

  it("stops at the end of the feed", () => {
    expect(shouldReadNextSavedPage({ ...base, hasNextPage: false })).toBe(false);
  });

  it("never asks twice at once", () => {
    expect(shouldReadNextSavedPage({ ...base, isFetchingNextPage: true })).toBe(false);
  });

  it("never pages without a server count to stop at (a client-only filter is narrowing)", () => {
    expect(shouldReadNextSavedPage({ ...base, serverCount: null })).toBe(false);
    expect(shouldReadNextSavedPage({ ...base, serverCount: undefined })).toBe(false);
  });

  it("does nothing with the toggle off", () => {
    expect(shouldReadNextSavedPage({ ...base, savedOnly: false })).toBe(false);
  });

  it("Dashboard runs it with the header's server count and the rendered list", () => {
    const code = blankComments(readFileSync(join(root, "src/pages/home/Dashboard.tsx"), "utf8"));
    expect(code).toMatch(/useSavedOnlyPaging\(\{\s*savedOnly,\s*listedCount: filters\.filteredJobs\.length,\s*serverCount: filters\.totalMatchingCount,/);
  });
});

describe("an empty saved-only list (Q1739)", () => {
  const read = { failed: false, onRetry: () => {}, retrying: false };

  it("says none are open when jobs are saved", () => {
    render(<SavedOnlyState savedRead={{ ...read, total: 1 }} />);
    expect(screen.getByText("None of your saved jobs are open")).toBeTruthy();
    expect(screen.queryByText("Nothing saved yet")).toBeNull();
  });

  it("says nothing is saved when nothing is", () => {
    render(<SavedOnlyState savedRead={{ ...read, total: 0 }} />);
    expect(screen.getByText("Nothing saved yet")).toBeTruthy();
  });

  it("the side query reports the total", () => {
    const code = blankComments(readFileSync(join(root, "src/pages/home/useDashboardSideQueries.ts"), "utf8"));
    expect(code).toMatch(/total: savedJobIds\.size,/);
  });
});

// @mutate src/pages/home/Dashboard.tsx |                           savedCount={filters.savedShownCount ?? 0} |                           savedCount={savedJobIds.size}
// @mutate src/pages/home/Dashboard.tsx | serverCount: filters.totalMatchingCount, hasNextPage | serverCount: null, hasNextPage
// @mutate src/pages/home/Dashboard.tsx | appliedJobIds, blockedUserIds, dismissedJobIds, savedJobIds, | appliedJobIds, blockedUserIds, dismissedJobIds,
// @mutate src/hooks/useDashboardFilters.ts |     savedOnlyJobIds: savedAllIdsKey, |     savedOnlyJobIds: savedOnlyIdsKey,
// @mutate src/hooks/useDashboardFilters.ts |     selectedCategory: null, |     selectedCategory,
// @mutate src/pages/home/useSavedOnlyPaging.ts |   if (i.listedCount >= i.serverCount) return false; |
// @mutate src/pages/home/useSavedOnlyPaging.ts |   if (typeof i.serverCount !== "number") return false; |
// @mutate src/pages/home/useSavedOnlyPaging.ts |   if (!i.savedOnly) return false; |
// @mutate src/pages/home/useSavedOnlyPaging.ts |   return i.hasNextPage === true && !i.isFetchingNextPage; |   return true;
// @mutate src/components/dashboard/SavedOnlyState.tsx |     const noneOpen = (savedRead?.total ?? 0) > 0; |     const noneOpen = false;
// @mutate src/pages/home/useDashboardSideQueries.ts |       total: savedJobIds.size, |
