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
    ? "border-accent/30 bg-accent/10 text-accent"
    : "border-primary/20 bg-primary/5 text-primary";

  return (
    <div className={`flex items-center gap-2 p-2.5 rounded-ds-sm border ${colorClasses}`}>
      <Timer className="w-4 h-4 shrink-0" />
      <div className="min-w-0">
        <p className="text-ds-11 font-semibold tabular-nums">{label}: {timeStr}</p>
        {/* No opacity modifier. At 10px this line has to clear WCAG AA, and
            `opacity-80` over the tinted card measured 3.72:1 (axe, serious) —
            #7d8267 on #f7f7f6. opacity-90 fixes the primary branch (4.58) but
            NOT the critical one (destructive lands at 4.35), and the critical
            branch is the one that most needs reading. Full opacity clears all
            three (5.71 / 5.06). The de-emphasis is already carried by size and
            weight against the line above (text-ds-11 font-semibold). */}
        <p className="text-ds-10 mt-0.5">
          {startTime
            ? jobDate.toLocaleString("en-US", { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
            : jobDate.toLocaleDateString("en-US", { weekday: 'short', month: 'short', day: 'numeric' }) + " · Flexible"
          }
        </p>
      </div>
    </div>
  );
};
