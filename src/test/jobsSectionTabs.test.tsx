/**
 * JOBS & POSTS (owner final decisions, 2026-10-19): the section OPENS ON
 * BROWSE, with a segmented toggle whose leftmost segment is always Browse and
 * whose labels are one word each — Browse | Posted | Working. Browse is the
 * existing feed, Posted/Working the existing lists. Old My Jobs deep links
 * (/jobs?job=, ?filter=, ?highlight=, ?q=) land on Working, not Browse. The
 * status boxes filter: tap one = only that group, tap it again = all groups.
 *
 * @mutate src/components/sections/sectionsConfig.ts | export const BROWSE = "browse" as const; | export const BROWSE = "posted" as const;
 * @mutate src/components/sections/SectionTabs.tsx |   const options = [{ value: BROWSE as string, label: tr("tabs.browse") }, ...tabs.map | const options = [...tabs.map
 * @mutate src/lib/i18n/enCore.ts |   "jobs.tabPosted": "Posted", |   "jobs.tabPosted": "Jobs I posted",
 * @mutate src/pages/jobs/JobsSection.tsx |   return MY_JOBS_LINK_PARAMS.some((k) => params.has(k)) ? "working" : "browse"; |   return "browse";
 * @mutate src/components/job-card/embeddedActivity.tsx |   return current === tapped ? "all" : tapped; |   return tapped;
 * @mutate src/components/sections/StatusBoxes.tsx | pressed={on} | pressed={false}
 * @mutate src/components/sections/StatusBoxes.tsx | {chip(ALL, "All", allCount ?? 0, value === null, () => { if (value !== null) onToggle(value); })} |
 * @mutate src/pages/home/useDetailJob.ts |         if (!next.has("tab")) next.set("tab", "browse"); |
 * @mutate src/pages/jobs/JobsSection.tsx |   const tab = params.get("tab") ? resolveJobsTab(params, picked) : openedOnLegacyLink ? "working" : "browse"; |   const tab = resolveJobsTab(params, picked);
 * @mutate src/components/job-card/embeddedActivity.tsx | label={tab === "posted" ? "Search posted jobs" | label={tab === "posted" ? "Search all sections"
 * @mutate src/pages/jobs/JobsSection.tsx | <SectionTabs label={tr("jobs.tabsLabel")} tabs={JOBS_TABS} value={tab} onChange={onTab} browseCount={browse?.count} /> | {null}
 */
import { describe, it, expect, vi, afterEach } from "vitest";
// The account's Customize row (useSectionPrefs, Q2199) is data, not what this spec measures: answered locally
// (no row yet, saves accepted); the device copy and the hook's own rules stay real.
vi.mock("@/lib/sectionPrefsRow", () => ({
  fetchSectionPrefsRow: async () => ({ data: null, error: null }),
  saveSectionPrefsRow: async () => ({ error: null }),
}));
import { render, renderHook, act, screen, cleanup, fireEvent, within } from "@testing-library/react";
import { useState, type ReactNode } from "react";
import { MemoryRouter, Routes, Route, useLocation } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { blankComments } from "./helpers/blankNonCode";
import { resultsPath } from "@/lib/savedSearches";

vi.mock("@/pages/home/Dashboard", () => ({
  default: ({ embeddedHeader }: { embeddedHeader: () => ReactNode }) => <div data-testid="feed">{embeddedHeader()}</div>,
}));
vi.mock("@/components/job-card/JobListPage", async (orig) => {
  const real = await orig<typeof import("@/components/job-card/JobListPage")>();
  return {
    ...real,
    default: ({ defaultTab, embeddedHeader }: { defaultTab: string; embeddedHeader: () => ReactNode }) => (
      <div data-testid={`list-${defaultTab}`}>{embeddedHeader()}</div>
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
// The "Preview" mark's read (useSectionTabs) stubbed as not loaded: no section is marked here (src/test/previewMark.test.tsx owns it).
vi.mock("@/components/landing/useSectionsOpen", async (orig) => ({ ...(await orig<object>()), useOpenToEveryoneAnswer: () => null }));
vi.mock("@/hooks/useFeature", () => ({ useFeature: () => false, useFeatureStatus: () => ({ on: false, settled: true }) }));
// The Browse | Posted | Working tabs row is the desktop website's; a phone reaches Posted and Working from "My Jobs"
// under the photo (the Vinted header, owner 11-08). Each test picks its width; phone by default.
const desktop = vi.hoisted(() => ({ on: false }));
vi.mock("@/hooks/useIsWebDesktop", () => ({ useIsWebDesktop: () => desktop.on }));

import JobsSection from "@/pages/jobs/JobsSection";
import { useDetailJob } from "@/pages/home/useDetailJob";
import type { EnrichedJob } from "@/components/dashboard/types";
import { nextBoxFilter, BOX_BUCKETS, EmbeddedActivityHeader } from "@/components/job-card/embeddedActivity";
import { StatusBoxes } from "@/components/sections/StatusBoxes";

function Where() {
  const l = useLocation();
  return <output data-testid="where">{l.pathname + l.search}</output>;
}
const open = (url: string) =>
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter initialEntries={[url]}>
        <Routes>
          <Route path="/jobs" element={<><JobsSection /><Where /></>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
const segments = () => within(screen.getByTestId("section-tabs")).getAllByRole("tab");

afterEach(() => { cleanup(); desktop.on = false; });

describe("one search bar per screen (owner 2026-10-21: two were stacked on Browse)", () => {
  it("no tab's header draws 'Search all sections': Browse's own 'Search jobs' row is its search, and Posted / Working carry their own list search as an icon beside the gear (owner 2026-10-25 / 2026-10-27 / 2026-10-31, src/test/jobsSearchIsAnIcon.test.tsx)", () => {
    let n = 0;
    for (const url of ["/jobs", "/jobs?tab=posted", "/jobs?tab=working"]) {
      open(url);
      expect(screen.queryByTestId("explore-search-entry"), url).toBeNull();
      n++;
      cleanup();
    }
    expect(n).toBe(3);
    desktop.on = true; // the icon beside the gear is the desktop tabs row's; a phone's is the bar's field (jobsSearchIsAnIcon)
    const { container } = render(<MemoryRouter><EmbeddedActivityHeader header={(row) => <div>{row?.end}</div>} tab="posted" statusFilter="all" counts={{ all: 1 }} onFilter={() => {}} search="" onSearch={() => {}} /></MemoryRouter>);
    expect(screen.queryByTestId("explore-search-entry")).toBeNull();
    const icon = container.querySelector<HTMLElement>("[data-jobs-search]")!;
    expect(icon.getAttribute("aria-label")).toBe("Search posted jobs");
    expect((icon.textContent ?? "").trim()).toBe("");
  });
});

describe("Jobs & Posts opens on Browse, Browse leftmost, one-word labels", () => {
  it("desktop website: a plain /jobs shows the feed with Browse selected and leftmost", () => {
    desktop.on = true;
    open("/jobs");
    expect(screen.getByTestId("feed")).toBeTruthy();
    const tabs = segments();
    expect(tabs.length).toBeGreaterThan(2);
    expect(tabs.map((t) => t.textContent?.trim())).toEqual(["Browse", "Posted", "Working"]);
    expect(tabs[0].getAttribute("aria-selected")).toBe("true");
    for (const t of tabs) expect((t.textContent ?? "").trim().split(/\s+/)).toHaveLength(1);
  });

  // F152 (owner audit 11-09: "Keep the three tabs visible on phone"): a plain /jobs opens on the feed (Browse) with
  // the Browse | Posted | Working tabs under the search row, Browse selected; no back row.
  it("phone: a plain /jobs shows the feed under the three tabs, Browse selected, and no back row (F152)", () => {
    open("/jobs");
    expect(screen.getByTestId("feed")).toBeTruthy();
    const tabs = segments();
    expect(tabs.map((t) => t.textContent?.trim())).toEqual(["Browse", "Posted", "Working"]);
    expect(tabs[0].getAttribute("aria-selected")).toBe("true");
    expect(screen.getByTestId("app-top-bar-search").compareDocumentPosition(screen.getByTestId("section-tabs")) & Node.DOCUMENT_POSITION_FOLLOWING, "the tabs under the search row").toBeTruthy();
    expect(document.querySelector("[data-section-list-back]")).toBeNull();
  });

  it("on a phone the bar is ONE row: 'Search jobs', the bell and the photo, 'Jobs' a hidden h1 (the compact top, owner 11-14); '+ Post a job' floats; Posted, Working and Jobs settings are in My Jobs", async () => {
    open("/jobs");
    const bar = screen.getByTestId("app-top-bar");
    const h1 = within(bar).getByRole("heading", { level: 1 });
    expect(h1.textContent).toBe("Jobs");
    expect(h1.className.split(/\s+/)).toContain("sr-only");
    const search = within(screen.getByTestId("app-top-bar-search")).getByRole("button", { name: "Search jobs" });
    expect(search.hasAttribute("data-section-search-bar")).toBe(true);
    expect(bar.contains(search)).toBe(true);
    const buttons = within(bar).getAllByRole("button");
    expect(buttons.map((b) => b.getAttribute("data-testid") ?? b.getAttribute("aria-label"))).toEqual(["Search jobs", expect.stringMatching(/^Notifications/), "top-bar-profile"]);
    expect(within(bar).queryByTestId("top-bar-messages")).toBeNull();
    expect(within(bar).queryByTestId("top-bar-create")).toBeNull();
    expect(within(bar).queryByTestId("explore-switcher")).toBeNull();
    const fab = screen.getByTestId("section-create-fab");
    expect(fab.textContent).toContain("Post a job");
    expect(bar.contains(fab)).toBe(false);
    fireEvent.click(within(bar).getByTestId("top-bar-profile"));
    const sheet = await screen.findByRole("dialog");
    expect(within(sheet).getAllByRole("link").map((r) => r.getAttribute("href"))).toEqual(["/jobs?tab=posted", "/jobs?tab=working", "/jobs/settings", "/profile"]);
  });

  // The lists are JobsSection's lazy chunk (B52): the first draw after a tab or link may be its loading frame.
  it("phone: tapping Posted shows the posted list with the three tabs still there, Posted selected; Browse brings the feed back (F152)", async () => {
    open("/jobs");
    fireEvent.click(segments()[1]);
    expect(await screen.findByTestId("list-posted")).toBeTruthy();
    expect(document.querySelector("[data-section-list-back]"), "no back row in place of the tabs").toBeNull();
    const tabs = segments();
    expect(tabs.map((t) => t.textContent?.trim())).toEqual(["Browse", "Posted", "Working"]);
    expect(tabs[1].getAttribute("aria-selected")).toBe("true");
    fireEvent.click(tabs[0]);
    expect(await screen.findByTestId("feed")).toBeTruthy();
  });

  it("desktop website: tapping Posted shows the posted list; Browse brings the feed back", async () => {
    desktop.on = true;
    open("/jobs");
    fireEvent.click(segments()[1]);
    expect(await screen.findByTestId("list-posted")).toBeTruthy();
    fireEvent.click(segments()[0]);
    expect(screen.getByTestId("feed")).toBeTruthy();
  });

  // AUD31-49: QUOTE_HOMES.myQuotes (/jobs?quotes=1, where Send quote and old /quotes?view=mine land) opened Browse,
  // where the sent quotes are not drawn. ?quotes= now names Working like the other My Jobs params.
  // @mutate src/pages/jobs/JobsSection.tsx | export const MY_JOBS_LINK_PARAMS = ["job", "filter", "highlight", "q", "quotes"] as const; | export const MY_JOBS_LINK_PARAMS = ["job", "filter", "highlight", "q"] as const;
  it.each(["/jobs?job=j-1", "/jobs?filter=done", "/jobs?highlight=a-1", "/jobs?q=fence", "/jobs?quotes=1"])("old My Jobs link %s lands on Working", async (url) => {
    open(url);
    expect(await screen.findByTestId("list-applied")).toBeTruthy();
    expect(screen.getByTestId("where").textContent).toContain("tab=working");
  });

  it("tapping a Browse card keeps Browse: the open job's URL names tab=browse, and that URL stays on the feed (run 4: it jumped to Working)", () => {
    const setSearchParams = vi.fn();
    const { result } = renderHook(() =>
      useDetailJob({ containerRef: { current: null }, searchParams: new URLSearchParams(), setSearchParams, allJobs: [] }),
    );
    act(() => result.current.openDetailJob({ id: "j-1" } as EnrichedJob));
    const update = setSearchParams.mock.calls[0][0] as (p: URLSearchParams) => URLSearchParams;
    const url = `/jobs?${update(new URLSearchParams()).toString()}`;
    expect(url).toBe("/jobs?job=j-1&tab=browse");
    open(url);
    expect(screen.getByTestId("feed")).toBeTruthy();
    expect(screen.queryByTestId("list-applied")).toBeNull();
  });

  it("typing in Browse's search (?q= written AFTER the section opened) stays on Browse (run 4: it jumped to Working)", async () => {
    const { useSearchParams } = await import("react-router-dom");
    function TypeInSearch() {
      const [, set] = useSearchParams();
      return <button type="button" onClick={() => set((p) => { const n = new URLSearchParams(p); n.set("q", "f"); return n; }, { replace: true })}>type</button>;
    }
    render(
      <MemoryRouter initialEntries={["/jobs"]}>
        <Routes>
          <Route path="/jobs" element={<><JobsSection /><TypeInSearch /><Where /></>} />
        </Routes>
      </MemoryRouter>,
    );
    fireEvent.click(screen.getByRole("button", { name: "type" }));
    expect(screen.getByTestId("where").textContent).toBe("/jobs?q=f");
    expect(screen.getByTestId("feed")).toBeTruthy();
    expect(screen.queryByTestId("list-applied")).toBeNull();
  });

  // Audit SS-1: a Jobs saved search with words opened Working and cleared its "new" count; Search's link was the same.
  // @mutate src/lib/savedSearches.ts |   return `/jobs?${new URLSearchParams([["tab", "browse"], ...p]).toString()}`; |   return `/jobs?${p.toString()}`;
  it.each([
    ["with words and filters", { query: "lawn", max_budget: 200, radius_miles: 25 }],
    ["with words only", { query: "lawn" }],
    ["with no words", { category: "yard_work" }],
  ])("a Jobs saved search %s opens Browse", (_n, s) => {
    open(resultsPath({ id: "s", name: "", section: "jobs", query: null, category: null, min_budget: null, max_budget: null, radius_miles: null, parish: null, location_keyword: null, notify_enabled: true, notify_email: true, last_seen_at: null, created_at: "", ...s }));
    expect(screen.getByTestId("feed")).toBeTruthy();
    expect(screen.queryByTestId("list-applied")).toBeNull();
  });

  // @mutate src/pages/search/SearchPage.tsx | <Link to={user ? `/jobs?tab=browse&${qs}` : `/browse?${qs}`} | <Link to={user ? `/jobs?${qs}` : `/browse?${qs}`}
  it("Search's See all in Jobs names its tab and opens Browse", () => {
    const src = blankComments(readFileSync(resolve(__dirname, "../pages/search/SearchPage.tsx"), "utf8"));
    const links = src.match(/\/jobs\?[^`"']*\$\{qs\}/g) ?? [];
    expect(links.length).toBeGreaterThan(0);
    for (const l of links) {
      open(l.replace("${qs}", "q=lawn"));
      expect(screen.getAllByTestId("feed").length).toBeGreaterThan(0);
      expect(screen.queryByTestId("list-applied")).toBeNull();
    }
  });

  it("/jobs?tab=posted (where /posts redirects) lands on Posted", async () => {
    open("/jobs?tab=posted&job=j-1");
    expect(await screen.findByTestId("list-posted")).toBeTruthy();
  });
});

describe("status chips filter: tap one = only that group, tap again or All = all", () => {
  it("the toggle rule", () => {
    expect(BOX_BUCKETS.length).toBeGreaterThan(3);
    expect(nextBoxFilter("all", "needs_you")).toBe("needs_you");
    expect(nextBoxFilter("needs_you", "needs_you")).toBe("all");
    expect(nextBoxFilter("needs_you", "done")).toBe("done");
  });

  it("the lit box is the chosen group, and tapping it again clears it", () => {
    function Harness() {
      const [f, setF] = useState("all");
      const value = (BOX_BUCKETS as readonly string[]).includes(f) ? (f as (typeof BOX_BUCKETS)[number]) : null;
      return <StatusBoxes boxes={BOX_BUCKETS.map((k) => ({ key: k, label: k, count: 1 }))} value={value} onToggle={(k) => setF(nextBoxFilter(f, k))} />;
    }
    render(<Harness />);
    const box = () => screen.getByRole("button", { name: /needs_you/ });
    expect(box().getAttribute("aria-pressed")).toBe("false");
    fireEvent.click(box());
    expect(box().getAttribute("aria-pressed")).toBe("true");
    // Boards 14/21: "All" leads the chip row and is unlit while a group is chosen.
    const all = () => screen.getByRole("button", { name: /^All/ });
    expect(all().getAttribute("aria-pressed")).toBe("false");
    fireEvent.click(box());
    expect(box().getAttribute("aria-pressed")).toBe("false");
    expect(all().getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(box());
    fireEvent.click(all());
    expect(box().getAttribute("aria-pressed")).toBe("false");
    expect(all().getAttribute("aria-pressed")).toBe("true");
  });
});
