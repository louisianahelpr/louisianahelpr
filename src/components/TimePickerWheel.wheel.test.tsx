/**
 * Mouse wheel and trackpad move the Start Time wheel one row at a time
 * (owner, 2026-10-09: "this is not a scroll you have to click every number to
 * move it"). Measured on prod in desktop Chrome: one 100px notch jumped two
 * hours (9 -> 7) and six 4px trackpad nudges moved nothing, so the column only
 * changed by clicking. useWheelStep now owns the wheel: one notch = one step,
 * small deltas add up, and at either end the page scrolls on instead.
 */
import { useState } from "react";
import { beforeAll, describe, expect, it } from "vitest";
import { act, render, screen } from "@testing-library/react";
import { TimePickerWheel } from "./TimePickerWheel";

function Harness({ initial }: { initial: string }) {
  const [v, setV] = useState(initial);
  return (
    <>
      <TimePickerWheel value={v} onChange={setV} variant="wheels" />
      <output data-testid="v">{v}</output>
    </>
  );
}
const value = () => screen.getByTestId("v").textContent;
const hour = () => screen.getByRole("listbox", { name: "Hour" });
const wheel = (el: HTMLElement, deltaY: number) => {
  const e = new WheelEvent("wheel", { deltaY, bubbles: true, cancelable: true });
  act(() => { el.dispatchEvent(e); });
  return e.defaultPrevented;
};

describe("TimePickerWheel mouse wheel", () => {
  // jsdom has no scrollTo; the wheel positions its column with it.
  beforeAll(() => { Element.prototype.scrollTo = () => {}; });

  it("one mouse notch moves exactly one hour, either way", () => {
    render(<Harness initial="09:00" />);
    expect(wheel(hour(), 100)).toBe(true);
    expect(value()).toBe("10:00");
    wheel(hour(), -100);
    wheel(hour(), -100);
    expect(value()).toBe("08:00");
  });

  it("small trackpad deltas add up to a step instead of snapping back", () => {
    render(<Harness initial="09:00" />);
    for (let i = 0; i < 6; i++) wheel(hour(), 4); // 24px: not yet a row
    expect(value()).toBe("09:00");
    for (let i = 0; i < 2; i++) wheel(hour(), 4); // 32px: one row
    expect(value()).toBe("10:00");
  });

  it("the minute column steps by its own options", () => {
    render(<Harness initial="09:00" />);
    wheel(screen.getByRole("listbox", { name: "Minute" }), 100);
    expect(value()).toBe("09:05");
  });

  it("at the end of the list the event is left for the page to scroll", () => {
    render(<Harness initial="11:00" />);
    expect(wheel(hour(), 100)).toBe(false);
    expect(value()).toBe("11:00");
  });
});

// @mutate src/hooks/useWheelStep.ts |       if (Math.abs(px) >= WHEEL_NOTCH_PX) { acc = 0; step(dir); return; } |
// @mutate src/hooks/useWheelStep.ts |       if (!can(dir)) { acc = 0; return; } |
