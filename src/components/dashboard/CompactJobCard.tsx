import { formatDistanceToNow } from "date-fns";
import { categoryColors } from "@/components/activity/activityConstants";
import { getCity } from "@/lib/locationUtils";
import type { EnrichedJob } from "@/components/dashboard/types";

interface CompactJobCardProps {
  job: EnrichedJob;
  onSelect: (job: EnrichedJob) => void;
  onMouseEnter?: () => void;
  onMouseLeave?: () => void;
  isHighlighted?: boolean;
}

/**
 * CompactJobCard — a single ~48px row for the "compact" density mode.
 *
 * Layout: [category dot] [title + city] [budget] [time ago]
 *
 * Desktop-split-screen: when a map is visible beside the list, hovering
 * this row highlights the corresponding map pin (via onMouseEnter/Leave).
 */
export function CompactJobCard({
  job,
  onSelect,
  onMouseEnter,
  onMouseLeave,
  isHighlighted = false,
}: CompactJobCardProps) {
  const colors = categoryColors[job.category] ?? categoryColors.other;
  const city = getCity(job.location);
  const timeAgo = job.created_at
    ? formatDistanceToNow(new Date(job.created_at), { addSuffix: false })
    : null;

  return (
    <li>
      <button
        type="button"
        onClick={() => onSelect(job)}
        onMouseEnter={onMouseEnter}
        onMouseLeave={onMouseLeave}
        className="w-full h-12 px-4 flex items-center gap-3 text-left transition-colors active:opacity-75"
        style={{
          background: isHighlighted ? "hsl(var(--bark) / 0.07)" : "transparent",
          borderBottom: "0.5px solid hsl(var(--olivewood) / 0.08)",
        }}
        aria-label={`${job.title}, $${job.budget}${city ? `, ${city}` : ""}`}
      >
        {/* Category dot */}
        <span
          className={`shrink-0 w-2 h-2 rounded-full ${colors.dot}`}
          aria-hidden
        />

        {/* Title + city — flex-1 with truncation */}
        <span className="flex-1 min-w-0 flex items-baseline gap-1.5 overflow-hidden">
          <span
            className="truncate font-sans font-medium text-ds-13 leading-none"
            style={{ color: "hsl(var(--ink-deep))" }}
          >
            {job.title}
          </span>
          {city && (
            <span
              className="shrink-0 font-serif italic text-ds-11 leading-none"
              style={{ color: "hsl(var(--olivewood) / 0.6)" }}
            >
              {city}
            </span>
          )}
        </span>

        {/* Budget */}
        <span
          className="shrink-0 font-sans font-semibold text-ds-13 tabular-nums"
          style={{ color: "hsl(var(--bark))" }}
        >
          ${job.budget}
        </span>

        {/* Time ago */}
        {timeAgo && (
          <span
            className="shrink-0 font-sans text-ds-11 tabular-nums"
            style={{ color: "hsl(var(--olivewood) / 0.5)" }}
          >
            {timeAgo}
          </span>
        )}
      </button>
    </li>
  );
}

export default CompactJobCard;
