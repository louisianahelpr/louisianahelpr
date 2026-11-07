import { MapPin, Calendar, BookOpen } from "lucide-react";
import { jobStartTimeLabel } from "@/lib/jobDate";
import { formatJobDate } from "@/lib/dateUtils";
import { jobDayLabel } from "@/lib/jobDateWindow";
import { CheckoutRepeatsRow } from "./CheckoutRepeatsRow";
import { ReviewMediaRows } from "./ReviewMediaRows";

/** Q806: CheckoutStep's read-only "Your post at a glance" card, moved out unchanged (a pure move; no money figure here). */
export function CheckoutGlanceCard({
  title, categoryLabel, description, streetAddress, city, addrState, zipCode, dateNeeded, dateWindowEnd, startTime,
  isFlexibleSchedule, estimatedHours, isRecurring, whenDate, recurrenceDays, visitCount, seriesEndDate, imagePreviews,
  scopeVideoUrl, specialRequirements,
}: {
  title: string; categoryLabel: string; description: string; streetAddress: string; city: string; addrState: string;
  zipCode: string; dateNeeded: string; dateWindowEnd: string | null; startTime: string; isFlexibleSchedule: boolean;
  estimatedHours: string; isRecurring: boolean; whenDate: string; recurrenceDays: number[]; visitCount: number;
  seriesEndDate: string; imagePreviews: string[]; scopeVideoUrl?: string | null; specialRequirements: string;
}) {
  return (
    /* ── Review & Post summary card ─────────────────────────────
        A clean read-only summary of everything the poster set. Shows
        the key fields at a glance so they can catch mistakes before
        committing to payment. The fee breakdown shows both sides:
        "You pay $X · Helper earns $Y" for full transparency.

        Type sizes here are one step up from the rest of the sheet (L6): the
        whole purpose of this card is catching a mistake before paying, and
        the street address a stranger will be sent to was rendering at the
        same size as a legal footnote. */
    <div className="rounded-ds-md liquid-glass overflow-hidden">
      <div
        className="px-4 py-2.5 flex items-center gap-2 border-b border-border"
        style={{ background: "hsl(var(--bark) / 0.04)" }}
      >
        <BookOpen className="w-3.5 h-3.5 shrink-0" style={{ color: "hsl(var(--bark))" }} />
        <p
          className="text-ds-10 uppercase tracking-wide font-semibold"
          style={{ color: "hsl(var(--bark))" }}
        >
          Your post at a glance
        </p>
      </div>
      <div className="divide-y divide-border">
        {/* Title */}
        <div className="px-4 py-3 flex items-start justify-between gap-3">
          <span className="text-ds-12 text-muted-foreground w-20 shrink-0 pt-0.5">Job</span>
          <div className="flex-1 min-w-0 text-right">
            <p className="text-ds-13 font-semibold text-foreground truncate">{title}</p>
          </div>
        </div>

        {/* Category: its own row, not under the title (owner, 2026-10-01). */}
        <div className="px-4 py-3 flex items-start justify-between gap-3">
          <span className="text-ds-12 text-muted-foreground w-20 shrink-0 pt-0.5">Category</span>
          <div className="flex-1 min-w-0 text-right">
            <span
              className="inline-block px-2 py-0.5 rounded-full text-ds-10 font-semibold capitalize"
              style={{
                background: "hsl(var(--bark) / 0.09)",
                color: "hsl(var(--bark))",
              }}
            >
              {categoryLabel}
            </span>
          </div>
        </div>

        {/* Description (3 lines), right-aligned like every value (owner, 2026-10-01). */}
        {description && (
          <div className="px-4 py-3 flex items-start gap-3">
            <span className="text-ds-12 text-muted-foreground w-20 shrink-0 pt-0.5">Details</span>
            <p
              className="flex-1 text-ds-13 text-foreground leading-relaxed line-clamp-3 text-right"
              style={{ wordBreak: "break-word" }}
            >
              {description}
            </p>
          </div>
        )}

        {/* No money row here (audit 11-01 JA-45): the summary's "Total" printed the same figure the Payment
            breakdown's Total prints below. The total is said once, in the breakdown, with the series / crew
            lines under it. */}

        {/* Location — full street address (the poster's own job, so
            showing the complete address once at checkout is fine). No parish
            suffix (owner, 2026-10-01: "no need to show ... any parish"). */}
        <div className="px-4 py-3 flex items-start gap-3">
          <span className="text-ds-12 text-muted-foreground w-20 shrink-0 pt-0.5 flex items-center gap-1">
            <MapPin className="w-3 h-3" />Location
          </span>
          <p className="flex-1 text-ds-13 text-foreground text-right">
            {[streetAddress, city, addrState, zipCode].filter(Boolean).join(", ")}
          </p>
        </div>

        {/* Date */}
        {dateNeeded && (
          <div className="px-4 py-3 flex items-start gap-3">
            <span className="text-ds-12 text-muted-foreground w-20 shrink-0 pt-0.5 flex items-center gap-1">
              <Calendar className="w-3 h-3" />When
            </span>
            <p className="flex-1 text-ds-13 text-foreground text-right">
              {isRecurring ? formatJobDate(whenDate) : jobDayLabel({ date_needed: whenDate, date_window_end: dateWindowEnd })}
              {/* Routed through the ONE rule (src/lib/jobDate.ts) so this
                  summary never disagrees with the card or detail sheet. It
                  once swallowed a real start time when Flexible was also
                  ticked; now the hour prints, then the flexibility note. */}
              {(() => {
                const timeLabel = jobStartTimeLabel(startTime, isFlexibleSchedule);
                // Both facts are true when a poster picks an hour AND ticks
                // Flexible, so both print. One expression, so the whole
                // "when" suffix has exactly one place it can be wrong.
                // The ONE rule now prints both itself ("2:00 PM · Flexible", owner 2026-10-23).
                return timeLabel ? ` · ${timeLabel}` : "";
              })()}
              {estimatedHours ? ` · ${estimatedHours}h est.` : ""}
            </p>
          </div>
        )}

        {/* Recurring schedule: the days and the visit count (CheckoutRepeatsRow). */}
        {isRecurring && <CheckoutRepeatsRow recurrenceDays={recurrenceDays} visitCount={visitCount} endDate={seriesEndDate} />}

        <ReviewMediaRows imagePreviews={imagePreviews} scopeVideoUrl={scopeVideoUrl} />

        {/* Special requirements */}
        {specialRequirements && (
          <div className="px-4 py-3 flex items-start gap-3">
            <span className="text-ds-12 text-muted-foreground w-20 shrink-0 pt-0.5">Notes</span>
            <p className="flex-1 text-ds-13 text-foreground text-right line-clamp-2">
              {specialRequirements}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
