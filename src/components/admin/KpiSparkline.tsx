/**
 * KpiSparkline — tiny 10-point area chart for a KPI tile.
 *
 * Drawn as one inline SVG, not with recharts: recharts' chart core is a
 * 68 KB gz chunk (CartesianChart), and on /admin it was the largest file the
 * Dashboard fetched, for four 28 px trend lines (measured 2026-11-01, cwv-lab
 * admin, 375 Slow 4G + 4x CPU: requested at 7.8 s, done at 8.9 s). The curve
 * is the same monotone cubic recharts' `type="monotone"` draws (d3's
 * curveMonotoneX), over a 0..max value axis.
 *
 * Imported lazily from KpiCard.tsx.
 */
import { useId } from "react";

interface KpiSparklineProps {
  /** 10-point numeric series. Empty / all-zero arrays render nothing. */
  data: number[];
  /** Visual accent — matches the KPI tile's accent ring. */
  tone?: "primary" | "accent" | "destructive";
}

const STROKE: Record<string, string> = {
  primary: "hsl(var(--primary))",
  accent: "hsl(var(--accent))",
  destructive: "hsl(var(--destructive))",
};

/** viewBox size; the SVG stretches to the tile (preserveAspectRatio="none"). */
const W = 100;
const H = 28;
/** recharts' margin top of 1 px, so the peak's stroke is not clipped. */
const TOP = 1;

const sign = (n: number) => (n < 0 ? -1 : 1);

/**
 * d3's curveMonotoneX tangents (Fritsch-Carlson / Steffen): interior points
 * take the limited three-point slope, the ends the two-point one. Exported
 * for the test.
 */
export function monotoneTangents(xs: number[], ys: number[]): number[] {
  const n = xs.length;
  const t = new Array<number>(n).fill(0);
  if (n < 2) return t;
  if (n === 2) {
    const s = (ys[1] - ys[0]) / (xs[1] - xs[0]);
    return [s, s];
  }
  for (let i = 1; i < n - 1; i++) {
    const h0 = xs[i] - xs[i - 1], h1 = xs[i + 1] - xs[i];
    const s0 = (ys[i] - ys[i - 1]) / h0, s1 = (ys[i + 1] - ys[i]) / h1;
    const p = (s0 * h1 + s1 * h0) / (h0 + h1);
    t[i] = (sign(s0) + sign(s1)) * Math.min(Math.abs(s0), Math.abs(s1), 0.5 * Math.abs(p)) || 0;
  }
  const end = (i: number, j: number, tj: number) => {
    const h = xs[j] - xs[i];
    return h ? (3 * (ys[j] - ys[i]) / h - tj) / 2 : tj;
  };
  t[0] = end(0, 1, t[1]);
  t[n - 1] = end(n - 2, n - 1, t[n - 2]);
  return t;
}

/** The line's path ("M ... C ...") and the filled area under it, in viewBox units. Exported for the test. */
export function sparkPaths(data: number[]): { line: string; area: string } {
  const max = Math.max(...data, 0);
  const n = data.length;
  const xs = data.map((_, i) => (n === 1 ? W / 2 : (i * W) / (n - 1)));
  const ys = data.map((v) => (max > 0 ? TOP + (H - TOP) * (1 - Math.max(v, 0) / max) : H));
  const r = (v: number) => Math.round(v * 100) / 100;
  const t = monotoneTangents(xs, ys);
  let line = `M${r(xs[0])},${r(ys[0])}`;
  for (let i = 1; i < n; i++) {
    const dx = (xs[i] - xs[i - 1]) / 3;
    line += `C${r(xs[i - 1] + dx)},${r(ys[i - 1] + dx * t[i - 1])},${r(xs[i] - dx)},${r(ys[i] - dx * t[i])},${r(xs[i])},${r(ys[i])}`;
  }
  const area = `${line}L${r(xs[n - 1])},${H}L${r(xs[0])},${H}Z`;
  return { line, area };
}

const KpiSparkline = ({ data, tone = "primary" }: KpiSparklineProps) => {
  // useId must run before any early return — hooks are unconditional.
  // The gradient id was `kpiSpark-${tone}`, i.e. one of THREE strings for the
  // whole app, so the Dashboard's four KPI tiles emitted the same <linearGradient
  // id> more than once (axe: duplicate-id on /admin home). Duplicate SVG ids are
  // not cosmetic — `fill="url(#id)"` resolves to the FIRST match in the
  // document, so every tile of a given tone was painting with the first tile's
  // gradient node and would inherit its colour if the tones ever diverged.
  const uid = useId();
  if (!data || data.length === 0) return null;
  const allZero = data.every((n) => !n);
  if (allZero) return null;

  const colour = STROKE[tone] ?? STROKE.primary;
  const gradientId = `kpiSpark-${tone}-${uid.replace(/:/g, "")}`;
  const { line, area } = sparkPaths(data);

  // Decorative: the numbers are printed beside it. No tab stop and nothing
  // for assistive tech (the old recharts surface needed
  // accessibilityLayer={false} to stop being a hidden focusable element).
  return (
    <div className="h-7 -mx-1 mt-2 pointer-events-none" aria-hidden>
      <svg width="100%" height="100%" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" focusable="false" className="block overflow-visible">
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={colour} stopOpacity={0.32} />
            <stop offset="100%" stopColor={colour} stopOpacity={0} />
          </linearGradient>
        </defs>
        <path d={area} fill={`url(#${gradientId})`} stroke="none" />
        <path d={line} fill="none" stroke={colour} strokeWidth={1.5} vectorEffect="non-scaling-stroke" />
      </svg>
    </div>
  );
};

export default KpiSparkline;
