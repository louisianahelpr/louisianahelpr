import { useState, useEffect } from "react";
import { Timer } from "lucide-react";

/**
 * JobCountdown — a live "job starts in" pill that ticks every minute.
 *
 * Shared by PostedJobCard and AppliedJobCard (both surface the same
 * countdown for an accepted/offered job). Parses the date parts
 * manually so the target instant stays in the viewer's local timezone
 * regardless of how `date_needed` is stored.
 */
export const JobCountdown = ({ dateNeeded, startTime, label }: { dateNeeded: string; startTime?: string | null; label: string }) => {
  const [now, setNow] = useState(new Date());
  useEffect(() => {
    const interval = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(interval);
  }, []);

  // Parse date parts manually to avoid timezone shifts
  const [year, month, day] = dateNeeded.split("-").map(Number);
  const jobDate = new Date(year, month - 1, day);
  if (startTime) {
    const [h, m] = startTime.split(":").map(Number);
    jobDate.setHours(h, m, 0, 0);
  } else {
    jobDate.setHours(23, 59, 59, 0);
  }

  const diffMs = jobDate.getTime() - now.getTime();
  if (diffMs <= 0) {
    return (
      <div className="flex items-center gap-2 p-2.5 rounded-ds-sm border border-primary/30 bg-primary/10">
        <Timer className="w-4 h-4 text-primary shrink-0" />
        <p className="text-ds-11 font-semibold text-primary">Job time has arrived!</p>
      </div>
    );
  }

  const totalMin = Math.floor(diffMs / 60_000);
  const days = Math.floor(totalMin / 1440);
  const hours = Math.floor((totalMin % 1440) / 60);
  const minutes = totalMin % 60;

  const timeStr = days > 0 ? `${days}d ${hours}h ${minutes}m` : hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`;
  const isUrgent = totalMin < 720;
  const isCritical = totalMin < 120;

  const colorClasses = isCritical
    ? "border-destructive/30 bg-destructive/10 text-destructive"
    : isUrgent
    ? "border-accent/30 bg-accent/10 text-[hsl(var(--accent-ink))]"
    : "border-primary/20 bg-primary/5 text-primary";

  return (
    <div className={`flex items-center gap-2 p-2.5 rounded-ds-sm border ${colorClasses}`}>
      <Timer className="w-4 h-4 shrink-0" />
      {/* ONE LINE, not two. This pill used to restate the date and start time
          underneath the countdown — "Job starts in: 5d 3h 42m" over "Fri, Aug
          28, 8:00 AM" — while the card's own meta row, two rows above it,
          already reads "Lafayette · Fri, Aug 28 · 8:00 AM". Same fact, twice,
          a centimetre apart (owner, repeatedly: "remove it already says this
          above"). What this pill knows that the meta row does not is the
          COUNTDOWN, so that is all it says now.

          `JobCardMetaRow` also covers the missing-time case — it prints
          "Flexible" in the time slot — so there is nothing left for a second
          line to add in either branch. */}
      <p className="text-ds-11 font-semibold tabular-nums min-w-0">{label}: {timeStr}</p>
    </div>
  );
};
