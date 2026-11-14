/**
 * JOBS > POSTED / WORKING (owner 2026-10-25, screenshots of Browse / Posted / Working at 1440):
 *   "i prefer the search not expanded"  -> the search is an ICON at the end of the status chip row, exactly like
 *     Browse's "Search jobs" button (BrowseTasksActions: a 40px ghost square), never a full-width field;
 *   "polish these cards, kind of a lot of spacing" -> the Posted / Working card face is no looser than Browse's card
 *     (JOB_CARD_BODY: 14px sides), with a 44px thumb and 8px between face, tracker and button.
 *
 * JOBS > BROWSE ON A PHONE (owner 2026-10-28, ~900px window in phone mode: "search and filter should be next to
 * gear"): the separate "Search jobs" row is gone; a search ICON and Filters sit at the end of the tabs row before
 * the gear (the desktop's order), and the search opens in place, leftward, in that row (InlineListSearch). The
 * map stays reachable in the filter sheet's View choice (hideViewToggle is desktop-only).
 *
 * JOBS > POSTED / WORKING (owner 2026-10-31, Jobs > Posted at 375, LEAD-SEARCH-BY-GEAR: "move it up into the tab
 * row next to the gear"): their search icon left the end of the status chip row and ends the TABS row, right before
 * the gear, as Browse's does. The chip row has nothing at its end. Red on f551dd2746 (the icon was in the chip row).
 *
 * THE CLASS: every search control on the Jobs tabs (header + list header) is an icon, and the "mine" card face's
 * padding, thumb and gaps stay within Browse's measures. Red on 25fc6a8ef9: JobsSection drew the "Search all
 * sections" field under the tabs, and MineJobFace was p-4 with a 56px thumb.
 *
 * @mutate src/components/job-card/embeddedActivity.tsx | <InlineListSearch value={search} onChange={onSearch} label={tab === "posted" ? "Search posted jobs" : "Search jobs you're working"} onOpenChange={setSearchOpen} fill /> | {null}
 * @mutate src/components/sections/InlineListSearch.tsx |   const [open, setOpen] = useState(() => pinned \|\| value.trim().length > 0); |   const [open, setOpen] = useState(() => true);
 * @mutate src/pages/home/Dashboard.tsx |       filter={<BrowseFiltersButton filters={filters} filtersButtonRef={filtersButtonRef} />} /> | />\n      <BrowseFiltersButton filters={filters} filtersButtonRef={filtersButtonRef} />
 * @mutate src/pages/home/Dashboard.tsx | : { search: phoneBrowseSearch, chips: phoneBrowseChips }) | : undefined)
 * @mutate src/pages/home/Dashboard.tsx |     <SectionSearchBar noun="jobs" home="/jobs" value={filters.searchQuery} onChange={filters.setSearchQuery} |     <SectionSearchRow value={filters.searchQuery} onChange={filters.setSearchQuery} placeholder="Search jobs"
 * @mutate src/components/job-card/embeddedActivity.tsx | header(desktop ? { end: searchEnd } : { search: <SectionSearchBar | header(desktop ? {} : { search: <SectionSearchBar
 * @mutate src/components/job-card/embeddedActivity.tsx | : { search: <SectionSearchBar noun={tab === "posted" ? "posted jobs" : "jobs you're working"} home="/jobs" value={search} onChange={onSearch} /> }) | : { end: searchEnd })
 * @mutate src/pages/jobs/JobsSection.tsx | <JobListPage key={tab} defaultTab={list} embeddedHeader={makeHeader} /> | <JobListPage key={tab} defaultTab={list} embeddedHeader={makeHeader()} />
 * @mutate src/pages/jobs/JobsSection.tsx | <JobListPage key={tab} defaultTab={list} embeddedHeader={makeHeader} /> | <JobListPage key={tab} defaultTab={list} embeddedHeader={() => makeHeader()} />
 * @mutate src/components/sections/StatusBoxes.tsx |       {end}\n |
 * @mutate src/components/sections/StatusBoxes.tsx | "pl-1 pr-11 [mask-image:linear-gradient(to_right,#000_calc(100%-44px),transparent)]" | "pl-1 pr-11 [mask-image:linear-gradient(to_right,#000_calc(100%-20px),transparent)]"
 * @mutate src/components/sections/StatusBoxes.tsx | "pl-1 pr-11 [mask-image:linear-gradient(to_right,#000_calc(100%-44px),transparent)]" | "px-1 [mask-image:linear-gradient(to_right,#000_calc(100%-44px),transparent)]"
 * @mutate src/components/sections/StatusBoxes.tsx | "pl-1 pr-11 [mask-image:linear-gradient(to_right,#000_calc(100%-44px),transparent)]" | "pl-1 pr-11"
 * @mutate src/components/job-card/MineJobFace.tsx | className="flex flex-col px-3.5 py-3 md:flex-row | className="flex flex-col p-4 md:flex-row
 * @mutate src/components/job-card/MineJobFace.tsx | className="h-11 w-11 shrink-0 overflow-hidden rounded-xl" | className="h-14 w-14 shrink-0 overflow-hidden rounded-xl"
 * @mutate src/components/job-card/ActivityBucketGroups.tsx | <div className="flex flex-col gap-4" data-testid="activity-bucket-groups"> | <div className="flex flex-col gap-5" data-testid="activity-bucket-groups">
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, it, expect, vi, afterEach } from "vitest";
// The account's Customize row (useSectionPrefs, Q2199) is data, not what this spec measures: answered locally
// (no row yet, saves accepted); the device copy and the hook's own rules stay real.
vi.mock("@/lib/sectionPrefsRow", () => ({
  fetchSectionPrefsRow: async () => ({ data: null, error: null }),
  saveSectionPrefsRow: async () => ({ error: null }),
}));
import { render, cleanup, within, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { blankComments } from "@/test/helpers/blankNonCode";

vi.mock("@/pages/home/Dashboard", () => ({
  default: ({ embeddedHeader }: { embeddedHeader: (b?: { end?: ReactNode }) => ReactNode }) => <div data-testid="feed">{embeddedHeader()}</div>,
}));
// Posted / Working draw the REAL list header (EmbeddedActivityHeader), so the tabs row is the one JobsSection builds.
vi.mock("@/components/job-card/JobListPage", async () => {
  const { EmbeddedActivityHeader } = await vi.importActual<typeof import("@/components/job-card/embeddedActivity")>("@/components/job-card/embeddedActivity");
  return {
    default: ({ defaultTab, embeddedHeader }: { defaultTab: "posted" | "applied"; embeddedHeader: import("@/components/job-card/embeddedActivity").EmbeddedHeader }) => (
      <div data-testid={`list-${defaultTab}`}>
        <EmbeddedActivityHeader header={embeddedHeader} tab={defaultTab} statusFilter="all" counts={{ all: 3, needs_you: 1 }} onFilter={() => {}} search="" onSearch={() => {}} />
      </div>
    ),
  };
});
vi.mock("@/components/NotificationPanel", () => ({ default: () => <button type="button" aria-label="Notifications" /> }));
// The title bars draw NotificationBell, which swaps the panel in: the same stand-in.
vi.mock("@/components/notificationPanel/NotificationBell", () => ({ default: () => <button type="button" aria-label="Notifications" /> }));
vi.mock("@/hooks/useCurrentUser", () => ({
  useCurrentUser: () => ({ user: { id: "u-1" }, profile: { avatar_url: null, full_name: "Test Person" }, isLoading: false, isAdmin: false }),
}));
vi.mock("@/hooks/useAgeGate", () => ({
  useAgeGate: () => ({ underAge: false, explain: () => {}, gate: (_k: string, f: () => void) => f, gatedProps: () => ({}) }),
}));
vi.mock("@/lib/haptics", () => ({ hapticLight: () => {}, hapticMedium: () => {} }));
vi.mock("@/components/landing/useSectionsOpen", async (orig) => ({ ...(await orig<object>()), useOpenToEveryoneAnswer: () => null }));
vi.mock("@/hooks/useFeature", () => ({ useFeature: () => false, useFeatureStatus: () => ({ on: false, settled: true }) }));
// The icon-by-the-gear rule is the desktop website's (the tabs row); a phone's search is the top bar's field (the
// Vinted header, owner 11-08). Each test picks its width.
const desktop = vi.hoisted(() => ({ on: true }));
vi.mock("@/hooks/useIsWebDesktop", () => ({ useIsWebDesktop: () => desktop.on }));

import JobsSection from "@/pages/jobs/JobsSection";
import { EmbeddedActivityHeader } from "@/components/job-card/embeddedActivity";
import { StatusBoxes } from "@/components/sections/StatusBoxes";
import { InlineListSearch } from "@/components/sections/InlineListSearch";

afterEach(() => { cleanup(); desktop.on = true; });

const wrap = (ui: ReactNode, url = "/jobs") =>
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter initialEntries={[url]}>
        <Routes>
          <Route path="/jobs" element={ui} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );

/** A search control drawn as an expanded field: it shows words (a placeholder look-alike) instead of only a glyph. */
function expandedSearchFields(root: HTMLElement): HTMLElement[] {
  const all = [
    ...root.querySelectorAll<HTMLElement>('[data-testid="explore-search-entry"], [data-jobs-search]'),
    ...root.querySelectorAll<HTMLElement>('input[type="search"], [role="search"]'),
  ];
  return all.filter((el) => (el.textContent ?? "").trim() !== "" || el.tagName === "INPUT" || el.getAttribute("role") === "search");
}

describe("Jobs: the search is an icon, never an expanded field", () => {
  it("desktop website: no Jobs tab's header (above the list) draws an expanded search field", () => {
    let checked = 0;
    for (const tab of ["browse", "posted", "working"]) {
      const { container } = wrap(<JobsSection />, tab === "browse" ? "/jobs" : `/jobs?tab=${tab}`);
      expect(expandedSearchFields(container), `${tab}: expanded search field in the header`).toEqual([]);
      checked++;
      cleanup();
    }
    expect(checked).toBe(3);
  });

  for (const tab of ["posted", "working"] as const) {
    it(`${tab}: the search is a 40px icon at the END OF THE TABS ROW, right before the gear, never in the status chip row (owner 2026-10-31)`, async () => {
      const { container } = wrap(<JobsSection />, `/jobs?tab=${tab}`);
      // The lists are JobsSection's lazy chunk (B52): wait past its loading frame.
      await waitFor(() => expect(container.querySelector("[data-jobs-search]")).not.toBeNull());
      const icons = [...container.querySelectorAll<HTMLElement>("[data-jobs-search]")];
      expect(icons, "one search icon").toHaveLength(1);
      const icon = icons[0];
      expect(icon.getAttribute("aria-label")).toBe(tab === "posted" ? "Search posted jobs" : "Search jobs you're working");
      expect(icon.getAttribute("aria-expanded")).toBe("false");
      expect((icon.textContent ?? "").trim(), "the icon shows no words").toBe("");
      expect(icon.querySelector("svg"), "a glyph").not.toBeNull();
      expect(icon.className.split(/\s+/)).toEqual(expect.arrayContaining(["h-10", "w-10"]));
      const tabsRow = within(container).getByTestId("section-tabs");
      expect(tabsRow.contains(icon), "in the tabs row").toBe(true);
      expect(within(tabsRow).getByRole("tablist").contains(icon), "outside the tabs' own sideways scroll").toBe(false);
      // The control right after the search is the gear, and the gear is the row's last control.
      const box = icon.closest<HTMLElement>("[data-activity-search-controls]")!;
      expect(box, "the search's box").not.toBeNull();
      const gear = within(tabsRow).getByTestId("section-settings");
      expect(box.nextElementSibling).toBe(gear);
      expect(tabsRow.lastElementChild).toBe(gear);
      const chipRow = container.querySelector<HTMLElement>("[data-jobs-toolbar]")!;
      expect(chipRow, "the status chip row").not.toBeNull();
      expect(chipRow.querySelector("[data-jobs-search]"), "nothing searches from the chip row").toBeNull();
      expect(expandedSearchFields(container)).toEqual([]);
    });
  }

  // On a phone the tab's search is the rounded field ("Search posted jobs", owner 11-08), the top bar's one row since
  // the compact top (owner 11-14; F148 had put it in its own row under the bar), with the tabs row under it (F152); no
  // icon, and still nothing searches from the chip row or the tabs row.
  for (const tab of ["posted", "working"] as const) {
    it(`phone, ${tab}: the search is the field in the top bar, never an icon, never in the status chip row (owner 11-08, F148)`, async () => {
      desktop.on = false;
      const { container } = wrap(<JobsSection />, `/jobs?tab=${tab}`);
      await waitFor(() => expect(container.querySelector("[data-jobs-toolbar]")).not.toBeNull());
      const row = within(container).getByTestId("app-top-bar-search");
      expect(within(container).getByTestId("app-top-bar").contains(row), "the top bar's own row").toBe(true);
      const field = row.querySelector<HTMLElement>("[data-section-search-bar]");
      expect(field, "the bar's search").not.toBeNull();
      const label = tab === "posted" ? "Search posted jobs" : "Search jobs you're working";
      expect(field!.getAttribute("role")).toBe("search");
      expect(within(field!).getByRole("searchbox", { name: label })).toBeInTheDocument();
      expect(container.querySelectorAll("[data-section-search-bar]"), "one search").toHaveLength(1);
      expect(container.querySelector("[data-jobs-search]"), "no icon").toBeNull();
      expect(within(container).getByTestId("section-tabs").querySelector("[data-section-search-bar], [data-jobs-search]"), "no search in the tabs row").toBeNull();
      expect(container.querySelector("[data-jobs-toolbar]")!.querySelector("[data-section-search-bar], [data-jobs-search]")).toBeNull();
    });
  }

  // HELP-WORKIN (lead 10-31): the Jobs chip row now fades its right edge like Declutter's (AUD31-4), so a chip cut at
  // 360 reads as "more to scroll" (searchKeepsLitChip pins its widths). A row with neither `end` nor `fade` still draws none.
  it("with nothing at its end, the Jobs chip row fades its right edge (HELP-WORKIN); a plain StatusBoxes row does not", () => {
    const { container } = wrap(
      <EmbeddedActivityHeader header={() => <div />} tab="posted" statusFilter="all" counts={{ all: 3, needs_you: 1 }} onFilter={() => {}} search="" onSearch={() => {}} />,
    );
    const cls = within(container).getByRole("group", { name: "Filter by status" }).className;
    expect(cls).toContain("overflow-x-auto");
    expect(cls).toMatch(/\[mask-image:linear-gradient\(to_right,#000_calc\(100%-40px\),transparent\)\]/);
    expect(cls).not.toMatch(/pr-11/);
    cleanup();
    const plain = wrap(<StatusBoxes boxes={[{ key: "a", label: "Needs you", count: 1 }]} value={null} onToggle={() => {}} allCount={1} />);
    expect(within(plain.container).getByRole("group", { name: "Filter by status" }).className).not.toMatch(/mask-image|pr-1[01]/);
  });

  it("a status chip row that does carry an end control (StatusBoxes' `end`) fades over at least one icon width, and its end padding lets the last chip clear the fade", () => {
    const { container } = wrap(
      <StatusBoxes boxes={[{ key: "a", label: "Needs you", count: 1 }, { key: "b", label: "Waiting", count: 2 }]} value={null} onToggle={() => {}} allCount={3}
        end={<InlineListSearch value="" onChange={() => {}} label="Search posted jobs" />} />,
    );
    const icon = container.querySelector<HTMLElement>("[data-jobs-search]")!;
    expect(icon, "the end control is drawn").not.toBeNull();
    const chips = within(container).getByRole("group", { name: "Filter by status" });
    expect(chips.contains(icon)).toBe(false);
    expect(chips.parentElement?.contains(icon)).toBe(true);
    const iconPx = Math.max(...icon.className.split(/\s+/).map((c) => /^w-(\d+(?:\.\d+)?)$/.exec(c)).filter(Boolean).map((m) => px(m![1])));
    expect(iconPx).toBe(40);
    const cls = chips.className.split(/\s+/);
    const fade = cls.map((c) => /^\[mask-image:linear-gradient\(to_right,#000_calc\(100%-(\d+)px\),transparent\)\]$/.exec(c)).find(Boolean);
    expect(fade, "a right-edge fade on the scrolling chip row").toBeTruthy();
    const fadePx = Number(fade![1]);
    expect(fadePx, "the fade is at least one icon wide").toBeGreaterThanOrEqual(iconPx);
    expect(padOf(cls.filter((c) => !/^p[xl]-/.test(c)), "x"), "end padding >= the fade, so the last chip scrolls clear of it").toBeGreaterThanOrEqual(fadePx);
  });
});

// ── Card spacing: the mine card face is no looser than Browse's card ──────────────────────────────────────────
const read = (p: string) => blankComments(readFileSync(resolve(__dirname, "..", p), "utf8"));

describe("Jobs > Browse on a phone: the top bar's search field, with Filters inside it (owner 11-08, the Vinted header)", () => {
  const dash = read("pages/home/Dashboard.tsx");
  const phoneEnd = dash.slice(dash.indexOf("const phoneBrowseSearch = isWebDesktop ? undefined : ("), dash.indexOf("const embeddedTitle = ("));

  // Owner 2026-10-28 put search then Filters at the end of the tabs row; the Vinted header (owner 11-08) moved both
  // into the top bar: "Search jobs" is the bar's field and Filters sits inside its right end.
  it("Dashboard hands the phone bar the 'Search jobs' field with Filters inside it", () => {
    expect(phoneEnd.length).toBeGreaterThan(100);
    const search = phoneEnd.indexOf('<SectionSearchBar noun="jobs" home="/jobs" value={filters.searchQuery} onChange={filters.setSearchQuery}');
    const filtersAt = phoneEnd.indexOf("filter={<BrowseFiltersButton filters={filters} filtersButtonRef={filtersButtonRef} />}");
    expect(search, "the search field").toBeGreaterThan(-1);
    expect(filtersAt, "the Filters button, inside the field").toBeGreaterThan(search);
    expect(dash).toContain("embeddedHeader(isWebDesktop ? { end: desktopBrowseEnd, count: wantsQuotes || feedShowingLoadError ? undefined : headerCount } : { search: phoneBrowseSearch, chips: phoneBrowseChips })");
    // JobsSection draws what Browse hands it in the phone bar, and the desktop end controls BEFORE the gear
    // (profileIsAccountMoneyHelp renders the order).
    const jobs = read("pages/jobs/JobsSection.tsx");
    expect(jobs).toContain('search={browse?.search ?? <SectionSearchBar noun="jobs" home="/jobs" />} mine={mine} />');
    expect(jobs).toContain("end={<>{browse?.end}<SectionSettingsButton settings={JOBS_SETTINGS} /></>}");
  });

  it("no separate 'Search jobs' row and no always-open field on Browse", () => {
    expect(dash).not.toMatch(/SectionSearchRow|BrowseCompactSearchRow|data-jobs-toolbar/);
    expect(phoneEnd).not.toMatch(/<input|placeholder=/);
  });

  it("the map stays one tap away on a phone: the filter sheet's View choice is hidden on the desktop website only", () => {
    expect(dash).toContain("hideViewToggle={isWebDesktop}");
  });
});
/** Tailwind spacing token -> px (4px per unit; "3.5" -> 14). */
const px = (unit: string) => Number(unit) * 4;
function padOf(cls: string[], axis: "x" | "y"): number {
  let v = -1;
  for (const c of cls) {
    const m = /^p([xytblr]?)-(\d+(?:\.\d+)?)$/.exec(c);
    if (!m) continue;
    const side = m[1];
    if (side === "" || side === axis || (axis === "x" && (side === "l" || side === "r")) || (axis === "y" && (side === "t" || side === "b")))
      v = Math.max(v, px(m[2]));
  }
  return v;
}
function classOf(src: string, marker: string): string[] {
  const at = src.indexOf(marker);
  expect(at, marker).toBeGreaterThan(-1);
  const m = /className="([^"]*)"/.exec(src.slice(at, at + 400));
  expect(m, `className after ${marker}`).not.toBeNull();
  return m![1].split(/\s+/).filter((c) => !c.includes(":"));
}

describe("Posted / Working cards are as tight as Browse's", () => {
  const browseBody = /JOB_CARD_BODY = "([^"]*)"/.exec(read("components/job/cardGeometry.ts"))![1].split(/\s+/);
  const face = read("components/job-card/MineJobFace.tsx");

  it("the face's padding is no more than Browse's card body sides (14px) and 12px top/bottom", () => {
    const cls = classOf(face, 'data-mine-face=""');
    expect(cls.length).toBeGreaterThan(2);
    expect(padOf(browseBody, "x")).toBeGreaterThan(0);
    expect(padOf(cls, "x"), cls.join(" ")).toBeGreaterThan(0);
    expect(padOf(cls, "x"), cls.join(" ")).toBeLessThanOrEqual(padOf(browseBody, "x"));
    expect(padOf(cls, "y"), cls.join(" ")).toBeLessThanOrEqual(12);
  });

  it("the thumb is at most 44px, and the lines under it indent by exactly thumb + 12px", () => {
    const thumb = /className="h-(\d+(?:\.\d+)?) w-(\d+(?:\.\d+)?) shrink-0 overflow-hidden rounded-xl"/.exec(face);
    expect(thumb, "the thumb's class").not.toBeNull();
    const size = px(thumb![1]);
    expect(size).toBeGreaterThan(0);
    expect(size).toBeLessThanOrEqual(44);
    const indent = /pl-\[(\d+)px\] pt-1"/.exec(face);
    expect(indent, "the under-title indent").not.toBeNull();
    expect(Number(indent![1])).toBe(size + 12);
  });

  it("face -> tracker -> button gaps are 8px, and bucket groups sit 16px apart", () => {
    expect(face).toMatch(/className="order-2 pt-2 md:order-none/);
    // Measured 2026-11-05: three button rows, each 8px under the tracker: also, chip + primary (a proposed new day), the lone button.
    expect(face.match(/order-3 mt-2 /g)?.length).toBe(3);
    const groups = read("components/job-card/ActivityBucketGroups.tsx");
    expect(groups).toContain('<div className="flex flex-col gap-4" data-testid="activity-bucket-groups">');
  });
});
