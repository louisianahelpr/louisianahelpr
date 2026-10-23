/**
 * Q2369: THE TRACKER'S STEP TIP IS A 44px TAP TARGET AT 375 WITHOUT BREAKING THE ONE-LINE ROW (lander 5 / lead,
 * 2026-10-23). Eight steps share one row (owner, 2026-10-22), so a column is ~43px in CI's fonts. The step tip
 * button reaches into half of the 4px grid gap on each side (4px wider than its column, -2px margins, 2px inline
 * padding so its content does not move), so neighbours meet and never overlap.
 *
 * The browser proof is e2e/happy-path/messages-thread.spec.ts (every tap target >= 44px with no step-tip skip; tips
 * never overlap; each tip is its column + 4px). This guard pins the two facts that proof depends on, so the next
 * edit to the row cannot quietly undo them: the half-gap classes match the grid's gap, and the skip stays gone.
 *
 * @mutate src/components/tracker/JobProgress.tsx | block w-[calc(100%+4px)] -mx-[2px] px-[2px] min-h-[44px] | block w-full min-h-[44px]
 * @mutate src/components/tracker/JobProgress.tsx | className="job-steps-grid grid gap-1" | className="job-steps-grid grid gap-2"
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const ROOT = resolve(__dirname, "..", "..");
const read = (p: string) => readFileSync(resolve(ROOT, p), "utf8");

describe("the tracker's step tip hit area (Q2369)", () => {
  const src = read("src/components/tracker/JobProgress.tsx");

  it("the step tip button takes exactly half of the grid's gap on each side", () => {
    const grid = /className="job-steps-grid grid gap-(\d+)"/.exec(src);
    expect(grid, "the step row is a grid with a gap").not.toBeNull();
    // Tailwind gap-1 = 4px; half of it on each side is 2px.
    const gapPx = Number(grid![1]) * 4;
    const half = gapPx / 2;
    const button = /data-step-tip=\{i\}[\s\S]*?className="([^"]+)"/.exec(src);
    expect(button, "the step tip button").not.toBeNull();
    const cls = button![1].split(/\s+/);
    expect(cls).toContain(`w-[calc(100%+${gapPx}px)]`);
    expect(cls).toContain(`-mx-[${half}px]`);
    expect(cls).toContain(`px-[${half}px]`);
    expect(cls).toContain("min-h-[44px]");
  });

  it("the e2e tap-target check measures step tips (no skip) and checks they never overlap", () => {
    const spec = read("e2e/happy-path/messages-thread.spec.ts");
    expect(spec).not.toMatch(/hasAttribute\("data-step-tip"\)\)\s*return/);
    expect(spec).toContain('querySelectorAll<HTMLElement>("[data-step-tip]")');
    expect(spec).toContain("overlap by");
  });
});
