import { type ReactNode } from "react";
import { Calendar, Clock, MapPin, Timer } from "lucide-react";
import { differenceInHours, formatDistanceToNow } from "date-fns";
import { parseLocalDate } from "@/lib/dateUtils";
import { getCityState } from "@/lib/locationUtils";

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
}: JobCardMetaRowProps) {
  return (
    <div className="flex items-center gap-2.5 flex-wrap text-ds-11 text-muted-foreground">
      <span className="flex items-center gap-1">
        <Calendar className="w-3 h-3 shrink-0" />
        {parseLocalDate(dateNeeded).toLocaleDateString(undefined, {
          weekday: "short",
          month: "short",
          day: "numeric",
        })}
        {!startTime
          ? ` · ${flexibleLabel}`
          : ` · ${new Date(`2000-01-01T${startTime}`).toLocaleTimeString(undefined, {
              hour: "numeric",
              minute: "2-digit",
            })}`}
      </span>
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
        <span className="truncate max-w-[140px]">{getCityState(location)}</span>
      </a>
      {estimatedHours ? (
        <span className="flex items-center gap-1">
          <Clock className="w-3 h-3 shrink-0" /> {estimatedHours}h
        </span>
      ) : null}
      {expiresAt
        ? (() => {
            const expiry = new Date(expiresAt);
            const expired = expiry <= new Date();
            const expiringSoon = differenceInHours(expiry, new Date()) < 24;
            const text = expired
              ? "Expired"
              : formatDistanceToNow(expiry, { addSuffix: false }) + " left";
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
    </div>
  );
}
