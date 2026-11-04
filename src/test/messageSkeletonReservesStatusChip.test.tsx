/**
 * Q1695 (lead 2026-11-04, by recommendation; owner rule "nothing jumps"): the
 * /messages loading row reserves the job-status chip's room.
 *
 * The loading-states refresh measured /messages 60px -> 83px: the test
 * accounts' threads carry a status chip, and at 375 the chip does not fit
 * beside the name and the timestamp, so it drops under the name and the row
 * grows by the chip's line. The skeleton drew no chip, so every row jumped.
 *
 * jsdom has no layout, so this pins the STRUCTURE that makes the bone wrap
 * exactly where the real chip wraps: the skeleton's line 1 wears the real
 * row's line-1 classes, its left group wears the real left group's wrapping
 * classes, its name box sits on the real name's flex basis at the real name's
 * 24px line, and a chip bone of the chip's ~20px height sits beside it in the
 * same wrapping group. Measured in a browser (both mounted from the dev
 * server, ~/.lh-shots/b1-q1695/harness.mjs): at 309px (the 375 list) the
 * skeleton column is 82px against a wrapped real row's 81.8px; at 700px (the
 * desktop panel) both are 60px.
 *
 * @mutate src/components/ui/skeletons/MessageThreadSkeleton.tsx | data-testid="skeleton-status-chip" | data-testid="skeleton-no-chip"
 * @mutate src/components/ui/skeletons/MessageThreadSkeleton.tsx | <div className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5 min-w-0 flex-1"> | <div className="flex items-center gap-x-1.5 gap-y-0.5 min-w-0 flex-1">
 * @mutate src/components/ui/skeletons/MessageThreadSkeleton.tsx | className="min-w-0 basis-[7.5rem] grow h-6 flex items-center" | className="min-w-0 basis-[5rem] grow h-6 flex items-center"
 * @mutate src/components/ui/skeletons/MessageThreadSkeleton.tsx | className="h-5 w-[4.5rem] rounded-full shrink-0" | className="h-4 w-[4.5rem] rounded-full shrink-0"
 * @mutate src/components/ui/skeletons/MessageThreadSkeleton.tsx | className="mt-1 h-3.5 w-24 rounded" | className="mt-1.5 h-4 w-24 rounded"
 */
import { describe, expect, it, afterEach, vi } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";

vi.mock("@/lib/errorLogger", () => ({ report: vi.fn() }));

import { ConversationRow } from "@/components/messages/ConversationRow";
import { MessageThreadSkeleton } from "@/components/ui/skeletons/MessageThreadSkeleton";
import type { Conversation } from "@/components/messages/types";

afterEach(cleanup);

const classes = (el: Element | null | undefined) => (el?.className ?? "").toString().split(/\s+/).filter(Boolean).sort();
const has = (el: Element, ...want: string[]) => want.filter((c) => !el.classList.contains(c));

function realRow() {
  render(
    <ConversationRow
      convo={{
        otherUserId: "u-1",
        otherUserName: "Helper Test",
        jobId: "j-1",
        jobTitle: "Mow the yard",
        jobStatus: "completed",
        lastMessage: "See you then",
        lastAt: "2026-10-28T15:00:00Z",
        unread: 0,
      } as unknown as Conversation}
      currentUserId="me"
      openConvo={() => {}}
    />,
  );
  const line = screen.getByTestId("row-line-1");
  const chip = screen.getByTestId("row-status-chip");
  const name = screen.getByTestId("row-name");
  cleanup();
  return { line, group: chip.parentElement!, name };
}

describe("/messages skeleton reserves the status chip (Q1695)", () => {
  it("line 1 and its wrapping group wear the real row's classes", () => {
    const real = realRow();
    render(<MessageThreadSkeleton />);
    const line = screen.getByTestId("skeleton-line-1");
    const chip = screen.getByTestId("skeleton-status-chip");
    const group = chip.parentElement!;
    expect(classes(line), "skeleton line 1 = real row-line-1").toEqual(classes(real.line).filter((c) => c !== "transition-colors"));
    expect(classes(group), "chip bone's group = the real chip's wrapping group").toEqual(classes(real.group));
    expect(group.parentElement, "the group is line 1's own child").toBe(line);
  });

  it("the name box sits on the real name's basis at the real name's line height", () => {
    const real = realRow();
    render(<MessageThreadSkeleton />);
    const name = screen.getByTestId("skeleton-name");
    const basis = classes(real.name).filter((c) => c.startsWith("basis-") || c === "grow");
    expect(basis.length, "the real name still has a flex basis").toBe(2);
    expect(has(name, ...basis, "h-6", "min-w-0")).toEqual([]);
  });

  it("the chip bone has the chip's height, shrinks never, and the column still totals 60px unwrapped", () => {
    render(<MessageThreadSkeleton />);
    const chip = screen.getByTestId("skeleton-status-chip");
    expect(has(chip, "h-5", "shrink-0")).toEqual([]);
    const col = screen.getByTestId("skeleton-line-1").parentElement!;
    const [, second, third] = [...col.children];
    // 24 (h-6 line 1) + 4 + 14 + 4 + 14 = 60, the unwrapped real column.
    expect(has(second, "mt-1", "h-3.5")).toEqual([]);
    expect(has(third, "mt-1", "h-3.5")).toEqual([]);
    expect(col.children.length).toBeGreaterThan(2);
  });
});
