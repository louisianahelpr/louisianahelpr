/**
 * Q372 (owner, 2026-09-24): each Activity section shows 50 cards, then a
 * "Show older" button reveals the next 50. The largest account held 202
 * posted jobs, all rendered at once.
 */
// @mutate src/components/job-card/PagedActivityList.tsx | export const ACTIVITY_PAGE_SIZE = 50; | export const ACTIVITY_PAGE_SIZE = 5000;
// @mutate src/components/job-card/PagedActivityList.tsx | setShown((n) => n + ACTIVITY_PAGE_SIZE) | setShown((n) => n)
// @mutate src/components/job-card/PagedActivityList.tsx | {items.length > shown && ( | {false && (
// @mutate src/components/job-card/ActivitySectionedView.tsx | <PagedActivityList items={bucketItems} getKey={getKey} renderItem={renderItem} onHiddenChange={reportHidden[key]} /> | <div>{bucketItems.map((i) => <div key={getKey(i)}>{renderItem(i)}</div>)}</div>
// @mutate src/pages/posts/PostedJobsTab.tsx | <PagedActivityList items={visibleJobs} | <PagedActivityList items={visibleJobs.slice(0)}
// @mutate src/pages/jobs/AppliedJobsTab.tsx | <PagedActivityList items={apps} | <PagedActivityList items={apps.slice(0)}
// @mutate src/components/job-card/PagedActivityList.tsx | onHiddenChange?.(hidden); | onHiddenChange?.(0);
// @mutate src/components/job-card/ActivitySectionedView.tsx | onHiddenChange?.(totalHidden); | onHiddenChange?.(0);
// @mutate src/pages/posts/PostedJobsTab.tsx | if (moreHidden \|\| !onSelectStatusFilter | if (!onSelectStatusFilter
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ActivitySectionedView } from "./ActivitySectionedView";
import { ACTIVITY_PAGE_SIZE } from "./PagedActivityList";

type Item = { id: string; bucket: "active" | "completed" | "cancelled" };
const make = (n: number, bucket: Item["bucket"]): Item[] =>
  Array.from({ length: n }, (_, i) => ({ id: `${bucket}-${i}`, bucket }));

function setup(items: Item[]) {
  sessionStorage.setItem("activity:sections:posted", JSON.stringify({ active: true, completed: true, cancelled: true }));
  return render(
    <ActivitySectionedView<Item>
      tab="posted"
      items={items}
      getKey={(i) => i.id}
      bucketize={(i) => i.bucket}
      renderItem={(i) => <span data-testid="card">{i.id}</span>}
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

  it("pages each section on its own and shows no button at 50 or fewer", () => {
    setup([...make(50, "active"), ...make(51, "cancelled")]);
    expect(screen.getAllByTestId("card")).toHaveLength(100);
    expect(screen.getAllByRole("button", { name: /Show older/ })).toHaveLength(1);
    expect(screen.getByRole("button", { name: /Show older/ }).textContent).toContain("(50 of 51)");
  });

  it("the flat single-status lists on both tabs page through the same component", () => {
    for (const [f, v] of [["PostedJobsTab", "visibleJobs"], ["AppliedJobsTab", "apps"]]) {
      const src = readFileSync(join(__dirname, "..", "..", "pages", f === "PostedJobsTab" ? "posts" : "jobs", `${f}.tsx`), "utf8");
      expect(src, `${f} flat list`).toMatch(new RegExp(`<PagedActivityList items=\\{${v}\\} getKey=\\{\\(\\w+\\) => \\w+\\.id\\} renderItem=\\{\\w+\\}`));
      expect(src, `${f} renders its cards outside the pager`).not.toMatch(new RegExp(`\\{${v}\\.map\\(`));
    }
  });

  it("reports how many cards are hidden, per list and summed across sections", () => {
    const seen = vi.fn();
    setup(make(120, "completed"));
    const { unmount } = render(
      <ActivitySectionedView<Item>
        tab="posted"
        items={[...make(70, "completed"), ...make(60, "cancelled")]}
        getKey={(i) => i.id}
        bucketize={(i) => i.bucket}
        renderItem={(i) => <span>{i.id}</span>}
        onHiddenChange={seen}
      />,
    );
    expect(seen).toHaveBeenLastCalledWith(20 + 10);
    unmount();
  });

  it("the Posted tab's end-of-list line never says \"that's everything\" while cards are hidden", () => {
    const src = readFileSync(join(__dirname, "..", "..", "pages", "posts", "PostedJobsTab.tsx"), "utf8");
    expect(src).toContain("moreHidden={hiddenCount > 0}");
    expect(src).toContain("if (moreHidden || !onSelectStatusFilter || others.length === 0) {");
    expect(src.match(/onHiddenChange=\{setHiddenCount\}/g)).toHaveLength(2);
  });
});
