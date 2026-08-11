import { RefreshCw } from "lucide-react";
import SectionCard from "./SectionCard";
import type { Analytics } from "./fetchAnalytics";

interface RepeatHireCardProps {
  analytics: Analytics | undefined;
  hasAccess: boolean;
  isLoading: boolean;
  onUpgrade: () => void;
}

const RepeatHireCard = ({ analytics, hasAccess, isLoading, onUpgrade }: RepeatHireCardProps) => {
  return (
    <SectionCard
      title="Repeat hire rate"
      icon={<RefreshCw className="w-4 h-4" />}
      hasAccess={hasAccess}
      isLoading={isLoading}
      onUpgrade={onUpgrade}
      lockedPreview="What share of your posters have hired you more than once."
    >
      {analytics && (
        <div className="text-center py-2 space-y-1">
          <p
            className="font-display italic font-bold"
            style={{ fontSize: "2.2rem", color: "hsl(var(--ink-deep))", letterSpacing: "-0.03em" }}
          >
            {analytics.repeatHirePercent}%
          </p>
          <p className="font-serif italic text-ds-12" style={{ color: "hsl(var(--olivewood) / 0.8)" }}>
            of posters hired you more than once
          </p>
          {analytics.repeatHirePercent !== null && analytics.repeatHirePercent >= 30 && (
            <p className="text-ds-11 font-medium" style={{ color: "hsl(var(--bark))" }}>
              Posters keep coming back — great sign
            </p>
          )}
        </div>
      )}
    </SectionCard>
  );
};

export default RepeatHireCard;
