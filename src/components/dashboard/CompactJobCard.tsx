import { formatDistanceToNow } from "date-fns";
import { Star } from "lucide-react";
import { categoryColors } from "@/components/activity/activityConstants";
import { getCity } from "@/lib/locationUtils";
import { computeNet } from "@/components/dashboard/JobPrice";
import { formatPrice } from "@/lib/format";
import type { EnrichedJob } from "@/components/dashboard/types";

interface CompactJobCardProps {
  job: EnrichedJob;
  /** Helper's platform-fee percent — when provided the row shows the net
   *  "you earn" figure (matching JobPrice / the comfortable card) instead
   *  of the gross budget, so the same job never shows two numbers. */
  effectiveFee?: number;
  onSelect: (job: EnrichedJob) => void;
  onMouseEnter?: () => void;
  onMouseLeave?: () => void;
  isHighlighted?: boolean;
  /** Marks this as a top recommended pick — renders a subtle pill. */
  recommended?: boolean;
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
  effectiveFee,
  onSelect,
  onMouseEnter,
  onMouseLeave,
  isHighlighted = false,
  recommended = false,
}: CompactJobCardProps) {
  const colors = categoryColors[job.category] ?? categoryColors.other;
  const city = getCity(job.location);
  // addSuffix: true → "5 minutes ago" instead of a bare "5 minutes", so the
  // relative time reads unambiguously as how long ago the job was posted.
  const timeAgo = job.created_at
    ? formatDistanceToNow(new Date(job.created_at), { addSuffix: true })
    : null;
  // Net "you earn" when a fee tier is known; gross budget otherwise. Uses
  // the shared JobPrice math so this row agrees with the comfortable card.
  // (Bidding was removed — zero production usage — so every job now has a
  // set budget and there is no second price treatment to branch on.)
  const helpers = job.is_group_job && job.helpers_needed ? job.helpers_needed : 1;
  const priceAmount =
    effectiveFee != null
      ? computeNet(job.budget, effectiveFee, job.urgent_fee ?? 0, helpers).netEarnings
      : job.budget;

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
        aria-label={`${job.title}, ${effectiveFee != null ? "you earn " : ""}$${formatPrice(priceAmount)}${city ? `, ${city}` : ""}`}
      >
        {/* Category dot */}
        <span
          className={`shrink-0 w-2 h-2 rounded-full ${colors.dot}`}
          aria-hidden
        />

        {/* Recommended pill — a subtle relevance cue for the top picks.
            Sits between the category dot and the title; pointer-events stay
            with the row button so the whole row remains tappable. */}
        {recommended && (
          <span
            className="shrink-0 inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-ds-10"
            style={{
              background: "hsl(var(--burnt-sienna) / 0.10)",
              color: "hsl(var(--burnt-sienna))",
            }}
          >
            <Star
              className="w-2.5 h-2.5 shrink-0"
              strokeWidth={2}
              style={{ fill: "hsl(var(--burnt-sienna) / 0.3)" }}
            />
            <span className="font-sans font-semibold leading-none">Recommended</span>
          </span>
        )}

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
              className="shrink-0 font-sans text-ds-11 leading-none"
              style={{ color: "hsl(var(--olivewood) / 0.8)" }}
            >
              {city}
            </span>
          )}
        </span>

        {/* Price — net "you earn" when a fee tier is known, else gross. */}
        <span
          className="shrink-0 font-sans font-semibold text-ds-13 tabular-nums"
          style={{ color: "hsl(var(--bark))" }}
        >
          ${formatPrice(priceAmount)}
        </span>

        {/* Time ago */}
        {timeAgo && (
          <span
            className="shrink-0 font-sans text-ds-11 tabular-nums"
            style={{ color: "hsl(var(--olivewood) / 0.8)" }}
          >
            {timeAgo}
          </span>
        )}
      </button>
    </li>
  );
}

export default CompactJobCard;
