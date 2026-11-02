/**
 * A3-107 (audit 11-01): on Repeats, days Mon + Thu with start date Tue Nov 3, the series silently began Thu Nov 5:
 * step 5 said only "8 visits · $80 in labor". It now says the first and last visit, and that the start date picked
 * isn't one of the days.
 *
 * @mutate src/components/postjob/RecurringSchedulePicker.tsx |             {dates[0] !== startDate && startDate ? ` (${formatJobDate(startDate)} isn't one of the days)` : ""} |
 * @mutate src/components/postjob/RecurringSchedulePicker.tsx | `First visit ${formatJobDate(dates[0])} · last ${formatJobDate(dates[dates.length - 1])}` | `First visit ${formatJobDate(dates[0])}`
 */
import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import { RecurringSchedulePicker } from "./RecurringSchedulePicker";

const noop = () => {};
const line = (startDate: string, days: number[], weeks: number) => {
  render(<RecurringSchedulePicker days={days} setDays={noop} weeks={weeks} setWeeks={noop} startDate={startDate} budget={10} splitOk={false} setSplitOk={noop} />);
  return document.querySelector("[data-series-first-last]")?.textContent ?? null;
};

describe("A3-107: Repeats says the first and last visit", () => {
  it("Mon + Thu from Tue Nov 3 for 4 weeks: first Thu Nov 5, last Mon Nov 30, and the Tuesday is not a visit", () => {
    expect(line("2026-11-03", [1, 4], 4)).toBe("First visit Thu, Nov 5 · last Mon, Nov 30 (Tue, Nov 3 isn't one of the days)");
  });
  it("a start date on a chosen day says nothing more", () => {
    expect(line("2026-11-02", [1], 2)).toBe("First visit Mon, Nov 2 · last Mon, Nov 9");
  });
});
