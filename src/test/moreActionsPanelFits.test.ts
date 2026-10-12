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
 * @mutate src/components/job-card/JobActionRow.tsx | className="w-max min-w-[9rem] max-w-[min(17rem,calc(100vw-1.5rem))] p-1.5" | className="w-[24rem] p-1.5"
 * @mutate src/components/job-card/JobActionRow.tsx | <div className="grid grid-cols-1 gap-1.5">{children}</div> | <div className="grid grid-cols-2 gap-1.5">{children}</div>
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { blankComments } from "./helpers/blankNonCode";

const SRC = blankComments(readFileSync(resolve(__dirname, "../components/job-card/JobActionRow.tsx"), "utf8"));

describe("the job card's More panel fits the screen", () => {
  const panel = SRC.match(/<PopoverContent[\s\S]*?data-job-step-overflow-panel=""[\s\S]*?<\/PopoverContent>/);

  it("there is exactly one overflow panel", () => {
    expect(panel, "PopoverContent with data-job-step-overflow-panel").not.toBeNull();
    expect(SRC.match(/data-job-step-overflow-panel=""/g)?.length).toBe(1);
  });

  it("its width is its contents', capped to the viewport minus a gutter", () => {
    const cls = panel![0].match(/className="([^"]+)"/)![1].split(/\s+/);
    expect(cls).toContain("w-max");
    const cap = cls.find((c) => c.startsWith("max-w-"));
    expect(cap, "a max-width").toBeDefined();
    expect(cap).toMatch(/calc\(100vw-[\d.]+rem\)/);
    expect(cls.some((c) => /^w-\[\d/.test(c)), "no fixed width").toBe(false);
  });

  it("its actions sit in one column, anchored to the button's start edge", () => {
    expect(panel![0]).toMatch(/align="start"/);
    expect(panel![0]).toMatch(/className="grid grid-cols-1 /);
  });
});
