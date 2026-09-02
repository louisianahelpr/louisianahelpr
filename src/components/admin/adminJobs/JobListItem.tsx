import { Badge } from "@/components/ui/badge";
import { MapPin, CalendarClock, AlertTriangle, CheckCircle2 } from "lucide-react";
import { StatusBadge } from "@/components/StatusBadge";
import { paymentStatusLabel } from "@/lib/statusLabels";
import { categoryLabels, paymentColors, type Job } from "./types";
import { formatJobDate } from "@/lib/dateUtils";
import { formatPrice, formatCategory } from "@/lib/format";
import { STALE_DATE_FLAG, moderationFlags } from "./adminJobsHelpers";

interface JobListItemProps {
  job: Job;
  flags: string[] | undefined;
  isResolved: boolean;
  onOpen: (job: Job) => void;
}

/**
 * One row of the moderation queue.
 *
 * Two things were fighting for the same 343pt of phone width. The title shared
 * its line with a category badge while a two-chip status stack held the right
 * edge, so every title truncated at roughly six words ("Pack a kitchen for
 * mov…") — on a screen whose entire job is telling an admin WHICH job they are
 * looking at. The title now owns a full row and clamps at two lines; the chips
 * moved down to a meta row of their own, where they wrap instead of squeezing.
 *
 * And the flag treatment was one-size: every auto-flag rendered as a red pill
 * on a red-bordered card, so twenty stale dates painted a wall of red that hid
 * the single card with an actual moderation flag. Staleness is now a quiet
 * amber note and only real flags tint the card.
 */
export const JobListItem = ({ job, flags, isResolved, onOpen }: JobListItemProps) => {
  const modFlags = moderationFlags(flags);
  const isStale = !!flags?.includes(STALE_DATE_FLAG);
  // Only MODERATION flags earn the destructive card treatment.
  const showFlagStyle = modFlags.length > 0 && !isResolved;
  const isRemoved = !!job.removal_reason;
  return (
    <div
      onClick={() => onOpen(job)}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onOpen(job);
        }
      }}
      className={`rounded-ds-md border bg-card p-4 space-y-2 cursor-pointer hover:bg-secondary/20 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary ${
        showFlagStyle ? "border-destructive/30" : "border-border"
      } ${isRemoved ? "opacity-60" : ""}`}
    >
      {/* Title row — the whole width, two lines before it clamps. */}
      <div className="flex items-start gap-2">
        {showFlagStyle && <AlertTriangle className="w-4 h-4 mt-0.5 text-destructive shrink-0" />}
        {modFlags.length > 0 && isResolved && <CheckCircle2 className="w-4 h-4 mt-0.5 text-primary shrink-0" />}
        <p className="min-w-0 flex-1 font-semibold text-foreground leading-snug line-clamp-2">{job.title}</p>
      </div>

      {/* Meta row — every chip that used to crowd the title or stack at the
          right edge, wrapping freely on one line of its own. */}
      <div className="flex flex-wrap items-center gap-1.5">
        <StatusBadge status={job.status} className="text-ds-11" />
        <span className={`text-ds-11 px-2 py-0.5 rounded-full font-medium ${paymentColors[job.payment_status || "unpaid"] || ""}`}>
          {paymentStatusLabel(job.payment_status ?? "unpaid")}
        </span>
        <Badge variant="sienna" className="text-ds-11">{categoryLabels[job.category] || formatCategory(job.category)}</Badge>
        {isRemoved && <Badge variant="destructive" className="text-ds-11">Removed</Badge>}
        {modFlags.length > 0 && isResolved && (
          <Badge variant="outline" className="text-ds-11 gap-1"><CheckCircle2 className="w-3 h-3" />Resolved</Badge>
        )}
      </div>

      <div className="flex flex-wrap gap-x-3 gap-y-1 text-ds-11 text-muted-foreground">
        <span className="flex items-center gap-1 min-w-0"><MapPin className="w-3 h-3 shrink-0" /> <span className="truncate">{job.location}</span></span>
        <span className="flex items-center gap-1"><CalendarClock className="w-3 h-3 shrink-0" /> {formatJobDate(job.date_needed)}</span>
        <span className="font-medium text-foreground">${formatPrice(job.budget ?? 0)}</span>
      </div>

      {showFlagStyle && (
        <div className="flex flex-wrap gap-1">
          {modFlags.slice(0, 2).map((f, i) => (
            <span key={i} className="text-ds-10 bg-destructive/10 text-destructive px-1.5 py-0.5 rounded-full">{f}</span>
          ))}
          {modFlags.length > 2 && <span className="text-ds-10 text-destructive">+{modFlags.length - 2} more</span>}
        </div>
      )}

      {/* Staleness — a calendar fact, not an emergency. One quiet line. */}
      {isStale && !isResolved && (
        <p className="flex items-center gap-1 text-ds-10" style={{ color: "hsl(var(--amber-ink))" }}>
          <CalendarClock className="w-3 h-3 shrink-0" /> Date needed has passed
        </p>
      )}
    </div>
  );
};
