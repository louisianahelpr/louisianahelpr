// The one recharts import on /analytics, isolated so it lands in its own lazy
// chunk — the same reason AdminAnalyticsCharts.tsx exists (recharts is ~250 KB
// pre-gzip and nothing above the fold needs it).
//
// Only the monthly earnings chart uses recharts. The category comparison, the
// funnel and the demand clock are laid out with CSS grid instead: they are
// small-multiple / matrix shapes that a charting library renders no better,
// and a hand-built grid cannot introduce the horizontal overflow that a
// fixed-width SVG can at 320px.

import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { EarningsMonth } from "@/lib/helperAnalytics";

// Two series, two roles: what the helper kept, and what the platform took.
// Bare HSL rather than `hsl(var(--token))` because recharts copies the string
// into a `style` prop on the rendered <path>, where a runtime var reference
// does not resolve — the same note EarningsBreakdownCharts.tsx carries.
const TAKE_HOME_FILL = "hsl(70, 22%, 34%)"; // bark
const FEE_FILL = "hsl(20, 60%, 62%)"; // burnt sienna, lightened so it reads as the minor share

const TOOLTIP_STYLE = {
  background: "hsl(var(--ivory-sand) / 0.97)",
  border: "0.5px solid hsl(var(--olivewood) / 0.18)",
  borderRadius: 8,
  fontSize: "0.78rem",
} as const;

const money = (v: number) => `$${Number(v).toFixed(2)}`;

export function EarningsFeeChart({ data }: { data: EarningsMonth[] }) {
  return (
    <ResponsiveContainer width="100%" height="100%" minHeight={200}>
      <BarChart data={data} margin={{ top: 4, right: 8, left: -12, bottom: 0 }}>
        <CartesianGrid stroke="hsl(var(--olivewood))" strokeOpacity={0.08} vertical={false} />
        <XAxis
          dataKey="label"
          tick={{ fontSize: 10, fill: "hsl(var(--olivewood))" }}
          tickLine={false}
          axisLine={false}
          interval="preserveStartEnd"
          minTickGap={8}
        />
        <YAxis
          width={44}
          tick={{ fontSize: 10, fill: "hsl(var(--olivewood))" }}
          tickLine={false}
          axisLine={false}
          tickFormatter={(v: number) => `$${v >= 1000 ? Math.round(v / 100) / 10 + "k" : v}`}
        />
        <Tooltip
          cursor={{ fill: "hsl(var(--olivewood) / 0.05)" }}
          contentStyle={TOOLTIP_STYLE}
          formatter={(value, name) => [money(value as number), name as string]}
        />
        <Legend
          wrapperStyle={{ fontSize: "0.7rem", color: "hsl(var(--olivewood))" }}
          iconType="circle"
          iconSize={8}
        />
        {/* Stacked so the bar's full height is the job's gross and the split
            reads as "what you kept / what it cost", not as two rival series.

            ANIMATION OFF, and this is not a preference. Recharts grows bars
            from zero over 1.5s by default, and for that second and a half the
            panel is a labelled, gridded, axis-scaled chart with NOTHING in the
            plot area — indistinguishable from "you earned nothing". Caught in
            a 375px screenshot taken 1.2s after load, which is exactly what a
            person on a slow phone sees. A page whose whole purpose is not
            showing a false zero does not get to show one for a second. */}
        <Bar dataKey="takeHome" name="You kept" stackId="m" fill={TAKE_HOME_FILL} isAnimationActive={false} />
        <Bar dataKey="fees" name="Platform fee" stackId="m" fill={FEE_FILL} radius={[4, 4, 0, 0]} isAnimationActive={false} />
      </BarChart>
    </ResponsiveContainer>
  );
}
