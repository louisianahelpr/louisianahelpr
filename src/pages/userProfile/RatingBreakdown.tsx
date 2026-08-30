import { Star } from "lucide-react";
import type { ProfileReview } from "./types";

type Props = {
  reviews: ProfileReview[];
};

export const RatingBreakdown = ({ reviews }: Props) => {
  if (reviews.length < 3) return null;

  const buckets = [5, 4, 3, 2, 1].map((star) => ({
    star,
    count: reviews.filter((r) => Math.round(r.rating) === star).length,
  }));
  const total = reviews.length;

  // Sub-rating breakdown (Punctuality/Quality/Communication) removed (owner,
  // 2026-08-30: one overall rating only). Only the overall star distribution
  // renders below now.

  return (
    <div className="rounded-2xl liquid-glass p-5 space-y-3">
      {/* Distribution chart */}
      <p
        className="text-ds-10 uppercase tracking-wide font-semibold"
        style={{ color: "hsl(var(--olivewood) / 0.8)" }}
      >
        Rating breakdown
      </p>
      <div className="space-y-1.5">
        {buckets.map(({ star, count }) => (
          <div key={star} className="flex items-center gap-2">
            <span
              className="text-ds-11 font-semibold tabular-nums w-5 shrink-0 text-right"
              style={{ color: "hsl(var(--ink-deep))" }}
            >
              {star}
            </span>
            <Star
              className="w-2.5 h-2.5 shrink-0"
              style={{ color: "hsl(var(--bark))", fill: "hsl(var(--bark))" }}
            />
            {/* Track + fill */}
            <div
              className="relative flex-1 h-2 rounded-full overflow-hidden"
              style={{ background: "hsl(var(--bark) / 0.10)" }}
            >
              <div
                className="absolute inset-y-0 left-0 rounded-full transition-all"
                style={{
                  width: total > 0 ? `${(count / total) * 100}%` : "0%",
                  background: "hsl(var(--bark))",
                }}
              />
            </div>
            <span
              className="text-ds-11 tabular-nums w-4 shrink-0 text-right"
              style={{ color: "hsl(var(--olivewood) / 0.8)" }}
            >
              {count}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
};
