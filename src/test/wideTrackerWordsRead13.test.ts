/**
 * F275a (audit 11-10): on a wide Posted card the progress words were 11px grey though each of the six columns had
 * ~100px. From a 640px tracker (the container query that already gives six equal columns) the words read at 13px:
 * 0.8125rem, on the type scale; never under Bigger text, whose html.senior-mode .text-ds-11 already sets the row to 16px. Narrow
 * trackers keep 11px (and 0.91em under 300px), which is what keeps every full name inside its column there.
 *
 * @mutate src/index.css |   html:not(.senior-mode) .job-step-full { font-size: 0.8125rem; } |   html:not(.senior-mode) .job-step-full { font-size: 1em; }
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { blankCssComments } from "./helpers/blankNonCode";

const read = (f: string) => readFileSync(join(process.cwd(), f), "utf8");

describe("a wide tracker's step words read at 13px (F275a)", () => {
  it("inside the 640px container query, .job-step-full is 0.8125rem (13px)", () => {
    const css = blankCssComments(read("src/index.css"));
    const wide = css.match(/@container \(min-width: 640px\) \{([^]*?)\n\}/)?.[1] ?? "";
    expect(wide).toContain(".job-steps-grid { grid-template-columns: repeat(6, minmax(0, 1fr)) !important; }");
    expect(wide).toContain("html:not(.senior-mode) .job-step-full { font-size: 0.8125rem; }");
  });

  it("the word row it scales from is 11px", () => {
    expect(read("src/components/tracker/JobProgress.tsx")).toMatch(/mt-1 flex min-w-0 items-center justify-center gap-0\.5 text-ds-11 leading-tight/);
  });
});
