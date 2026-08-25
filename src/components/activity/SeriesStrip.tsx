import { useQuery } from "@tanstack/react-query";
import { RefreshCw } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { WEEKDAY_LABELS, upcomingVisitDates, visitCount } from "@/lib/recurringSchedule";
import { formatJobDate } from "@/lib/dateUtils";

/**
 * SeriesStrip — the recurring series, made visible (owner, 2026-08-24: the
 * engine was fully wired but the poster couldn't SEE the series anywhere —
 * "next visit funds Thursday · 3 of 18 created" existed only in the cron's
 * head). Renders on the poster's PARENT card only; children and one-off jobs
 * render nothing.
 *
 * Three facts, one line each:
 *   - the shape:   Mon, Wed, Fri × 6 weeks (18 visits)
 *   - progress:    3 of 18 visits created
 *   - what's next: Next visit Wed, Aug 27 — funds automatically 3 days ahead,
 *                  or the honest paused state when no Helpr is committed.
 */
export function SeriesStrip({
  jobId,
  recurrenceDays,
  recurrenceWeeks,
  dateNeeded,
  seriesHelperCommitted,
}: {
  jobId: string;
  recurrenceDays: number[] | null | undefined;
  recurrenceWeeks: number | null | undefined;
  dateNeeded: string | null;
  seriesHelperCommitted: boolean;
}) {
  const isSeries = !!recurrenceDays && recurrenceDays.length > 0 && !!recurrenceWeeks;

  const { data: createdCount } = useQuery({
    queryKey: ["series-children", jobId],
    enabled: isSeries,
    staleTime: 60_000,
    queryFn: async () => {
      const { count, error } = await supabase
        .from("jobs")
        .select("id", { count: "exact", head: true })
        .eq("parent_job_id", jobId);
      if (error) throw error;
      return count ?? 0;
    },
  });

  if (!isSeries || !dateNeeded) return null;

  const total = visitCount(dateNeeded, recurrenceDays!, recurrenceWeeks!);
  // +1: the parent row IS the first visit; children are the rest.
  const created = Math.min(total, (createdCount ?? 0) + 1);
  const today = new Date().toISOString().slice(0, 10);
  const upcoming = upcomingVisitDates(dateNeeded, recurrenceDays!, recurrenceWeeks!).filter((d) => d >= today);
  const next = upcoming.length > 0 ? upcoming[0] : null;
  const dayList = recurrenceDays!.map((d) => WEEKDAY_LABELS[d]).join(", ");

  return (
    <div
      className="mx-4 mb-2 px-3 py-2 rounded-ds-md space-y-0.5"
      style={{
        background: "hsl(var(--bark) / 0.06)",
        border: "0.5px solid hsl(var(--bark) / 0.18)",
      }}
    >
      <p className="flex items-center gap-1.5 text-ds-11 font-semibold" style={{ color: "hsl(var(--bark))" }}>
        <RefreshCw className="w-3 h-3 shrink-0" aria-hidden />
        Series · {dayList} × {recurrenceWeeks} {recurrenceWeeks === 1 ? "week" : "weeks"} ({total} visits)
      </p>
      <p className="text-ds-11" style={{ color: "hsl(var(--olivewood) / 0.85)" }}>
        {created} of {total} visits created
        {next
          ? seriesHelperCommitted
            ? ` · next ${formatJobDate(next)} — funds automatically 3 days ahead`
            : ` · paused until a Helpr books this job`
          : " · series complete"}
      </p>
      <p className="text-ds-10" style={{ color: "hsl(var(--olivewood) / 0.65)" }}>
        Cancelling this job cancels the whole series — visits already funded are unaffected.
      </p>
    </div>
  );
}
