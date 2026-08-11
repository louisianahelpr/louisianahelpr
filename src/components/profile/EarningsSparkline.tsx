// Tiny, dependency-free SVG sparkline used as an earnings teaser on the
// Profile landing header. It draws a single polyline (plus a soft area
// fill) in a fixed viewBox — intentionally NOT a charting lib, so it adds
// zero bundle weight. The parent decides whether to render it; this
// component assumes it has been handed a usable series (>= 2 points) and
// only guards against degenerate geometry (a flat line).

interface EarningsSparklineProps {
  /** Earnings amount per bucket, oldest → newest (e.g. last 6 weeks). */
  values: number[];
  /** Accessible label for the whole figure. */
  label: string;
  /** SVG width/height in px. Kept small — this is a teaser, not a chart. */
  width?: number;
  height?: number;
  className?: string;
}

export function EarningsSparkline({
  values,
  label,
  width = 72,
  height = 28,
  className,
}: EarningsSparklineProps) {
  // Caller is responsible for the >=2 guard, but stay defensive so a bad
  // series can never throw / render a broken (NaN) path.
  if (values.length < 2) return null;

  const max = Math.max(...values);
  const min = Math.min(...values);
  // Flat series → draw a centered horizontal line rather than dividing by
  // a zero range (which would produce NaN coordinates).
  const range = max - min || 1;
  // Inset by the stroke half-width so the line never clips at the edges.
  const pad = 2;
  const innerW = width - pad * 2;
  const innerH = height - pad * 2;

  const points = values.map((v, i) => {
    const x = pad + (innerW * i) / (values.length - 1);
    // Invert Y: higher earnings sit nearer the top.
    const y = pad + innerH - ((v - min) / range) * innerH;
    return [x, y] as const;
  });

  const linePath = points
    .map(([x, y], i) => `${i === 0 ? "M" : "L"}${x.toFixed(2)},${y.toFixed(2)}`)
    .join(" ");
  // Close the area down to the baseline for the soft fill underneath.
  const areaPath =
    `${linePath} L${points[points.length - 1][0].toFixed(2)},${(height - pad).toFixed(2)}` +
    ` L${points[0][0].toFixed(2)},${(height - pad).toFixed(2)} Z`;

  const last = points[points.length - 1];

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      role="img"
      aria-label={label}
      className={className}
      preserveAspectRatio="none"
    >
      <path d={areaPath} fill="hsl(var(--burnt-sienna) / 0.14)" stroke="none" />
      <path
        d={linePath}
        fill="none"
        stroke="hsl(var(--burnt-sienna))"
        strokeWidth={1.75}
        strokeLinejoin="round"
        strokeLinecap="round"
      />
      {/* End-point dot — anchors the eye on the most recent week. */}
      <circle cx={last[0]} cy={last[1]} r={2} fill="hsl(var(--burnt-sienna))" />
    </svg>
  );
}
