/**
 * Every weekday + date pair in the holiday content is a real 2026 season day (holiday audit C8a, 2026-11-20: the 25 Days
 * lineup said "Family mini session on Sat Dec 20", and Dec 20, 2026 is a Sunday; a winner could show up on the wrong
 * day). Reads every tracked file under src/content and src/components/sponsor (the 25 Days page, sponsor page, rules,
 * gift guides and Small Business Saturday copy) for "Sat Dec 20", "Sunday, November 22", "Fri Jan 22" and the like,
 * and checks the weekday against the calendar: Nov and Dec are 2026, Jan is 2027 (the 25 Days season).
 *
 * @mutate src/content/sponsorPage.ts | { brand: "Wicks NOLA Candle Company", prize: "8 oz scented candle" },\n          { brand: "Suzi Marques Photography", prize: "Family mini session on Sun Dec 20 at Moncus Park | { brand: "Wicks NOLA Candle Company", prize: "8 oz scented candle" },\n          { brand: "Suzi Marques Photography", prize: "Family mini session on Sat Dec 20 at Moncus Park
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { trackedFiles } from "./helpers/trackedFiles";

const DAYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];
const MONTHS: Record<string, { m: number; y: number }> = { nov: { m: 10, y: 2026 }, dec: { m: 11, y: 2026 }, jan: { m: 0, y: 2027 } };
const PAIR = /\b(Mon|Tue|Tues|Wed|Wednes|Thu|Thur|Thurs|Fri|Sat|Satur|Sun)(?:day)?\.?,?\s+(Nov|Dec|Jan)[a-z]*\.?\s+(\d{1,2})(?!\d)/g;

/** The weekday problems in one text: "<file>:<line> <found> (is a <real day>)". */
function weekdayProblems(file: string, text: string): string[] {
  const out: string[] = [];
  for (const m of text.matchAll(PAIR)) {
    const { m: month, y } = MONTHS[m[2].toLowerCase().slice(0, 3)];
    const day = Number(m[3]);
    const real = new Date(Date.UTC(y, month, day)).getUTCDay();
    if (DAYS[real] !== m[1].toLowerCase().slice(0, 3)) {
      const line = text.slice(0, m.index).split("\n").length;
      out.push(`${file}:${line} "${m[0]}" (${m[2]} ${day}, ${y} is a ${DAYS[real]})`);
    }
  }
  return out;
}

describe("holiday weekday + date pairs", () => {
  const files = [...trackedFiles("src/content"), ...trackedFiles("src/components/sponsor")].filter((f) => /\.(ts|tsx|mjs|json)$/.test(f));

  it("the checker catches a wrong pair and passes a right one", () => {
    expect(weekdayProblems("x", "Family mini session on Sat Dec 20")).toHaveLength(1);
    expect(weekdayProblems("x", "Sign up by Sunday, November 22. Sun Dec 20. Fri Jan 22. Saturday, Nov 28")).toEqual([]);
  });

  it("every pair in the holiday content is a real day", () => {
    let pairs = 0;
    const bad: string[] = [];
    for (const f of files) {
      const text = readFileSync(f, "utf8");
      pairs += [...text.matchAll(PAIR)].length;
      bad.push(...weekdayProblems(f, text));
    }
    expect(files.length).toBeGreaterThan(20);
    expect(pairs).toBeGreaterThan(10);
    expect(bad).toEqual([]);
  });
});
