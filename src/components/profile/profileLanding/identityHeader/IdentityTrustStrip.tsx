import { Star } from "lucide-react";
import { ProfileSectionError } from "@/components/profile/ProfileSectionError";

interface IdentityTrustStripProps {
  statsError: boolean;
  avgRating: number | null;
  reviewCount: number;
  completedCount: number;
  postedCount: number;
  onSelectTab: (key: string) => void;
  onLoadInlineJobs: () => void;
  onRetryStats?: () => void;
}

/**
 * Trust strip — rating · jobs done · jobs posted, in three even columns. A
 * failed stats load shows a small inline error scoped to this strip. Pure
 * presentational: every value + callback arrives via props, no state/hooks.
 * Extracted verbatim from IdentityHeader.
 */
export function IdentityTrustStrip({
  statsError,
  avgRating,
  reviewCount,
  completedCount,
  postedCount,
  onSelectTab,
  onLoadInlineJobs,
  onRetryStats,
}: IdentityTrustStripProps) {
  return (
    <div className="mt-3.5 pt-3.5" style={{ borderTop: "1px solid hsl(var(--olivewood) / 0.10)" }}>
      {statsError ? (
        <ProfileSectionError
          section="your profile stats"
          onRetry={() => onRetryStats?.()}
        />
      ) : (
        /* Buttons use `h-full py-2` so the middle column's vertical
           `border-x border-border/50` divider spans the full height
           of the trust strip; previously the borders only matched
           the (variable) intrinsic height of the middle column. */
        <div className="grid grid-cols-3 items-stretch">
          <button
            onClick={() => onSelectTab("reviews")}
            className="flex flex-col items-center justify-center gap-0.5 py-2 h-full active:opacity-60 transition-opacity"
          >
            <span className="inline-flex items-center gap-1">
              <Star
                className="w-3.5 h-3.5 text-primary"
                fill={reviewCount > 0 ? "currentColor" : "none"}
              />
              {/* "New" until the first review lands — a 5.0 with 0
                  reviews is a default, not an earned rating. */}
              {reviewCount > 0 ? (
                <span className="text-ds-15 font-bold text-foreground leading-none">
                  {avgRating ? avgRating.toFixed(1) : "5.0"}
                </span>
              ) : (
                <span className="text-ds-13 font-bold text-foreground leading-none">New</span>
              )}
            </span>
            <span className="text-ds-9 font-sans font-medium uppercase tracking-wider text-muted-foreground">
              {reviewCount > 0 ? `${reviewCount} ${reviewCount === 1 ? "review" : "reviews"}` : "Rating"}
            </span>
          </button>
          <button
            onClick={() => { if (completedCount > 0) { onLoadInlineJobs(); onSelectTab("completed_jobs"); } }}
            className="flex flex-col items-center justify-center gap-0.5 py-2 h-full border-x border-border/50 active:opacity-60 transition-opacity"
          >
            <span className="text-ds-15 font-bold text-foreground leading-none">{completedCount}</span>
            <span className="text-ds-9 font-sans font-medium uppercase tracking-wider text-muted-foreground">
              Jobs done
            </span>
          </button>
          <button
            onClick={() => { if (postedCount > 0) { onLoadInlineJobs(); onSelectTab("posted_jobs"); } }}
            className="flex flex-col items-center justify-center gap-0.5 py-2 h-full active:opacity-60 transition-opacity"
          >
            <span className="text-ds-15 font-bold text-foreground leading-none">{postedCount}</span>
            <span className="text-ds-9 font-sans font-medium uppercase tracking-wider text-muted-foreground">
              Jobs posted
            </span>
          </button>
        </div>
      )}
    </div>
  );
}
