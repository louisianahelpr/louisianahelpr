import { CalendarClock } from "lucide-react";
import { scheduleClashText, type ScheduleClash } from "@/lib/scheduleClashes";

/**
 * The in-app half of "you're double-booked" (owner, 2026-10-12, Q1326): on the
 * Helpr's card, collapsed and expanded, for as long as the two bookings
 * overlap. The job carries `schedule_clash` (tagged by useActivityData from
 * my_schedule_clashes()); nothing to dismiss, it goes away when one moves.
 */
export function ScheduleClashNotice({ job }: { job: object | null | undefined }) {
  const clash = (job as { schedule_clash?: ScheduleClash } | null)?.schedule_clash;
  if (!clash) return null;
  return (
    <div
      role="status"
      data-schedule-clash
      className="mx-3 mt-3 flex items-start gap-2 rounded-ds-md px-3 py-2"
      style={{ background: "hsl(var(--warning) / 0.12)", border: "1px solid hsl(var(--warning) / 0.45)" }}
    >
      <CalendarClock className="h-4 w-4 shrink-0 mt-0.5" style={{ color: "hsl(var(--ink-deep))" }} aria-hidden />
      <p className="flex-1 min-w-0 text-ds-12 font-semibold" style={{ color: "hsl(var(--ink-deep))" }}>
        {scheduleClashText(clash)}
      </p>
    </div>
  );
}
