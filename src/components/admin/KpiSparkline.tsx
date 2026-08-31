/**
 * KpiSparkline — tiny 10-point area chart for a KPI tile.
 *
 * Imported lazily from Admin.tsx so recharts stays out of the
 * critical-path bundle for non-admin users.
 */
import { useId } from "react";
import { Area, AreaChart, ResponsiveContainer } from "recharts";

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

export const KpiSparkline = ({ data, tone = "primary" }: KpiSparklineProps) => {
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

  // recharts wants an array of objects.
  const series = data.map((v, i) => ({ i, v }));
  const colour = STROKE[tone] ?? STROKE.primary;
  const gradientId = `kpiSpark-${tone}-${uid.replace(/:/g, "")}`;

  return (
    <div className="h-7 -mx-1 mt-2 pointer-events-none" aria-hidden>
      <ResponsiveContainer width="100%" height="100%" minHeight={28}>
        {/* accessibilityLayer={false} is required, not optional. Recharts v3
            turns it ON by default, which puts tabIndex=0 on the chart surface
            for keyboard data navigation. Inside this aria-hidden wrapper that
            produces a focusable element hidden from assistive tech — axe's
            aria-hidden-focus, and in practice a keyboard tab stop that a
            screen-reader user lands on and is told nothing about. The chart is
            a decorative trend line whose numbers are already printed beside
            it, so the data-navigation layer has nothing to add here. */}
        <AreaChart accessibilityLayer={false} data={series} margin={{ top: 1, right: 0, bottom: 0, left: 0 }}>
          <defs>
            <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={colour} stopOpacity={0.32} />
              <stop offset="100%" stopColor={colour} stopOpacity={0} />
            </linearGradient>
          </defs>
          <Area
            type="monotone"
            dataKey="v"
            stroke={colour}
            strokeWidth={1.5}
            fill={`url(#${gradientId})`}
            isAnimationActive={false}
            dot={false}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
};

export default KpiSparkline;
