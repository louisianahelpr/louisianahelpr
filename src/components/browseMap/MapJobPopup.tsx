// MapJobPopup — the card that opens when you tap a pin on the browse map.
//
// WHY THIS FILE EXISTS: the popup and the browse `JobCard` describe the same
// job, and for a long time they disagreed. The popup showed four things (title,
// a grey category word, the parish, the gross budget); the card showed a
// coloured category chip, the net take-home, the city, the date and the start
// time. Same job, two different answers to "what is this and when is it" — and
// on desktop the two render side by side.
//
// So this renders the CARD'S OWN primitives rather than restyling from scratch:
// `categoryColors` + `CategoryIcon` + `categoryLabels` for the chip,
// `<JobPrice variant="chip">` for the money, `getCity` / `formatJobDate` /
// `formatTime12` for the meta row. If the card's palette, price math or date
// format changes, this changes with it — that is the point.
//
// WHAT IT DELIBERATELY DOES NOT SHOW: poster rating, ID-verified and applicant
// count. All three need `customer_id`, which `get_open_jobs_for_map` withholds
// on purpose (see the privacy note atop BrowseMap.tsx). Poster identity stays
// off the map rather than the map widening its PII surface for a trust chip.
//
// LAYOUT: a Leaflet popup is a fixed-width box, so unlike the card (which packs
// location/date/time into one nowrap row and truncates the city) the meta row
// here WRAPS. Nothing is clipped and the city is never abbreviated to "Brouss…"
// — the popup has vertical room the feed row does not.

import { Calendar, Clock, MapPin, X, Zap } from "lucide-react";

import { categoryColors, categoryLabels } from "@/components/activity/activityConstants";
import { CategoryIcon } from "@/components/job/CategoryIcon";
import { JobPrice } from "@/components/dashboard/JobPrice";
import { Button } from "@/components/ui/button";
import { formatJobDate } from "@/lib/dateUtils";
import { formatPrice } from "@/lib/format";
import { getCity } from "@/lib/locationUtils";
import { formatTime12 } from "@/components/TimePickerSelect";
import type { MapJob } from "./config";

// The callout's host node (`.browse-map-callout` in BrowseMap.tsx) carries
// `padding: 10px 12px` so MapKit's bubble never touches the card content.
// The category tab below has to BLEED past that padding to reach the true
// top-left corner (same as JobCard's rail/tab), so the top-level wrapper
// cancels it with a matching negative margin and the content re-adds its
// own padding beneath the tab.
const CALLOUT_PAD_Y = 10;
const CALLOUT_PAD_X = 12;

export interface MapJobPopupProps {
  job: MapJob;
  /** Tap on the CTA. Omitted on surfaces with no action (the button hides). */
  onJobAction?: (jobId: string) => void;
  /** CTA text — "Apply" signed in, "Sign up to apply" for guests. */
  ctaLabel: string;
  /**
   * Viewer's platform commission percent. When supplied the price reads the
   * helper's NET take-home, exactly like the feed card beside it. When absent
   * the popup falls back to the gross posted budget rather than inventing a
   * fee — an over-stated payout is the one error a money figure may not make.
   */
  effectiveFee?: number;
  /** Dismiss the callout (deselects the pin). Omitted → no close button. */
  onClose?: () => void;
}

export function MapJobPopup({ job, onJobAction, ctaLabel, effectiveFee, onClose }: MapJobPopupProps) {
  const catStyle = categoryColors[job.category] || categoryColors.other;
  const categoryLabel = categoryLabels[job.category] || job.category;

  // City from the masked "City, State" the RPC returns, falling back to the
  // parish — which is all the RPC returned before migration 20260823120000, so
  // a pre-deploy row still names a place instead of showing an empty pin row.
  const city = getCity(job.location ?? "") || job.parish || null;

  // An ABSENT key (old RPC shape) is not the same as a NULL value (job has no
  // date/time set). Only the second may render the card's "Flexible" fallback;
  // the first hides the row entirely, because "Flexible" would be a claim we
  // have no data to make.
  const scheduleKnown = job.date_needed !== undefined || job.start_time !== undefined;
  const showFlexible = scheduleKnown && !job.date_needed && !job.start_time;

  const urgentBonus = Number(job.urgent_fee ?? 0);
  // Mirrors JobCard's `helpersCount` so a group job's popup price and its card
  // price divide the budget the same way.
  const helpersCount = job.is_group_job && job.helpers_needed ? job.helpers_needed : 1;

  return (
    <div
      className="relative"
      data-testid="map-job-popup"
      style={{ margin: `-${CALLOUT_PAD_Y}px -${CALLOUT_PAD_X}px` }}
    >
      {/* Category rail — vertical color stripe down the left edge, same
          treatment as JobCard's feed-row rail (`catStyle.dot`). Bleeds to
          the callout's true left edge via the wrapper's negative margin. */}
      <span aria-hidden className={`absolute left-0 top-0 bottom-0 w-1.5 ${catStyle.dot}`} />

      {/* Category tab — anchored at the true top-left corner, flat left edge
          continuing the rail, exactly like JobCard's tab. Urgency sits beside
          it in the same bled row instead of wrapping inline with the title. */}
      <div className="absolute top-0 left-0 z-20 flex items-stretch gap-1">
        <span
          data-testid="map-popup-category"
          className={`inline-flex items-center gap-1 pl-2 pr-1.5 py-0.5 rounded-l-none rounded-br-lg rounded-tr-none border-b border-r text-ds-10 font-semibold leading-none ${catStyle.badge}`}
        >
          <CategoryIcon
            category={job.category}
            aria-hidden
            className="w-2.5 h-2.5 shrink-0"
            strokeWidth={2.25}
          />
          <span className="font-serif italic">{categoryLabel}</span>
        </span>
        {job.is_urgent && (
          <span
            className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-br-lg border-b border-r text-ds-9 font-bold uppercase leading-none"
            aria-label={urgentBonus > 0 ? `Urgent — $${formatPrice(urgentBonus)} bonus` : "Urgent"}
            style={{
              color: "hsl(var(--accent))",
              background: "hsl(var(--accent) / 0.15)",
              borderColor: "hsl(var(--accent) / 0.5)",
              letterSpacing: "0.05em",
            }}
          >
            <Zap
              className="w-2.5 h-2.5 shrink-0"
              style={{ color: "hsl(var(--accent))", fill: "hsl(var(--accent))" }}
            />
            {urgentBonus > 0 ? `+$${formatPrice(urgentBonus)} Urgent` : "Urgent"}
          </span>
        )}
      </div>

      {onClose && (
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="absolute top-1 right-1 z-20 w-6 h-6 rounded-full flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-[hsl(var(--olivewood)/0.10)] transition-colors"
        >
          <X className="w-3.5 h-3.5" strokeWidth={2.25} />
        </button>
      )}

      {/* Content — pushed down/in to clear the bled tab + rail, then re-adds
          the callout's own padding (cancelled above) on the other three
          sides. */}
      <div
        className="space-y-1.5"
        style={{
          paddingTop: 26,
          paddingBottom: CALLOUT_PAD_Y - 4,
          paddingLeft: CALLOUT_PAD_X + 2,
          paddingRight: CALLOUT_PAD_X - 2,
        }}
      >
        {/* Row 1 — title + price, the card's top row. `min-w-0` on the title
            is what lets it give way inside the fixed popup width so the price
            chip (and its tap-to-reveal fee breakdown) can never be pushed out
            of the box. Two lines here rather than the card's one: a popup is
            taller than a feed row and a clipped title is the worst thing to
            clip. `items-center` (not `items-start`) so the price chip sits on
            the title's vertical center even when the title wraps to 2 lines. */}
        <div className="flex items-center justify-between gap-2">
          <p
            className="flex-1 min-w-0 font-display italic font-bold text-ds-13 leading-tight line-clamp-2"
            style={{ color: "hsl(var(--ink-deep))", letterSpacing: "-0.02em" }}
          >
            {job.title}
          </p>
          <JobPrice
            budget={Number(job.budget)}
            // No fee to apply → show the gross budget, never a guessed net.
            effectiveFee={effectiveFee ?? 0}
            showBudget={effectiveFee === undefined}
            urgentFee={urgentBonus}
            helpersNeeded={helpersCount}
            variant="chip"
            className="shrink-0"
          />
        </div>

        {/* Row 2 — where + when, the card's meta row. Wraps instead of
            truncating (see the layout note at the top of this file). */}
        {(city || scheduleKnown) && (
          <div
            data-testid="map-popup-meta"
            className="flex items-center gap-x-2 gap-y-1 flex-wrap text-ds-11 leading-tight"
            style={{ color: "hsl(var(--olivewood) / 0.9)" }}
          >
            {city && (
              <span className="inline-flex items-center gap-1">
                <MapPin className="w-2.5 h-2.5 shrink-0" />
                <span className="font-sans">{city}</span>
              </span>
            )}
            {showFlexible && (
              <span className="inline-flex items-center gap-1">
                <Calendar className="w-2.5 h-2.5 shrink-0" />
                <span className="font-sans">Flexible</span>
              </span>
            )}
            {job.date_needed && (
              <span className="inline-flex items-center gap-1">
                <Calendar className="w-2.5 h-2.5 shrink-0" />
                <span className="font-sans whitespace-nowrap">{formatJobDate(job.date_needed)}</span>
              </span>
            )}
            {job.start_time && (
              <span className="inline-flex items-center gap-1">
                <Clock className="w-2.5 h-2.5 shrink-0" />
                <span className="font-sans whitespace-nowrap">{formatTime12(job.start_time)}</span>
              </span>
            )}
          </div>
        )}

        {onJobAction && (
          // Same primitive + effects as the job-detail "Apply Now" CTA
          // (ApplyBody.tsx): `btn-liquid-fill` for the left-to-right bark
          // wash on hover, so this pin popup's Apply and the full apply
          // flow's Apply Now feel like one button, not two. `h-7` (not `h-8`)
          // so the `text-ds-11` label doesn't look lost in an oversized box.
          <Button
            size="sm"
            onClick={() => onJobAction(job.id)}
            className="btn-liquid-fill w-full h-7 text-ds-11"
          >
            {ctaLabel}
          </Button>
        )}
      </div>
    </div>
  );
}

export default MapJobPopup;
