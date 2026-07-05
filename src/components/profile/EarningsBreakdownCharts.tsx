// Earnings breakdown — small Recharts panel.
//
// Two visualisations on the same surface:
//
//  1. Pie of earnings by job category (skills slice from each
//     completed job). Skills is a free-text string; we bucket on the
//     first comma-separated token so a helper who's tagged "Painting"
//     and "Lawn care, painting" rolls under the same "Painting"
//     bucket. The slice is purely visual — not for tax math.
//
//  2. YTD vs prior YTD month-by-month comparison. Cumulative line
//     instead of bars so the divergence (or lack thereof) reads at a
//     glance on a small mobile viewport.
//
// Renders nothing when there's no qualifying data so the Earnings tab
// stays compact for brand-new helpers.

import { useMemo } from "react";
import { netUrgentFeeDollars } from "@/lib/stripeFees";
import {
  PieChart, Pie, Cell, Tooltip, ResponsiveContainer,
  LineChart, Line, XAxis, YAxis, CartesianGrid, Legend,
} from "recharts";
import type { Database } from "@/integrations/supabase/types";

type Job = Database["public"]["Tables"]["jobs"]["Row"];

interface EarningsBreakdownChartsProps {
  earningsJobs: Job[];
}

// Palette — five brand-ish hues sequenced for max contrast around the
// pie. We use bare hex/HSL values here because Recharts' SVG fills
// can't follow `hsl(var(--token))` runtime references (it copies the
// string into a `style` prop on the rendered <path>); a static palette
// keeps the chart legible without a runtime token-resolver.
const PIE_COLORS = [
  "hsl(20, 60%, 50%)",   // burnt sienna
  "hsl(70, 22%, 24%)",   // bark
  "hsl(165, 18%, 50%)",  // verdigris
  "hsl(38, 50%, 55%)",   // gold-warm
  "hsl(190, 35%, 45%)",  // dusty blue
  "hsl(280, 25%, 50%)",  // muted plum
];

// First comma-separated bucket from a free-text skills string. Falls
// back to "Other" so an unbucketed job still shows in the pie.
const bucketFor = (skills: string | null | undefined): string => {
  const raw = (skills ?? "").trim();
  if (!raw) return "Other";
  const first = raw.split(",")[0]?.trim();
  if (!first) return "Other";
  // Capitalize for display consistency.
  return first.charAt(0).toUpperCase() + first.slice(1);
};

// Helper take-home math, mirroring the EarningsTab logic. Centralized
// here so the pie + monthly-trend agree on what counts as "earned".
const helperTakeHome = (job: Job): number => {
  const helpers = job.is_group_job && job.helpers_needed ? job.helpers_needed : 1;
  const perHelper = job.budget / helpers;
  const commissionPercent = job.helper_fee_percent ?? 10;
  const commission = (perHelper * commissionPercent) / 100;
  return perHelper - commission + netUrgentFeeDollars(job.urgent_fee);
};

// Tail accessor for the per-job timestamp — prefers helper completion
// stamp, falling back to created_at for older rows that predate it.
const completionTime = (job: Job): number => {
  const helper = (job as unknown as { helper_completed_at?: string | null }).helper_completed_at;
  if (helper) return new Date(helper).getTime();
  return new Date(job.created_at).getTime();
};

export function EarningsBreakdownCharts({ earningsJobs }: EarningsBreakdownChartsProps) {
  const completed = earningsJobs.filter((j) => j.status === "completed");
  const now = new Date();
  const ytdYear = now.getFullYear();
  const priorYtdYear = ytdYear - 1;

  // ── Pie data — bucket completed-job take-home by skills bucket ──
  const pieData = useMemo(() => {
    const totals = new Map<string, number>();
    completed.forEach((j) => {
      const key = bucketFor((j as unknown as { skills?: string | null }).skills);
      totals.set(key, (totals.get(key) ?? 0) + helperTakeHome(j));
    });
    return Array.from(totals.entries())
      .map(([name, value]) => ({ name, value: Math.round(value * 100) / 100 }))
      .filter((d) => d.value > 0)
      .sort((a, b) => b.value - a.value)
      .slice(0, 6);
  }, [completed]);

  // ── YTD vs prior YTD — cumulative dollars by month index ────────
  // 12-element arrays; entry [i] is the cumulative running total
  // through month i+1. A short year (Jan–May) leaves [5..11] as the
  // last known total so the line plateaus instead of dipping to zero.
  const trendData = useMemo(() => {
    const cumul = (year: number): number[] => {
      const monthly = new Array(12).fill(0);
      completed.forEach((j) => {
        const t = completionTime(j);
        const d = new Date(t);
        if (d.getFullYear() !== year) return;
        monthly[d.getMonth()] += helperTakeHome(j);
      });
      const result: number[] = [];
      let running = 0;
      for (let i = 0; i < 12; i++) {
        running += monthly[i];
        result.push(Math.round(running * 100) / 100);
      }
      return result;
    };

    const ytd = cumul(ytdYear);
    const prior = cumul(priorYtdYear);
    const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    const currentMonth = now.getMonth();
    return months.map((m, i) => ({
      month: m,
      // Mask future months for the current year (would be a flat line
      // at the YTD total, which reads as "I earned that in December").
      // null tells Recharts to leave a gap.
      ytd: i <= currentMonth ? ytd[i] : null,
      prior: prior[i],
    }));
  }, [completed, ytdYear, priorYtdYear, now]);

  const ytdTotal = trendData[now.getMonth()]?.ytd ?? 0;
  const priorAtSameMonth = trendData[now.getMonth()]?.prior ?? 0;
  // Year-over-year delta — positive = up vs same month last year.
  const yoyDelta = ytdTotal - priorAtSameMonth;
  const yoyPct =
    priorAtSameMonth > 0
      ? Math.round((yoyDelta / priorAtSameMonth) * 100)
      : null;

  // Self-hide on no data: pre-onboarded helpers shouldn't see two
  // empty charts. The trend is meaningful even with one year of data,
  // but the pie needs at least one completed job — gate on that.
  const hasPieData = pieData.length > 0;
  const hasTrendData = trendData.some((d) => (d.ytd ?? 0) > 0 || d.prior > 0);
  if (!hasPieData && !hasTrendData) return null;

  return (
    <section className="space-y-3">
      <div>
        <p
          className="font-serif italic uppercase"
          style={{ fontSize: "0.62rem", color: "hsl(var(--burnt-sienna) / 0.78)", letterSpacing: "0.18em" }}
        >
          Breakdown
        </p>
        <h2
          className="font-display italic font-bold leading-tight text-headline-section"
          style={{ color: "hsl(var(--ink-deep))", letterSpacing: "-0.02em" }}
        >
          Where your money comes from
        </h2>
      </div>

      {hasPieData && (
        <div className="rounded-2xl liquid-glass p-4">
          <p
            className="font-serif italic uppercase mb-1"
            style={{ fontSize: "0.6rem", color: "hsl(var(--burnt-sienna) / 0.78)", letterSpacing: "0.18em" }}
          >
            By category
          </p>
          <div className="h-[180px] w-full">
            <ResponsiveContainer width="100%" height="100%" minHeight={180}>
              <PieChart>
                <Pie
                  data={pieData}
                  dataKey="value"
                  nameKey="name"
                  innerRadius={36}
                  outerRadius={70}
                  paddingAngle={2}
                  stroke="hsl(var(--ivory-sand))"
                  strokeWidth={1}
                >
                  {pieData.map((_, i) => (
                    <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip
                  formatter={(value) => [`$${Number(value).toFixed(2)}`, "Take-home"]}
                  contentStyle={{
                    background: "hsl(var(--ivory-sand) / 0.95)",
                    border: "0.5px solid hsl(var(--olivewood) / 0.18)",
                    borderRadius: 8,
                    fontSize: "0.78rem",
                  }}
                />
                <Legend
                  verticalAlign="bottom"
                  wrapperStyle={{ fontSize: "0.7rem" }}
                />
              </PieChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      {hasTrendData && (
        <div className="rounded-2xl liquid-glass p-4">
          <div className="flex items-baseline justify-between gap-2 mb-1 flex-wrap">
            <p
              className="font-serif italic uppercase"
              style={{ fontSize: "0.6rem", color: "hsl(var(--burnt-sienna) / 0.78)", letterSpacing: "0.18em" }}
            >
              {ytdYear} vs {priorYtdYear}
            </p>
            {yoyPct !== null && (
              <span
                className="font-display italic font-bold tabular-nums"
                style={{
                  fontSize: "0.85rem",
                  color: yoyDelta >= 0 ? "hsl(var(--bark))" : "hsl(var(--burnt-sienna))",
                }}
              >
                {yoyDelta >= 0 ? "+" : ""}{yoyPct}% YoY
              </span>
            )}
          </div>
          <div className="h-[200px] w-full">
            <ResponsiveContainer width="100%" height="100%" minHeight={200}>
              <LineChart data={trendData} margin={{ top: 4, right: 8, left: -10, bottom: 0 }}>
                <CartesianGrid stroke="hsl(var(--olivewood))" strokeOpacity={0.08} vertical={false} />
                <XAxis
                  dataKey="month"
                  tick={{ fontSize: 10, fill: "hsl(var(--olivewood))" }}
                  axisLine={{ stroke: "hsl(var(--olivewood))", strokeOpacity: 0.2 }}
                  tickLine={false}
                />
                <YAxis
                  tick={{ fontSize: 10, fill: "hsl(var(--olivewood))" }}
                  axisLine={false}
                  tickLine={false}
                  width={44}
                  tickFormatter={(v: number) => `$${v >= 1000 ? Math.round(v / 100) / 10 + "k" : v}`}
                />
                <Tooltip
                  formatter={(value, name) => [`$${Number(value).toFixed(2)}`, String(name) === "ytd" ? String(ytdYear) : String(priorYtdYear)]}
                  contentStyle={{
                    background: "hsl(var(--ivory-sand) / 0.95)",
                    border: "0.5px solid hsl(var(--olivewood) / 0.18)",
                    borderRadius: 8,
                    fontSize: "0.78rem",
                  }}
                />
                <Line
                  type="monotone"
                  dataKey="prior"
                  stroke="hsl(var(--olivewood))"
                  strokeOpacity={0.35}
                  strokeWidth={2}
                  dot={false}
                  name={String(priorYtdYear)}
                />
                <Line
                  type="monotone"
                  dataKey="ytd"
                  stroke="hsl(20, 60%, 50%)"
                  strokeWidth={2.5}
                  dot={{ r: 2.5, fill: "hsl(20, 60%, 50%)" }}
                  connectNulls={false}
                  name={String(ytdYear)}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}
    </section>
  );
}

export default EarningsBreakdownCharts;
