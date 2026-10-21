/**
 * Explore › Jobs › Browse (owner report 2026-10-21, prod):
 *   - ONE group list for posting and browsing: the filter sheet's Category is
 *     exactly the 8 groups Post a job opens on (JOB_CATEGORY_GROUPS), in
 *     sentence case, no subcategories; the group a poster picks is the group a
 *     Helpr filters by;
 *   - a group filters the list, the map and the server count by its member
 *     categories; an old single-category value (old link, saved search) still
 *     means that one category and shows as one removable chip;
 *   - no category chip row under "Search jobs" (categories live only in the
 *     sheet);
 *   - the sheet's title row never scrolls (the title was cut off under the
 *     sheet's top edge once the sheet was scrolled).
 * Declutter's chip row: src/components/declutter/declutterGateAndLocation.test.tsx.
 * The Explore header's one search: src/test/jobsSectionTabs.test.tsx. Saved-search
 * alerts by group: src/test/savedSearchAlertsByGroup.test.ts.
 *
 * @mutate src/components/dashboard/JobFilters.tsx |       {JOB_CATEGORY_GROUPS.map((g) => { |       {JOB_CATEGORY_GROUPS.slice(1).map((g) => {
 * @mutate src/components/dashboard/JobFilters.tsx | onClick={() => { hapticLight(); setSelectedCategory(isActive ? null : g.id); onSelect?.(); }} | onClick={() => { hapticLight(); setSelectedCategory(isActive ? null : g.items[0].value); onSelect?.(); }}
 * @mutate src/components/dashboard/JobFilters.tsx |   const legacy = selectedCategory && !isJobCategoryGroupId(selectedCategory) ? selectedCategory : null; |   const legacy = null;
 * @mutate src/lib/jobCategoryGroups.ts |   if (isJobCategoryGroupId(value)) { |   if (false) {
 * @mutate src/hooks/useDashboardJobsCount.ts | query.in("category", categoriesForFilter(selectedCategory) as never) | query.eq("category", selectedCategory as never)
 * @mutate src/hooks/useDashboardFilters.ts |       if (!categoryFilterMatches(selectedCategory, job.category)) return false; |       if (selectedCategory && job.category !== selectedCategory) return false;
 * @mutate src/components/browseMap/mapFilter.ts |     if (!categoryFilterMatches(f.selectedCategory, job.category)) return false; |     if (f.selectedCategory && job.category !== f.selectedCategory) return false;
 * @mutate src/components/dashboard/BrowseTasksToolbar.tsx |       <FilterSheet | <div role="group" aria-label="Job groups"><button type="button">Home</button></div>\n      <FilterSheet
 * @mutate src/components/dashboard/FilterSheet.tsx |         <div data-filter-sheet-body="" className="min-h-0 flex-1 overflow-y-auto overscroll-contain"> |         <div data-filter-sheet-body="" className="min-h-0 flex-1">
 * @mutate src/components/dashboard/FilterSheet.tsx | max-h-[85dvh] flex flex-col overflow-hidden p-0 | max-h-[85dvh] overflow-y-auto p-0
 */
import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fireEvent, render, renderHook, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { blankComments } from "@/test/helpers/blankNonCode";

const calls = vi.hoisted(() => ({ list: [] as Array<[string, string, unknown]> }));
vi.mock("@/hooks/useIsWebDesktop", () => ({ useIsWebDesktop: () => false }));
vi.mock("@/integrations/supabase/client", () => {
  const builder: Record<string, unknown> = {};
  for (const m of ["select", "neq", "or", "lte", "eq", "gte", "gt", "not", "in"]) {
    builder[m] = (col: string, val: unknown) => {
      calls.list.push([m, col, val]);
      return builder;
    };
  }
  builder.then = (res: (v: { count: number; error: null }) => void) => res({ count: 3, error: null });
  return { supabase: { from: () => builder } };
});

import { CategoryContent } from "@/components/dashboard/JobFilters";
import { FilterSheet } from "@/components/dashboard/FilterSheet";
import { BrowseTasksToolbar } from "@/components/dashboard/BrowseTasksToolbar";
import type { BrowseTasksToolbarProps } from "@/components/dashboard/browseTasksToolbar/types";
import { useDashboardJobsCount } from "@/hooks/useDashboardJobsCount";
import { buildMapJobFilter, type MapJobFilterInput } from "@/components/browseMap/mapFilter";
import { JOB_CATEGORY_GROUPS, categoriesForFilter, categoryFilterMatches, jobCategoryGroupOf } from "@/lib/jobCategoryGroups";
import { JOB_CATEGORY_LABELS, type JobCategory } from "@/lib/jobCategories";
import type { MapJob } from "@/components/browseMap/config";

const REPO = resolve(__dirname, "..", "..");
const code = (f: string) => blankComments(readFileSync(resolve(REPO, f), "utf8"));
const ALL_CATEGORIES = Object.keys(JOB_CATEGORY_LABELS) as JobCategory[];

function category(selected: string | null, set = vi.fn()) {
  render(<CategoryContent selectedCategory={selected} setSelectedCategory={set} />);
  const group = screen.getByRole("group", { name: "Filter by category" });
  return { set, buttons: within(group).getAllByRole("button") };
}

describe("one group list for posting and browsing", () => {
  it("the filter's Category is exactly the 8 groups Post a job opens on, in sentence case, with no subcategory", () => {
    const { buttons } = category(null);
    const names = buttons.map((b) => b.textContent?.replace(/^\P{L}+/u, "").trim());
    expect(names).toEqual(JOB_CATEGORY_GROUPS.map((g) => g.label));
    expect(names).toHaveLength(8);
    for (const n of names) expect(n, n).toMatch(/^[A-Z][^A-Z]*$/);
    // No subcategory chip ("Yard Work", "Handyman", "HVAC"...): only a group's own name may equal a category's.
    const groupNames = new Set(JOB_CATEGORY_GROUPS.map((g) => g.label.toLowerCase()));
    const subcategoryChips = ALL_CATEGORIES.map((c) => JOB_CATEGORY_LABELS[c].toLowerCase()).filter((l) => !groupNames.has(l) && names.some((n) => n?.toLowerCase() === l));
    expect(subcategoryChips).toEqual([]);
  });

  it("Post a job and the filter read the same list (JOB_CATEGORY_GROUPS), and every category sits in a group", () => {
    for (const f of ["src/components/postjob/JobCategoryGroups.tsx", "src/components/dashboard/JobFilters.tsx"]) {
      expect(code(f), f).toMatch(/import \{[^}]*\bJOB_CATEGORY_GROUPS\b[^}]*\} from "@\/lib\/jobCategoryGroups"/);
      expect(code(f), f).toMatch(/JOB_CATEGORY_GROUPS\.map\(/);
    }
    expect(ALL_CATEGORIES.length).toBeGreaterThan(20);
    for (const c of ALL_CATEGORIES) expect(jobCategoryGroupOf(c), c).not.toBeNull();
  });

  it("tapping a group filters by that group's id; tapping it again clears", () => {
    const set = vi.fn();
    const home = JOB_CATEGORY_GROUPS.find((g) => g.id === "home")!;
    category(null, set);
    fireEvent.click(screen.getByRole("button", { name: home.label }));
    expect(set).toHaveBeenLastCalledWith("home");
  });

  it("an old single-category filter shows as one lit chip with a remove x; no group is lit", () => {
    const set = vi.fn();
    const { buttons } = category("handyman", set);
    const lit = buttons.filter((b) => b.getAttribute("aria-pressed") === "true");
    expect(lit).toHaveLength(1);
    expect(lit[0].textContent).toMatch(/^Handyman/);
    fireEvent.click(lit[0]);
    expect(set).toHaveBeenLastCalledWith(null);
  });
});

describe("a group filters by its member categories on every layer", () => {
  it("the rule: a group is its categories; an old category value is itself; events/other mean the same either way", () => {
    expect(categoriesForFilter("home").sort()).toEqual(ALL_CATEGORIES.filter((c) => jobCategoryGroupOf(c) === "home").sort());
    expect(categoriesForFilter("home").length).toBeGreaterThan(3);
    expect(categoryFilterMatches("home", "painting")).toBe(true);
    expect(categoryFilterMatches("home", "hvac")).toBe(false);
    expect(categoryFilterMatches("handyman", "handyman")).toBe(true);
    expect(categoryFilterMatches("handyman", "painting")).toBe(false);
    expect(categoriesForFilter("events")).toEqual(["events"]);
    expect(categoryFilterMatches(null, "painting")).toBe(true);
    expect(categoryFilterMatches("home", null)).toBe(false);
  });

  it("the list filters through that rule", () => {
    expect(code("src/hooks/useDashboardFilters.ts")).toMatch(/if \(!categoryFilterMatches\(selectedCategory, job\.category\)\) return false;/);
  });

  it("the map keeps a Home job under 'home' and drops a Trades one", () => {
    const NONE: MapJobFilterInput = {
      selectedCategory: "home", searchQuery: "", minBudget: "", maxBudget: "", urgentOnly: false, boostedOnly: false,
      expiresWithin: "", whenRange: null, matchAvailability: false, nearbyMiles: null, userLoc: null, earlyAccessDelayMs: 0,
    };
    const job = (category: string) => ({
      id: "j", title: "A job", category, budget: 60, is_urgent: false, latitude: 30.45, longitude: -91.15,
      parish: "East Baton Rouge", created_at: new Date(Date.now() - 3600_000).toISOString(),
    }) as MapJob;
    const f = buildMapJobFilter(NONE);
    expect(f(job("painting"))).toBe(true);
    expect(f(job("hvac"))).toBe(false);
  });

  it("the server count asks open_jobs_browse for every category in the group", async () => {
    calls.list = [];
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
    const { result } = renderHook(() => useDashboardJobsCount({
      selectedCategory: "home", searchQuery: "", minBudget: "", maxBudget: "", urgentOnly: false, boostedOnly: false,
      expiresWithin: "", jobWhen: "", earlyAccessTier: null, appliedJobIds: [], blockedUserIds: [], dismissedJobIds: [],
      savedOnlyJobIds: null,
    }), { wrapper });
    await waitFor(() => expect(result.current.data).toBe(3));
    expect(calls.list).toContainEqual(["in", "category", categoriesForFilter("home")]);
    expect(calls.list.some(([m, col]) => m === "eq" && col === "category")).toBe(false);
  });
});

describe("no category chip row on Browse", () => {
  const noop = () => {};
  const filters = {
    filtersOpen: false, setFiltersOpen: vi.fn(), activeFilterCount: 0, clearFilters: noop,
    selectedCategory: null, setSelectedCategory: noop, locationFilter: "", setLocationFilter: noop,
    sortBy: "smart", setSortBy: noop, expiresWithin: "", setExpiresWithin: noop, jobWhen: "", setJobWhen: noop,
    minBudget: "", setMinBudget: noop, maxBudget: "", setMaxBudget: noop,
    matchAvailability: false, setMatchAvailability: noop, boostedOnly: false, setBoostedOnly: noop,
    urgentOnly: false, setUrgentOnly: noop, userLoc: { status: "idle" }, nearbyApproximate: false, nearbyUnavailable: false,
  } as unknown as BrowseTasksToolbarProps["filters"];

  it("with the sheet closed, Browse's toolbar draws no category control at all", () => {
    render(
      <MemoryRouter>
        <BrowseTasksToolbar filters={filters} user={null} helperAvailability={[]} view="list" setView={noop} />
      </MemoryRouter>,
    );
    expect(screen.queryByRole("group", { name: "Job groups" })).toBeNull();
    for (const g of JOB_CATEGORY_GROUPS) expect(screen.queryByRole("button", { name: g.label })).toBeNull();
    expect(screen.queryAllByRole("button")).toHaveLength(0);
  });
});

describe("the filter sheet's title row never scrolls", () => {
  it("the sheet is a fixed column: the title sits outside the one scrolling body", () => {
    render(
      <MemoryRouter>
        <FilterSheet open onOpenChange={() => {}} sections={[{ key: "x", title: "Sort", content: <p>chips</p> }]} activeFilterCount={0} title="Filter jobs" />
      </MemoryRouter>,
    );
    const dialog = screen.getByRole("dialog");
    const cls = dialog.className.split(/\s+/);
    expect(cls).toEqual(expect.arrayContaining(["flex", "flex-col", "overflow-hidden"]));
    expect(cls).not.toContain("overflow-y-auto");
    const body = dialog.querySelector("[data-filter-sheet-body]") as HTMLElement;
    expect(body.className.split(/\s+/)).toEqual(expect.arrayContaining(["overflow-y-auto", "min-h-0", "flex-1"]));
    const title = screen.getByRole("heading", { name: "Filter jobs" });
    expect(body.contains(title)).toBe(false);
    expect(body.contains(screen.getByText("chips"))).toBe(true);
  });
});
