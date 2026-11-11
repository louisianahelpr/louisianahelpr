/**
 * F433 (audit 11-10): tapping "Hallie H. has arrived for Paint a fence" opened Jobs > Needs you (703 jobs) on a
 * different card: the url named the right job, but its card sat behind "Show older" (50 a page) or a group's
 * "See all", so it was never drawn and could not scroll into view or pulse. Now the list opens far enough, once,
 * that the linked card is drawn, in both the flat list and the grouped view, and on both tabs.
 *
 * @mutate src/components/job-card/PagedActivityList.tsx |     setShown((n) => (at < n ? n : Math.ceil((at + 1) / ACTIVITY_PAGE_SIZE) * ACTIVITY_PAGE_SIZE)); |     setShown((n) => n);
 * @mutate src/components/job-card/ActivityBucketGroups.tsx |     if (hidden) setExpanded((p) => ({ ...p, [b]: true })); |     if (hidden) setExpanded((p) => p);
 * @mutate src/pages/posts/PostedJobsTab.tsx | renderItem={renderJobCard} revealKey={highlightJobId ?? null} /> | renderItem={renderJobCard} />
 * @mutate src/pages/jobs/AppliedJobsTab.tsx | renderItem={renderAppliedCard} revealKey={highlightAppId ?? null} /> | renderItem={renderAppliedCard} />
 */
import { describe, expect, it } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { blankComments } from "@/test/helpers/blankNonCode";
import { PagedActivityList } from "./PagedActivityList";
import { ActivityBucketGroups, POSTED_GROUP_LABEL } from "./ActivityBucketGroups";
import type { ActivityBucket } from "@/lib/activityBuckets";

type Item = { id: string; bucket: ActivityBucket };
const make = (n: number, bucket: ActivityBucket): Item[] => Array.from({ length: n }, (_, i) => ({ id: `${bucket}-${i}`, bucket }));
const card = (i: Item) => <span data-testid="card">{i.id}</span>;

describe("the card a notification opened is drawn (F433)", () => {
  it("flat list: a card 640 places down opens enough pages, and the rest stays paged", () => {
    const items = make(703, "needs_you");
    render(<PagedActivityList<Item> items={items} getKey={(i) => i.id} renderItem={card} revealKey="needs_you-640" />);
    expect(screen.getByText("needs_you-640")).toBeTruthy();
    expect(screen.getAllByTestId("card").length).toBe(650);
    expect(screen.getByText(/Show older/)).toBeTruthy();
  });

  it("flat list: the link arriving before the cards still opens once they load", () => {
    const { rerender } = render(<PagedActivityList<Item> items={[]} getKey={(i) => i.id} renderItem={card} revealKey="needs_you-120" />);
    rerender(<PagedActivityList<Item> items={make(200, "needs_you")} getKey={(i) => i.id} renderItem={card} revealKey="needs_you-120" />);
    expect(screen.getByText("needs_you-120")).toBeTruthy();
  });

  it("flat list: no link keeps the first page only", () => {
    render(<PagedActivityList<Item> items={make(120, "needs_you")} getKey={(i) => i.id} renderItem={card} />);
    expect(screen.getAllByTestId("card").length).toBe(50);
  });

  it("grouped view: a card past 'See all' and one in a closed Done row are drawn", () => {
    const items = [...make(10, "needs_you"), ...make(4, "done")];
    const props = { getKey: (i: Item) => i.id, bucketOf: (i: Item) => i.bucket, renderItem: card, labels: POSTED_GROUP_LABEL };
    const { unmount } = render(<ActivityBucketGroups<Item> items={items} {...props} revealKey="needs_you-7" />);
    expect(screen.getByText("needs_you-7")).toBeTruthy();
    unmount();
    render(<ActivityBucketGroups<Item> items={items} {...props} revealKey="done-2" />);
    expect(screen.getByText("done-2")).toBeTruthy();
    // Still the member's to close: the group was opened once, not pinned open.
    fireEvent.click(screen.getByRole("button", { name: /Done|Finished|Completed/i, expanded: true }));
    expect(screen.queryByText("done-2")).toBeNull();
  });

  it("both tabs hand the linked card to both list views", () => {
    const posted = blankComments(readFileSync(join(process.cwd(), "src/pages/posts/PostedJobsTab.tsx"), "utf8"));
    const working = blankComments(readFileSync(join(process.cwd(), "src/pages/jobs/AppliedJobsTab.tsx"), "utf8"));
    expect(posted.match(/revealKey=\{highlightJobId \?\? null\}/g)?.length).toBe(2);
    expect(working.match(/revealKey=\{highlightAppId \?\? null\}/g)?.length).toBe(2);
  });
});
