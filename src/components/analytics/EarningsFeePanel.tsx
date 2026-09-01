// Panel 1 — what you earned, and what it cost you to earn it.
//
// This is the panel that answers "is the subscription worth it?" without
// asking the helper to take anyone's word for it: the fee they actually paid,
// beside what the same jobs would have cost on the Free plan. Both halves come
// out of `src/lib/helperEarnings.ts`, so the totals here and the totals on the
// Earnings tab are the same arithmetic, not two guesses at it.
//
// It does NOT duplicate the free Earnings-tab charts. Those show take-home by
// category (a pie) and this-year-vs-last-year cumulative take-home (a line).
// Neither shows the fee split, which is the whole subject here.

import { lazy, Suspense } from "react";
import { HelprSpinner } from "@/components/ui/HelprSpinner";
import { AnalyticsPanel, StatTile } from "@/components/analytics/AnalyticsPanel";
import { NotEnoughYet } from "@/components/analytics/NotEnoughYet";
import {
  FREE_TIER_FEE_PERCENT,
  earningsByMonth,
  earningsTotals,
  money,
  type AnalyticsJob,
} from "@/lib/helperAnalytics";

const EarningsFeeChart = lazy(() =>
  import("@/components/analytics/AnalyticsCharts").then((m) => ({ default: m.EarningsFeeChart })),
);

const ChartFallback = () => (
  <div className="flex h-full w-full items-center justify-center">
    <HelprSpinner size={20} />
  </div>
);

interface EarningsFeePanelProps {
  jobs: AnalyticsJob[];
  feeFallbackPercent: number;
  windowLabel: string;
}

export function EarningsFeePanel({ jobs, feeFallbackPercent, windowLabel }: EarningsFeePanelProps) {
  const totals = earningsTotals(jobs, feeFallbackPercent);
  const months = earningsByMonth(jobs, feeFallbackPercent);

  if (!totals) {
    return (
      <AnalyticsPanel title="Earnings & fees" caption={`Completed jobs · last ${windowLabel}`}>
        <NotEnoughYet what="your earnings" have={0} need={1} unit="completed jobs" />
      </AnalyticsPanel>
    );
  }

  // Only claim a saving when there is one. A Free helper's saving is $0, and
  // "$0.00 saved" printed under a paid-plan heading is a worse answer than no
  // line at all.
  const showSaving = totals.savedVsFree > 0.005;

  return (
    <AnalyticsPanel
      title="Earnings & fees"
      caption={`${totals.jobs} completed ${totals.jobs === 1 ? "job" : "jobs"} · last ${windowLabel}`}
    >
      <div className="grid grid-cols-2 gap-2">
        <StatTile label="You kept" value={money(totals.takeHome)} tone="positive" />
        <StatTile
          label="Platform fees"
          value={money(totals.fees)}
          hint={
            totals.effectiveFeePercent !== null
              ? `${totals.effectiveFeePercent}% of ${money(totals.gross)}`
              : undefined
          }
        />
      </div>

      {showSaving && (
        <div
          className="rounded-xl px-3 py-2.5 text-ds-12 leading-snug"
          style={{
            background: "hsl(var(--bark) / 0.06)",
            border: "0.5px solid hsl(var(--bark) / 0.18)",
            color: "hsl(var(--olivewood))",
          }}
        >
          Your plan&rsquo;s lower commission saved you{" "}
          <span className="font-semibold tabular-nums" style={{ color: "hsl(var(--bark))" }}>
            {money(totals.savedVsFree)}
          </span>{" "}
          on these jobs. The same work on the Free plan&rsquo;s {FREE_TIER_FEE_PERCENT}% would have
          cost {money(totals.feesAtFreeRate)} in fees.
        </div>
      )}

      {months.length >= 2 ? (
        <div className="h-[200px] w-full">
          <Suspense fallback={<ChartFallback />}>
            <EarningsFeeChart data={months} />
          </Suspense>
        </div>
      ) : (
        <NotEnoughYet
          what="a month-by-month trend"
          have={months.length}
          need={2}
          unit="months with completed work"
        />
      )}
    </AnalyticsPanel>
  );
}
