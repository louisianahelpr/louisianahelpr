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

  // Sub-rating averages — compute from reviews that have the
  // column filled in (null skipped, not dragged to 0). Gate on
  // 3+ sub-rated reviews so a single detailed review doesn't
  // look authoritative.
  const subReviews = reviews.filter(
    (r) => r.punctuality !== null || r.quality !== null || r.communication !== null,
  );
  const subAvg = (key: "punctuality" | "quality" | "communication") => {
    const vals = subReviews
      .map((r) => r[key])
      .filter((v): v is number => v !== null);
    return vals.length >= 3
      ? { avg: vals.reduce((a, b) => a + b, 0) / vals.length, count: vals.length }
      : null;
  };
  const punctualityAvg = subAvg("punctuality");
  const qualityAvg = subAvg("quality");
  const communicationAvg = subAvg("communication");
  const hasSubRatings = punctualityAvg !== null || qualityAvg !== null || communicationAvg !== null;

  return (
    <div className="rounded-2xl liquid-glass p-5 space-y-3">
      {/* Distribution chart */}
      <p
        className="text-[10px] uppercase tracking-wide font-semibold"
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

      {/* Sub-rating mini bars (1b) */}
      {hasSubRatings && (
        <>
          <div className="h-px" style={{ background: "hsl(var(--olivewood) / 0.12)" }} />
          <p
            className="text-[10px] uppercase tracking-wide font-semibold"
            style={{ color: "hsl(var(--olivewood) / 0.8)" }}
          >
            Sub-ratings
          </p>
          <div className="space-y-1.5">
            {[
              { label: "Punctuality", data: punctualityAvg },
              { label: "Quality", data: qualityAvg },
              { label: "Communication", data: communicationAvg },
            ].map(({ label, data: d }) =>
              d === null ? null : (
                <div key={label} className="flex items-center gap-2">
                  <span
                    className="text-ds-11 w-24 shrink-0"
                    style={{ color: "hsl(var(--olivewood) / 0.8)" }}
                  >
                    {label}
                  </span>
                  <div
                    className="relative flex-1 h-2 rounded-full overflow-hidden"
                    style={{ background: "hsl(var(--bark) / 0.10)" }}
                  >
                    <div
                      className="absolute inset-y-0 left-0 rounded-full"
                      style={{
                        width: `${(d.avg / 5) * 100}%`,
                        background: "hsl(var(--bark))",
                      }}
                    />
                  </div>
                  <span
                    className="text-ds-11 font-semibold tabular-nums w-7 shrink-0 text-right"
                    style={{ color: "hsl(var(--ink-deep))" }}
                  >
                    {d.avg.toFixed(1)}
                  </span>
                </div>
              ),
            )}
          </div>
        </>
      )}
    </div>
  );
};
