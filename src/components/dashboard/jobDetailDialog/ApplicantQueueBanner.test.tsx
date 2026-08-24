import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { ApplicantQueueBanner } from "./ApplicantQueueBanner";

/**
 * The applicant-queue slot renders ONLY when there is something to say.
 *
 * History worth keeping, because it is a genuine trade and not an oversight:
 *
 * This component sits inside `display:contents` wrappers, so its box is a
 * direct grid item of DialogContent (`grid … gap-4`). It used to reserve the
 * slot while the count loaded, then render nothing when the count came back
 * ZERO — so the dialog lost a row AND a 1rem row-gap, about 67px, out of a
 * dialog already open and being read. On phone the sheet is bottom-anchored,
 * so that shrink dragged the title down under the reader's eyes.
 *
 * That was first fixed by giving zero its own banner ("No one has applied yet
 * — you'd be first in line"), which kept the slot occupied in every state. The
 * owner removed that copy (2026-08-23), so the reserving skeleton had to go
 * with it: keeping a placeholder that reserves height for content that will
 * never appear re-creates the exact shrink it was added to prevent.
 *
 * The slot is therefore ABSENT for a job with no applicants — no reservation,
 * no shrink, no shift at all in the common case. The residual trade is that a
 * job WITH applicants grows by a row when the count lands. Growth downward is
 * the gentler of the two: it does not move what you are already reading, where
 * the shrink pulled the title out from under you.
 */
const box = (c: HTMLElement) => c.querySelector<HTMLElement>("div.rounded-ds-md");

describe("ApplicantQueueBanner", () => {
  it("renders NOTHING while the count is loading", () => {
    // No reserving skeleton — see the note above on why it had to go with the
    // zero-state copy rather than outlive it.
    const { container } = render(
      <ApplicantQueueBanner guest={false} applicationCount={null} viewerAppPosition={null} />,
    );
    expect(box(container)).toBeNull();
  });

  it("renders NOTHING for zero applicants", () => {
    const { container } = render(
      <ApplicantQueueBanner guest={false} applicationCount={0} viewerAppPosition={null} />,
    );
    expect(box(container), "no applicants means no banner (owner)").toBeNull();
    expect(container.textContent).not.toMatch(/first in line/i);
  });

  it("renders the queue nudge when others have applied", () => {
    const { container } = render(
      <ApplicantQueueBanner guest={false} applicationCount={3} viewerAppPosition={null} />,
    );
    expect(box(container)).toBeTruthy();
    expect(container.textContent).toMatch(/3 Helprs already applied/i);
  });

  it("renders the viewer's position once they have applied", () => {
    const { container } = render(
      <ApplicantQueueBanner guest={false} applicationCount={7} viewerAppPosition={3} />,
    );
    expect(box(container)).toBeTruthy();
  });

  it("the two states that DO render pin the same height", () => {
    // Equal-height branches are what make the swap between them free.
    for (const [count, pos] of [[3, null], [7, 3]] as Array<[number, number | null]>) {
      const { container } = render(
        <ApplicantQueueBanner guest={false} applicationCount={count} viewerAppPosition={pos} />,
      );
      expect(box(container)?.className, `count=${count} pos=${pos}`).toContain("min-h-[3.1875rem]");
    }
  });
});
