import { Star } from "lucide-react";
import SectionCard from "./SectionCard";
import type { Analytics } from "./fetchAnalytics";

interface RatingsReviewsCardProps {
  analytics: Analytics | undefined;
  hasAccess: boolean;
  isLoading: boolean;
  onUpgrade: () => void;
}

const RatingsReviewsCard = ({ analytics, hasAccess, isLoading, onUpgrade }: RatingsReviewsCardProps) => {
  return (
    <SectionCard
      title="Ratings & reviews"
      icon={<Star className="w-4 h-4" />}
      hasAccess={hasAccess}
      isLoading={isLoading}
      onUpgrade={onUpgrade}
      lockedPreview="Star breakdown across every review, with reviewer names."
    >
      {analytics && (
        <div className="py-1">
          {analytics.reviewCount > 0 ? (
            <>
              {/* Average rating headline */}
              <div className="flex items-end gap-3 mb-4">
                {/* 2.8rem = 44.8px, DELIBERATELY above the ds-* scale's ds-40
                    ceiling — owner decision, do not "fix" this to ds-40 in a
                    type sweep. It is a single display figure whose size is
                    tuned to sit beside the star row, not body copy that needs
                    to march in step with the ladder. The scale's job is to keep
                    running text consistent; a one-off hero numeral is the case
                    it does not need to cover. If a ds-44 rung is ever added,
                    move this onto it. */}
                <p
                  className="font-display italic font-bold leading-none"
                  style={{ fontSize: "2.8rem", color: "hsl(var(--ink-deep))", letterSpacing: "-0.03em" }}
                >
                  {analytics.avgRating!.toFixed(1)}
                </p>
                <div className="pb-1">
                  {/* Star row */}
                  <div className="flex gap-0.5 mb-0.5">
                    {[1, 2, 3, 4, 5].map((s) => {
                      const filled = analytics.avgRating! >= s;
                      const half = !filled && analytics.avgRating! >= s - 0.5;
                      return (
                        <Star
                          key={s}
                          className="w-3.5 h-3.5"
                          style={{
                            color: filled || half
                              ? "hsl(var(--burnt-sienna))"
                              : "hsl(var(--olivewood) / 0.25)",
                            fill: filled ? "hsl(var(--burnt-sienna))" : "none",
                          }}
                        />
                      );
                    })}
                  </div>
                  <p className="text-ds-11 text-muted-foreground">
                    {analytics.reviewCount} review{analytics.reviewCount !== 1 ? "s" : ""}
                  </p>
                </div>
              </div>

              {/* Per-star breakdown bars */}
              <div className="space-y-1.5 mb-3">
                {[5, 4, 3, 2, 1].map((star) => {
                  const count = analytics.starBuckets[star] ?? 0;
                  const pct = analytics.reviewCount > 0
                    ? Math.round((count / analytics.reviewCount) * 100)
                    : 0;
                  return (
                    <div key={star} className="flex items-center gap-2">
                      <span
                        className="text-ds-11 font-semibold tabular-nums w-4 text-right"
                        style={{ color: "hsl(var(--ink-deep))" }}
                      >
                        {star}
                      </span>
                      <Star
                        className="w-3 h-3 flex-shrink-0"
                        style={{
                          color: "hsl(var(--burnt-sienna) / 0.6)",
                          fill: "hsl(var(--burnt-sienna) / 0.6)",
                        }}
                      />
                      <div className="flex-1 h-1.5 rounded-full bg-muted/50 overflow-hidden">
                        <div
                          className="h-full rounded-full transition-all duration-500"
                          style={{
                            width: `${pct}%`,
                            background: star >= 4
                              ? "hsl(var(--burnt-sienna) / 0.75)"
                              : star === 3
                              ? "hsl(var(--bark) / 0.55)"
                              : "hsl(var(--bark) / 0.32)",
                          }}
                        />
                      </div>
                      <span
                        className="text-ds-11 tabular-nums w-5 text-left"
                        style={{ color: "hsl(var(--olivewood) / 0.8)" }}
                      >
                        {count}
                      </span>
                    </div>
                  );
                })}
              </div>

              {/* Benchmark comparison */}
              <p
                className="text-ds-11 font-medium text-center"
                style={{
                  color:
                    analytics.avgRating! >= analytics.PLATFORM_AVERAGE_RATING
                      ? "hsl(var(--bark))"
                      : "hsl(var(--olivewood) / 0.8)",
                }}
              >
                {analytics.avgRating! >= analytics.PLATFORM_AVERAGE_RATING
                  ? `Above the Helpr average of ${analytics.PLATFORM_AVERAGE_RATING}`
                  : `Helpr average is ${analytics.PLATFORM_AVERAGE_RATING}`}
              </p>
            </>
          ) : (
            <p className="text-ds-12 text-muted-foreground text-center py-2">
              Complete jobs to earn your first review.
            </p>
          )}
        </div>
      )}
    </SectionCard>
  );
};

export default RatingsReviewsCard;
