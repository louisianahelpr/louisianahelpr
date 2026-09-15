import { describe, it, expect } from "vitest";

import { STAR_CENTRES_X, starPath } from "./EmptyReviews";

/**
 * VN-36 (owner, 2026-09-14): the empty-reviews stars read as crammed. The old
 * template was lopsided (bottom points not mirror images) and neighbours were
 * 2 units apart. Guard: each star is mirror-symmetric, strides are equal, and
 * neighbouring stars keep real air between them.
 */
function points(d: string): [number, number][] {
  return [...d.matchAll(/[ML](-?[\d.]+) (-?[\d.]+)/g)].map((m) => [Number(m[1]), Number(m[2])]);
}

describe("EmptyReviews star row", () => {
  it("draws five mirror-symmetric stars", () => {
    expect(STAR_CENTRES_X).toHaveLength(5);
    for (const cx of STAR_CENTRES_X) {
      const pts = points(starPath(cx));
      expect(pts).toHaveLength(10);
      for (const [x, y] of pts) {
        const mirrored = pts.some(([mx, my]) => Math.abs(mx - (2 * cx - x)) < 0.02 && Math.abs(my - y) < 0.02);
        expect(mirrored).toBe(true);
      }
    }
  });

  it("spaces the stars evenly with a clear gap", () => {
    const strides = STAR_CENTRES_X.slice(1).map((x, i) => x - STAR_CENTRES_X[i]);
    expect(new Set(strides).size).toBe(1);
    const a = points(starPath(STAR_CENTRES_X[0]));
    const b = points(starPath(STAR_CENTRES_X[1]));
    const gap = Math.min(...b.map((p) => p[0])) - Math.max(...a.map((p) => p[0]));
    expect(gap).toBeGreaterThanOrEqual(6);
  });
});
