// Panel 2 — which kinds of work actually pay you, and how that compares to
// what the market is posting.
//
// The comparison is budget-to-budget on purpose. A helper's TAKE-HOME and a
// posted BUDGET are different quantities, and putting them side by side under
// one heading would invite the reader to subtract them. So the market column
// is compared against the helper's own median BUDGET, and their take-home is
// shown separately as what they actually banked.
//
// Two independent floors apply and they are reported separately, because they
// fail for different reasons: too few of YOUR jobs in a category (the median
// take-home is withheld) and too few MARKET jobs in it (the market median is
// withheld). One being short says nothing about the other.

import { AnalyticsPanel } from "@/components/analytics/AnalyticsPanel";
import { NotEnoughYet } from "@/components/analytics/NotEnoughYet";
import {
  categoryBreakdown,
  money,
  type AnalyticsFloors,
  type AnalyticsJob,
  type AnalyticsMarket,
} from "@/lib/helperAnalytics";
import { scopeLabel } from "@/lib/helperAnalytics";

interface CategoryPanelProps {
  jobs: AnalyticsJob[];
  feeFallbackPercent: number;
  floors: AnalyticsFloors;
  market: AnalyticsMarket | undefined;
  windowLabel: string;
}

export function CategoryPanel({
  jobs,
  feeFallbackPercent,
  floors,
  market,
  windowLabel,
}: CategoryPanelProps) {
  const rows = categoryBreakdown(jobs, feeFallbackPercent, floors, market?.rates ?? []);
  const maxTake = rows.reduce((m, r) => Math.max(m, r.takeHome), 0);

  if (rows.length === 0) {
    return (
      <AnalyticsPanel title="What pays you best" caption={`Completed jobs · last ${windowLabel}`}>
        <NotEnoughYet what="a breakdown by job type" have={0} need={1} unit="completed jobs" />
      </AnalyticsPanel>
    );
  }

  return (
    <AnalyticsPanel
      title="What pays you best"
      caption={
        <>
          Your completed jobs, last {windowLabel}. Market medians are posted budgets in{" "}
          {scopeLabel(market)} over the last {market?.window_days ?? 180} days.
        </>
      }
    >
      <ul className="space-y-2.5">
        {rows.map((r) => (
          <li key={r.category} className="min-w-0">
            <div className="flex items-baseline gap-2">
              <span
                className="text-ds-13 font-semibold truncate"
                style={{ color: "hsl(var(--ink-deep))" }}
              >
                {r.label}
              </span>
              <span className="text-ds-11" style={{ color: "hsl(var(--olivewood) / 0.55)" }}>
                {r.jobs} {r.jobs === 1 ? "job" : "jobs"}
              </span>
              <span
                className="ml-auto text-ds-13 font-semibold tabular-nums shrink-0"
                style={{ color: "hsl(var(--bark))" }}
              >
                {money(r.takeHome)}
              </span>
            </div>

            {/* Share-of-total bar. Purely a reading aid for the number above it,
                which is why it carries no axis and no separate label. */}
            <div
              className="mt-1 h-1.5 rounded-full overflow-hidden"
              style={{ background: "hsl(var(--olivewood) / 0.08)" }}
              aria-hidden="true"
            >
              <div
                className="h-full rounded-full"
                style={{
                  width: `${maxTake > 0 ? Math.max(3, (r.takeHome / maxTake) * 100) : 0}%`,
                  background: "hsl(var(--bark) / 0.55)",
                }}
              />
            </div>

            <div
              className="mt-1 flex flex-wrap items-baseline gap-x-3 gap-y-0.5 text-ds-11"
              style={{ color: "hsl(var(--olivewood) / 0.68)" }}
            >
              {r.medianTakeHome !== null ? (
                <span className="tabular-nums">
                  Typical take-home {money(r.medianTakeHome)}/job
                </span>
              ) : (
                <span>
                  Typical take-home needs {floors.category_jobs - r.jobs} more{" "}
                  {floors.category_jobs - r.jobs === 1 ? "job" : "jobs"}
                </span>
              )}
              {/* Three cases, and the middle one is the easy thing to miss:
                  the market median can be known while the helper's own is
                  still below its floor. Showing nothing there would withhold a
                  number that is measured and useful just because a DIFFERENT
                  number is not. */}
              {r.marketMedianBudget !== null && r.medianBudget !== null && (
                <span className="tabular-nums">
                  Your budget {money(r.medianBudget)} vs market {money(r.marketMedianBudget)}
                </span>
              )}
              {r.marketMedianBudget !== null && r.medianBudget === null && (
                <span className="tabular-nums">
                  Market median {money(r.marketMedianBudget)} across {r.marketJobs} postings
                </span>
              )}
              {r.marketMedianBudget === null && (
                <span>
                  Market rate: {r.marketJobs} of {floors.market_category_jobs} postings
                </span>
              )}
            </div>
          </li>
        ))}
      </ul>
    </AnalyticsPanel>
  );
}
