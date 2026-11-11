/**
 * F278a (audit 11-10): with Bigger text and buttons on, the progress bar's six names ran into each other on a phone
 * ("Con- firmedthe", "Work-Done", "On the way" on three lines). The owner's 11-08 pick keeps every full name (never a
 * short form or a hidden word; trackerFullWordsFromMidWidth), so under a 640px tracker Bigger text lays the six steps
 * out three to a row: each name gets twice the room. A stylesheet rule, so this reads index.css (jsdom applies no
 * container queries) and the class the setting puts on <html>.
 *
 * @mutate src/index.css |   html.senior-mode .job-steps-grid { grid-template-columns: repeat(3, minmax(0, 1fr)) !important; row-gap: 6px; } |   html.senior-mode .job-steps-grid { row-gap: 6px; }
 * @mutate src/index.css | @container (max-width: 639px) {\n  html.senior-mode .job-steps-grid | @container (max-width: 1px) {\n  html.senior-mode .job-steps-grid
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { blankCssComments } from "./helpers/blankNonCode";

const css = blankCssComments(readFileSync(join(process.cwd(), "src/index.css"), "utf8"));
const read = (f: string) => readFileSync(join(process.cwd(), f), "utf8");

describe("Bigger text: a phone-width tracker gives each full name twice the room (F278a)", () => {
  it("under a 640px tracker, senior-mode lays the steps out three to a row, overriding the inline columns", () => {
    const block = [...css.matchAll(/@container \(max-width: 639px\) \{([^}]*)\}/g)].map((m) => m[1]).find((b) => b.includes("senior-mode")) ?? "";
    expect(block).toMatch(/html\.senior-mode \.job-steps-grid \{ grid-template-columns: repeat\(3, minmax\(0, 1fr\)\) !important;/);
  });

  it("the class is the one Bigger text puts on <html>, and the grid is the tracker's", () => {
    expect(read("src/lib/simpleMode.ts")).toContain('const SIMPLE_MODE_CLASS = "senior-mode";');
    expect(read("src/components/tracker/JobProgress.tsx")).toContain('className="job-steps-grid grid gap-1"');
  });
});
