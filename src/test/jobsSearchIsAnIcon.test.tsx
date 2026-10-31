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
 * THE CLASS: every search control on the Jobs tabs (header + list header) is an icon, and the "mine" card face's
 * padding, thumb and gaps stay within Browse's measures. Red on 25fc6a8ef9: JobsSection drew the "Search all
 * sections" field under the tabs, and MineJobFace was p-4 with a 56px thumb.
 *
 * @mutate src/components/job-card/embeddedActivity.tsx | <InlineListSearch value={search} onChange={onSearch} label={tab === "posted" ? "Search posted jobs" : "Search jobs you're working"} onOpenChange={setSearchOpen} fill /> | {null}
 * @mutate src/components/sections/InlineListSearch.tsx |   const [open, setOpen] = useState(() => value.trim().length > 0); |   const [open, setOpen] = useState(() => true);
 * @mutate src/pages/home/Dashboard.tsx |       <InlineListSearch value={filters.searchQuery} onChange={filters.setSearchQuery} label="Search jobs" onOpenChange={setPhoneSearchOpen} fill />\n      {phoneSearchOpen && <SearchTriggerSlot width="40px" />}\n      <BrowseFiltersButton filters={filters} filtersButtonRef={filtersButtonRef} /> |       <BrowseFiltersButton filters={filters} filtersButtonRef={filtersButtonRef} />\n      <InlineListSearch value={filters.searchQuery} onChange={filters.setSearchQuery} label="Search jobs" onOpenChange={setPhoneSearchOpen} fill />
 * @mutate src/pages/home/Dashboard.tsx | : { end: phoneBrowseEnd, onlySelected: phoneSearchOpen }) | : undefined)
 * @mutate src/pages/home/Dashboard.tsx |       <InlineListSearch value={filters.searchQuery} onChange={filters.setSearchQuery} label="Search jobs" onOpenChange={setPhoneSearchOpen} fill /> |       <SectionSearchRow value={filters.searchQuery} onChange={filters.setSearchQuery} placeholder="Search jobs" />
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
import { render, cleanup, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { blankComments } from "@/test/helpers/blankNonCode";

vi.mock("@/pages/home/Dashboard", () => ({
  default: ({ embeddedHeader }: { embeddedHeader: (b?: { end?: ReactNode }) => ReactNode }) => <div data-testid="feed">{embeddedHeader()}</div>,
}));
vi.mock("@/components/job-card/JobListPage", () => ({
  default: ({ defaultTab, embeddedHeader }: { defaultTab: string; embeddedHeader?: ReactNode }) => (
    <div data-testid={`list-${defaultTab}`}>{embeddedHeader}</div>
  ),
}));
vi.mock("@/components/NotificationPanel", () => ({ default: () => <button type="button" aria-label="Notifications" /> }));
vi.mock("@/hooks/useCurrentUser", () => ({
  useCurrentUser: () => ({ user: { id: "u-1" }, profile: { avatar_url: null, full_name: "Test Person" }, isLoading: false, isAdmin: false }),
}));
vi.mock("@/hooks/useAgeGate", () => ({
  useAgeGate: () => ({ underAge: false, explain: () => {}, gate: (_k: string, f: () => void) => f, gatedProps: () => ({}) }),
}));
vi.mock("@/lib/haptics", () => ({ hapticLight: () => {}, hapticMedium: () => {} }));
vi.mock("@/components/landing/useSectionsOpen", async (orig) => ({ ...(await orig<object>()), useOpenToEveryoneAnswer: () => null }));
vi.mock("@/hooks/useFeature", () => ({ useFeature: () => false, useFeatureStatus: () => ({ on: false, settled: true }) }));

import JobsSection from "@/pages/jobs/JobsSection";
import { EmbeddedActivityHeader } from "@/components/job-card/embeddedActivity";

afterEach(cleanup);

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
  it("no Jobs tab's header (above the list) draws an expanded search field", () => {
    let checked = 0;
    for (const tab of ["browse", "posted", "working"]) {
      const { container } = wrap(<JobsSection />, tab === "browse" ? "/jobs" : `/jobs?tab=${tab}`);
      expect(expandedSearchFields(container), `${tab}: expanded search field in the header`).toEqual([]);
      checked++;
      cleanup();
    }
    expect(checked).toBe(3);
  });

  for (const tab of ["posted", "applied"] as const) {
    it(`${tab}: the list header carries its search as a 40px icon at the end of the status chip row (it opens in place: jobsToolbarRowIsOneRow)`, () => {
      const { container } = wrap(
        <EmbeddedActivityHeader header={<div />} tab={tab} statusFilter="all" counts={{ all: 3, needs_you: 1 }} onFilter={() => {}} search="" onSearch={() => {}} />,
      );
      const link = container.querySelector<HTMLElement>("[data-jobs-search]")!;
      expect(link, "the search icon").not.toBeNull();
      expect(link.getAttribute("aria-label")).toBe(tab === "posted" ? "Search posted jobs" : "Search jobs you're working");
      expect(link.getAttribute("aria-expanded")).toBe("false");
      expect((link.textContent ?? "").trim(), "the icon shows no words").toBe("");
      expect(link.querySelector("svg"), "a glyph").not.toBeNull();
      expect(link.className.split(/\s+/)).toEqual(expect.arrayContaining(["h-10", "w-10"]));
      // Same row as the chips, outside their sideways scroll (so it never scrolls away).
      const chips = within(container).getByRole("group", { name: "Filter by status" });
      expect(chips.contains(link)).toBe(false);
      expect(chips.parentElement?.contains(link)).toBe(true);
      expect(expandedSearchFields(container)).toEqual([]);
    });

    it(`${tab}: no chip looks clipped by the icon: the row fades over at least one icon width, and its end padding lets the last chip clear the fade`, () => {
      const { container } = wrap(
        <EmbeddedActivityHeader header={<div />} tab={tab} statusFilter="all" counts={{ all: 3, needs_you: 1 }} onFilter={() => {}} search="" onSearch={() => {}} />,
      );
      const icon = container.querySelector<HTMLElement>("[data-jobs-search]")!;
      const iconPx = Math.max(...icon.className.split(/\s+/).map((c) => /^w-(\d+(?:\.\d+)?)$/.exec(c)).filter(Boolean).map((m) => px(m![1])));
      expect(iconPx).toBe(40);
      const cls = within(container).getByRole("group", { name: "Filter by status" }).className.split(/\s+/);
      const fade = cls.map((c) => /^\[mask-image:linear-gradient\(to_right,#000_calc\(100%-(\d+)px\),transparent\)\]$/.exec(c)).find(Boolean);
      expect(fade, "a right-edge fade on the scrolling chip row").toBeTruthy();
      const fadePx = Number(fade![1]);
      expect(fadePx, "the fade is at least one icon wide").toBeGreaterThanOrEqual(iconPx);
      expect(padOf(cls.filter((c) => !/^p[xl]-/.test(c)), "x"), "end padding >= the fade, so the last chip scrolls clear of it").toBeGreaterThanOrEqual(fadePx);
    });
  }
});

// ── Card spacing: the mine card face is no looser than Browse's card ──────────────────────────────────────────
const read = (p: string) => blankComments(readFileSync(resolve(__dirname, "..", p), "utf8"));

describe("Jobs > Browse on a phone: search and filters end the tabs row, before the gear (owner 2026-10-28)", () => {
  const dash = read("pages/home/Dashboard.tsx");
  const phoneEnd = dash.slice(dash.indexOf("const phoneBrowseEnd = isWebDesktop ? undefined : ("), dash.indexOf("const embeddedTitle = ("));

  it("Dashboard hands the tabs row, on a phone, the search ICON (opens in place) then Filters", () => {
    expect(phoneEnd.length).toBeGreaterThan(100);
    const search = phoneEnd.indexOf('<InlineListSearch value={filters.searchQuery} onChange={filters.setSearchQuery} label="Search jobs" onOpenChange={setPhoneSearchOpen} fill />');
    const filtersAt = phoneEnd.indexOf("<BrowseFiltersButton filters={filters} filtersButtonRef={filtersButtonRef} />");
    expect(search, "the search icon").toBeGreaterThan(-1);
    expect(filtersAt, "the Filters button").toBeGreaterThan(search);
    expect(dash).toContain("embeddedHeader(isWebDesktop ? { end: desktopBrowseEnd, count: wantsQuotes ? undefined : headerCount } : { end: phoneBrowseEnd, onlySelected: phoneSearchOpen })");
    // JobsSection puts whatever Browse hands it BEFORE the gear (profileIsAccountMoneyHelp renders the order).
    expect(read("pages/jobs/JobsSection.tsx")).toContain("end={<>{browse?.end}<SectionSettingsButton settings={JOBS_SETTINGS} /></>}");
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
    expect(face.match(/order-3 mt-2 /g)?.length).toBe(2);
    const groups = read("components/job-card/ActivityBucketGroups.tsx");
    expect(groups).toContain('<div className="flex flex-col gap-4" data-testid="activity-bucket-groups">');
  });
});
