import { TrendingUp } from "lucide-react";
import SectionCard from "./SectionCard";
import type { Analytics } from "./fetchAnalytics";

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
      lockedPreview="Track month-over-month earnings trends and spot your best months."
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
                  {m.amount > 0 ? `$${Math.round(m.amount)}` : ""}
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
