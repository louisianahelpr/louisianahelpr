import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { ApplicantQueueBanner } from "./ApplicantQueueBanner";

/**
 * The applicant-queue slot must never be empty in a resolved state.
 *
 * This component sits inside `display:contents` wrappers, so its box is a
 * DIRECT grid item of DialogContent (`grid … gap-4`). When it renders nothing,
 * the dialog loses the row AND one 1rem row-gap — about 67px — out of a dialog
 * that is already open and being read. On phone the sheet is bottom-anchored,
 * so the shrink drags the title downward under the reader's eyes.
 *
 * That is exactly what happened for a job with zero applicants: the loading
 * skeleton reserved height, then the count landed at 0 and BOTH branches went
 * false. These tests pin the invariant — every resolved state renders a box —
 * so a future branch added here cannot silently reopen the hole.
 */
const box = (c: HTMLElement) => c.querySelector<HTMLElement>("div.rounded-ds-md");

describe("ApplicantQueueBanner occupies its slot in every state", () => {
  it("loading (count null) renders the reserving skeleton", () => {
    const { container } = render(
      <ApplicantQueueBanner guest={false} applicationCount={null} viewerAppPosition={null} />,
    );
    expect(box(container), "loading state must reserve height").toBeTruthy();
  });

  it("ZERO applicants and not applied still renders a box", () => {
    // The regression. Before the fix this rendered nothing at all.
    const { container } = render(
      <ApplicantQueueBanner guest={false} applicationCount={0} viewerAppPosition={null} />,
    );
    const el = box(container);
    expect(el, "zero-applicant state must occupy the slot").toBeTruthy();
    expect(container.textContent).toMatch(/first in line/i);
    // and it must NOT borrow the urgency tone reserved for real competition
    expect(container.textContent).not.toMatch(/already applied/i);
  });

  it("others have applied renders the queue nudge", () => {
    const { container } = render(
      <ApplicantQueueBanner guest={false} applicationCount={3} viewerAppPosition={null} />,
    );
    expect(box(container)).toBeTruthy();
    expect(container.textContent).toMatch(/3 Helprs already applied/i);
  });

  it("viewer has applied renders their position", () => {
    const { container } = render(
      <ApplicantQueueBanner guest={false} applicationCount={7} viewerAppPosition={3} />,
    );
    expect(box(container)).toBeTruthy();
  });

  it("every resolved state pins the same min-height", () => {
    // Equal-height branches are what make the swap free. If one branch loses
    // the pin, the shift comes back smaller and harder to spot.
    const states: Array<[number, number | null]> = [
      [0, null],
      [3, null],
      [7, 3],
    ];
    for (const [count, pos] of states) {
      const { container } = render(
        <ApplicantQueueBanner guest={false} applicationCount={count} viewerAppPosition={pos} />,
      );
      expect(
        box(container)?.className,
        `count=${count} pos=${pos} must pin the slot height`,
      ).toContain("min-h-[3.1875rem]");
    }
  });
});
