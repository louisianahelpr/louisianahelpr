/**
 * Owner, 2026-10-08, on a 430px phone where a browse card read "📍 · Fri, Oct 9
 * · 2:00 PM · Materials · 1 day left" with the city squeezed to nothing:
 * "Location should never be hidden. Materials should [not] be listed here
 * ever. And 1 day left should only show if there is space ... location, date
 * and time never be hidden."
 *
 * Measured after (local build, the real CSS): at a 330px row the countdown
 * shows whole; at 200px it is absent and the city keeps its 72px.
 *
 * @mutate src/components/dashboard/JobCard.tsx | <span className="flex items-center gap-1 min-w-[5.25rem] overflow-hidden"> | <span className="flex items-center gap-1 min-w-0 overflow-hidden">
 * @mutate src/components/dashboard/JobCard.tsx | className="flex-1 basis-0 min-w-0 h-[1.5em] overflow-hidden flex flex-wrap items-center gap-x-2" | className="shrink-0 flex items-center gap-x-2"
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { blankComments } from "./helpers/blankNonCode";

const SRC = blankComments(readFileSync(join(process.cwd(), "src/components/dashboard/JobCard.tsx"), "utf8"));

describe("the browse card keeps place, date and time; the countdown only fills spare room", () => {
  it("the location group has a floor and never shrinks to its pin", () => {
    expect(SRC).toContain('<span className="flex items-center gap-1 min-w-[5.25rem] overflow-hidden">');
  });

  it("the start time is never hidden by a width rule", () => {
    const time = SRC.slice(SRC.indexOf("{timeLabel && ("), SRC.indexOf("{timeLabel}</span>"));
    expect(time.length).toBeGreaterThan(0);
    expect(time).not.toMatch(/\bhidden\b/);
  });

  it("no materials on the browse card", () => {
    expect(SRC).not.toMatch(/MaterialsChip|materials_note/);
  });

  it("the countdown lives in a leftover-width, one-line, wrap-to-hide slot", () => {
    expect(SRC).toContain('className="flex-1 basis-0 min-w-0 h-[1.5em] overflow-hidden flex flex-wrap items-center gap-x-2"');
    expect(SRC).toMatch(/<span aria-hidden className="w-0 h-\[1\.5em\]" \/>/);
  });
});
