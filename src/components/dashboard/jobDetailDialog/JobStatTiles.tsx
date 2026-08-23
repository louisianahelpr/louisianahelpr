import { type ElementType } from "react";
import { MapPin, Calendar, Clock, Hourglass, Timer } from "lucide-react";
import { getCity } from "@/lib/locationUtils";
import { formatJobDate, parseLocalDate } from "@/lib/dateUtils";
import { formatDistanceToNow, differenceInHours } from "date-fns";
import { formatTime12 } from "@/components/TimePickerSelect";
import type { EnrichedJob } from "../types";

interface JobStatTilesProps {
  job: EnrichedJob;
  distMilesForDriving: number | null;
  drivingLabel: string | null;
}

/* Stat strip — sits ABOVE the payout pill so the helpr scans the
   facts (where, when, how long, deadline) before they see the
   payout. Where + Date are clickable: Where opens Google Maps,
   Date opens Google Calendar.

   WHERE / DATE / TIME render as ONE compact row, not three tiles
   (owner decision 2026-08-22). As tiles those three short values —
   "Lake Charles", "Sat, Sep 19", "8:30 AM" — cost ~250pt of an 874pt
   phone screen for about twelve characters each, pushing the payout
   and the CTA off the first read. They are also exactly the triplet
   the feed card already prints on one line, so the tile treatment made
   the detail view LESS scannable than the card it came from.

   Estimated / Closes keep the tile treatment: both are optional, both
   carry an urgency state (Closes pulses under 24h), and neither
   appears on the feed card, so they are new information that earns the
   space. The row stays >=44pt tall so Where/Date remain HIG-legal tap
   targets. */
export const JobStatTiles = ({ job, distMilesForDriving, drivingLabel }: JobStatTilesProps) => {
  // auto-rows-fr + the last-child span keeps the final tile from sitting as a
  // lone full-width slab. With an ODD tile count (5 here: Where, Date, Time,
  // Estimated, Closes) a plain 2-col grid strands the last one; spanning it
  // across both columns is the deliberate, balanced version of what was
  // happening by accident, and auto-rows-fr keeps every row the same height so
  // the block reads as one unit.
  return (
    <div className="flex flex-col gap-2">
      {(() => {
        const dateNeeded = parseLocalDate(job.date_needed);
        const dateValid = !isNaN(dateNeeded.getTime());
        let calendarUrl: string | null = null;
        if (dateValid) {
          const dateStartIso = dateNeeded.toISOString().slice(0, 10).replace(/-/g, "");
          const dateEnd = new Date(dateNeeded.getTime() + (job.estimated_hours ? Number(job.estimated_hours) * 3600 * 1000 : 24 * 3600 * 1000));
          const dateEndIso = dateEnd.toISOString().slice(0, 10).replace(/-/g, "");
          calendarUrl = `https://www.google.com/calendar/render?action=TEMPLATE&text=${encodeURIComponent(job.title)}&dates=${dateStartIso}/${dateEndIso}&details=${encodeURIComponent(job.description.slice(0, 200))}&location=${encodeURIComponent(job.location)}`;
        }
        const mapsUrl = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(job.location)}`;
        // Distance estimate when both helpr coords + parish centroid
        // available. distMilesForDriving + drivingLabel are computed
        // above (because useDrivingTime is a hook); we just compose
        // the user-facing copy here.
        const distMiles = distMilesForDriving;
        const distOnly = distMiles != null
          ? distMiles < 1 ? "less than 1 mi" : `~${Math.round(distMiles)} mi`
          : null;
        // Compose distance + driving time on one line when both are
        // available: "12 min · ~4 mi". Falls back to either alone.
        const distLabel = distOnly && drivingLabel
          ? `${drivingLabel} · ${distOnly}`
          : drivingLabel ?? distOnly;
        // Closes urgency: <24h to expiry → render in Sienna with subtle pulse
        const hoursLeft = job.expires_at
          ? differenceInHours(new Date(job.expires_at), new Date())
          : null;
        const closesUrgent = hoursLeft != null && hoursLeft >= 0 && hoursLeft < 24;
        const tiles = [
          { Icon: MapPin, label: "Where", value: getCity(job.location).replace(/,\s*LA\s*$/i, ""), sub: distLabel, href: mapsUrl, urgent: false },
          {
            Icon: Calendar,
            label: "Date",
            value: dateValid ? formatJobDate(job.date_needed) : "—",
            sub: null,
            href: calendarUrl,
            urgent: false,
          },
          // Time is its own tile (not a sub-line under Date) so the date
          // stops truncating and the start time reads as a first-class
          // fact. Omitted when unset, matching Estimated/Closes below.
          // 12-hour clock (e.g. "2:30 PM"), matching the feed card — not
          // the raw "14:30:00" the DB column stores.
          ...(job.start_time
            ? [{
                Icon: Clock,
                label: "Time",
                value: formatTime12(job.start_time),
                sub: null,
                href: null,
                urgent: false,
              }]
            : []),
          // Estimated-hours tile is omitted entirely when unset — a bare
          // "Estimated —" read as a bug rather than "no estimate given".
          ...(job.estimated_hours != null
            ? [{
                // Hourglass, not Clock. Clock sits directly beside this on the
                // "Time" tile, so two identical glyphs were labelling two
                // different things — a clock time (5:00 PM) and a duration
                // (4 hrs). Three distinct time concepts now read distinctly:
                // Clock = when it starts, Hourglass = how long it takes,
                // Timer = how long until the listing closes.
                Icon: Hourglass,
                label: "Estimated",
                value: `${job.estimated_hours} ${Number(job.estimated_hours) === 1 ? "hr" : "hrs"}`,
                sub: null,
                href: null,
                urgent: false,
              }]
            : []),
          // Closes tile is omitted entirely when the job has no expiry —
          // an empty "—" deadline read as a bug rather than "no deadline".
          ...(job.expires_at
            ? [{
                Icon: Timer,
                label: "Closes",
                value: formatDistanceToNow(new Date(job.expires_at), { addSuffix: false }),
                sub: null,
                href: null,
                urgent: closesUrgent,
              }]
            : []),
        ];
        // First three entries (Where, Date, Time) are the compact row; the
        // optional Estimated / Closes entries stay as tiles below it.
        const rowItems = tiles.filter((t) => ["Where", "Date", "Time"].includes(t.label));
        const tileItems = tiles.filter((t) => !["Where", "Date", "Time"].includes(t.label));

        const compactRow = (
          <div
            key="compact-meta"
            className="flex items-stretch rounded-ds-md overflow-hidden min-h-[44px]"
            style={{
              backgroundColor: "var(--glass-bg-soft)",
              backdropFilter: "blur(18px) saturate(160%)",
              WebkitBackdropFilter: "blur(18px) saturate(160%)",
              border: "0.5px solid var(--glass-border)",
              boxShadow:
                "inset 0 1px 1px 0 rgba(255, 255, 255, 0.55), 0 1px 2px hsl(var(--olivewood) / 0.05)",
            }}
          >
            {rowItems.map(({ Icon, label, value, sub, href }, i) => {
              const Wrapper: ElementType = href ? "a" : "div";
              const wrapperProps: { href?: string; target?: string; rel?: string } = href
                ? { href, target: "_blank", rel: "noopener noreferrer" }
                : {};
              return (
                <Wrapper
                  key={label}
                  {...wrapperProps}
                  aria-label={href ? `${label}: ${value}` : undefined}
                  className={`flex-1 min-w-0 flex flex-col items-center justify-center px-1.5 py-2 ${
                    i > 0 ? "border-l" : ""
                  } ${href ? "glass-press cursor-pointer" : ""}`}
                  style={i > 0 ? { borderLeftColor: "var(--glass-border)", borderLeftWidth: "0.5px" } : undefined}
                >
                  <span className="flex items-center gap-1 min-w-0 max-w-full">
                    <Icon
                      className="w-3.5 h-3.5 shrink-0"
                      style={{ color: "hsl(var(--burnt-sienna) / 0.7)" }}
                      aria-hidden
                    />
                    <span
                      className="font-sans font-semibold text-ds-14 leading-tight tracking-tight truncate"
                      style={{ color: "hsl(var(--ink-deep))" }}
                    >
                      {value}
                    </span>
                  </span>
                  {sub && (
                    <span
                      className="font-serif italic text-ds-11 truncate max-w-full mt-0.5"
                      style={{ color: "hsl(var(--olivewood) / 0.8)" }}
                    >
                      {sub}
                    </span>
                  )}
                </Wrapper>
              );
            })}
          </div>
        );

        const tileGrid = tileItems.length > 0 && (
          <div
            key="stat-tiles"
            className="grid grid-cols-2 auto-rows-fr gap-2 [&>*:last-child:nth-child(odd)]:col-span-2"
          >
            {tileItems.map(({ Icon, label, value, sub, href, urgent }, index) => {
          // An odd tile count leaves the last tile alone in the 2-col
          // grid with an empty cell beside it — let it span the full
          // width instead so the strip reads as intentional.
          const fillsRow = tileItems.length % 2 === 1 && index === tileItems.length - 1;
          const Wrapper: ElementType = href ? "a" : "div";
          // Only the anchor branch carries href/target/rel; an empty object
          // for the div branch. Typed as the minimal shared shape so the
          // spread is valid whether Wrapper resolves to <a> or <div>.
          const wrapperProps: { href?: string; target?: string; rel?: string } = href
            ? { href, target: "_blank", rel: "noopener noreferrer" }
            : {};
          return (
            <Wrapper
              key={label}
              {...wrapperProps}
              className={`relative min-w-0 rounded-ds-md p-2.5 overflow-hidden ${fillsRow ? "col-span-2" : ""} ${href ? "glass-press transition-shadow hover:shadow-md cursor-pointer" : ""} ${urgent ? "urgent-pulse" : ""}`}
              style={{
                backgroundColor: urgent ? "hsl(var(--accent) / 0.10)" : "var(--glass-bg-soft)",
                backdropFilter: "blur(18px) saturate(160%)",
                WebkitBackdropFilter: "blur(18px) saturate(160%)",
                border: urgent
                  ? "0.5px solid hsl(var(--accent) / 0.45)"
                  : "0.5px solid var(--glass-border)",
                boxShadow:
                  "inset 0 1px 1px 0 rgba(255, 255, 255, 0.55), " +
                  (urgent
                    ? "0 1px 2px hsl(var(--accent) / 0.18)"
                    : "0 1px 2px hsl(var(--olivewood) / 0.05)"),
                display: "block",
              }}
            >
              <div className="relative z-10">
                <p
                  className="flex items-center justify-center gap-1.5 text-ds-11 font-sans font-semibold uppercase"
                  style={{
                    color: urgent ? "hsl(var(--accent))" : "hsl(var(--olivewood) / 0.8)",
                    letterSpacing: "0.06em",
                  }}
                >
                  <Icon
                    className="w-3.5 h-3.5 shrink-0"
                    style={{ color: urgent ? "hsl(var(--accent))" : "hsl(var(--burnt-sienna) / 0.7)" }}
                  />
                  {label}
                </p>
                <p
                  className="font-sans font-semibold mt-1 text-ds-16 leading-tight tracking-tight truncate text-center"
                  style={{ color: urgent ? "hsl(var(--accent))" : "hsl(var(--ink-deep))" }}
                >
                  {value}
                </p>
                {sub && (
                  <p className="font-serif italic text-ds-11 truncate text-center mt-0.5" style={{ color: "hsl(var(--olivewood) / 0.8)" }}>
                    {sub}
                  </p>
                )}
              </div>
            </Wrapper>
          );
            })}
          </div>
        );

        return (
          <>
            {compactRow}
            {tileGrid}
          </>
        );
      })()}
    </div>
  );
};
