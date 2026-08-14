import { Clock } from "lucide-react";
import SectionCard from "./SectionCard";
import type { Analytics } from "./fetchAnalytics";

interface OnTimeArrivalCardProps {
  analytics: Analytics | undefined;
  hasAccess: boolean;
  isLoading: boolean;
  onUpgrade: () => void;
}

const OnTimeArrivalCard = ({ analytics, hasAccess, isLoading, onUpgrade }: OnTimeArrivalCardProps) => {
  return (
    <SectionCard
      title="On-time arrival"
      icon={<Clock className="w-4 h-4" />}
      hasAccess={hasAccess}
      isLoading={isLoading}
      onUpgrade={onUpgrade}
      lockedPreview="Your reliability score across every completed job."
    >
      {analytics && (
        <div className="text-center py-2 space-y-1">
          <p
            className="font-display italic font-bold text-ds-32"
            style={{ color: "hsl(var(--ink-deep))", letterSpacing: "-0.03em" }}
          >
            {analytics.onTimeRate}%
          </p>
          <p className="font-serif italic text-ds-12" style={{ color: "hsl(var(--olivewood) / 0.8)" }}>
            of jobs you arrived on time or early
          </p>
          <p className="text-ds-11 text-muted-foreground">
            Based on {analytics.timingJobCount} job{analytics.timingJobCount !== 1 ? "s" : ""} with check-in data
          </p>
        </div>
      )}
    </SectionCard>
  );
};

export default OnTimeArrivalCard;
