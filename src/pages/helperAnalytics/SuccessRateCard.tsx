import { Target } from "lucide-react";
import SectionCard from "./SectionCard";
import type { Analytics } from "./fetchAnalytics";

interface SuccessRateCardProps {
  analytics: Analytics | undefined;
  hasAccess: boolean;
  isLoading: boolean;
  onUpgrade: () => void;
}

const SuccessRateCard = ({ analytics, hasAccess, isLoading, onUpgrade }: SuccessRateCardProps) => {
  return (
    <SectionCard
      title="Application success rate"
      icon={<Target className="w-4 h-4" />}
      hasAccess={hasAccess}
      isLoading={isLoading}
      onUpgrade={onUpgrade}
      lockedPreview="Track your applications-to-hires conversion and dial in your pitch."
    >
      {analytics && (
        <div className="text-center py-2 space-y-1">
          {analytics.successRate !== null ? (
            <>
              <p
                className="font-display italic font-bold"
                style={{ fontSize: "2.2rem", color: "hsl(var(--ink-deep))", letterSpacing: "-0.03em" }}
              >
                {analytics.successRate}%
              </p>
              <p className="font-serif italic text-ds-12" style={{ color: "hsl(var(--olivewood) / 0.8)" }}>
                of your applications lead to a hire
              </p>
              <p
                className="text-ds-11 font-medium"
                style={{
                  color: analytics.successRate >= analytics.PLATFORM_AVERAGE_SUCCESS_RATE
                    ? "hsl(var(--bark))"
                    : "hsl(var(--olivewood) / 0.8)",
                }}
              >
                {analytics.successRate >= analytics.PLATFORM_AVERAGE_SUCCESS_RATE
                  ? `Above the Helpr average of ${analytics.PLATFORM_AVERAGE_SUCCESS_RATE}%`
                  : `Helpr average is ${analytics.PLATFORM_AVERAGE_SUCCESS_RATE}%`}
              </p>
              <p className="text-ds-11 text-muted-foreground">
                Based on {analytics.totalApplications} application{analytics.totalApplications !== 1 ? "s" : ""}
              </p>
            </>
          ) : (
            <p className="text-ds-12 text-muted-foreground py-2">
              Apply to jobs to see your hire rate.
            </p>
          )}
        </div>
      )}
    </SectionCard>
  );
};

export default SuccessRateCard;
