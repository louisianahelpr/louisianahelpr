// Tiny 24hr donut clock — visual decoder for the quiet-hours window.
//
// Translates `HH:MM` start/end strings into an SVG arc on a 24hr clock
// face (midnight at top, noon at bottom). Wraps cleanly across midnight
// — a window like 22:00→07:00 renders as a single continuous muted arc
// that spans midnight, not two arcs.
//
// Pure visual: no clicks, no tooltips. Decorative — `aria-hidden` so
// screen readers ignore it (the inline From/To time pickers are the
// authoritative control).

interface QuietHoursClockProps {
  /** Quiet-window start in `HH:MM` (24hr local). */
  start: string;
  /** Quiet-window end in `HH:MM` (24hr local). */
  end: string;
  /** Pixel size of the donut. Defaults to 48. */
  size?: number;
}

// Convert "HH:MM" → fractional hours [0, 24). Tolerates a trailing
// ":SS" (Postgres `time` column) by slicing to the first 5 chars.
const parseTime = (hhmm: string): number => {
  const trimmed = hhmm.slice(0, 5);
  const [hStr, mStr] = trimmed.split(":");
  const h = Number(hStr);
  const m = Number(mStr);
  if (!Number.isFinite(h) || !Number.isFinite(m)) return 0;
  return (h + m / 60) % 24;
};

// Angle on the clock face for an hour value. 0h = top (−90°), advancing
// clockwise. SVG y-axis grows down, so cos→x and sin→y.
const hourToPoint = (hour: number, cx: number, cy: number, r: number) => {
  const theta = (hour / 24) * Math.PI * 2 - Math.PI / 2;
  return { x: cx + r * Math.cos(theta), y: cy + r * Math.sin(theta) };
};

export function QuietHoursClock({ start, end, size = 48 }: QuietHoursClockProps) {
  const startH = parseTime(start);
  const endH = parseTime(end);
  // Forward span across the 24hr face — wraps midnight cleanly so a
  // 22→07 window renders as a 9hr continuous arc, not split.
  const span = (endH - startH + 24) % 24;
  const largeArc = span > 12 ? 1 : 0;

  const cx = size / 2;
  const cy = size / 2;
  const stroke = Math.max(4, size * 0.18);
  const r = (size - stroke) / 2;

  const startP = hourToPoint(startH, cx, cy, r);
  const endP = hourToPoint(endH, cx, cy, r);

  // Edge cases: span 0 (start==end) — render an empty face so the
  // user sees "no muted window". Span exactly 24 — render a full ring
  // (start≈end after wrap). We treat span < 0.01 hr as "empty".
  const hasArc = span > 0.01;

  // Tick marks at 0/6/12/18 — minimal orientation cues so the user can
  // read which hours are muted. Subtle so they don't fight the arc.
  const ticks = [0, 6, 12, 18];

  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      aria-hidden="true"
      role="img"
      style={{ flexShrink: 0 }}
    >
      {/* Base ring — every hour, in a quiet ivory tone. */}
      <circle
        cx={cx}
        cy={cy}
        r={r}
        fill="none"
        stroke="hsl(var(--ivory-sand))"
        strokeWidth={stroke}
        opacity={0.7}
      />
      {/* Muted-window arc — burnt-sienna on a near-full-opacity stroke
          so it reads against the ivory base on every theme. */}
      {hasArc && (
        <path
          d={`M ${startP.x} ${startP.y} A ${r} ${r} 0 ${largeArc} 1 ${endP.x} ${endP.y}`}
          fill="none"
          stroke="hsl(var(--bark))"
          strokeWidth={stroke}
          strokeLinecap="round"
          opacity={0.78}
        />
      )}
      {/* Hour ticks — 12 o'clock (midnight) tick is slightly stronger
          so the user has an anchor for "top = midnight". */}
      {ticks.map((h) => {
        const inner = hourToPoint(h, cx, cy, r - stroke / 2 - 1);
        const outer = hourToPoint(h, cx, cy, r + stroke / 2 + 1);
        return (
          <line
            key={h}
            x1={inner.x}
            y1={inner.y}
            x2={outer.x}
            y2={outer.y}
            stroke="hsl(var(--olivewood))"
            strokeWidth={h === 0 ? 1.1 : 0.7}
            opacity={h === 0 ? 0.55 : 0.35}
            strokeLinecap="round"
          />
        );
      })}
      {/* Moon glyph in the dial — pure decoration to anchor "this means
          quiet". A small filled circle ≈ moon body. */}
      <circle
        cx={cx}
        cy={cy}
        r={Math.max(1.5, size * 0.06)}
        fill="hsl(var(--bark))"
        opacity={0.55}
      />
    </svg>
  );
}
