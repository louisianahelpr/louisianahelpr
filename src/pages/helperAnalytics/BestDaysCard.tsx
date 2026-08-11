import { Calendar } from "lucide-react";
import SectionCard from "./SectionCard";
import { DOW_LABELS } from "./analyticsUtils";
import type { Analytics } from "./fetchAnalytics";

interface BestDaysCardProps {
  analytics: Analytics | undefined;
  hasAccess: boolean;
  isLoading: boolean;
  onUpgrade: () => void;
}

const BestDaysCard = ({ analytics, hasAccess, isLoading, onUpgrade }: BestDaysCardProps) => {
  return (
    <SectionCard
      title="Best days to work"
      icon={<Calendar className="w-4 h-4" />}
      hasAccess={hasAccess}
      isLoading={isLoading}
      onUpgrade={onUpgrade}
      lockedPreview="See which weekdays book fastest for you and plan your availability."
    >
      {analytics && (
        <div>
          {analytics.sortedDow[0].count > 0 ? (
            <>
              <p className="text-ds-13 font-semibold mb-3" style={{ color: "hsl(var(--ink-deep))" }}>
                You close most jobs on{" "}
                <span style={{ color: "hsl(var(--burnt-sienna))" }}>
                  {analytics.sortedDow[0].label}
                </span>
                {analytics.sortedDow[1].count > 0 && (
                  <>
                    {" > "}
                    <span style={{ color: "hsl(var(--bark))" }}>{analytics.sortedDow[1].label}</span>
                  </>
                )}
                {analytics.sortedDow[2].count > 0 && (
                  <>
                    {" > "}
                    <span className="text-muted-foreground">{analytics.sortedDow[2].label}</span>
                  </>
                )}
              </p>
              <div className="flex items-end gap-1.5 h-16">
                {DOW_LABELS.map((day) => {
                  const count = analytics.sortedDow.find((d) => d.label === day)?.count ?? 0;
                  const maxCount = Math.max(...analytics.sortedDow.map((d) => d.count), 1);
                  const heightPct = Math.max(6, Math.round((count / maxCount) * 100));
                  return (
                    <div key={day} className="flex-1 flex flex-col items-center gap-1">
                      <div
                        className="w-full rounded-t-sm"
                        style={{
                          height: `${heightPct}%`,
                          minHeight: "4px",
                          background: count > 0
                            ? "hsl(var(--bark) / 0.70)"
                            : "hsl(var(--olivewood) / 0.12)",
                        }}
                      />
                      <span className="text-ds-9 text-muted-foreground">{day.slice(0, 2)}</span>
                    </div>
                  );
                })}
              </div>
            </>
          ) : (
            <p className="text-ds-12 text-muted-foreground text-center py-2">
              Complete jobs to see your best working days.
            </p>
          )}
        </div>
      )}
    </SectionCard>
  );
};

export default BestDaysCard;
