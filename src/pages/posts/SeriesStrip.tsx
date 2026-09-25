import { useQuery } from "@tanstack/react-query";
import { RefreshCw } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { WEEKDAY_LABELS, recurringVisitDates } from "@/lib/recurringSchedule";
import { formatJobDate } from "@/lib/dateUtils";
import { todayYmd } from "@/lib/jobDate";
import { EndSeriesControl } from "@/components/series/EndSeriesControl";

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
 *   - what's next: the next date MONEY MOVES, or the honest paused state when
 *                  no Helpr is committed.
 *
 * "next funds <date>" printed the VISIT date, which is not when the card is
 * charged. `charge-recurring-visits` funds every visit inside a
 * FUND_LEAD_DAYS = 3 horizon (index.ts:97, :251), so a Wednesday visit is
 * charged the preceding Sunday. The strip was naming a date three days after
 * the money actually left the poster's account — on the one line of this card
 * that is about money. The lead is mirrored in FUND_LEAD_DAYS below.
 */
/**
 * How many days BEFORE a visit its escrow is charged.
 *
 * Mirrors `FUND_LEAD_DAYS` in `supabase/functions/charge-recurring-visits/
 * index.ts:97` — the cron takes `horizon = today + FUND_LEAD_DAYS` and funds
 * every unfunded visit on or before it. Keep the two in step: this constant is
 * what turns a visit date into the date the poster's card is actually charged.
 */
const FUND_LEAD_DAYS = 3;

/** `ymd` shifted by `days`, in the same UTC calendar the cron uses. */
function shiftYmd(ymd: string, days: number): string {
  // Noon UTC for the same reason `recurringSchedule.parseYmd` uses it: a
  // date-only string parsed at midnight and shifted lands a day early.
  const d = new Date(`${ymd}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function SeriesStrip({
  jobId,
  recurrenceDays,
  recurrenceWeeks,
  dateNeeded,
  seriesHelperCommitted,
  seriesEndedOn = null,
  canEnd = false,
  jobTitle = null,
  userId = null,
}: {
  jobId: string;
  recurrenceDays: number[] | null | undefined;
  recurrenceWeeks: number | null | undefined;
  dateNeeded: string | null;
  seriesHelperCommitted: boolean;
  /** jobs.series_ended_on: the last date an ended series runs; null = running. */
  seriesEndedOn?: string | null;
  /** Show "End series" (a running series the viewer is a party to). */
  canEnd?: boolean;
  jobTitle?: string | null;
  userId?: string | null;
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

  // An ended series runs only through series_ended_on; the cron funds nothing
  // after it.
  const allDates = recurringVisitDates(dateNeeded, recurrenceDays!, recurrenceWeeks!).filter(
    (d, i) => i === 0 || seriesEndedOn === null || d <= seriesEndedOn,
  );
  const total = allDates.length;
  // +1: the parent row IS the first visit; children are the rest.
  const created = Math.min(total, (createdCount ?? 0) + 1);
  // Today in America/Chicago. The cron runs at 06:06 UTC (00:06 CST / 01:06
  // CDT), so the run for date D happens early on Chicago day D: a charge dated
  // today has run, one dated tomorrow has not. The UTC date runs ahead of that
  // from 18:00 CST / 19:00 CDT to midnight and would skip tomorrow's charge.
  const today = todayYmd();
  const upcoming = allDates.slice(1).filter((d) => d >= today);
  const next = upcoming.length > 0 ? upcoming[0] : null;
  // The next visit whose charge has NOT already been attempted. Everything
  // inside the horizon was funded on an earlier run, so its money has already
  // moved and naming its date would point the poster at the past.
  const nextFundDate = upcoming
    .map((visit) => shiftYmd(visit, -FUND_LEAD_DAYS))
    .find((fundsOn) => fundsOn > today) ?? null;
  const dayList = recurrenceDays!.map((d) => WEEKDAY_LABELS[d]).join(", ");

  // ONE line (owner, 2026-08-24: "kind of busy, make less hectic" — the
  // first cut was a three-line box on a card that already stacks countdown,
  // tracker and confirmation strips). The cancel-scope warning moved to the
  // Cancel dialog, which is the only moment it matters.
  return (
    <div
      className="mx-4 mb-2 px-3 py-1.5 rounded-ds-md"
      style={{
        background: "hsl(var(--bark) / 0.06)",
        border: "0.5px solid hsl(var(--bark) / 0.18)",
      }}
    >
      <p className="flex items-center gap-1.5 text-ds-11 min-w-0" style={{ color: "hsl(var(--bark))" }}>
        <RefreshCw className="w-3 h-3 shrink-0" aria-hidden />
        <span className="truncate">
          <span className="font-semibold">{dayList} × {recurrenceWeeks} wk{recurrenceWeeks === 1 ? "" : "s"}</span>
          {" · "}{created}/{total} visits
          {seriesEndedOn
            ? next
              ? ` · ended — last visit ${formatJobDate(allDates[allDates.length - 1])}`
              : " · ended"
            : next
            ? seriesHelperCommitted
              ? nextFundDate
                ? ` · next funds ${formatJobDate(nextFundDate)}`
                : // Every remaining visit is already inside the funding window,
                  // so there is no future charge to name. Fall back to the fact
                  // that IS still ahead of the poster: the visit itself.
                  ` · next visit ${formatJobDate(next)}`
              : " · paused until a Helpr books"
            : " · complete"}
        </span>
        {canEnd && !seriesEndedOn && next && (
          <span className="ml-auto">
            <EndSeriesControl jobId={jobId} jobTitle={jobTitle} userId={userId} />
          </span>
        )}
      </p>
    </div>
  );
}
