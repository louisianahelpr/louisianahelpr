/**
 * A birthday wheel whose max is today opens 18 years back (lh-authz-rls
 * re-review of 44ca75e95, should-fix 4, Q1586(c)): it used to open on its max,
 * which was today - 18 years. With the cap lifted so a minor's honest birthday
 * can be entered, opening on today would let an adult who only spins the month
 * and day save a minor's birthday, which only support can change.
 *
 * @mutate src/components/DateWheelPicker.tsx |     : openAt && openAt >= minDate && openAt <= maxDate ? openAt : maxDate; |     : maxDate;
 */
import { useState } from "react";
import { describe, expect, it } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { DateWheelPicker } from "./DateWheelPicker";

function Harness({ openAt }: { openAt?: Date }) {
  const [v, setV] = useState("");
  return (
    <>
      <DateWheelPicker value={v} onChange={setV} minDate={new Date(1906, 0, 1)} maxDate={new Date(2026, 9, 13)} openAt={openAt} />
      <output data-testid="value">{v}</output>
    </>
  );
}

describe("DateWheelPicker openAt", () => {
  it("with no date chosen, the first step moves from openAt, not from the max", () => {
    render(<Harness openAt={new Date(2008, 9, 13)} />);
    const month = screen.getByRole("listbox", { name: "Month" });
    month.focus();
    fireEvent.keyDown(month, { key: "ArrowUp" });
    expect(screen.getByTestId("value").textContent).toMatch(/^2008-/);
  });

  it("without openAt it still starts at the max (other date fields unchanged)", () => {
    render(<Harness />);
    const month = screen.getByRole("listbox", { name: "Month" });
    month.focus();
    fireEvent.keyDown(month, { key: "ArrowUp" });
    expect(screen.getByTestId("value").textContent).toMatch(/^2026-/);
  });
});
