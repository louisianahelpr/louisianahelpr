/**
 * TYPE THE BIRTHDAY (owner, 2026-10-09). The DOB wheel opens on the youngest
 * allowed birthday (today - 18y), so a real user born in 1968 faced a "2008"
 * year column and 40 flicks; he read it as the only year on offer and could
 * not finish sign-up. The wheel now carries a MM/DD/YYYY box: a complete,
 * valid typed date IS the value (and moves the wheel), an impossible or
 * out-of-range one is refused in words, and a wheel change rewrites the box.
 */
import { useState } from "react";
import { describe, expect, it } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { DateWheelPicker } from "./DateWheelPicker";
import { parseTypedDate } from "./TypedDateInput";

const MIN = new Date(1906, 9, 9);
const MAX = new Date(2008, 9, 9);

function Harness({ initial = "" }: { initial?: string }) {
  const [v, setV] = useState(initial);
  return (
    <>
      <DateWheelPicker value={v} onChange={setV} minDate={MIN} maxDate={MAX} />
      <output data-testid="value">{v}</output>
    </>
  );
}

const valueText = () => screen.getByTestId("value").textContent;
const box = () => screen.getByLabelText(/type it/i) as HTMLInputElement;
const selectedYear = () =>
  screen.getByRole("listbox", { name: "Year" }).querySelector("[aria-selected=true]")?.textContent;

describe("DateWheelPicker typed entry", () => {
  it("offers a typed box, and a typed birthday becomes the value and moves the wheel", () => {
    render(<Harness />);
    // The original defect, as the user met it: the wheel opens on 2008.
    expect(selectedYear()).toBe("2008");
    fireEvent.change(box(), { target: { value: "06171968" } });
    expect(box().value).toBe("06/17/1968");
    expect(valueText()).toBe("1968-06-17");
    expect(selectedYear()).toBe("1968");
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("refuses an impossible or out-of-range date in words and keeps the old value", () => {
    render(<Harness initial="1990-05-01" />);
    fireEvent.change(box(), { target: { value: "02/30/1990" } });
    expect(screen.getByRole("alert").textContent).toMatch(/isn't a real date/);
    expect(valueText()).toBe("1990-05-01");
    fireEvent.change(box(), { target: { value: "01/01/2010" } });
    expect(screen.getByRole("alert").textContent).toMatch(/on or before October 9, 2008/);
    expect(box().getAttribute("aria-invalid")).toBe("true");
    expect(valueText()).toBe("1990-05-01");
  });

  it("rewrites the box when the wheel moves", () => {
    render(<Harness initial="1990-05-01" />);
    expect(box().value).toBe("05/01/1990");
    const year = screen.getByRole("listbox", { name: "Year" });
    year.focus();
    fireEvent.keyDown(year, { key: "ArrowDown" });
    expect(valueText()).toBe("1989-05-01");
    expect(box().value).toBe("05/01/1989");
  });

  it("parseTypedDate holds both bounds and the calendar", () => {
    expect(parseTypedDate("10092008", MIN, MAX)).toEqual({ value: "2008-10-09" });
    expect(parseTypedDate("10102008", MIN, MAX)).toHaveProperty("error");
    expect(parseTypedDate("10091906", MIN, MAX)).toEqual({ value: "1906-10-09" });
    expect(parseTypedDate("10081906", MIN, MAX)).toHaveProperty("error");
    expect(parseTypedDate("02292000", MIN, MAX)).toEqual({ value: "2000-02-29" });
    expect(parseTypedDate("02291999", MIN, MAX)).toHaveProperty("error");
    expect(parseTypedDate("13011990", MIN, MAX)).toHaveProperty("error");
  });
});

// The typed value must reach the form, not just the box.
// @mutate src/components/TypedDateInput.tsx |     onChange(parsed.value); |     void parsed.value;
// The upper bound is the 18+ line; typed dates may not cross it.
// @mutate src/components/TypedDateInput.tsx |   if (picked > maxDate) return | if (false) return
