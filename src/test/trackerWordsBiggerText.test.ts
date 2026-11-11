/**
 * F260k (whole-app audit 11-10): with Bigger text on, the job tracker's step words grew to 16px and broke mid-word
 * ("Ar-" / "rived", "Work-" / "ing") while "Working" ran into "Done" on the Home card at 375. Under html.senior-mode
 * the six step words keep their default 11px (src/index.css), the size the narrow-width rules are fitted to.
 *
 * @mutate src/index.css | html.senior-mode .job-steps-grid .text-ds-11 { font-size: 11px | html.senior-mode .job-steps-grid .text-ds-11 { font-size: 16px
 * @mutate src/index.css | html.senior-mode .job-steps-grid .text-ds-11 | html.senior-mode .job-steps-grids .text-ds-11
 * @mutate src/components/tracker/JobProgress.tsx | className="job-steps-grid grid gap-1" | className="grid gap-1"
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { blankComments } from "./helpers/blankNonCode";

const css = blankComments(readFileSync(resolve(__dirname, "../index.css"), "utf8"));
const tracker = blankComments(readFileSync(resolve(__dirname, "../components/tracker/JobProgress.tsx"), "utf8"));
const tw = readFileSync(resolve(__dirname, "../../tailwind.config.ts"), "utf8");

describe("tracker step words under Bigger text (F260k)", () => {
  it("the step words are text-ds-11 inside the .job-steps-grid (vacuity floor)", () => {
    expect(tracker.length).toBeGreaterThan(2000);
    expect(tracker).toContain('className="job-steps-grid grid gap-1"');
    expect(tracker).toMatch(/justify-center gap-0\.5 text-ds-11 leading-tight/);
    expect(tw.match(/"ds-11":\s*\["(\d+)px"/)?.[1]).toBe("11");
  });
  it("under html.senior-mode they keep 11px, after the senior .text-ds-11 rung", () => {
    const sel = "html.senior-mode .job-steps-grid .text-ds-11";
    const rule = css.match(/html\.senior-mode \.job-steps-grid \.text-ds-11\s*\{([^}]*)\}/)?.[1] ?? "";
    expect(rule).toMatch(/font-size:\s*11px\s*!important/);
    expect(css.indexOf(sel)).toBeGreaterThan(-1);
    expect(css.indexOf("html.senior-mode .text-ds-11 {")).toBeGreaterThan(-1);
  });
});
