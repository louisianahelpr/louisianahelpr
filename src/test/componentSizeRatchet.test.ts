// @mutate src/components/BrowseMap.tsx | // BrowseMap — Apple MapKit JS map showing open Louisiana jobs as pins. The | // BrowseMap — Apple MapKit JS map showing open Louisiana jobs as pins. The\n//
// @mutate src/components/NotificationPanel.tsx | // Type-only: erased at build, so framer stays off the critical path.\n |
// @mutate src/components/RichMessageInput.tsx | import { useCallback, useEffect, useState, useRef } from "react"; | import { useCallback, useEffect, useState, useRef } from "react";\n\n\n\n\n
/*
 * God components may only SHRINK, file by file (OPEN.md Q184).
 *
 * Every non-test src/**\/*.tsx over THRESHOLD lines is listed in
 * scripts/component-size-baseline.json at its exact `wc -l`. The check is
 * two-way, like the `any` ratchet beside it:
 *   - a baselined file that GREW fails (extract something instead);
 *   - a baselined file that SHRANK fails until the baseline is lowered in the
 *     same commit, so the gain cannot silently drift back;
 *   - a file that crosses THRESHOLD without an entry fails (a NEW god component);
 *   - an entry whose file fell to <= THRESHOLD, or no longer exists, fails
 *     until the entry is deleted.
 *
 * Regenerate after shrinking: `node scripts/component-size-baseline.mjs --write`
 * (lower-only: it refuses to raise or add an entry).
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  BASELINE_PATH,
  THRESHOLD,
  compare,
  componentSizes,
  countLines,
  isTestFile,
  oversized,
} from "../../scripts/component-size-baseline.mjs";

const root = join(__dirname, "..", "..");
const baseline: { _threshold: number; files: Record<string, number> } = JSON.parse(
  readFileSync(join(root, BASELINE_PATH), "utf8"),
);

describe("god components (non-test .tsx over the line threshold) only shrink, per file", () => {
  const { scanned, sizes } = componentSizes(root);

  it("scans the real source tree", () => {
    // A walker that read nothing would report no oversized files and "pass".
    expect(scanned).toBeGreaterThan(400);
    expect(Object.keys(oversized(sizes)).length).toBeGreaterThan(20);
    expect(Object.keys(baseline.files).length).toBeGreaterThan(20);
    expect(sizes["src/components/JobTracking.tsx"]).toBeGreaterThan(THRESHOLD);
    expect(Object.keys(sizes).filter(isTestFile), "test files must not be counted").toEqual([]);
    expect(baseline._threshold, "baseline was generated at a different threshold").toBe(THRESHOLD);
  });

  it("every oversized component's line count equals the baseline", () => {
    const problems = compare(sizes, baseline.files);
    expect(problems, problems.join("\n")).toEqual([]);
  });

  it("the comparison fails in every direction (fixture)", () => {
    const base = { "src/a.tsx": 700, "src/b.tsx": 650, "src/gone.tsx": 800 };
    const problems = compare(
      { "src/a.tsx": 701, "src/b.tsx": 640, "src/c.tsx": 601, "src/d.tsx": 600 },
      base,
    ).join("\n");
    expect(problems).toMatch(/src\/a\.tsx: GREW from 700 to 701/);
    expect(problems).toMatch(/src\/b\.tsx: SHRANK from 650 to 640/);
    expect(problems).toMatch(/src\/c\.tsx: NEW god component/);
    expect(problems).toMatch(/src\/gone\.tsx: .*no longer exists/);
    expect(problems).not.toMatch(/src\/d\.tsx/); // exactly THRESHOLD is not oversized
    expect(compare({ "src/b.tsx": 600 }, { "src/b.tsx": 650 }).join("\n")).toMatch(/at or under the 600-line threshold/);
    expect(compare({ "src/a.tsx": 700 }, { "src/a.tsx": 700 })).toEqual([]);
  });

  it("counts lines exactly like wc -l", () => {
    expect(countLines("")).toBe(0);
    expect(countLines("a")).toBe(0);
    expect(countLines("a\n")).toBe(1);
    expect(countLines("a\nb\n")).toBe(2);
  });

  it("baseline entries are positive integers over the threshold", () => {
    for (const [file, n] of Object.entries(baseline.files)) {
      expect(Number.isInteger(n) && n > THRESHOLD, `${file}: ${n}`).toBe(true);
    }
  });
});
