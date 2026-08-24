import { TrendingUp } from "lucide-react";
import SectionCard from "./SectionCard";
import type { Analytics } from "./fetchAnalytics";
import { formatPrice } from "@/lib/format";

interface EarningsByMonthCardProps {
  analytics: Analytics | undefined;
  hasAccess: boolean;
  isLoading: boolean;
  onUpgrade: () => void;
}

const EarningsByMonthCard = ({ analytics, hasAccess, isLoading, onUpgrade }: EarningsByMonthCardProps) => {
  return (
    <SectionCard
      title="Earnings by month"
      icon={<TrendingUp className="w-4 h-4" />}
      hasAccess={hasAccess}
      isLoading={isLoading}
      onUpgrade={onUpgrade}
      /* Names what this card ADDS. The Earnings tab already shows a free
         cumulative YTD-vs-last-year line, so "track month-over-month earnings
         trends" described a chart the helpr could already see — a paywall
         selling something the page had given away. What is actually behind the
         lock is the per-month figure: a running total tells you the year is up,
         not which month carried it. */
      lockedPreview="A bar and a dollar figure for every month — the free year-to-date line only shows the running total."
    >
      {analytics && (
        <div className="flex items-end gap-2 h-28">
          {analytics.earningsMonths.map((m) => {
            const heightPct = analytics.maxEarnings > 0
              ? Math.max(4, Math.round((m.amount / analytics.maxEarnings) * 100))
              : 4;
            return (
              <div key={m.label} className="flex-1 flex flex-col items-center gap-1">
                <span className="text-ds-10 font-semibold" style={{ color: "hsl(var(--bark))" }}>
                  {m.amount > 0 ? `$${formatPrice(m.amount)}` : ""}
                </span>
                <div
                  className="w-full rounded-t-sm transition-all duration-500"
                  style={{
                    height: `${heightPct}%`,
                    minHeight: "4px",
                    background: m.amount > 0
                      ? "hsl(var(--burnt-sienna) / 0.80)"
                      : "hsl(var(--bark) / 0.18)",
                  }}
                />
                <span className="text-ds-10 text-muted-foreground">{m.label}</span>
              </div>
            );
          })}
        </div>
      )}
    </SectionCard>
  );
};

export default EarningsByMonthCard;
