// Earnings breakdown — Money › More insights.
//
// Spec v2 rebuild (audit 2026-10-21): one palette, real data only.
//
//  1. Take-home by job category (`jobs.category`, formatCategory — the same
//     bucketing fetchAnalytics uses) as a RANKED BAR LIST: one olive hue for
//     magnitude, the amount in rust text beside each bar. It was a six-hue
//     donut (sienna, bark, verdigris, gold, blue, plum) that was also caught
//     mid-animation with a gap in its ring — a rainbow encoding a ranking.
//
//  2. This year's take-home, month by month (running total), one olive line.
//     Last year's line and the "% vs last year" figure render ONLY when last
//     year has real earnings: a flat zero line labelled "2025" compared the
//     member against a year they were not here for.
//
// Renders nothing when there's no qualifying data so the Earnings tab
// stays compact for brand-new helpers.

import { useMemo } from "react";
import { formatCategory, formatPriceExact } from "@/lib/format";
import { earnedByJob } from "@/components/profile/earningsTab/earningsTabHelpers";
import {
  Tooltip, ResponsiveContainer,
  LineChart, Line, XAxis, YAxis, CartesianGrid, Legend,
} from "recharts";
import type { ReadableJobRow } from "@/lib/jobColumns";
import { isEarnedJob } from "@/components/profile/earningsTab/earningsTabHelpers";

// jobs.offered_to_helper_id is not client-selectable (20260915045110).
type Job = ReadableJobRow;

interface EarningsBreakdownChartsProps {
  earningsJobs: Job[];
  // Fee % to apply when a job row predates the per-job helper_fee_percent
  // column. Tier-derived by the caller so every earnings surface agrees
  // (analytics/work-record already resolve from the tier).
  feeFallbackPercent: number;
  /** The one-time setup fee owed from the first payout (dollars) and the payout ledger:
   *  the same inputs as the Earned card, so the categories add up to it. */
  firstPayoutFee: number;
  ledger: Parameters<typeof earnedByJob>[3];
}

/** A design token resolved to a colour string. Recharts writes `stroke` as an
 *  SVG presentation ATTRIBUTE, where `var()` does not resolve, so the token is
 *  read once per render from the live document (light or dark). */
const token = (name: string, fallback: string): string => {
  if (typeof window === "undefined") return fallback;
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return v ? `hsl(${v})` : fallback;
};

// Display bucket for a job's category. "Other" catches a blank category
// so the job still shows in the pie instead of vanishing.
const bucketFor = (category: string | null | undefined): string => {
  const label = formatCategory(category ?? "");
  return label || "Other";
};

// Tail accessor for the per-job timestamp — prefers helper completion
// stamp, falling back to created_at for older rows that predate it.
const completionTime = (job: Job): number => {
  const helper = (job as unknown as { helper_completed_at?: string | null }).helper_completed_at;
  if (helper) return new Date(helper).getTime();
  return new Date(job.created_at).getTime();
};

export function EarningsBreakdownCharts({ earningsJobs, feeFallbackPercent, firstPayoutFee, ledger }: EarningsBreakdownChartsProps) {
  // Same definition as the Earned card these charts sit under — `isEarnedJob`,
  // not `status === "completed"`. Two money figures on one screen totalling
  // different sets of jobs is the defect this screen keeps producing; a
  // refunded or charged-back job is `completed` forever and belonged to
  // neither.
  const completed = earningsJobs.filter(isEarnedJob);
  const now = new Date();
  const ytdYear = now.getFullYear();
  const priorYtdYear = ytdYear - 1;

  // Each job's figure is the Earned card's own (what was transferred, else the
  // computed take-home), and the setup fee still owed comes off once below, so
  // the list adds up to Earned exactly (owner 2026-10-21: $804 vs $802).
  const { byJob, feeOwed } = useMemo(
    () => earnedByJob(completed, feeFallbackPercent, firstPayoutFee, ledger),
    [completed, feeFallbackPercent, firstPayoutFee, ledger],
  );
  const jobDollars = (j: Job) => byJob.get(j.id) ?? 0;

  // ── Category data: every earned dollar, top five and the rest as "Everything else" ──
  const { pieData, categoriesTotal } = useMemo(() => {
    const totals = new Map<string, number>();
    completed.forEach((j) => {
      const key = bucketFor(j.category);
      totals.set(key, (totals.get(key) ?? 0) + jobDollars(j));
    });
    const sorted = Array.from(totals.entries())
      .map(([name, value]) => ({ name, value: Math.round(value * 100) / 100 }))
      .filter((d) => d.value > 0)
      .sort((a, b) => b.value - a.value);
    const shown = sorted.length > 6 ? sorted.slice(0, 5) : sorted;
    const restValue = sorted.slice(shown.length).reduce((s, d) => s + d.value, 0);
    return {
      pieData: restValue > 0 ? [...shown, { name: "Everything else", value: Math.round(restValue * 100) / 100 }] : shown,
      categoriesTotal: sorted.reduce((s, d) => s + d.value, 0),
    };
  }, [completed, byJob]);

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
        monthly[d.getMonth()] += jobDollars(j);
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
  }, [completed, ytdYear, priorYtdYear, now, byJob]);

  const ytdTotal = trendData[now.getMonth()]?.ytd ?? 0;
  const priorAtSameMonth = trendData[now.getMonth()]?.prior ?? 0;
  // Year-over-year delta — positive = up vs same month last year.
  const yoyDelta = ytdTotal - priorAtSameMonth;
  const yoyPct =
    priorAtSameMonth > 0
      ? Math.round((yoyDelta / priorAtSameMonth) * 100)
      : null;

  // No empty charts: with no data it says so in one line (below). The trend is meaningful even with one year of data,
  // but the pie needs at least one completed job — gate on that.
  const hasPieData = pieData.length > 0;
  const hasPriorYear = trendData.some((d) => d.prior > 0);
  const hasTrendData = trendData.some((d) => (d.ytd ?? 0) > 0) || hasPriorYear;
  const olive = token("--bark", "hsl(70, 20%, 33%)");
  const muted = token("--muted-foreground", "hsl(40, 6%, 40%)");
  const maxCategory = pieData[0]?.value ?? 0;
  // B81 (2026-11-01): Money's "More insights" opened onto nothing for a member with no earnings yet (the panel's only
  // content hid itself), so the tap looked dead. It now says why it is empty. Guard: moreInsightsNeverOpensEmpty.test.tsx.
  if (!hasPieData && !hasTrendData) {
    return (
      <p className="rounded-[20px] liquid-glass p-card text-ds-13 text-muted-foreground" data-insights-empty="">
        Nothing to chart yet. Once a job or a sale pays you, this shows where your money comes from, by category and month.
      </p>
    );
  }

  return (
    <section className="space-y-3">
      <h2 className="font-sans font-bold leading-tight text-ds-17 text-foreground px-1">
        Where your money comes from
      </h2>

      {hasPieData && (
        <div className="rounded-[20px] liquid-glass p-card">
          <ul className="space-y-3" aria-label="Take-home by job category">
            {pieData.map((d) => (
              <li key={d.name} className="space-y-1">
                <div className="flex items-baseline justify-between gap-3 text-ds-13">
                  <span className="font-medium text-foreground truncate">{d.name}</span>
                  <span className="font-semibold tabular-nums shrink-0" style={{ color: "hsl(var(--accent-ink))" }}>
                    ${formatPriceExact(d.value)}
                  </span>
                </div>
                <div className="h-2 rounded-full bg-muted overflow-hidden" aria-hidden>
                  <div
                    className="h-full rounded-full bg-primary"
                    style={{ width: `${maxCategory > 0 ? Math.max(2, Math.round((d.value / maxCategory) * 100)) : 0}%` }}
                  />
                </div>
              </li>
            ))}
          </ul>
          {/* The reconciliation, only when there is something to reconcile: the
              setup fee still to come off the next payout, then the Earned figure. */}
          {feeOwed > 0 && (
            <dl className="mt-3 pt-3 border-t border-border/60 space-y-1 text-ds-13" data-testid="insights-reconcile">
              <div className="flex justify-between gap-3">
                <dt className="text-muted-foreground">One-time setup fee, from your next payout</dt>
                <dd className="tabular-nums font-semibold whitespace-nowrap" style={{ color: "hsl(var(--accent-ink))" }}>−${formatPriceExact(feeOwed)}</dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="font-semibold text-foreground">Earned, all time</dt>
                <dd className="tabular-nums font-bold" style={{ color: "hsl(var(--accent-ink))" }}>${formatPriceExact(categoriesTotal - feeOwed)}</dd>
              </div>
            </dl>
          )}
        </div>
      )}

      {hasTrendData && (
        <div className="rounded-[20px] liquid-glass p-card">
          <div className="flex items-baseline justify-between gap-2 mb-1 flex-wrap">
            <p className="font-sans text-ds-13 font-semibold text-foreground">
              {hasPriorYear ? `${ytdYear} vs ${priorYtdYear}, running total` : `${ytdYear}, running total`}
            </p>
            {hasPriorYear && yoyPct !== null && (
              <span className="font-sans font-bold tabular-nums text-ds-13 text-foreground">
                {yoyDelta >= 0 ? "+" : ""}{yoyPct}% vs {priorYtdYear}
              </span>
            )}
          </div>
          <div className="h-[200px] w-full">
            <ResponsiveContainer width="100%" height="100%" minHeight={200}>
              <LineChart data={trendData} margin={{ top: 4, right: 8, left: -10, bottom: 0 }}>
                <CartesianGrid stroke={muted} strokeOpacity={0.15} vertical={false} />
                <XAxis
                  dataKey="month"
                  tick={{ fontSize: 11, fill: muted }}
                  axisLine={{ stroke: muted, strokeOpacity: 0.3 }}
                  tickLine={false}
                />
                <YAxis
                  tick={{ fontSize: 11, fill: muted }}
                  axisLine={false}
                  tickLine={false}
                  width={44}
                  tickFormatter={(v: number) => `$${v >= 1000 ? Math.round(v / 100) / 10 + "k" : v}`}
                />
                <Tooltip
                  formatter={(value, name) => [`$${formatPriceExact(Number(value))}`, String(name)]}
                  contentStyle={{
                    background: "hsl(var(--card))",
                    border: "1px solid hsl(var(--border))",
                    borderRadius: 14,
                    fontSize: "0.8rem",
                  }}
                />
                {hasPriorYear && <Legend verticalAlign="bottom" wrapperStyle={{ fontSize: "0.75rem" }} />}
                {hasPriorYear && (
                  <Line
                    type="monotone"
                    dataKey="prior"
                    stroke={muted}
                    strokeDasharray="4 4"
                    strokeWidth={2}
                    dot={false}
                    isAnimationActive={false}
                    name={String(priorYtdYear)}
                  />
                )}
                <Line
                  type="monotone"
                  dataKey="ytd"
                  stroke={olive}
                  strokeWidth={2}
                  dot={{ r: 3, fill: olive, strokeWidth: 0 }}
                  connectNulls={false}
                  isAnimationActive={false}
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
