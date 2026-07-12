import { BarChart2 } from "lucide-react";
import SectionCard from "./SectionCard";
import type { Analytics } from "./fetchAnalytics";

interface TopCategoriesCardProps {
  analytics: Analytics | undefined;
  hasAccess: boolean;
  isLoading: boolean;
  onUpgrade: () => void;
}

const TopCategoriesCard = ({ analytics, hasAccess, isLoading, onUpgrade }: TopCategoriesCardProps) => {
  return (
    <SectionCard
      title="Your best categories"
      icon={<BarChart2 className="w-4 h-4" />}
      hasAccess={hasAccess}
      isLoading={isLoading}
      onUpgrade={onUpgrade}
      lockedPreview="Rank which job categories earn you the most — and where to focus."
    >
      {analytics && (
        <div className="space-y-2.5">
          {analytics.topCategories.length > 0 ? (
            analytics.topCategories.map((cat) => (
              <div key={cat.label}>
                <div className="flex items-center justify-between mb-1">
                  <span className="text-ds-12 font-semibold" style={{ color: "hsl(var(--ink-deep))" }}>
                    {cat.label}
                  </span>
                  <span className="text-ds-12 font-bold tabular-nums" style={{ color: "hsl(var(--burnt-sienna))" }}>
                    {cat.pct}%
                  </span>
                </div>
                <div className="h-1.5 rounded-full bg-muted/50 overflow-hidden">
                  <div
                    className="h-full rounded-full transition-all duration-500"
                    style={{
                      width: `${cat.pct}%`,
                      background: "hsl(var(--burnt-sienna) / 0.70)",
                    }}
                  />
                </div>
              </div>
            ))
          ) : (
            <p className="text-ds-12 text-muted-foreground text-center py-2">
              Complete jobs to see your top categories.
            </p>
          )}
        </div>
      )}
    </SectionCard>
  );
};

export default TopCategoriesCard;
