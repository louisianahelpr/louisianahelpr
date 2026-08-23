import { type ReactNode } from "react";
import { Calendar, Clock, MapPin, Timer } from "lucide-react";
import { differenceInHours } from "date-fns";
import { formatJobDate, formatTimeLeft } from "@/lib/dateUtils";
import { getCity } from "@/lib/locationUtils";

interface JobCardMetaRowProps {
  dateNeeded: string;
  startTime: string | null;
  /** Text shown after the date when `startTime` is empty — Posted uses
      "Flexible time", Applied uses "Flexible". */
  flexibleLabel?: string;
  location: string;
  latitude: number | null;
  longitude: number | null;
  estimatedHours?: number | null;
  /** ISO timestamp of the application/post expiry. Pass `null`/`undefined`
      to hide the expiry chip; the caller is responsible for any extra
      gating (e.g. only show while pending, only show with no helper). */
  expiresAt?: string | null;
  /** Optional extra chips appended to the row (e.g. applicant counts,
      recurring, group-task) — Posted uses this. */
  children?: ReactNode;
  /** A single control pinned to the far right of the row (`ml-auto`), after
   *  every chip. The posted card's "View details" toggle lives here so it
   *  stops costing a full 44px row of its own — see the note at the call
   *  site. Kept separate from `children` so it is always LAST and always
   *  right-aligned no matter how many chips wrapped above it. */
  trailing?: ReactNode;
}

/**
 * Date / location / estimated-hours / expiry chip row shared by both
 * activity cards. Posted adds a few role-specific chips via `children`.
 */
export function JobCardMetaRow({
  dateNeeded,
  startTime,
  flexibleLabel = "Flexible",
  location,
  latitude,
  longitude,
  estimatedHours,
  expiresAt,
  children,
  trailing,
}: JobCardMetaRowProps) {
  return (
    <div className="flex items-center gap-2.5 flex-wrap text-ds-11 text-muted-foreground">
      {/* Location → date → time, matching the home feed ("Browse Tasks")
          card order so the two surfaces read consistently. */}
      <a
        onClick={(e) => e.stopPropagation()}
        href={
          latitude && longitude
            ? `https://www.google.com/maps?q=${latitude},${longitude}`
            : `https://www.google.com/maps/search/${encodeURIComponent(location)}`
        }
        target="_blank"
        rel="noopener noreferrer"
        className="flex items-center gap-1 hover:text-primary transition-colors"
      >
        <MapPin className="w-3 h-3 shrink-0" />
        <span className="truncate max-w-[140px]">{getCity(location)}</span>
      </a>
      <span className="flex items-center gap-1">
        <Calendar className="w-3 h-3 shrink-0" />
        {formatJobDate(dateNeeded)}
      </span>
      <span className="flex items-center gap-1">
        <Clock className="w-3 h-3 shrink-0" />
        {!startTime
          ? flexibleLabel
          : new Date(`2000-01-01T${startTime}`).toLocaleTimeString(undefined, {
              hour: "numeric",
              minute: "2-digit",
            })}
      </span>
      {/* No "3h" estimate chip. Post a Job has no estimated-hours field any
          more (owner), so on every job posted since it was dropped this
          rendered nothing, and on the older ones it showed a second clock icon
          beside the start time for a number the poster can no longer set or
          correct. The column and its edit field are untouched — this is the
          card display only. */}
      {expiresAt
        ? (() => {
            const expiry = new Date(expiresAt);
            const expired = expiry <= new Date();
            const expiringSoon = differenceInHours(expiry, new Date()) < 24;
            const text = expired ? "Expired" : formatTimeLeft(expiry);
            return (
              <span
                className={`flex items-center gap-1 ${expiringSoon ? "text-destructive font-medium" : ""}`}
              >
                <Timer className="w-3 h-3 shrink-0" /> {text}
              </span>
            );
          })()
        : null}
      {children}
      {trailing ? <span className="ml-auto shrink-0">{trailing}</span> : null}
    </div>
  );
}
