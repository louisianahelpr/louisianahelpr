/**
 * Five-star row for the empty reviews state.
 *
 * Every star is the SAME regular five-pointed star, computed from one centre
 * and translated along the row, so all five are identical and evenly spaced.
 *
 * History: the hand-written row was replaced 2026-09 by a 10-vertex template
 * at a 22-then-26-unit stride. That template was not a regular star (its
 * bottom-left point sat 4 units further out than its bottom-right, so every
 * star leaned) and a 2-unit gap with round stroke joins still let neighbours
 * touch visually. Owner, 2026-09-14 (VN-36): "organize the stars better" —
 * the row read as crammed. Now: regular stars, 32-unit stride, ~9 units of
 * clear air between points.
 *
 * The leading star is filled to read as "the first one you'll earn"; the rest
 * are outlines.
 */

/** Row geometry, in viewBox units. */
const STRIDE = 32;
const OUTER_R = 12;
const INNER_R = 5.2;
const CENTRE_Y = 46;
export const STAR_CENTRES_X = [16, 48, 80, 112, 144] as const;

const round = (n: number) => Math.round(n * 100) / 100;

/** One regular five-pointed star centred at (cx, CENTRE_Y), point up. */
export function starPath(cx: number): string {
  const pts: string[] = [];
  for (let i = 0; i < 10; i++) {
    const r = i % 2 === 0 ? OUTER_R : INNER_R;
    const a = -Math.PI / 2 + (i * Math.PI) / 5;
    pts.push(`${i === 0 ? "M" : "L"}${round(cx + r * Math.cos(a))} ${round(CENTRE_Y + r * Math.sin(a))}`);
  }
  return `${pts.join(" ")} Z`;
}

export function EmptyReviews({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      // Cropped to the row's bounds, not the shared square 0 0 120 120: a
      // five-star row is wide and short. Ink runs x≈4.6–155.4, y34–55.7;
      // the box leaves ~4 units of air on every side (owner, 2026-09-11: the
      // glyph must not sit hard against "No reviews yet").
      viewBox={`0 30 ${STRIDE * STAR_CENTRES_X.length} 30`}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {STAR_CENTRES_X.map((cx, i) => (
        <path
          key={cx}
          d={starPath(cx)}
          fill={i === 0 ? "currentColor" : "none"}
          fillOpacity={i === 0 ? 0.15 : undefined}
        />
      ))}
    </svg>
  );
}
