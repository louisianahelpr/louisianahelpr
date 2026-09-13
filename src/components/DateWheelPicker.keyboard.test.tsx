/**
 * DOB wheel keyboard model (keyboard audit, 2026-09-12): Tab landed on each
 * option <button>, which scroll-snapped the column and silently changed the
 * value (2008 -> 1906 in two presses). Each column must be ONE tab stop and
 * only arrow/Home/End/Page keys may move the selection.
 */
import { useState } from "react";
import { describe, expect, it } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { DateWheelPicker } from "./DateWheelPicker";

function Harness({ initial }: { initial: string }) {
  const [v, setV] = useState(initial);
  return (
    <>
      <button type="button">before</button>
      <DateWheelPicker value={v} onChange={setV} minDate={new Date(1906, 0, 1)} maxDate={new Date(2008, 8, 12)} />
      <button type="button">after</button>
      <output data-testid="value">{v}</output>
    </>
  );
}

const valueText = () => screen.getByTestId("value").textContent;

describe("DateWheelPicker keyboard", () => {
  it("Tab visits exactly the three listboxes and never changes the value", () => {
    const { container } = render(<Harness initial="2000-06-15" />);
    // Tab order = every element a sequential Tab can land on, in DOM order.
    const tabbable = Array.from(container.querySelectorAll<HTMLElement>("button, [tabindex], input, a[href]"))
      .filter((el) => el.tabIndex >= 0 && !(el as HTMLButtonElement).disabled);
    expect(tabbable.map((a) => `${a.getAttribute("role") ?? a.tagName}:${a.getAttribute("aria-label") ?? a.textContent}`))
      .toEqual(["BUTTON:before", "listbox:Month", "listbox:Day", "listbox:Year", "BUTTON:after"]);
    // Walk it forwards and back the way a Tab press does: blur, focus, keyup.
    for (const el of [...tabbable, ...tabbable.slice().reverse()]) {
      el.focus();
      fireEvent.keyUp(el, { key: "Tab" });
      fireEvent.scroll(el.closest("[role=listbox]") ?? el);
    }
    expect(valueText()).toBe("2000-06-15");
    for (const o of screen.getAllByRole("option")) expect(o.tabIndex).toBe(-1);
  });

  it("arrow keys move the focused column by exactly one step", () => {
    render(<Harness initial="2000-06-15" />);
    const key = (el: HTMLElement, k: string) => { el.focus(); fireEvent.keyDown(el, { key: k }); };
    // Years are listed newest first, so ArrowDown goes one year earlier.
    key(screen.getByRole("listbox", { name: "Year" }), "ArrowDown");
    expect(valueText()).toBe("1999-06-15");
    key(screen.getByRole("listbox", { name: "Year" }), "ArrowUp");
    expect(valueText()).toBe("2000-06-15");
    key(screen.getByRole("listbox", { name: "Day" }), "ArrowDown");
    expect(valueText()).toBe("2000-06-16");
    key(screen.getByRole("listbox", { name: "Day" }), "Home");
    expect(valueText()).toBe("2000-06-01");
    key(screen.getByRole("listbox", { name: "Day" }), "End");
    expect(valueText()).toBe("2000-06-30");
    expect(screen.getByRole("listbox", { name: "Day" }).getAttribute("aria-activedescendant"))
      .toBe(screen.getByRole("option", { name: "30" }).id);
  });
});
