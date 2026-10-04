/**
 * Q912 (owner, 2026-10-04): /legal's open policy search fills the whole pill,
 * so its ✕ now sits exactly where the magnifier comes back — the geometry the
 * 2026-09-19 landing slot (10f00eebc) existed to avoid, because the next press
 * under the same finger reopened the field ("the x on search needed to be
 * clicked 3 times to close"). The overlap is now allowed and the RE-PRESS is
 * refused: a pointer press on the magnifier within RETAP_GUARD_MS of the ✕ is
 * the same gesture landing twice. A keyboard press (click detail 0) is never
 * swallowed, and a press after the pause still opens it.
 *
 * MEASURED in the browser (local build against prod, /legal at 375 and 1440,
 * Chromium and WebKit, light and dark, ~/.lh-shots/q912/repro.mjs: press ✕,
 * press the same point 150 ms later, then press the magnifier 1.2 s later):
 *   - shipped (slot held): field ended 48/56 px short of the pill; 0 of 8 reopened;
 *   - filled, guard 0:     field reaches the pill's inner edge; 8 of 8 REOPENED;
 *   - filled, guard 500:   field reaches the pill's inner edge; 0 of 8 reopened,
 *                          and the deliberate reopen worked 8 of 8.
 * A render test was tried and dropped: Legal under jsdom reaches prod
 * Supabase and does not mount the public search row. This guard holds the
 * source shape that the browser run measured.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { blankComments } from "./helpers/blankNonCode";

const src = blankComments(readFileSync(resolve(__dirname, "../..", "src/pages/info/Legal.tsx"), "utf8"));

describe("Q912: the filled /legal search refuses the re-press that would reopen it", () => {
  it("reads the real page", () => {
    expect(src).toContain('aria-label="Search all policies"');
    expect(src.length).toBeGreaterThan(5000);
  });

  it("holds no landing slot, so the field reaches the pill's edge", () => {
    expect(src).not.toMatch(/<SearchTriggerSlot[\s/>]/);
  });

  it("the guard window is long enough to cover a second press under the same finger", () => {
    const ms = Number(/const RETAP_GUARD_MS = (\d+);/.exec(src)?.[1]);
    expect(ms).toBeGreaterThanOrEqual(300);
    expect(ms).toBeLessThanOrEqual(1000);
  });

  it("closing stamps the time, and only a POINTER press inside the window is refused", () => {
    expect(src).toMatch(/const closeSearch = \(\) => \{\s*closedAtRef\.current = performance\.now\(\);/);
    expect(src).toMatch(
      /const openSearch = \(e: ReactMouseEvent\) => \{\s*if \(e\.detail > 0 && performance\.now\(\) - closedAtRef\.current < RETAP_GUARD_MS\) return;\s*setSearchOpen\(true\);/,
    );
  });

  it("the magnifier opens through the guard, not around it", () => {
    expect(src).toContain("onClick={openSearch}");
    expect(src).not.toMatch(/onClick=\{\(\) => setSearchOpen\(true\)\}/);
  });
});

// @mutate src/pages/info/Legal.tsx | const RETAP_GUARD_MS = 500; | const RETAP_GUARD_MS = 0;
// @mutate src/pages/info/Legal.tsx |     if (e.detail > 0 && performance.now() | if (performance.now()
// @mutate src/pages/info/Legal.tsx |     closedAtRef.current = performance.now();\n |
// @mutate src/pages/info/Legal.tsx |           onClick={openSearch} |           onClick={() => setSearchOpen(true)}
