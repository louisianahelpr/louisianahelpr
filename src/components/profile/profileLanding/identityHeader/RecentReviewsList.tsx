import { Star } from "lucide-react";
import type { ReviewPreview } from "../types";
import { relativeReviewTime } from "./identityHeaderHelpers";

/**
 * "Recent reviews" list inside the Work & reviews disclosure — a pure
 * presentational block. Receives the review previews and a tab-select
 * callback via props; holds no state and does no data-fetching. Extracted
 * verbatim from IdentityHeader (parent still owns the has-reviews gate).
 */
export function RecentReviewsList({
  reviewsPreview,
  onSelectTab,
}: {
  reviewsPreview: ReviewPreview[];
  onSelectTab: (key: string) => void;
}) {
  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <p className="font-serif italic uppercase text-ds-9" style={{ color: "hsl(var(--burnt-sienna))", letterSpacing: "0.18em" }}>
          Recent reviews
        </p>
        <button
          type="button"
          onClick={() => onSelectTab("reviews")}
          className="text-ds-11 font-semibold active:opacity-70"
          style={{ color: "hsl(var(--bark))" }}
        >
          See all →
        </button>
      </div>
      <div className="space-y-2">
        {reviewsPreview.map((r, i) => {
          const when = relativeReviewTime(r.created_at);
          return (
            <button
              key={`${r.created_at}-${i}`}
              type="button"
              onClick={() => onSelectTab("reviews")}
              className="w-full text-left rounded-xl p-2.5 active:scale-[0.99] active:opacity-80 transition-all"
              style={{
                background: "hsla(0, 0%, 100%, 0.55)",
                border: "1px solid hsl(var(--olivewood) / 0.10)",
              }}
            >
              <div className="flex items-center gap-2 mb-1">
                <div className="flex items-center gap-0.5">
                  {[1, 2, 3, 4, 5].map((n) => (
                    <Star
                      key={n}
                      className="w-3 h-3"
                      style={{
                        color: n <= r.rating ? "hsl(var(--burnt-sienna))" : "hsl(var(--olivewood) / 0.25)",
                        fill: n <= r.rating ? "hsl(var(--burnt-sienna))" : "transparent",
                      }}
                    />
                  ))}
                </div>
                <span className="text-ds-11 font-semibold truncate" style={{ color: "hsl(var(--ink-deep))" }}>
                  {r.reviewerName}
                </span>
                <span className="text-ds-10 text-muted-foreground shrink-0">· {when}</span>
              </div>
              {r.feedback?.trim() ? (
                <p
                  className="font-serif italic text-ds-13 leading-snug line-clamp-2"
                  style={{ color: "hsl(var(--olivewood) / 0.85)" }}
                >
                  "{r.feedback}"
                </p>
              ) : (
                <p
                  className="font-serif italic text-ds-11 leading-snug"
                  style={{ color: "hsl(var(--olivewood) / 0.8)" }}
                >
                  {r.jobTitle}
                </p>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
