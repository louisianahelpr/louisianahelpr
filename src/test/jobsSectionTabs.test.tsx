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
 * @mutate src/components/sections/StatusBoxes.tsx |               aria-pressed={on} |               aria-pressed={false}
 * @mutate src/pages/home/useDetailJob.ts |         if (!next.has("tab")) next.set("tab", "browse"); |
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, renderHook, act, screen, cleanup, fireEvent, within } from "@testing-library/react";
import { useState, type ReactNode } from "react";
import { MemoryRouter, Routes, Route, useLocation } from "react-router-dom";

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
    <MemoryRouter initialEntries={[url]}>
      <Routes>
        <Route path="/jobs" element={<><JobsSection /><Where /></>} />
      </Routes>
    </MemoryRouter>,
  );
const segments = () => within(screen.getByTestId("section-tabs")).getAllByRole("tab");

afterEach(cleanup);

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

  it("the section's own + is Post a job, then the bell, then the profile avatar", () => {
    open("/jobs");
    const bar = screen.getByTestId("app-top-bar");
    const labels = within(bar).getAllByRole("button").map((b) => b.getAttribute("aria-label"));
    expect(labels).toEqual(["Post a job", "Notifications", "Profile"]);
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

  it("/jobs?tab=posted (where /posts redirects) lands on Posted", () => {
    open("/jobs?tab=posted&job=j-1");
    expect(screen.getByTestId("list-posted")).toBeTruthy();
  });
});

describe("status boxes filter: tap one = only that group, tap again = all", () => {
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
    expect(screen.getByText(/tap it again to show all/)).toBeTruthy();
    fireEvent.click(box());
    expect(box().getAttribute("aria-pressed")).toBe("false");
  });
});
