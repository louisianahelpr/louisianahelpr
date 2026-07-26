import { Star, ClipboardList } from "lucide-react";
import type { PosterReputation } from "./types";

type Props = {
  postedTotalCount: number;
  postedCancelledCount: number;
  posterReputation: PosterReputation | null;
};

export const PosterReputationCard = ({
  postedTotalCount,
  postedCancelledCount,
  posterReputation,
}: Props) => {
  const hasPosterActivity = postedTotalCount > 0;
  if (!hasPosterActivity) return null;

  const posterCancelRate =
    postedTotalCount >= 5
      ? (postedCancelledCount / postedTotalCount) * 100
      : null;

  return (
    <div className="rounded-2xl liquid-glass p-5 space-y-2">
      <p
        className="text-[10px] uppercase tracking-wide font-semibold"
        style={{ color: "hsl(var(--olivewood) / 0.8)" }}
      >
        As a job poster
      </p>
      <div className="flex flex-wrap gap-x-4 gap-y-1.5 text-ds-11">
        <span className="flex items-center gap-1" style={{ color: "hsl(var(--olivewood) / 0.8)" }}>
          <ClipboardList className="w-3 h-3" />
          <span className="font-display italic font-bold tabular-nums" style={{ color: "hsl(var(--ink-deep))" }}>
            {postedTotalCount}
          </span>
          {" "}job{postedTotalCount !== 1 ? "s" : ""} posted
        </span>
        {posterReputation !== null && (
          <span className="flex items-center gap-1" style={{ color: "hsl(var(--olivewood) / 0.8)" }}>
            <Star className="w-3 h-3" style={{ fill: "hsl(var(--bark))", color: "hsl(var(--bark))" }} />
            <span className="font-display italic font-bold tabular-nums" style={{ color: "hsl(var(--ink-deep))" }}>
              {posterReputation.avgRating.toFixed(1)}
            </span>
            {" "}avg poster rating
            <span style={{ color: "hsl(var(--olivewood) / 0.8)" }}>
              ({posterReputation.reviewCount})
            </span>
          </span>
        )}
        {posterCancelRate !== null && (
          <span className="flex items-center gap-1" style={{ color: "hsl(var(--olivewood) / 0.8)" }}>
            <span
              className="font-display italic font-bold tabular-nums"
              style={{
                color:
                  posterCancelRate < 5
                    ? "hsl(var(--ink-deep))"
                    : posterCancelRate < 15
                    ? "hsl(var(--gold-warm))"
                    : "hsl(var(--burnt-sienna))",
              }}
            >
              {posterCancelRate.toFixed(0)}%
            </span>
            {" "}cancel rate
          </span>
        )}
      </div>
    </div>
  );
};
