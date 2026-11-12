/*
 * THE JOBS PLACEHOLDER RESERVES EXACTLY WHAT THE LOADED SCREEN SHOWS.
 *
 * Re-pointed 2026-10-19 (Q2205). This file pinned the old My Posts / My Jobs
 * placeholder (ActivityPageSkeleton): it reserved the phone tab row only when
 * the loaded header would show it, and drew the loaded header row itself, so
 * no card jumped when the data landed (owner, 2026-09-25; VN-32). Those
 * screens became Jobs > Posted / Working, and the /jobs route fallback is now
 * the Jobs-section silhouette (JobsSectionSkeleton). Same promise, new rows:
 *   - the frame matches the tab the URL will open on (Browse: no search row
 *     since owner 2026-10-28, its search is an icon in the tabs row;
 *     Posted / Working: the four status boxes; /posts lands on Posted; an old
 *     My Jobs link such as /jobs?filter= lands on Working);
 *   - the header is the loaded header's shape: on a phone the search bar with
 *     the bell and the profile (the Vinted header, owner 11-08), no tabs row,
 *     and Posted / Working's back row; on the desktop website the real title in the bar
 *     (src/test/sectionLoadingHeaderIsSettled.test.tsx);
 *   - ONE h1 while pending.
 *
 * Q1695 (loading-states refresh 2026-11-02 01:07Z: /posts row 623 -> 641, +18px, both test accounts): the status
 * row's bones are the loaded chips' row (JOBS_TOOLBAR_ROW, 44px chips), not the old 64px tiles.
 * @mutate src/components/JobsSectionSkeleton.tsx | <Skeleton key={i} data-status-chip-bone="" className={`h-11 ${w} shrink-0 rounded-full`} /> | <Skeleton key={i} data-status-chip-bone="" className={`h-16 ${w} shrink-0 rounded-2xl`} />
 * @mutate src/components/JobsSectionSkeleton.tsx |     <div data-jobs-toolbar="" className={JOBS_TOOLBAR_ROW} aria-hidden> |     <div data-jobs-toolbar="" className="grid gap-2 grid-cols-4" aria-hidden>
 * @mutate src/components/JobsSectionSkeleton.tsx |   if (window.location.pathname.startsWith("/posts")) return "posted"; |
 * @mutate src/components/JobsSectionSkeleton.tsx |       {header}\n      <StatusBoxBones />\n | {header}\n
 * @mutate src/components/JobsSectionSkeleton.tsx |       titleCard={header} | titleCard={<div className="flex flex-col gap-4">{header}<Skeleton className="h-10 w-full rounded-full" aria-hidden /></div>}
 * @mutate src/components/JobsSectionSkeleton.tsx |       {!titleInBar && <h1 className="sr-only">Jobs</h1>} |
 * @mutate src/components/JobsSectionSkeleton.tsx |               <Skeleton className="h-11 w-full rounded-full" />\n |
 * @mutate src/components/JobsSectionSkeleton.tsx |       <Skeleton className="h-11 w-full rounded-ds-md" /> |       {desktop && <Skeleton className="h-11 w-full rounded-ds-md" />}
 * @mutate src/components/JobsSectionSkeleton.tsx |           <div className="app-top-bar flex items-center justify-between gap-2 h-16"> |           <div className="app-top-bar flex items-center justify-between gap-2 h-12">
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, cleanup } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

vi.mock("@/hooks/useIsWebDesktop", () => ({ useIsWebDesktop: () => false }));

import { JOBS_TOOLBAR_ROW } from "@/components/sections/jobsToolbar";
import { CHIP } from "@/components/ui/chipClasses";
import JobsSectionSkeleton from "@/components/JobsSectionSkeleton";

afterEach(() => {
  cleanup();
  window.history.replaceState(null, "", "/");
});

function at(url: string) {
  window.history.replaceState(null, "", url);
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <MemoryRouter>
        <JobsSectionSkeleton />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

/** The status-chip bones (StatusBoxBones, Q1695: one 46px row of four 44px chip bones, the loaded chips' row). */
const statusBoxes = (c: HTMLElement) => c.querySelectorAll("[data-jobs-toolbar] [data-status-chip-bone].h-11").length;
/** The old phone "Search jobs" row's h-10 pill (gone since owner 2026-10-28): no frame draws it. */
const searchRow = (c: HTMLElement) => c.querySelectorAll(".h-10.w-full.rounded-full").length;

describe("the /jobs placeholder draws the tab the URL opens on", () => {
  it.each([
    ["/jobs", "browse"],
    ["/jobs?tab=posted", "list"],
    ["/jobs?tab=working", "list"],
    ["/posts", "list"],
    ["/posts?filter=done", "list"],
    ["/jobs?filter=needs_you", "list"],
    ["/jobs?job=abc", "list"],
    ["/jobs?tab=nonsense", "browse"],
  ] as const)("%s -> %s frame", (url, frame) => {
    const { container } = at(url);
    expect(statusBoxes(container), "status boxes").toBe(frame === "list" ? 4 : 0);
    expect(searchRow(container), "no Browse search row").toBe(0);
  });
});

describe("the placeholder's header is the loaded header's shape", () => {
  it.each(["/jobs", "/jobs?tab=posted", "/jobs?tab=working"] as const)("%s: the phone header's top row (the title, then the bell and the photo), the search row under it, the tabs row under that, no back row, and a single h1", (url) => {
    // One pattern (owner UI audit F148, 11-09): on a phone the top row is the title, then the bell and the photo, 64px
    // (AppTopBar's own h-16 row), and the section's search is its own 44px row right under it (app-top-bar-search,
    // pb-2). No "+" (it floats: SectionCreateFab). The Browse | Posted | Working tabs stay under the search on every
    // tab (F152, owner audit 11-09), so every frame draws their 44px row and none draws a back row.
    const { container } = at(url);
    const bar = container.querySelector(".app-top-bar.h-16");
    expect(bar, "the top row's own h-16 box").not.toBeNull();
    expect(bar!.querySelectorAll(".explore-switcher-bone"), "no chips' bone").toHaveLength(0);
    expect(bar!.querySelectorAll(".rounded-full.h-11"), "no search bar's bone in the bar").toHaveLength(0);
    expect(bar!.firstElementChild?.nextElementSibling?.className, "the title's bone first").toMatch(/\bh-7\b/);
    expect(bar!.lastElementChild?.children.length, "the bell, the photo").toBe(2);
    const row = bar!.nextElementSibling;
    expect(row?.className, "the search row under the bar, 2px under it (owner 11-12, browseHeaderSpacing)").toBe("pb-0.5 min-w-0");
    expect(row!.querySelectorAll(".h-11.w-full.rounded-full"), "the search bar's bone").toHaveLength(1);
    expect(container.querySelectorAll(".h-11.w-full.rounded-ds-md"), "the tabs row on a phone").toHaveLength(1);
    expect(row!.nextElementSibling?.className, "the tabs row right under the search").toContain("h-11 w-full rounded-ds-md");
    expect(container.querySelectorAll("[data-list-back-bone]"), "no back row").toHaveLength(0);
    expect(container.querySelectorAll("h1")).toHaveLength(1);
  });
});

describe("Q1695: the status row's bones are the loaded chips' row", () => {
  it("one JOBS_TOOLBAR_ROW row of 44px chip bones, the height the loaded StatusBoxes chips take (CHIP min-h-11)", () => {
    const { container } = at("/posts");
    const row = container.querySelector("[data-jobs-toolbar]");
    expect(row).not.toBeNull();
    expect(row!.className).toBe(`${JOBS_TOOLBAR_ROW}`);
    const bones = [...row!.querySelectorAll("[data-status-chip-bone]")];
    expect(bones.length).toBe(4);
    for (const b of bones) expect(b.className.split(/\s+/)).toContain("h-11");
    expect(CHIP.split(/\s+/)).toContain("min-h-11");
    // No old 64px status tile anywhere (the top bar's own h-16 row is AppTopBar's, nav redesign 2026-11-06).
    expect(container.querySelectorAll(".h-16:not(.app-top-bar)").length).toBe(0);
  });
});
