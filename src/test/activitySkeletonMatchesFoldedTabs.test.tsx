/*
 * THE JOBS PLACEHOLDER RESERVES EXACTLY WHAT THE LOADED SCREEN SHOWS.
 *
 * Re-pointed 2026-10-19 (Q2205). This file pinned the old My Posts / My Jobs
 * placeholder (ActivityPageSkeleton): it reserved the phone tab row only when
 * the loaded header would show it, and drew the loaded header row itself, so
 * no card jumped when the data landed (owner, 2026-09-25; VN-32). Those
 * screens became Jobs > Posted / Working, and the /jobs route fallback is now
 * the Jobs-section silhouette (JobsSectionSkeleton). Same promise, new rows:
 *   - the frame matches the tab the URL will open on (Browse: the search row;
 *     Posted / Working: the four status boxes; /posts lands on Posted; an old
 *     My Jobs link such as /jobs?filter= lands on Working);
 *   - the header is the loaded header's shape: top bar with its three
 *     controls (+, bell, profile), then the tab toggle;
 *   - ONE h1 while pending.
 *
 * @mutate src/components/JobsSectionSkeleton.tsx |   if (window.location.pathname.startsWith("/posts")) return "posted"; |
 * @mutate src/components/JobsSectionSkeleton.tsx |       {header}\n      <StatusBoxBones />\n | {header}\n
 * @mutate src/components/JobsSectionSkeleton.tsx | {!isWebDesktop && <Skeleton className="h-10 w-full rounded-full" aria-hidden />} | {null}
 * @mutate src/components/JobsSectionSkeleton.tsx |       <h1 className="sr-only">Jobs</h1>\n |
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, cleanup } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

vi.mock("@/hooks/useIsWebDesktop", () => ({ useIsWebDesktop: () => false }));

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

/** The four status-box bones (StatusBoxBones: a 4-column grid of h-16 bones). */
const statusBoxes = (c: HTMLElement) => c.querySelectorAll(".grid.grid-cols-4 > .h-16").length;
/** BrowseCompactSearchRow's one h-10 pill. */
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
    expect(searchRow(container), "Browse search row").toBe(frame === "browse" ? 1 : 0);
  });
});

describe("the placeholder's header is the loaded header's shape", () => {
  it.each(["/jobs", "/jobs?tab=posted"])("%s: top bar with three controls, the tab toggle, and a single h1", (url) => {
    const { container } = at(url);
    const bar = container.querySelector(".app-top-bar.h-16");
    expect(bar, "the top bar's own h-16 box").not.toBeNull();
    // title bone + one cluster holding +, bell, profile
    expect(bar!.children).toHaveLength(2);
    expect(bar!.lastElementChild!.children).toHaveLength(3);
    expect(container.querySelectorAll(".h-12.w-full.rounded-full"), "the 48px tab toggle").toHaveLength(1);
    expect(container.querySelectorAll("h1")).toHaveLength(1);
  });
});
