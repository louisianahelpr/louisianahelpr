/**
 * The job card's More panel stays on screen and one column wide (Q1084).
 *
 * Seen on prod 2026-10-12 (poster-e2e's seed job on /posts, Supabase writes
 * refused): at 375 the panel opens ABOVE the More button, 144 x 223 px at
 * (54, 299), inside the 375 x 812 viewport; at 1440 it drops below the
 * button, 144 x 223 at (58, 521); light and dark; four actions in one column
 * (Edit, Copy link, Boost, Cancel), each 130 x 48. What keeps it there is in
 * the panel's own classes: as wide as its widest action, never wider than the
 * screen minus a 0.75rem gutter each side, one column, anchored to the
 * button's start edge. Radix flips it above or below by itself.
 *
 * Area 03 M11 (design audit 11-18): the panel is now the job page's bottom sheet (SheetContent side="bottom"), which
 * spans the screen by construction and cannot run off it or overlap the next card; the rows stay one column.
 * @mutate src/components/job-card/JobActionRow.tsx | <SheetContent side="bottom" aria-label="More actions for this job" | <SheetContent side="left" aria-label="More actions for this job"
 * @mutate src/components/job-card/JobActionRow.tsx | <div data-job-step-overflow-list="" className="flex flex-col gap-2 pb-2" onClick | <div data-job-step-overflow-list="" className="grid grid-cols-2 gap-2 pb-2" onClick
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { blankComments } from "./helpers/blankNonCode";

const SRC = blankComments(readFileSync(resolve(__dirname, "../components/job-card/JobActionRow.tsx"), "utf8"));

describe("the job card's More panel fits the screen", () => {
  const panel = SRC.match(/<SheetContent[\s\S]*?data-job-step-overflow-panel=""[\s\S]*?<\/SheetContent>/);

  it("there is exactly one overflow panel", () => {
    expect(SRC.length).toBeGreaterThan(5_000);
    expect(panel, "SheetContent with data-job-step-overflow-panel").not.toBeNull();
    expect(SRC.match(/data-job-step-overflow-panel=""/g)?.length).toBe(1);
  });

  it("it is a bottom sheet (the job page's More options), never a popover anchored beside the next card", () => {
    expect(panel![0]).toMatch(/side="bottom"/);
    expect(SRC).not.toMatch(/<PopoverContent/);
  });

  it("its actions sit in one column", () => {
    expect(panel![0]).toMatch(/data-job-step-overflow-list="" className="flex flex-col gap-2 /);
  });
});
