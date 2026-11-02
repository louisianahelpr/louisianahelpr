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
 *   - the header is the loaded header's shape: on a phone the chips row with
 *     the bell and the profile (no "+" since owner 2026-10-28), then the tab
 *     toggle; on the desktop website the real title in the bar
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
  it.each(["/jobs", "/jobs?tab=posted"])("%s: the phone Explore header's top row (chips, bell, photo), the tabs row, and a single h1", (url) => {
    // The Explore header (owner, 2026-10-22): on a phone the top row is the section chips with the bell and the
    // photo, 48px (no "+", owner 2026-10-28). Then the thin underline tabs, 44px.
    const { container } = at(url);
    const bar = container.querySelector(".app-top-bar.h-12");
    expect(bar, "the top row's own h-12 box").not.toBeNull();
    expect(bar!.querySelectorAll(".explore-switcher-bone"), "the chips' bone").toHaveLength(1);
    expect(bar!.querySelectorAll(".top-bar-add-bone, .top-bar-title-bone"), "no + or title bone (phone)").toHaveLength(0);
    expect(bar!.querySelectorAll(":scope > span"), "the bell and the photo").toHaveLength(2);
    expect(container.querySelectorAll(".h-11.w-full"), "the 44px tabs row").toHaveLength(1);
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
    expect(container.querySelectorAll(".h-16").length).toBe(0);
  });
});
