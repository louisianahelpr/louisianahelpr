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
    // Nor holds a pick waiting for AM/PM (Q1733): the wheels chose nothing.
    expect(screen.queryByTestId("time-pick-period")).toBeNull();
  });

  it("a scroll the person makes still picks (touch, then scroll to the 3rd hour row; the time lands with AM/PM)", () => {
    render(<Harness />);
    fireEvent.pointerDown(list("Hour"));
    scrollTo(list("Hour"), 2 * 44);
    expect(value()).toBe("");
    fireEvent.click(screen.getByRole("radio", { name: "PM" }));
    expect(value()).toBe("14:00");
  });
});

/**
 * Q1733 (owner, 2026-10-14: "make them pick AM/PM"): tapping only an hour and
 * a minute on an empty Start Time committed AM (seen 2026-10-12 on prod,
 * WebKit 390x844: 3 and 30 became 3:30 AM with no AM/PM tap).
 * @mutate src/components/TimePickerWheel.tsx |     if (!hasValue && field !== "period") { |     if (false) {
 * @mutate src/components/TimePickerWheel.tsx |       {awaitingPeriod && ( |       {false && (
 */
describe("AM or PM is the poster's choice (Q1733)", () => {
  beforeAll(() => { Element.prototype.scrollTo = () => {}; });

  it("an hour and a minute alone commit nothing and ask for AM or PM", () => {
    render(<Harness />);
    fireEvent.click(screen.getByRole("option", { name: "3" }));
    fireEvent.click(screen.getByRole("option", { name: "30" }));
    expect(value()).toBe("");
    expect(screen.getByTestId("time-pick-period")).toHaveTextContent("Pick AM or PM");
    // Neither chip reads as chosen.
    expect(screen.getByRole("radio", { name: "AM" })).not.toBeChecked();
    expect(screen.getByRole("radio", { name: "PM" })).not.toBeChecked();
  });

  it("the AM/PM tap commits the time the wheels show", () => {
    render(<Harness />);
    fireEvent.click(screen.getByRole("option", { name: "3" }));
    fireEvent.click(screen.getByRole("option", { name: "30" }));
    fireEvent.click(screen.getByRole("radio", { name: "PM" }));
    expect(value()).toBe("15:30");
    expect(screen.queryByTestId("time-pick-period")).toBeNull();
    fireEvent.click(screen.getByRole("radio", { name: "AM" }));
    expect(value()).toBe("03:30");
  });

  it("once a time is set, the wheels change it directly (AM/PM already chosen)", () => {
    render(<Harness />);
    fireEvent.click(screen.getByRole("radio", { name: "PM" }));
    expect(value()).toBe("12:00");
    fireEvent.click(screen.getByRole("option", { name: "4" }));
    expect(value()).toBe("16:00");
  });
});
