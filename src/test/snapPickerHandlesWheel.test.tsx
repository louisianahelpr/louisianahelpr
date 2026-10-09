/**
 * EVERY scroll-snap picker column takes the mouse wheel one row at a time
 * (owner, 2026-10-09, Start Time on Post a Job: "this is not a scroll you have
 * to click every number to move it").
 *
 * Measured in desktop Chrome on prod: a `snap-mandatory` listbox left to the
 * browser jumped two rows per 100px notch and snapped small trackpad moves
 * back to the same row. The class is any listbox column that scroll-snaps;
 * the inventory is read from src/, so a new picker joins this check by
 * existing, and must route its wheel through useWheelStep.
 */
import { readFileSync } from "node:fs";
import { readdirSync } from "./helpers/trackedFiles";
import { join } from "node:path";
import { useState } from "react";
import { act, render, screen } from "@testing-library/react";
import { beforeAll, describe, expect, it } from "vitest";
import { DateWheelPicker } from "@/components/DateWheelPicker";

function snapPickerFiles(dir = "src"): string[] {
  const out: string[] = [];
  for (const d of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, d.name);
    if (d.isDirectory()) out.push(...snapPickerFiles(p));
    else if (/\.tsx$/.test(d.name) && !/\.test\./.test(d.name)) out.push(p);
  }
  return out;
}
const isSnapListbox = (src: string) => src.includes("snap-mandatory") && /role=["']listbox["']/.test(src);
const handlesWheel = (src: string) => src.includes("useWheelStep(");

describe("scroll-snap pickers own the mouse wheel", () => {
  it("catches the original Start Time column", () => {
    const original = `<div role="listbox" className="overflow-y-auto snap-y snap-mandatory">`;
    expect(isSnapListbox(original) && !handlesWheel(original)).toBe(true);
  });

  it("every snap-mandatory listbox in src/ calls useWheelStep", () => {
    const pickers = snapPickerFiles().filter((f) => isSnapListbox(readFileSync(f, "utf8")));
    expect(pickers.length, "no snap pickers found — this check is looking at nothing").toBeGreaterThanOrEqual(2);
    expect(pickers.filter((f) => !handlesWheel(readFileSync(f, "utf8")))).toEqual([]);
  });
});

describe("the birthday wheel, rendered", () => {
  beforeAll(() => { Element.prototype.scrollTo = () => {}; });

  it("one notch on the Year column moves one year", () => {
    function H() {
      const [v, setV] = useState("1990-05-01");
      return (<><DateWheelPicker value={v} onChange={setV} minDate={new Date(1906, 0, 1)} maxDate={new Date(2008, 9, 9)} /><output data-testid="v">{v}</output></>);
    }
    render(<H />);
    const year = screen.getByRole("listbox", { name: "Year" });
    act(() => { year.dispatchEvent(new WheelEvent("wheel", { deltaY: 100, bubbles: true, cancelable: true })); });
    // Years run newest first, so scrolling down is one year earlier.
    expect(screen.getByTestId("v").textContent).toBe("1989-05-01");
  });
});
