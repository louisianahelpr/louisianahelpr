/**
 * JOBS & POSTS (owner final decisions, 2026-10-19): the section OPENS ON
 * BROWSE, with a segmented toggle whose leftmost segment is always Browse and
 * whose labels are one word each — Browse | Posted | Working. Browse is the
 * existing feed, Posted/Working the existing lists. Old My Jobs deep links
 * (/jobs?job=, ?filter=, ?highlight=, ?q=) land on Working, not Browse. The
 * status boxes filter: tap one = only that group, tap it again = all groups.
 *
 * @mutate src/components/sections/sectionsConfig.ts | export const BROWSE = "browse" as const; | export const BROWSE = "posted" as const;
 * @mutate src/components/sections/SectionTabs.tsx |   const options = [{ value: BROWSE as string, label: "Browse" }, ...tabs.map | const options = [...tabs.map
 * @mutate src/pages/jobs/JobsSection.tsx |   { value: "posted", label: "Posted" }, |   { value: "posted", label: "Jobs I posted" },
 * @mutate src/pages/jobs/JobsSection.tsx |   return MY_JOBS_LINK_PARAMS.some((k) => params.has(k)) ? "working" : "browse"; |   return "browse";
 * @mutate src/components/job-card/embeddedActivity.tsx |   return current === tapped ? "all" : tapped; |   return tapped;
 * @mutate src/components/sections/StatusBoxes.tsx | aria-pressed={on} | aria-pressed={false}
 * @mutate src/components/sections/StatusBoxes.tsx | {chip(ALL, "All", allCount ?? 0, value === null, () => { if (value !== null) onToggle(value); })} |
 * @mutate src/pages/home/useDetailJob.ts |         if (!next.has("tab")) next.set("tab", "browse"); |
 * @mutate src/pages/jobs/JobsSection.tsx |   const tab = params.get("tab") ? resolveJobsTab(params, picked) : openedOnLegacyLink ? "working" : "browse"; |   const tab = resolveJobsTab(params, picked);
 * @mutate src/pages/jobs/JobsSection.tsx |       {tab !== "browse" && <ExploreSearchEntry />} |       <ExploreSearchEntry />
 * @mutate src/pages/jobs/JobsSection.tsx |       {tab !== "browse" && <ExploreSearchEntry />} |       {tab === "browse" && <ExploreSearchEntry />}
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, renderHook, act, screen, cleanup, fireEvent, within } from "@testing-library/react";
import { useState, type ReactNode } from "react";
import { MemoryRouter, Routes, Route, useLocation } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

vi.mock("@/pages/home/Dashboard", () => ({
  default: ({ embeddedHeader }: { embeddedHeader?: ReactNode }) => <div data-testid="feed">{embeddedHeader}</div>,
}));
vi.mock("@/components/job-card/JobListPage", async (orig) => {
  const real = await orig<typeof import("@/components/job-card/JobListPage")>();
  return {
    ...real,
    default: ({ defaultTab, embeddedHeader }: { defaultTab: string; embeddedHeader?: ReactNode }) => (
      <div data-testid={`list-${defaultTab}`}>{embeddedHeader}</div>
    ),
  };
});
vi.mock("@/components/NotificationPanel", () => ({ default: () => <button type="button" aria-label="Notifications" /> }));
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

import JobsSection from "@/pages/jobs/JobsSection";
import { useDetailJob } from "@/pages/home/useDetailJob";
import type { EnrichedJob } from "@/components/dashboard/types";
import { nextBoxFilter, BOX_BUCKETS } from "@/components/job-card/embeddedActivity";
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

afterEach(cleanup);

describe("one search bar per screen (owner 2026-10-21: two were stacked on Browse)", () => {
  it("Browse has no 'Search all sections' (its own 'Search jobs' row is the search); Posted and Working, which have none, keep it", () => {
    open("/jobs");
    expect(screen.queryByTestId("explore-search-entry")).toBeNull();
    cleanup();
    for (const tab of ["posted", "working"]) {
      open(`/jobs?tab=${tab}`);
      expect(screen.getByTestId("explore-search-entry").textContent).toBe("Search all sections");
      cleanup();
    }
  });
});

describe("Jobs & Posts opens on Browse, Browse leftmost, one-word labels", () => {
  it("a plain /jobs shows the feed with Browse selected and leftmost", () => {
    open("/jobs");
    expect(screen.getByTestId("feed")).toBeTruthy();
    const tabs = segments();
    expect(tabs.length).toBeGreaterThan(2);
    expect(tabs.map((t) => t.textContent?.trim())).toEqual(["Browse", "Posted", "Working"]);
    expect(tabs[0].getAttribute("aria-selected")).toBe("true");
    for (const t of tabs) expect((t.textContent ?? "").trim().split(/\s+/)).toHaveLength(1);
  });

  it("on a phone the bar is Explore, the Jobs settings gear, the bell, then the profile avatar: no + (the bottom bar's center + creates, 2026-10-20; the gear is in the header, owner 2026-10-21)", () => {
    open("/jobs");
    const bar = screen.getByTestId("app-top-bar");
    expect(within(bar).getByRole("heading", { level: 1 }).textContent).toBe("Explore");
    const labels = within(bar).getAllByRole("button").map((b) => b.getAttribute("aria-label"));
    expect(labels).toEqual(["Jobs settings", "Notifications", "Profile"]);
    expect(within(screen.getByTestId("explore-switcher")).getByRole("radio", { name: "Jobs" }).getAttribute("aria-checked")).toBe("true");
  });

  it("tapping Posted shows the posted list; Browse brings the feed back", () => {
    open("/jobs");
    fireEvent.click(segments()[1]);
    expect(screen.getByTestId("list-posted")).toBeTruthy();
    fireEvent.click(segments()[0]);
    expect(screen.getByTestId("feed")).toBeTruthy();
  });

  it.each(["/jobs?job=j-1", "/jobs?filter=done", "/jobs?highlight=a-1", "/jobs?q=fence"])("old My Jobs link %s lands on Working", (url) => {
    open(url);
    expect(screen.getByTestId("list-applied")).toBeTruthy();
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

  it("/jobs?tab=posted (where /posts redirects) lands on Posted", () => {
    open("/jobs?tab=posted&job=j-1");
    expect(screen.getByTestId("list-posted")).toBeTruthy();
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
