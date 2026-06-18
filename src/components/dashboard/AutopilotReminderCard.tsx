import { motion } from "framer-motion";
import { X, RefreshCw } from "lucide-react";
import { useReducedMotion } from "@/lib/accessibility";

interface Reminder {
  id: string;
  category: string;
  last_completed_date: string | null;
  next_reminder_date: string | null;
  reminder_interval_days: number;
}

interface Props {
  reminder: Reminder;
  onDismiss: () => void;
  onPostJob: (category: string) => void;
}

const CATEGORY_LABELS: Record<string, string> = {
  cleaning: "deep clean",
  yard_work: "yard work",
  pet_care: "pet care",
  handyman: "handyman work",
  painting: "painting",
};

function weeksAgo(date: string): string {
  const days = Math.floor(
    (Date.now() - new Date(date).getTime()) / 86_400_000,
  );
  if (days < 7) return `${days} day${days === 1 ? "" : "s"} ago`;
  const weeks = Math.round(days / 7);
  return `${weeks} week${weeks === 1 ? "" : "s"} ago`;
}

/**
 * AutopilotReminderCard — home-care autopilot prompt.
 * Shows when a maintenance category is due based on the interval set after
 * the last completed job. One card max (the most overdue).
 */
export function AutopilotReminderCard({ reminder, onDismiss, onPostJob }: Props) {
  const reducedMotion = useReducedMotion();
  const label = CATEGORY_LABELS[reminder.category] ?? reminder.category.replace(/_/g, " ");
  const sinceLabel = reminder.last_completed_date
    ? weeksAgo(reminder.last_completed_date)
    : null;

  const headline = sinceLabel
    ? `Your last ${label} was ${sinceLabel}`
    : `Time for a ${label}?`;
  const subtext = sinceLabel
    ? `Looks like it's time for another ${label}.`
    : `Keep your home on track with regular ${label}.`;

  return (
    <motion.div
      initial={reducedMotion ? { opacity: 0 } : { opacity: 0, y: -8 }}
      animate={reducedMotion ? { opacity: 1 } : { opacity: 1, y: 0 }}
      exit={reducedMotion ? { opacity: 0 } : { opacity: 0, height: 0, marginBottom: 0 }}
      transition={{ duration: reducedMotion ? 0.15 : 0.28 }}
      className="shrink-0 mx-4 mb-1 rounded-ds-md px-3 py-3 flex items-start gap-3"
      style={{
        background:
          "radial-gradient(70% 100% at 0% 50%, hsl(155 50% 35% / 0.06) 0%, transparent 60%)",
        border: "0.5px solid hsl(155 50% 35% / 0.20)",
        backdropFilter: "blur(10px)",
      }}
    >
      {/* Icon tile */}
      <div
        className="shrink-0 w-9 h-9 rounded-ds-sm flex items-center justify-center mt-0.5"
        style={{
          background: "hsl(155 50% 35% / 0.10)",
          color: "hsl(155 50% 30%)",
        }}
        aria-hidden
      >
        <RefreshCw className="w-4.5 h-4.5 w-[18px] h-[18px]" strokeWidth={2} />
      </div>

      {/* Text + CTA */}
      <div className="flex-1 min-w-0">
        <p
          className="font-display italic font-semibold leading-tight"
          style={{ fontSize: "0.87rem", color: "hsl(var(--ink-deep))", letterSpacing: "-0.01em" }}
        >
          {headline}
        </p>
        <p
          className="font-serif italic text-ds-11 leading-snug mt-0.5"
          style={{ color: "hsl(var(--olivewood) / 0.75)" }}
        >
          {subtext}
        </p>
        <div className="flex flex-wrap gap-2 mt-2">
          <button
            type="button"
            onClick={() => onPostJob(reminder.category)}
            className="font-sans font-semibold text-ds-11 px-2.5 py-1 rounded-ds-pill active:opacity-70 transition-opacity"
            style={{
              background: "hsl(155 50% 30% / 0.10)",
              color: "hsl(155 50% 25%)",
              border: "0.5px solid hsl(155 50% 35% / 0.24)",
            }}
          >
            Post a {label.replace(/\b\w/g, (c) => c.toUpperCase())} job →
          </button>
          <button
            type="button"
            onClick={onDismiss}
            className="font-sans text-ds-11 text-muted-foreground underline underline-offset-2 active:opacity-70 transition-opacity"
          >
            Remind me later
          </button>
        </div>
      </div>

      {/* Dismiss X */}
      <button
        type="button"
        onClick={onDismiss}
        aria-label="Dismiss reminder"
        className="shrink-0 -mt-1 -mr-1 w-9 h-9 flex items-center justify-center rounded-full active:opacity-70 hover:bg-black/[0.04] transition-colors"
        style={{ color: "hsl(var(--olivewood) / 0.55)" }}
      >
        <X className="w-4 h-4" />
      </button>
    </motion.div>
  );
}

export default AutopilotReminderCard;
