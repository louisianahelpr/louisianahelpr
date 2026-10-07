/**
 * Q778: the series "End series" / "Leave series" link stays on one line and
 * clears AA in dark.
 *
 * Measured on prod 2026-10-07 with an is_seed series (poster-e2e, /posts
 * Scheduled, 375): the SeriesStrip row is one line by owner rule, its summary
 * truncates, and the End series button shrank to 44px wide so its label broke
 * onto two lines ("End / series"); in dark its raw --burnt-sienna measured
 * 4.48:1 at 11px. After (local build): one line; dark 7.09:1, light 6.08:1.
 *
 * Every mount of EndSeriesControl must sit in a `shrink-0` wrapper, and the
 * control's button must be `whitespace-nowrap` in --sienna-ink.
 *
 * @mutate src/components/series/EndSeriesControl.tsx | underline underline-offset-2 whitespace-nowrap" | underline underline-offset-2"
 * @mutate src/pages/posts/SeriesStrip.tsx | <span className="ml-auto shrink-0"> | <span className="ml-auto">
 * @mutate src/components/series/EndSeriesControl.tsx | style={{ color: "hsl(var(--sienna-ink))" }} | style={{ color: "hsl(var(--burnt-sienna))" }}
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { trackedFiles } from "./helpers/trackedFiles";
import { blankComments } from "./helpers/blankNonCode";

const ROOT = join(__dirname, "..", "..");
const src = (f: string) => blankComments(readFileSync(join(ROOT, f), "utf8"));

describe("End series fits its row and reads in dark (Q778)", () => {
  it("the control's button never wraps and uses the sienna label ink", () => {
    const s = src("src/components/series/EndSeriesControl.tsx");
    const btn = /<button\b[\s\S]*?data-end-series[\s\S]*?<\/button>/.exec(s)?.[0] ?? "";
    expect(btn, "the End series button was not found").not.toBe("");
    expect(btn).toMatch(/className="[^"]*\bwhitespace-nowrap\b/);
    expect(btn).toMatch(/color:\s*"hsl\(var\(--sienna-ink\)\)"/);
  });

  it("every mount sits in a shrink-0 wrapper", () => {
    const files = trackedFiles().filter((f) => /^src\/.*\.tsx$/.test(f) && !f.includes(".test."));
    const mounts: string[] = [];
    const bad: string[] = [];
    for (const f of files) {
      const s = src(f);
      for (const m of s.matchAll(/<EndSeriesControl\b/g)) {
        mounts.push(f);
        const before = s.slice(Math.max(0, m.index! - 200), m.index!);
        const wrapper = /<span className="([^"]*)">\s*$/.exec(before)?.[1] ?? "";
        if (!/\bshrink-0\b/.test(wrapper)) bad.push(`${relative(ROOT, join(ROOT, f))}: wrapper "${wrapper}"`);
      }
    }
    expect(mounts.length).toBeGreaterThan(1);
    expect(bad).toEqual([]);
  });
});
