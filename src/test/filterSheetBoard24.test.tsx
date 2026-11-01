/**
 * Board 24, the shared filter sheet (lead decisions 2026-10-20):
 *   - the footer is "Clear all" (olive text link) + ONE primary that closes the
 *     sheet; the primary carries a number ONLY when the count is exact for the
 *     whole filtered set, never a count of the pages loaded so far;
 *   - Distance has no default radius (no permission prompt on open, farther
 *     jobs stay visible); 5/10/25/50 are options;
 *   - "When" is the job's DAY, applied by the list, the map and the server
 *     count alike (jobWhenFilter.ts);
 *   - Price is a range over the existing min/max budget state.
 *
 * @mutate src/pages/home/headerJobCount.ts | return listComplete && listOnScreen ? listedCount : null; | return listedCount;
 * @mutate src/components/dashboard/filterSheet/FilterSheetFooter.tsx | if (resultCount === null \|\| resultCount === undefined) return `Show ${many}`; | if (resultCount === null \|\| resultCount === undefined) return `Show 0 ${many}`;
 * @mutate src/pages/home/Dashboard.tsx | listComplete: !hasNextPage, listOnScreen | listComplete: true, listOnScreen
 * @mutate src/components/dashboard/FilterSheet.tsx |       onDone={() => onOpenChange(false)} |       onDone={() => {}}
 * @mutate src/hooks/useDashboardFilters.ts |       if (!jobMatchesWhen(job.date_needed, whenRange)) return false; |       void whenRange;
 * @mutate src/hooks/useDashboardJobsCount.ts |       if (whenRange) query = query.gte | if (false) query = query.gte
 * @mutate src/hooks/useDashboardFilters.ts |   const [locationFilter, setLocationFilter] = useState(() => param("loc")); |   const [locationFilter, setLocationFilter] = useState(() => param("loc") \|\| "nearby:25");
 * @mutate src/components/dashboard/filterSheet/jobFilterSections.tsx |       key: "price", |       key: "price-x",
 * @mutate src/components/dashboard/BrowseTasksToolbar.tsx |         title="Filter jobs" |         title="Filters"
 * @mutate src/components/dashboard/FilterSheet.tsx |         floor\n        // The Filters button |         floor={false}\n        // The Filters button
 * @mutate src/components/dashboard/filterSheet/jobFilterSections.tsx |           style={minBudget \|\| maxBudget ? { color: "hsl(var(--burnt-sienna))" } : undefined} |           style={{ color: "hsl(var(--burnt-sienna))" }}
 * @mutate src/components/dashboard/JobFilters.tsx | btn-press border min-h-10"; | btn-press border h-11";
 * @mutate src/components/dashboard/JobFilters.tsx | const radiusChip = chipBase.replace("px-4", "px-3"); | const radiusChip = chipBase;
 * @mutate src/components/dashboard/browseTasksToolbar/BrowseViewToggle.tsx |     <SegmentedControl | <SegmentedControl semantics="tab"
 */
import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fireEvent, render, renderHook, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { blankComments } from "@/test/helpers/blankNonCode";

const calls = vi.hoisted(() => ({ list: [] as Array<[string, string, unknown]>, desktop: false }));
vi.mock("@/hooks/useIsWebDesktop", () => ({ useIsWebDesktop: () => calls.desktop }));
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

import { FilterSheet } from "@/components/dashboard/FilterSheet";
import { buildJobFilterSections } from "@/components/dashboard/filterSheet/jobFilterSections";
import { sheetResultCount } from "@/pages/home/headerJobCount";
import { jobMatchesWhen, jobWhenRange } from "@/lib/jobWhenFilter";
import { useDashboardJobsCount } from "@/hooks/useDashboardJobsCount";
import { BrowseTasksToolbar } from "@/components/dashboard/BrowseTasksToolbar";
import type { BrowseTasksToolbarProps } from "@/components/dashboard/browseTasksToolbar/types";

const REPO = resolve(__dirname, "..", "..");
const code = (f: string) => blankComments(readFileSync(resolve(REPO, f), "utf8"));
const NOUN = ["job", "jobs"] as const;

function sheet(resultCount: number | null | undefined, extra: { onOpenChange?: (o: boolean) => void; onClearAll?: () => void } = {}) {
  return render(
    <MemoryRouter>
      <FilterSheet
        open
        onOpenChange={extra.onOpenChange ?? (() => {})}
        sections={[{ key: "x", title: "Sort", content: <p>chips</p> }]}
        activeFilterCount={1}
        onClearAll={extra.onClearAll ?? (() => {})}
        title="Filter jobs"
        resultCount={resultCount}
        resultNoun={NOUN}
      />
    </MemoryRouter>,
  );
}

describe("board 24: the Show jobs button tells the truth", () => {
  it("prints no number while the count is not exact for the whole set", () => {
    sheet(null);
    const btn = screen.getByRole("button", { name: "Show jobs" });
    expect(btn.textContent).not.toMatch(/\d/);
  });

  it("prints the exact count, singular and plural, and never 'Show 0'", () => {
    const { unmount } = sheet(12);
    expect(screen.getByRole("button", { name: "Show 12 jobs" })).toBeTruthy();
    unmount();
    const one = sheet(1);
    expect(screen.getByRole("button", { name: "Show 1 job" })).toBeTruthy();
    one.unmount();
    sheet(0);
    expect(screen.getByRole("button", { name: "No jobs match" })).toBeTruthy();
  });

  it("the count is exact only once the last page is in and that list is on screen", () => {
    expect(sheetResultCount({ listedCount: 20, listComplete: false, listOnScreen: true })).toBeNull();
    expect(sheetResultCount({ listedCount: 7, listComplete: true, listOnScreen: false })).toBeNull();
    expect(sheetResultCount({ listedCount: 7, listComplete: true, listOnScreen: true })).toBe(7);
    // The page wires it to the feed's own pagination, not to a server total.
    const dash = code("src/pages/home/Dashboard.tsx");
    expect(dash).toMatch(/resultCount=\{sheetResultCount\(\{ listedCount: filters\.filteredJobs\.length, listComplete: !hasNextPage, listOnScreen: !wantsQuotes/);
  });

  it("the primary closes the sheet; Clear all clears and is olive, never rust", () => {
    const onOpenChange = vi.fn();
    const onClearAll = vi.fn();
    sheet(null, { onOpenChange, onClearAll });
    expect(screen.getByRole("heading", { name: "Filter jobs" })).toBeTruthy();
    const clear = screen.getByRole("button", { name: "Clear all" });
    expect(clear.getAttribute("style") ?? "").not.toMatch(/burnt-sienna/);
    fireEvent.click(clear);
    expect(onClearAll).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: "Show jobs" }));
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });
});

describe("board 24: sections and defaults", () => {
  const noop = () => {};
  const sections = buildJobFilterSections({
    selectedCategory: null, setSelectedCategory: noop, sortBy: "smart", setSortBy: noop,
    minBudget: "", setMinBudget: noop, maxBudget: "", setMaxBudget: noop,
    jobWhen: "", setJobWhen: noop, expiresWithin: "", setExpiresWithin: noop,
    boostedOnly: false, setBoostedOnly: noop, urgentOnly: false, setUrgentOnly: noop,
    locationFilter: "", setLocationFilter: noop,
  });

  it("orders Sort, Price, Distance, When, Category, Show only (spec §3)", () => {
    expect(sections.map((s) => s.key)).toEqual(["sort", "price", "nearby", "when", "category", "show-only"]);
  });

  it("Distance starts on Any: no default radius, so no location prompt on open", () => {
    render(<MemoryRouter>{sections.find((s) => s.key === "nearby")!.content}</MemoryRouter>);
    expect(screen.getByRole("button", { name: "Any" }).getAttribute("aria-pressed")).toBe("true");
    for (const mi of [5, 10, 25, 50]) {
      const chip = screen.getByRole("button", { name: `${mi} mi` });
      expect(chip.getAttribute("aria-pressed")).toBe("false");
      // Five chips on one line at 375 (lead, board 24 r2): px-3, not the default px-4.
      expect(chip.className.split(/\s+/)).toContain("px-3");
    }
    expect(code("src/hooks/useDashboardFilters.ts")).toMatch(/const \[locationFilter, setLocationFilter\] = useState\(\(\) => param\("loc"\)\);/);
  });
});

describe("board 24: When is the job's day on every layer", () => {
  it("today and the next 7 days, inclusive; a job with no day is only 'Any time'", () => {
    const today = jobWhenRange("today", "2026-10-20");
    const week = jobWhenRange("next7", "2026-10-30");
    expect(today).toEqual({ from: "2026-10-20", to: "2026-10-20" });
    expect(week).toEqual({ from: "2026-10-30", to: "2026-11-05" });
    expect(jobMatchesWhen("2026-10-20", today)).toBe(true);
    expect(jobMatchesWhen("2026-10-21", today)).toBe(false);
    expect(jobMatchesWhen("2026-11-05", week)).toBe(true);
    expect(jobMatchesWhen("2026-11-06", week)).toBe(false);
    expect(jobMatchesWhen(null, week)).toBe(false);
    expect(jobMatchesWhen(null, jobWhenRange(""))).toBe(true);
  });

  it("the list filters on it", () => {
    expect(code("src/hooks/useDashboardFilters.ts")).toMatch(/if \(!jobMatchesWhen\(job\.date_needed, whenRange\)\) return false;/);
  });

  it("the server count bounds date_needed the same way", async () => {
    calls.list = [];
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
    const { result } = renderHook(() => useDashboardJobsCount({
      selectedCategory: null, searchQuery: "", minBudget: "", maxBudget: "", urgentOnly: false, boostedOnly: false,
      expiresWithin: "", jobWhen: "today", earlyAccessTier: null, appliedJobIds: [], blockedUserIds: [], dismissedJobIds: [],
      savedOnlyJobIds: null,
    }), { wrapper });
    await waitFor(() => expect(result.current.data).toBe(3));
    const range = jobWhenRange("today")!;
    expect(calls.list).toContainEqual(["gte", "date_needed", range.from]);
    expect(calls.list).toContainEqual(["lte", "date_needed", range.to]);
  });
});

describe("board 24: the Jobs toolbar mounts the sheet with its title and the page's exact count", () => {
  const noop = () => {};
  const filters = {
    filtersOpen: true, setFiltersOpen: vi.fn(), activeFilterCount: 0, clearFilters: noop,
    selectedCategory: null, setSelectedCategory: noop, locationFilter: "", setLocationFilter: noop,
    sortBy: "smart", setSortBy: noop, expiresWithin: "", setExpiresWithin: noop, jobWhen: "", setJobWhen: noop,
    minBudget: "", setMinBudget: noop, maxBudget: "", setMaxBudget: noop,
    matchAvailability: false, setMatchAvailability: noop, boostedOnly: false, setBoostedOnly: noop,
    urgentOnly: false, setUrgentOnly: noop, userLoc: { status: "idle" }, nearbyApproximate: false, nearbyUnavailable: false, nearbyApplied: false,
  } as unknown as BrowseTasksToolbarProps["filters"];

  // The toolbar loads its FilterSheet on demand (B47 10-31: off guest /browse's first paint), so the open sheet
  // arrives after one Suspense tick: find, not get.
  it("renders 'Filter jobs' with Price and When, and 'Show 4 jobs' from resultCount", async () => {
    render(
      <MemoryRouter>
        <BrowseTasksToolbar filters={filters} user={null} helperAvailability={[]} view="list" setView={noop} resultCount={4} />
      </MemoryRouter>,
    );
    expect(await screen.findByRole("heading", { name: "Filter jobs" })).toBeTruthy();
    expect(screen.getByRole("slider", { name: "Lowest price" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Next 7 days" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Show 4 jobs" }));
    expect(filters.setFiltersOpen).toHaveBeenCalledWith(false);
  });
});

describe("board 24, lead review 2026-10-20: lighter chips, a segmented View, muted 'Any price', a desktop modal", () => {
  const noop = () => {};
  const build = (minBudget: string) => buildJobFilterSections({
    selectedCategory: null, setSelectedCategory: noop, sortBy: "smart", setSortBy: noop,
    minBudget, setMinBudget: noop, maxBudget: "", setMaxBudget: noop,
    jobWhen: "", setJobWhen: noop, expiresWithin: "", setExpiresWithin: noop,
    boostedOnly: false, setBoostedOnly: noop, urgentOnly: false, setUrgentOnly: noop,
  });

  it("chips are the Declutter ChipGroup size (min-h-10, px-4, text-ds-13)", () => {
    render(<MemoryRouter>{build("").find((x) => x.key === "sort")!.content}</MemoryRouter>);
    const chip = screen.getByRole("button", { name: "Newest" });
    for (const c of ["min-h-10", "px-4", "text-ds-13"]) expect(chip.className.split(/\s+/)).toContain(c);
    expect(chip.className).not.toMatch(/\bh-11\b/);
  });

  it("'Any price' is muted ink; a real range is rust", () => {
    const { unmount } = render(<MemoryRouter>{build("").find((x) => x.key === "price")!.trailing}</MemoryRouter>);
    expect(screen.getByTestId("pay-range-value").textContent).toBe("Any price");
    expect(screen.getByTestId("pay-range-value").getAttribute("style") ?? "").not.toMatch(/burnt-sienna/);
    unmount();
    render(<MemoryRouter>{build("40").find((x) => x.key === "price")!.trailing}</MemoryRouter>);
    expect(screen.getByTestId("pay-range-value").textContent).toBe("$40+");
    expect(screen.getByTestId("pay-range-value").getAttribute("style") ?? "").toMatch(/burnt-sienna/);
  });

  it("View is the shared segmented control (a 'Feed view' radiogroup)", () => {
    const filters = {
      filtersOpen: true, setFiltersOpen: vi.fn(), activeFilterCount: 0, clearFilters: noop,
      selectedCategory: null, setSelectedCategory: noop, locationFilter: "", setLocationFilter: noop,
      sortBy: "smart", setSortBy: noop, expiresWithin: "", setExpiresWithin: noop, jobWhen: "", setJobWhen: noop,
      minBudget: "", setMinBudget: noop, maxBudget: "", setMaxBudget: noop,
      matchAvailability: false, setMatchAvailability: noop, boostedOnly: false, setBoostedOnly: noop,
      urgentOnly: false, setUrgentOnly: noop, userLoc: { status: "idle" }, nearbyApproximate: false, nearbyUnavailable: false, nearbyApplied: false,
    } as unknown as BrowseTasksToolbarProps["filters"];
    render(<MemoryRouter><BrowseTasksToolbar filters={filters} user={null} helperAvailability={[]} view="list" setView={noop} /></MemoryRouter>);
    const group = screen.getByRole("radiogroup", { name: "Feed view" });
    expect(group.querySelectorAll('[role="radio"]').length).toBe(2);
  });

  // Owner 2026-10-28 replaced the centred 520px modal with a small drop-down under the Filters button
  // (src/test/filterDropdownOnDesktop.test.tsx).
  it("desktop web opens the drop-down, phone the floor sheet", () => {
    calls.desktop = true;
    const { unmount } = sheet(null);
    const desk = screen.getByRole("dialog");
    expect(desk.hasAttribute("data-filter-dropdown")).toBe(true);
    expect(desk.className).not.toContain("sheet-floor");
    unmount();
    calls.desktop = false;
    sheet(null);
    expect(screen.getByRole("dialog").className).toContain("sheet-floor");
  });
});
