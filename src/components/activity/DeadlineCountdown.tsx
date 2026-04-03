import { useState, useEffect } from "react";
import { Timer } from "lucide-react";

interface DeadlineCountdownProps {
  deadline: string;
  expiredText: string;
  consequenceText: string;
  variant?: "warning" | "destructive";
}

const DeadlineCountdown = ({ deadline, expiredText, consequenceText, variant = "warning" }: DeadlineCountdownProps) => {
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

  const colorClasses = isExpired
    ? "bg-destructive/10 border-destructive/30 text-destructive"
    : isUrgent
    ? variant === "destructive"
      ? "bg-destructive/10 border-destructive/30 text-destructive"
      : "bg-yellow-500/15 border-yellow-500/30 text-yellow-700 dark:text-yellow-400"
    : variant === "destructive"
    ? "bg-destructive/5 border-destructive/20 text-muted-foreground"
    : "bg-yellow-500/5 border-yellow-500/20 text-muted-foreground";

  return (
    <div className={`flex items-start gap-2 p-2 rounded-lg border ${colorClasses}`}>
      <Timer className="w-4 h-4 shrink-0 mt-0.5" />
      <div className="min-w-0">
        {isExpired ? (
          <p className="text-xs font-semibold">{expiredText}</p>
        ) : (
          <>
            <p className="text-xs font-semibold tabular-nums">{timeStr} remaining</p>
            <p className="text-[10px] mt-0.5 opacity-80">{consequenceText}</p>
          </>
        )}
      </div>
    </div>
  );
};

export default DeadlineCountdown;
