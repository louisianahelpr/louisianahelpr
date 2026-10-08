/**
 * Owner, 2026-10-08 (pop-up: "Inline, both boxes same height"): Post a Job's
 * date calendar is always open, filling its column, and the Start Time card
 * stretches to the calendar's height. No pill, no popover over the fields
 * below.
 *
 * @mutate src/components/postjob/LogisticsSection.tsx |           inline\n |
 * @mutate src/components/DatePickerField.tsx |             onSelect={(d) => d && onChange(toLocalIso(d))} |             onSelect={() => {}}
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { DatePickerField } from "@/components/DatePickerField";

describe("Post a Job's date calendar is always open", () => {
  it("Logistics asks for the inline calendar, labelled by Date Needed", () => {
    const src = readFileSync(join(process.cwd(), "src/components/postjob/LogisticsSection.tsx"), "utf8");
    const field = src.slice(src.indexOf("<DatePickerField"), src.indexOf("/>", src.indexOf("<DatePickerField")));
    expect(field).toMatch(/\binline\b/);
    expect(field).toMatch(/labelledBy="date-label"/);
    expect(src).toMatch(/md:items-stretch/);
  });

  it("the inline calendar renders without a tap and picks a local YYYY-MM-DD", async () => {
    const onChange = vi.fn();
    render(<DatePickerField id="date" inline value="" onChange={onChange} min="2000-01-01" />);
    expect(screen.queryByRole("button", { name: /select a date/i })).toBeNull();
    await screen.findAllByRole("gridcell", undefined, { timeout: 5000 });
    const day = document.querySelector('td[data-day$="-15"]:not([data-outside])');
    expect(day).not.toBeNull();
    fireEvent.click((day as HTMLElement).querySelector("button")!);
    expect(onChange).toHaveBeenCalledWith(expect.stringMatching(/^\d{4}-\d{2}-15$/));
  });
});
