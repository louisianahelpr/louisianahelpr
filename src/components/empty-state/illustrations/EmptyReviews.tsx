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
const STAR_XS = [4, 26, 48, 70, 92] as const;

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
      viewBox="0 0 120 120"
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
