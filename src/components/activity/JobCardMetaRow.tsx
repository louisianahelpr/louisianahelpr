import { type ReactNode } from "react";
import { Calendar, Clock, MapPin, Timer } from "lucide-react";
import { differenceInHours } from "date-fns";
import { formatJobDate, formatTimeLeft } from "@/lib/dateUtils";
import { getCity } from "@/lib/locationUtils";
import { mapsSearchUrl } from "@/lib/mapsLink";

interface JobCardMetaRowProps {
  dateNeeded: string;
  startTime: string | null;
  /** Text shown after the date when `startTime` is empty — Posted uses
      "Flexible time", Applied uses "Flexible". */
  flexibleLabel?: string;
  location: string;
  /* Accepted but no longer read — the maps link uses the ADDRESS now (see the
     href below). Kept in the interface because both cards pass them and both
     may want them again for a distance chip; removing them would be an edit
     across the call sites for no gain. */
  latitude?: number | null;
  longitude?: number | null;
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
  estimatedHours,
  expiresAt,
  children,
  trailing,
}: JobCardMetaRowProps) {
  return (
    /* `gap-x-5`, not `gap-2.5` (owner: "space location day and time out
       better"). Three icon+label pairs 10px apart read as one run-on string —
       the eye can't tell where the place ends and the date begins, because the
       gap between "Lafayette" and the calendar icon was the same as the gap
       between the calendar icon and its own text. Twenty pixels between the
       GROUPS against six inside them makes the grouping do the separating, so
       no middot or rule is needed. `gap-y-1.5` keeps the wrapped rows apart on
       a narrow card. */
    <div className="flex items-center gap-x-5 gap-y-1.5 flex-wrap text-ds-11 text-muted-foreground">
      {/* Location → date → time, matching the home feed ("Browse Tasks")
          card order so the two surfaces read consistently. */}
      <a
        onClick={(e) => e.stopPropagation()}
        /* THE ADDRESS, not the coordinates. This linked to
           `google.com/maps?q=<lat>,<lng>` at four decimal places — about eleven
           metres, which on a residential job is the house — so the precise
           location of a private home travelled to a third party in a query
           string on every tap, for a convenience the address serves just as
           well. See mapsLink.ts; it also picks the platform's own maps app in
           the native shell instead of always sending people to the web. */
        href={mapsSearchUrl(location)}
        target="_blank"
        rel="noopener noreferrer"
        /* `py-2 -my-2` grows the HIT AREA without moving anything. The link
           measured 77x16 on a 375px screen — a thumb target a third of the
           44px floor index.css puts on every button in the app, and short even
           of WCAG 2.5.8's 24px minimum. The row's only other content is plain
           text, so the extra 8px above and below overlaps nothing that could
           steal the tap. */
        className="flex items-center gap-1.5 py-2 -my-2 hover:text-primary transition-colors"
      >
        <MapPin className="w-3 h-3 shrink-0" />
        <span className="truncate max-w-[140px]">{getCity(location)}</span>
      </a>
      <span className="flex items-center gap-1.5">
        <Calendar className="w-3 h-3 shrink-0" />
        {formatJobDate(dateNeeded)}
      </span>
      <span className="flex items-center gap-1.5">
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
