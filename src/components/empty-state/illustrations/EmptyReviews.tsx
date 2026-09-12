/**
 * Five-star row for the empty reviews state.
 *
 * Every star is the SAME path translated by 22px, generated from one template
 * rather than hand-written five times. The previous version was written out by
 * hand and two of the five were wrong: the first was a 14-vertex blob that did
 * not resolve into a star at all (it read as a torn shape overlapping the row),
 * and the last was truncated against the right edge of the viewBox, so its
 * outer point folded inward. Both are visible at the size this renders.
 *
 * The leading star is filled to read as "the first one you'll earn"; the rest
 * are outlines.
 */
/* STRIDE 26, NOT 22. Each star is 24 units wide (x → x+24), so a 22-unit
   stride OVERLAPPED every neighbour by 2 units: the five points ran into each
   other and the row read as one torn shape rather than five stars — plainly
   visible in a 375 screenshot of the reviews empty state, and invisible to any
   measurement of the SVG box. 26 leaves a clean 2-unit gap. */
const STAR_XS = [3, 29, 55, 81, 107] as const;

/** One five-pointed star, top-left anchored at (x, 36). */
function starPath(x: number): string {
  return [
    `M${x} 58`,
    `L${x + 4} 50`,
    `L${x} 44`,
    `L${x + 8} 44`,
    `L${x + 12} 36`,
    `L${x + 16} 44`,
    `L${x + 24} 44`,
    `L${x + 18} 50`,
    `L${x + 20} 58`,
    `L${x + 12} 54`,
    "Z",
  ].join(" ");
}

export function EmptyReviews({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      // Cropped to the row's actual bounds instead of the shared 0 0 120 120.
      // The stars occupy y36-58 — 22 of 120 units, 18% of the box — so at the
      // shared `h-24 w-24` roughly 78px of the 96px render was empty air, and
      // the gap between the stars and "No reviews yet" read as a layout bug.
      // A five-star row is inherently wide and short; the other five
      // illustrations genuinely fill their square, so this one gets a viewBox
      // that matches its shape (and a non-square default in
      // EmptyStateIllustration) rather than being letterboxed inside theirs.
      // FOUR units of air on every side, not two (owner, 2026-09-11: the
      // reviews empty state crowds its title). The ink runs x4–116, y36–58,
      // so `2 34 116 26` hugged it at 2 units — with a 1.5-wide stroke that
      // is barely half a stroke of clearance, and because the box IS the
      // layout box, a glyph that tight sat hard against "No reviews yet"
      // below it. `0 32 120 30` keeps the row centred (the ink is already
      // centred in 0–134) and gives the illustration a box that matches its
      // visual weight.
      viewBox="0 32 134 30"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {STAR_XS.map((x, i) => (
        <path
          key={x}
          d={starPath(x)}
          fill={i === 0 ? "currentColor" : "none"}
          fillOpacity={i === 0 ? 0.15 : undefined}
        />
      ))}
    </svg>
  );
}
