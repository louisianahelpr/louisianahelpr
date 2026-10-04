import { lazy } from "react";
import { HelprSpinner } from "@/components/ui/HelprSpinner";

/** The uppercase eyebrow the Dashboard home already uses to head a group of
 *  tiles. Twenty-odd cards down one column with no grouping is a list, not a
 *  dashboard — these four labels are what make it scannable.
 *  The negative bottom margin pulls the label back against the block it heads:
 *  AdminViewShell's rhythm spaces every child equally, which would leave the
 *  eyebrow floating exactly halfway between the group it labels and the one
 *  above it. */
export const SectionLabel = ({ children }: { children: React.ReactNode }) => (
  <p className="-mb-2 sm:-mb-3 text-ds-10 sm:text-ds-11 font-semibold text-muted-foreground uppercase tracking-widest">
    {children}
  </p>
);

// Lazy-load charts so recharts (~250 KB pre-gzip) lands in its own chunk
// instead of inflating the AdminAnalytics initial bundle. Funnel cards +
// metric tiles paint immediately while charts hydrate in the background.
export const SubscriberPieChart = lazy(() =>
  import("../AdminAnalyticsCharts").then((m) => ({ default: m.SubscriberPieChart }))
);
export const RevenueLineChart = lazy(() =>
  import("../AdminAnalyticsCharts").then((m) => ({ default: m.RevenueLineChart }))
);
export const MonthlyJobsBarChart = lazy(() =>
  import("../AdminAnalyticsCharts").then((m) => ({ default: m.MonthlyJobsBarChart }))
);

export const ChartFallback = () => (
  <div className="flex h-full w-full items-center justify-center">
    <HelprSpinner size={20} />
  </div>
);
