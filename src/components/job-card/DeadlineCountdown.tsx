import { useState, useEffect } from "react";
import { Timer } from "lucide-react";

interface DeadlineCountdownProps {
  deadline: string;
  expiredText: string;
  consequenceText: string;
  variant?: "warning" | "destructive";
  /** One-line mode: renders `{time} {consequenceText}` as a single sentence
   *  (owner: "one-line countdown", 2026-08-24 — the 4-line explainer made the
   *  banner the tallest thing on the card while the Approve sheet it points
   *  at already walks through both paths). Callers pass a clause that reads
   *  after a duration, e.g. "to review — payment auto-releases after". */
  inline?: boolean;
  /** Bare one-line form for the collapsed card's status strip (owner,
   *  2026-10-01: every tracker deadline is visible on the collapsed line).
   *  No box, no border: the strip already supplies the surface and the ink,
   *  so this inherits its colour. Same clock, same text as `inline`. */
  compact?: boolean;
}

const DeadlineCountdown = ({
  deadline,
  expiredText,
  consequenceText,
  variant = "warning",
  inline = false,
  compact = false,
}: DeadlineCountdownProps) => {
  const [now, setNow] = useState(new Date());

  useEffect(() => {
    const interval = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(interval);
  }, []);

  const deadlineDate = new Date(deadline);
  const diffMs = deadlineDate.getTime() - now.getTime();
  const isExpired = diffMs <= 0;

  // Calculate remaining time
  const totalMinutes = Math.max(0, Math.floor(diffMs / 60_000));
  const days = Math.floor(totalMinutes / 1440);
  const hours = Math.floor((totalMinutes % 1440) / 60);
  const minutes = totalMinutes % 60;

  const timeStr = days > 0
    ? `${days}d ${hours}h ${minutes}m`
    : hours > 0
    ? `${hours}h ${minutes}m`
    : `${minutes}m`;

  const isUrgent = totalMinutes < 720; // < 12 hours

  // Destructive states map to token-backed Tailwind utilities. The warning
  // states use the amber tint/ink family, which are not Tailwind utilities,
  // so they're applied inline via style below.
  const isWarningUrgent = isUrgent && variant !== "destructive";
  const isWarningCalm = !isExpired && !isUrgent && variant !== "destructive";

  const colorClasses = isExpired
    ? "bg-destructive/10 border-destructive/30 text-[hsl(var(--destructive-ink))]"
    : isUrgent
    ? variant === "destructive"
      ? "bg-destructive/10 border-destructive/30 text-[hsl(var(--destructive-ink))]"
      : ""
    : variant === "destructive"
    ? "bg-destructive/5 border-destructive/20 text-muted-foreground"
    : "";

  const warningStyle: React.CSSProperties | undefined = isWarningUrgent
    ? {
        background: "hsl(var(--amber-tint) / 0.15)",
        borderColor: "hsl(var(--amber-tint) / 0.30)",
        color: "hsl(var(--amber-ink))",
      }
    : isWarningCalm
    ? {
        background: "hsl(var(--amber-tint) / 0.05)",
        borderColor: "hsl(var(--amber-tint) / 0.20)",
        color: "hsl(var(--muted-foreground))",
      }
    : undefined;

  if (compact) {
    return (
      <span data-deadline-countdown className="flex items-center gap-1 text-ds-11 font-semibold">
        <Timer className="w-3 h-3 shrink-0" aria-hidden />
        {isExpired ? (
          <span>{expiredText}</span>
        ) : (
          <span>
            <span className="tabular-nums">{timeStr}</span> {consequenceText}
          </span>
        )}
      </span>
    );
  }

  return (
    <div
      data-deadline-countdown
      className={`flex items-start gap-2 p-2 rounded-ds-sm border ${colorClasses}`}
      style={warningStyle}
    >
      <Timer className="w-4 h-4 shrink-0 mt-0.5" />
      <div className="min-w-0">
        {isExpired ? (
          <p className="text-ds-11 font-semibold">{expiredText}</p>
        ) : inline ? (
          <p className="text-ds-11 font-semibold">
            <span className="tabular-nums">{timeStr}</span> {consequenceText}
          </p>
        ) : (
          <>
            <p className="text-ds-11 font-semibold tabular-nums">{timeStr} remaining</p>
            {/* opacity removed — same 3.72:1 AA failure as JobCountdown; see
                the note there. Size + weight carry the hierarchy instead. */}
            <p className="text-ds-10 mt-0.5">{consequenceText}</p>
          </>
        )}
      </div>
    </div>
  );
};

export default DeadlineCountdown;
