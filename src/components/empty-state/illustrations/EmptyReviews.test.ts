import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { createElement } from "react";

import { EmptyReviews, STAR_CENTRES_X, starPath } from "./EmptyReviews";

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

  /*
   * The viewBox is computed from STRIDE × the star count, while the centres
   * are a separate hand-written array — two descriptions of one row. Neither
   * test above can see them disagree, and the failure mode is silent: the
   * glyph is simply clipped or floats off-centre in its box, which is the
   * class of defect the owner reported on 2026-09-11 ("the glyph must not sit
   * hard against 'No reviews yet'").
   *
   * So: render the real component, take the box it actually declares, and
   * check every point of every star lands inside it with air to spare.
   */
  it("keeps every star inside the viewBox it declares, with air on all sides", () => {
    const { container } = render(createElement(EmptyReviews));
    const svg = container.querySelector("svg")!;
    const [vx, vy, vw, vh] = svg.getAttribute("viewBox")!.split(/\s+/).map(Number);

    const paths = [...svg.querySelectorAll("path")];
    expect(paths, "one path per star").toHaveLength(STAR_CENTRES_X.length);

    const pts = paths.flatMap((p) => points(p.getAttribute("d")!));
    const xs = pts.map((p) => p[0]);
    const ys = pts.map((p) => p[1]);
    const stroke = Number(svg.getAttribute("strokeWidth") ?? svg.getAttribute("stroke-width") ?? 1.5);
    const pad = stroke / 2;

    expect(Math.min(...xs) - pad, "ink runs off the left edge").toBeGreaterThanOrEqual(vx);
    expect(Math.max(...xs) + pad, "ink runs off the right edge").toBeLessThanOrEqual(vx + vw);
    expect(Math.min(...ys) - pad, "ink runs off the top edge").toBeGreaterThanOrEqual(vy);
    expect(Math.max(...ys) + pad, "ink runs off the bottom edge").toBeLessThanOrEqual(vy + vh);

    // ...and centred in it, so the row does not drift to one side of its box.
    const inkCentre = (Math.min(...xs) + Math.max(...xs)) / 2;
    expect(Math.abs(inkCentre - (vx + vw / 2)), "row is off-centre in its box").toBeLessThan(1);
  });

  it("fills only the leading star, as 'the first one you'll earn'", () => {
    const { container } = render(createElement(EmptyReviews));
    const fills = [...container.querySelectorAll("path")].map((p) => p.getAttribute("fill"));
    expect(fills[0]).toBe("currentColor");
    expect(fills.slice(1).every((f) => f === "none")).toBe(true);
  });
});

// VN-36's original defect: a template whose points were not mirror images, so
// every star leaned.
// @mutate src/components/empty-state/illustrations/EmptyReviews.tsx | const r = i % 2 === 0 ? OUTER_R : INNER_R; | const r = i % 3 === 0 ? OUTER_R : INNER_R;
// The row's two descriptions (hand-written centres vs STRIDE-derived viewBox)
// drifting apart: uneven strides AND ink clipped by the box.
// @mutate src/components/empty-state/illustrations/EmptyReviews.tsx | export const STAR_CENTRES_X = [16, 48, 80, 112, 144] as const; | export const STAR_CENTRES_X = [16, 48, 80, 112, 170] as const;
