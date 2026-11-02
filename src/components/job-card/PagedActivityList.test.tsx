/**
 * Q372 (owner, 2026-09-24): each Activity section shows 50 cards, then a
 * "Show older" button reveals the next 50. The largest account held 202
 * posted jobs, all rendered at once.
 */
// @mutate src/components/job-card/PagedActivityList.tsx | export const ACTIVITY_PAGE_SIZE = 50; | export const ACTIVITY_PAGE_SIZE = 5000;
// @mutate src/components/job-card/PagedActivityList.tsx | setShown((n) => n + ACTIVITY_PAGE_SIZE) | setShown((n) => n)
// @mutate src/components/job-card/PagedActivityList.tsx | {items.length > shown && ( | {false && (
// @mutate src/pages/posts/PostedJobsTab.tsx | <PagedActivityList items={visibleJobs} | <PagedActivityList items={visibleJobs.slice(0)}
// @mutate src/pages/jobs/AppliedJobsTab.tsx | <PagedActivityList items={apps} | <PagedActivityList items={apps.slice(0)}
// @mutate src/components/job-card/PagedActivityList.tsx | onHiddenChange?.(hidden); | onHiddenChange?.(0);
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { blankComments } from "@/test/helpers/blankNonCode";
import { ACTIVITY_PAGE_SIZE, PagedActivityList } from "./PagedActivityList";

// The sectioned view these cases used to mount (ActivitySectionedView) had no app caller since Q2215 and was
// removed (Q2227); the lists page through PagedActivityList directly (PostedJobsTab, AppliedJobsTab).
type Item = { id: string; bucket: "active" | "completed" | "cancelled" };
const make = (n: number, bucket: Item["bucket"]): Item[] =>
  Array.from({ length: n }, (_, i) => ({ id: `${bucket}-${i}`, bucket }));

function setup(items: Item[], onHiddenChange?: (n: number) => void) {
  return render(
    <PagedActivityList<Item>
      items={items}
      getKey={(i) => i.id}
      renderItem={(i) => <span data-testid="card">{i.id}</span>}
      onHiddenChange={onHiddenChange}
    />,
  );
}

describe("Activity lists page at 50 with Show older", () => {
  it("is 50", () => expect(ACTIVITY_PAGE_SIZE).toBe(50));

  it("shows 50 of 120, then 100, then all, and the button goes away", () => {
    setup(make(120, "completed"));
    expect(screen.getAllByTestId("card")).toHaveLength(50);
    expect(screen.getByText("completed-49")).toBeTruthy();
    expect(screen.queryByText("completed-50")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /Show older/ }));
    expect(screen.getAllByTestId("card")).toHaveLength(100);
    fireEvent.click(screen.getByRole("button", { name: /Show older/ }));
    expect(screen.getAllByTestId("card")).toHaveLength(120);
    expect(screen.queryByRole("button", { name: /Show older/ })).toBeNull();
  });

  it("shows no button at 50 or fewer, and says how many of how many when there are more", () => {
    const { unmount } = setup(make(50, "active"));
    expect(screen.getAllByTestId("card")).toHaveLength(50);
    expect(screen.queryByRole("button", { name: /Show older/ })).toBeNull();
    unmount();
    setup(make(51, "cancelled"));
    expect(screen.getByRole("button", { name: /Show older/ }).textContent).toContain("(50 of 51)");
  });

  it("the flat single-status lists on both tabs page through the same component", () => {
    for (const [f, v] of [["PostedJobsTab", "visibleJobs"], ["AppliedJobsTab", "apps"]]) {
      const src = readFileSync(join(__dirname, "..", "..", "pages", f === "PostedJobsTab" ? "posts" : "jobs", `${f}.tsx`), "utf8");
      expect(src, `${f} flat list`).toMatch(new RegExp(`<PagedActivityList items=\\{${v}\\} getKey=\\{\\(\\w+\\) => \\w+\\.id\\} renderItem=\\{\\w+\\}`));
      expect(src, `${f} renders its cards outside the pager`).not.toMatch(new RegExp(`\\{${v}\\.map\\(`));
    }
  });

  it("reports how many cards are hidden", () => {
    const seen = vi.fn();
    setup(make(70, "completed"), seen);
    expect(seen).toHaveBeenLastCalledWith(20);
    fireEvent.click(screen.getByRole("button", { name: /Show older/ }));
    expect(seen).toHaveBeenLastCalledWith(0);
  });

  it("the Posted tab's end-of-list line never says \"that's everything\" (it is gone: J6, src/test/postedListNoDuplicateTail.test.tsx)", () => {
    // Q372 kept the line from claiming "everything" while cards were behind
    // "Show older". J6 (Cowork audit 2026-10-20) removed the line altogether:
    // it restated the status boxes. Nothing in the tab says it any more.
    const src = readFileSync(join(__dirname, "..", "..", "pages", "posts", "PostedJobsTab.tsx"), "utf8");
    expect(src.length).toBeGreaterThan(5000);
    expect(blankComments(src)).not.toMatch(/That's everything under/);
  });
});
