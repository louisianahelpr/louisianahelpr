/**
 * ApplicantsPanel's "% applied" reach line keeps an ink alpha of at least 0.65
 * (Q949, site 4 of the four contrast fixes). At 0.55 it measured 3.53:1, under
 * the 4.5:1 floor for its 11px text; 0.65 is the lowest alpha on --ink-deep
 * that clears. Photographed in its own state on prod (proof3 lane, 2026-10-14,
 * build 904f3f3a1): rgba(35,35,26,.65) over rgb(245,246,249) = 4.83:1 at 375
 * light, 4.78:1 at 1440 light, 6.09:1 at 375 dark. Sites 1 and 2 already have
 * guards (calendarWeekdaysAlignWithDays, wrappedUndercountWarningFullInk);
 * this pins the last one. The view count above it (0.7) is pinned too, so the
 * pair cannot both be dimmed together.
 *
 * @mutate src/pages/posts/postedJobs/ApplicantsPanel.tsx | style={{ color: "hsl(var(--ink-deep) / 0.65)" }} | style={{ color: "hsl(var(--ink-deep) / 0.55)" }}
 * @mutate src/pages/posts/postedJobs/ApplicantsPanel.tsx | style={{ color: "hsl(var(--ink-deep) / 0.7)" }} | style={{ color: "hsl(var(--ink-deep) / 0.5)" }}
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { blankComments } from "./helpers/blankNonCode";

const SRC = blankComments(
  readFileSync(join(__dirname, "..", "pages", "posts", "postedJobs", "ApplicantsPanel.tsx"), "utf8"),
);

/** The alpha of the last `color: "hsl(var(--ink-deep) / A)"` style before `at`;
 * 1 when the colour carries no alpha; null when no colour style is found. */
function inkAlphaBefore(at: number): number | null {
  const head = SRC.slice(Math.max(0, at - 400), at);
  const styles = [...head.matchAll(/style=\{\{\s*color:\s*"([^"]+)"\s*\}\}/g)];
  const color = styles[styles.length - 1]?.[1];
  if (!color) return null;
  if (color === "hsl(var(--ink-deep))") return 1;
  const m = /^hsl\(var\(--ink-deep\)\s*\/\s*([0-9.]+)\)$/.exec(color);
  return m ? Number(m[1]) : null;
}

describe("ApplicantsPanel's reach readout keeps readable ink (Q949)", () => {
  const applied = [...SRC.matchAll(/\}% applied/g)].map((m) => m.index ?? -1);
  const views = [...SRC.matchAll(/\{jobAnalytics\.viewCount\} \{jobAnalytics\.viewCount === 1/g)].map(
    (m) => m.index ?? -1,
  );

  it("finds the one '% applied' line and the one view count (inventory floor)", () => {
    expect(applied.length).toBeGreaterThan(0);
    expect(applied).toHaveLength(1);
    expect(views).toHaveLength(1);
  });

  it("the '% applied' line's ink alpha is at least 0.65 (4.5:1 at 11px)", () => {
    const alpha = inkAlphaBefore(applied[0]);
    expect(alpha).not.toBeNull();
    expect(alpha!).toBeGreaterThanOrEqual(0.65);
  });

  it("the view count above it stays at least 0.7", () => {
    const alpha = inkAlphaBefore(views[0]);
    expect(alpha).not.toBeNull();
    expect(alpha!).toBeGreaterThanOrEqual(0.7);
  });
});
