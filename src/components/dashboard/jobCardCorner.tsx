import { Zap } from "lucide-react";
export { isTodayJob } from "@/lib/sameDayJob";

/**
 * The browse card's top-right status corner (Boosted > Urgent > Today), its
 * shared shape. Lifted out of JobCard.tsx (componentSizeRatchet) when Q2438
 * added the Today chip.
 */
export const JOB_CARD_CORNER =
  "inline-flex items-center gap-1 shrink-0 pl-2.5 pr-3 py-1 rounded-bl-lg border-b border-l text-ds-9 font-bold uppercase leading-none shadow-sm";

/** Q2438: a job for Louisiana's today wears "Today" (below Boosted and Urgent, which keep the corner). */
export function TodayCornerChip() {
  return (
    <span
      className={JOB_CARD_CORNER}
      data-testid="job-card-today"
      style={{
        color: "hsl(var(--bark))",
        background: "hsl(var(--bark) / 0.12)",
        borderColor: "hsl(var(--bark) / 0.4)",
        letterSpacing: "0.05em",
      }}
    >
      <Zap className="w-2.5 h-2.5 shrink-0" style={{ color: "hsl(var(--bark))" }} aria-hidden />
      Today
    </span>
  );
}
