/**
 * Q1660 (found 2026-10-12 looking at Post a Job on prod in Playwright WebKit,
 * 390x844, the iPhone's engine): with no Start Time chosen, the Order Summary
 * read "Wed, Oct 14 · 12:00 AM · Flexible" in WebKit and "Wed, Oct 14 ·
 * Flexible" in Chromium. Without Flexible, WebKit's submit button skipped
 * "Pick a Start Time to Continue" and went straight to "Set a Budget".
 * Traced: WebKit fires a trusted scroll event on each freshly mounted snap
 * wheel (Hour and Minute, scrollTop 1), and the wheel committed its resting
 * rows (12, 00) as the poster's choice: midnight.
 *
 * The class: a time wheel commits a value only after the person touched it
 * (pointer, touch, wheel or key); a scroll nobody made never picks.
 *
 * @mutate src/components/TimePickerWheel.tsx |     if (!touched.current) return;\n |
 * @mutate src/components/TimePickerWheel.tsx |         onPointerDown={markTouched}\n |
 */
import { useState } from "react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { TimePickerWheel } from "@/components/TimePickerWheel";

function Harness() {
  const [v, setV] = useState("");
  return (
    <>
      <TimePickerWheel value={v} onChange={setV} variant="wheels" />
      <output data-testid="v">{v}</output>
    </>
  );
}
const value = () => screen.getByTestId("v").textContent;
const list = (name: "Hour" | "Minute") => screen.getByRole("listbox", { name });
const scrollTo = (el: HTMLElement, top: number) => {
  el.scrollTop = top;
  fireEvent.scroll(el);
  act(() => { vi.advanceTimersByTime(300); });
};

describe("a time wheel never picks a time on its own", () => {
  beforeAll(() => { Element.prototype.scrollTo = () => {}; });
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it("the mount-time snap scroll WebKit fires leaves an empty time empty", () => {
    render(<Harness />);
    scrollTo(list("Hour"), 1);
    scrollTo(list("Minute"), 1);
    expect(value()).toBe("");
  });

  it("a scroll the person makes still picks (touch, then scroll to the 3rd hour row)", () => {
    render(<Harness />);
    fireEvent.pointerDown(list("Hour"));
    scrollTo(list("Hour"), 2 * 44);
    expect(value()).toBe("02:00");
  });
});
