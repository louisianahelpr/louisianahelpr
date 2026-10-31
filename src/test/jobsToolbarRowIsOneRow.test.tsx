/**
 * JOBS: THE ROW UNDER THE TABS IS ONE ROW, AND ITS SEARCH OPENS WHERE IT IS (owner, 2026-10-27, /jobs at 1440):
 *   - "search should just open where its at. not at the top but like open to the left of where it is":
 *     Posted / Working's search icon was a link to /search, a different page with its field at the top.
 *     It now opens IN PLACE (InlineListSearch): the field replaces the icon in the same row, growing
 *     leftward, takes focus, filters that tab's own list, and closes back into the icon on X, Escape, or
 *     blur while empty. (Browse's desktop field already opened in place, left of its held slot.)
 *   - "spacing for all of these should be the same, like 0 jobs and the line under should be the same size
 *     as the posted screen": Browse's "N jobs" row was 61px tall with a 16px inset and its hairline spanned
 *     the list column only (273-867 at 1440), Posted's chip row 46px with no inset and its hairline across the
 *     panel (272-1415); at 375 Browse's row was 40px, Posted's 46px. Every tab now draws the same row box
 *     (jobsToolbar.ts) and, on the desktop website, the same hairline box across the whole panel.
 * Then (owner, 2026-10-28, /jobs at 1440): "move the 1 next to browse and the search filter and map up onto the
 * other line above to save space": on the desktop website Browse has NO row of its own; its count sits beside
 * "Browse" and its search, filters and map at the tabs row's end. And on a PHONE (owner, 2026-10-28, ~900px window:
 * "search and filter should be next to gear"): no "Search jobs" row either; a search icon and Filters end the tabs
 * row before the gear (src/test/jobsSearchIsAnIcon.test.tsx).
 * Measured before/after with getBoundingClientRect at 375 and 1440: ~/.lh-shots/jobs-search-inline-1027/.
 *
 * @mutate src/components/sections/InlineListSearch.tsx |         onClick={() => setOpen(true)} |         onClick={() => {}}
 * @mutate src/components/sections/InlineListSearch.tsx |     if (open) inputRef.current?.focus(); |     if (open) void 0;
 * @mutate src/components/sections/InlineListSearch.tsx |     if (e.key === "Escape") { |     if (e.key === "Esc-never") {
 * @mutate src/components/sections/InlineListSearch.tsx |           if (!value.trim()) close(false, false); |           void value;
 * @mutate src/components/sections/InlineListSearch.tsx |     if (clear && value) onChange(""); |     void clear;
 * @mutate src/components/sections/jobsToolbar.ts | export const JOBS_TOOLBAR_ROW = "flex min-h-[46px] min-w-0 items-center gap-2"; | export const JOBS_TOOLBAR_ROW = "flex min-h-[40px] min-w-0 items-center gap-2 px-4";
 * @mutate src/pages/home/Dashboard.tsx | embeddedHeader(isWebDesktop ? { end: desktopBrowseEnd, count: wantsQuotes ? undefined : headerCount } : { end: phoneBrowseEnd, onlySelected: phoneSearchOpen }) | embeddedHeader(isWebDesktop ? undefined : { end: phoneBrowseEnd, onlySelected: phoneSearchOpen })
 * @mutate src/pages/home/Dashboard.tsx | : { end: phoneBrowseEnd, onlySelected: phoneSearchOpen })}\n    </div> | : { end: phoneBrowseEnd, onlySelected: phoneSearchOpen })}\n      {!isWebDesktop && <div data-jobs-toolbar="" className={JOBS_TOOLBAR_ROW}>search</div>}\n    </div>
 * @mutate src/components/job-card/embeddedActivity.tsx |       <div data-jobs-toolbar="" className={JOBS_TOOLBAR_ROW}> |       <div data-jobs-toolbar="" className="flex">
 * @mutate src/components/job-card/embeddedActivity.tsx | <InlineListSearch value={search} onChange={onSearch} | <InlineListSearch value="" onChange={() => {}}
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { useState, type ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { blankComments } from "./helpers/blankNonCode";
import { InlineListSearch } from "@/components/sections/InlineListSearch";
import { EmbeddedActivityHeader } from "@/components/job-card/embeddedActivity";
import { JOBS_TOOLBAR_LINE_CLASS, JOBS_TOOLBAR_LINE_STYLE, JOBS_TOOLBAR_ROW } from "@/components/sections/jobsToolbar";
import { CHIP } from "@/components/ui/chipClasses";

afterEach(cleanup);

const read = (rel: string) => blankComments(readFileSync(join(process.cwd(), rel), "utf8"));

function Row({ initial = "", spy }: { initial?: string; spy?: (v: string) => void }) {
  const [q, setQ] = useState(initial);
  return (
    <div data-testid="row" className="flex">
      <span data-testid="chips">chips</span>
      <InlineListSearch value={q} onChange={(v) => { spy?.(v); setQ(v); }} label="Search posted jobs" />
      <span data-testid="after">after</span>
    </div>
  );
}

/** The search control's index among its row's children: the field must take the icon's own place. */
const slot = () => [...screen.getByTestId("row").children].findIndex((el) => el.hasAttribute("data-jobs-search"));

describe("the search opens in place, focused, and closes back into its icon", () => {
  it("tap: the field takes the icon's place in the same row and has the focus", async () => {
    render(<Row />);
    const icon = screen.getByRole("button", { name: "Search posted jobs" });
    const at = slot();
    expect(at).toBe(1);
    await act(async () => fireEvent.click(icon));
    const field = screen.getByRole("searchbox", { name: "Search posted jobs" });
    expect(slot(), "same place in the row").toBe(at);
    expect(document.activeElement).toBe(field);
    // Nothing navigates: there is no link anywhere in the row.
    expect(screen.getByTestId("row").querySelector("a")).toBeNull();
  });

  it("typing filters (onChange); Escape closes and clears, and the focus returns to the icon", async () => {
    const spy = vi.fn();
    render(<Row spy={spy} />);
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Search posted jobs" })));
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "fence" } });
    expect(spy).toHaveBeenLastCalledWith("fence");
    await act(async () => fireEvent.keyDown(screen.getByRole("searchbox"), { key: "Escape" }));
    expect(screen.queryByRole("searchbox")).toBeNull();
    expect(spy).toHaveBeenLastCalledWith("");
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Search posted jobs" }));
  });

  it("the X closes and clears; blur closes only while empty", async () => {
    const spy = vi.fn();
    render(<Row spy={spy} />);
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Search posted jobs" })));
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "roof" } });
    await act(async () => fireEvent.blur(screen.getByRole("searchbox")));
    expect(screen.getByRole("searchbox"), "words in it: it stays open").toBeTruthy();
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Close search" })));
    expect(screen.queryByRole("searchbox")).toBeNull();
    expect(spy).toHaveBeenLastCalledWith("");
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Search posted jobs" })));
    await act(async () => fireEvent.blur(screen.getByRole("searchbox")));
    expect(screen.queryByRole("searchbox"), "empty: blur closes it").toBeNull();
  });

  it("a list that arrives filtered (?q=) shows its open field", () => {
    render(<Row initial="paint" />);
    expect((screen.getByRole("searchbox") as HTMLInputElement).value).toBe("paint");
  });

  it("Posted / Working: the icon beside the gear opens there, in the tabs row, and searches that tab's list (owner 2026-10-31)", async () => {
    const onSearch = vi.fn();
    const tabsRow = (row?: { end?: ReactNode }) => <div data-testid="tabs-row">{row?.end}<button type="button" aria-label="Jobs settings" /></div>;
    function Header() {
      const [q, setQ] = useState("");
      return <EmbeddedActivityHeader header={tabsRow} tab="applied" statusFilter="all" counts={{ all: 2 }} onFilter={() => {}} search={q} onSearch={(v) => { onSearch(v); setQ(v); }} />;
    }
    const { container } = render(<MemoryRouter><Header /></MemoryRouter>);
    const chips = screen.getByRole("group", { name: "Filter by status" });
    const row = container.querySelector<HTMLElement>("[data-jobs-toolbar]")!;
    expect(row.contains(chips)).toBe(true);
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Search jobs you're working" })));
    const field = screen.getByRole("searchbox", { name: "Search jobs you're working" });
    expect(screen.getByTestId("tabs-row").contains(field), "the field opens in the tabs row, where the icon was").toBe(true);
    expect(row.contains(field), "not in the chip row").toBe(false);
    expect(document.activeElement).toBe(field);
    fireEvent.change(field, { target: { value: "mow" } });
    expect(onSearch).toHaveBeenLastCalledWith("mow");
  });
});

describe("Browse, Posted and Working draw the same row box and the same hairline", () => {
  const dash = read("src/pages/home/Dashboard.tsx");
  const list = read("src/components/job-card/JobListPage.tsx");
  const head = read("src/components/job-card/embeddedActivity.tsx");

  it("the row is 46px (a 44px status chip + its scroller's 2px) with no side inset of its own", () => {
    const cls = JOBS_TOOLBAR_ROW.split(/\s+/);
    expect(CHIP.split(/\s+/)).toContain("min-h-11");
    expect(read("src/components/sections/StatusBoxes.tsx")).toMatch(/overflow-x-auto pb-0\.5/);
    expect(cls).toContain("min-h-[46px]");
    expect(cls.filter((c) => /^(p|px|pl|pr)-/.test(c))).toEqual([]);
  });

  it("Posted / Working draw that row; Browse draws no row of its own on any width (inventory)", () => {
    const sites = [dash, head].join("\n").match(/data-jobs-toolbar="" className=\{JOBS_TOOLBAR_ROW\}/g) ?? [];
    expect(sites.length).toBe(1);
    expect(dash.match(/data-jobs-toolbar=""/g) ?? []).toHaveLength(0);
    expect(head.match(/data-jobs-toolbar=""/g)?.length).toBe(1);
  });

  it("desktop: Browse draws no row of its own; count beside Browse, controls at the tabs row's end", () => {
    expect(dash).toContain("embeddedHeader(isWebDesktop ? { end: desktopBrowseEnd, count: wantsQuotes ? undefined : headerCount } : { end: phoneBrowseEnd, onlySelected: phoneSearchOpen })");
    expect(dash).not.toMatch(/JOBS_TOOLBAR_LINE_CLASS/);
    const jobs = read("src/pages/jobs/JobsSection.tsx");
    expect(jobs).toContain("browseCount={browse?.count}");
    // ...then the Jobs settings gear, last (owner 2026-10-28: "move gear down with the other icons").
    expect(jobs).toContain("end={<>{browse?.end}<SectionSettingsButton settings={JOBS_SETTINGS} /></>}");
    // Posted / Working keep their chip row: the literal box (jobsTabsStayPut reads it) wears the shared line.
    const at = list.indexOf("{isWebDesktop && (");
    const box = /className="([^"]*)"\s+style=\{\{ borderBottom: "([^"]*)" \}\}/.exec(list.slice(at, at + 400));
    expect(box, "JobListPage's desktop header box").not.toBeNull();
    expect(box![1]).toBe(JOBS_TOOLBAR_LINE_CLASS);
    expect(box![2]).toBe(JOBS_TOOLBAR_LINE_STYLE.borderBottom);
  });
});
