import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { blankComments, blankCssComments } from "./helpers/blankNonCode";
import { trackedFiles } from "./helpers/trackedFiles";

/**
 * A JOB CARD'S TITLE GROWS WITH THE SENIOR TEXT RUNGS (Q1661).
 *
 * Found by the Q252 capture (iOS 26.5 simulator, iPhone SE 375, Dynamic Type
 * accessibility-XXXL, 2026-10-11): the meta line under a job card title grew
 * 11 -> 14px with the `.senior-mode` rungs while the title stayed at
 * `--headline-card` (15.2px), so the title read barely larger than its own meta.
 *
 * Proves, two-way where it can:
 *   1. index.css sizes `html.senior-mode .job-card-title` from `--headline-card`
 *      times a factor in [1.2, 1.5] (the small rungs grow ~1.25x);
 *   2. every single-line card title in src (a className with both
 *      `text-headline-card` and `truncate`) carries `job-card-title` AND
 *      `senior-clamp-2`, so the bigger title wraps to two lines instead of
 *      losing more of itself to the ellipsis; and nothing else carries
 *      `job-card-title` (the hook is for job-card titles, not headings).
 */

// Shown able to fail:
// @mutate src/index.css | font-size: calc(var(--headline-card) * 1.25); | font-size: var(--headline-card);
// @mutate src/components/job-card/JobCardTitleBar.tsx | className="job-card-title senior-clamp-2 font-display | className="font-display
// @mutate src/components/dashboard/JobCard.tsx | className="job-card-title senior-clamp-2 text-headline-card | className="job-card-title text-headline-card
// @mutate src/index.css | html.senior-mode .job-category-tab {\n  line-height: 1 !important; | html.senior-mode .job-category-tab {\n  line-height: 1.45 !important;
// @mutate src/components/job/cardGeometry.ts | "job-category-tab inline-flex | "inline-flex

const ROOT = process.cwd();
const read = (rel: string) => readFileSync(join(ROOT, rel), "utf8");

describe("Q1661: job-card titles follow the senior text scale", () => {
  it("index.css scales .job-card-title from --headline-card under html.senior-mode", () => {
    const css = blankCssComments(read("src/index.css"));
    const m = css.match(/html\.senior-mode\s+\.job-card-title\s*\{([^}]*)\}/);
    expect(m, "html.senior-mode .job-card-title rule").not.toBeNull();
    const size = m![1].match(/font-size\s*:\s*calc\(\s*var\(--headline-card\)\s*\*\s*([\d.]+)\s*\)/);
    expect(size, "font-size: calc(var(--headline-card) * k)").not.toBeNull();
    const k = Number(size![1]);
    expect(k).toBeGreaterThanOrEqual(1.2);
    expect(k).toBeLessThanOrEqual(1.5);
  });

  const classStrings: { file: string; cls: string }[] = [];
  for (const file of trackedFiles("src").filter((f) => /\.tsx$/.test(f) && !/\.test\.tsx$/.test(f))) {
    const src = blankComments(read(file));
    for (const m of src.matchAll(/className=(?:"([^"]*)"|\{`([^`]*)`\})/g)) classStrings.push({ file, cls: m[1] ?? m[2] });
  }
  const words = (cls: string) => cls.split(/\s+/);
  const titles = classStrings.filter(({ cls }) => words(cls).includes("text-headline-card") && words(cls).includes("truncate"));

  it("the corner category tab keeps its one-line leading at the senior rung (else it sits on the title)", () => {
    const css = blankCssComments(read("src/index.css"));
    const m = css.match(/html\.senior-mode\s+\.job-category-tab\s*\{([^}]*)\}/);
    expect(m, "html.senior-mode .job-category-tab rule").not.toBeNull();
    expect(m![1]).toMatch(/line-height\s*:\s*1\s*!important/);
    const frame = blankComments(read("src/components/job/cardGeometry.ts")).match(/JOB_CATEGORY_TAB_FRAME\s*=\s*"([^"]*)"/);
    expect(frame, "JOB_CATEGORY_TAB_FRAME").not.toBeNull();
    expect(frame![1].split(/\s+/)).toContain("job-category-tab");
  });

  it("finds the job-card titles (inventory floor)", () => {
    expect(titles.length).toBeGreaterThan(2);
  });

  it("every single-line card title carries job-card-title and senior-clamp-2", () => {
    const missing = titles.filter(({ cls }) => !words(cls).includes("job-card-title") || !words(cls).includes("senior-clamp-2"));
    expect(missing.map((t) => t.file)).toEqual([]);
  });

  it("job-card-title is only on those titles (two-way)", () => {
    const tagged = classStrings.filter(({ cls }) => words(cls).includes("job-card-title"));
    const stray = tagged.filter(({ cls }) => !(words(cls).includes("text-headline-card") && words(cls).includes("truncate")));
    expect(stray.map((t) => `${t.file}: ${t.cls}`)).toEqual([]);
    expect(tagged.length).toBe(titles.length);
  });
});
