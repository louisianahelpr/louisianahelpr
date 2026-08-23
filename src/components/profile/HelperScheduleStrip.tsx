import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { CalendarDays, Clock, MapPin } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog,
  DialogContent,
  DialogHero,
} from "@/components/ui/dialog";
import { supabase } from "@/integrations/supabase/client";
import { unwrap } from "@/lib/supabaseResult";
import { queryKeys } from "@/lib/queryKeys";
import { jobStatusLabel } from "@/lib/statusLabels";
import type { Database } from "@/integrations/supabase/types";

type JobRow = Database["public"]["Tables"]["jobs"]["Row"];

/**
 * Same status set the EarningsForecastCard projects on — the helper has
 * committed to deliver these (excluding `revision_requested` / `disputed`
 * which are uncertain). Keeping the two surfaces in lockstep means a job
 * that contributes to the weekly $$ projection also appears on this strip.
 */
const SCHEDULED_STATUSES = ["accepted", "in_progress"] as const;

const WINDOW_DAYS = 7;

/**
 * Columns we pull for each scheduled job — minimal slice, no `select("*")`,
 * keeps RLS row-shape predictable and avoids leaking unused fields.
 */
type StripJob = Pick<
  JobRow,
  "id" | "title" | "date_needed" | "start_time" | "location" | "status"
>;

/**
 * Build an array of YYYY-MM-DD strings covering today + next 6 days, in
 * the user's local timezone. Postgres compares against `date_needed` (a
 * `date`, not `timestamptz`) so we keep everything in plain date form.
 */
function buildWindow(now: Date = new Date()): {
  startISO: string;
  endISO: string;
  days: { iso: string; date: Date }[];
} {
  const isoDate = (d: Date) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

  const start = new Date(now);
  start.setHours(0, 0, 0, 0);

  const days: { iso: string; date: Date }[] = [];
  for (let i = 0; i < WINDOW_DAYS; i += 1) {
    const d = new Date(start);
    d.setDate(start.getDate() + i);
    days.push({ iso: isoDate(d), date: d });
  }

  return {
    startISO: days[0].iso,
    endISO: days[days.length - 1].iso,
    days,
  };
}

/**
 * Render `HH:MM` (24h) or `HH:MM:SS` from Postgres `time` as a
 * locale-friendly `h:mm a`. Returns `null` for missing/garbled values so
 * the caller can fall back to "Anytime".
 */
function formatTime(raw: string | null): string | null {
  if (!raw) return null;
  const match = /^(\d{1,2}):(\d{2})/.exec(raw);
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (Number.isNaN(hour) || Number.isNaN(minute)) return null;
  const d = new Date();
  d.setHours(hour, minute, 0, 0);
  return d.toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
  });
}

interface HelperScheduleStripProps {
  helperId: string;
  /**
   * When false the strip renders nothing — used to keep it off the screen
   * for helpers who haven't finished Stripe Connect onboarding (they
   * shouldn't be accepting jobs yet, so an empty 7-day grid is just
   * noise on the Earnings tab).
   */
  enabled: boolean;
}

/**
 * A horizontal 7-day strip of the helper's upcoming `accepted` /
 * `in_progress` jobs. Mirrors the same status + date filtering the
 * EarningsForecastCard uses so the two surfaces stay in sync.
 *
 * - Hidden entirely when the helper has zero scheduled jobs in the
 *   window. A 7-cell empty grid is more discouraging than informative.
 * - Tap a day → opens a dialog listing every scheduled job that day.
 * - Today is highlighted with a sienna border so the helper's eye lands
 *   on it first.
 */
export function HelperScheduleStrip({ helperId, enabled }: HelperScheduleStripProps) {
  const navigate = useNavigate();
  const [openDayISO, setOpenDayISO] = useState<string | null>(null);

  const { startISO, endISO, days } = useMemo(() => buildWindow(), []);

  const { data: jobs = [], isLoading, isError } = useQuery<StripJob[]>({
    queryKey: queryKeys.helperSchedule.forWindow(helperId, startISO, endISO),
    queryFn: async () => {
      // Filter at the DB level — RLS already restricts SELECT on these
      // statuses to the helper themselves. We pull only the columns the
      // strip actually renders.
      const rows = unwrap(
        await supabase
          .from("jobs")
          .select("id, title, date_needed, start_time, location, status")
          .eq("helper_id", helperId)
          .in("status", [...SCHEDULED_STATUSES])
          .gte("date_needed", startISO)
          .lte("date_needed", endISO)
          .order("date_needed", { ascending: true })
          .order("start_time", { ascending: true, nullsFirst: false }),
      ) as StripJob[] | null;
      return rows ?? [];
    },
    enabled: enabled && !!helperId,
    staleTime: 60_000,
    gcTime: 5 * 60_000,
  });

  // Group jobs into a Map keyed by date_needed (YYYY-MM-DD). Cheap enough
  // to recompute on every render — the result set is small (typically <
  // 20 jobs across a week).
  const jobsByDay = useMemo(() => {
    const map = new Map<string, StripJob[]>();
    for (const j of jobs) {
      const key = j.date_needed;
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(j);
    }
    return map;
  }, [jobs]);

  if (!enabled) return null;

  if (isLoading) {
    return (
      <div
        data-testid="helper-schedule-strip-skeleton"
        className="rounded-2xl liquid-glass p-4 space-y-3"
      >
        <Skeleton className="h-3 w-32 rounded" />
        <div className="flex gap-2 overflow-x-auto">
          {Array.from({ length: 7 }).map((_, i) => (
            <Skeleton
              key={i}
              className="h-24 w-20 shrink-0 rounded-ds-md"
            />
          ))}
        </div>
      </div>
    );
  }

  const todayISO = days[0].iso;

  // Hide entirely if there are NO upcoming jobs in the window. An empty
  // 7-day grid is busy chrome that demoralises rather than informs — the
  // EarningsForecastCard's empty state above already nudges them to
  // browse.
  // On a hard error `jobs` stays [] → the block below would falsely tell the
  // helper "No jobs scheduled this week" when they may have scheduled work.
  // Hide the strip instead of asserting an empty schedule (their jobs still
  // appear on the dashboard/Activity); react-query retries transient failures.
  if (isError) return null;

  if (jobs.length === 0) {
    return (
      <div className="rounded-2xl liquid-glass p-5">
        <div className="flex items-start gap-3">
          <div
            className="w-9 h-9 rounded-full flex items-center justify-center shrink-0"
            style={{ background: "hsl(var(--bark) / 0.10)" }}
          >
            <CalendarDays
              className="w-4 h-4"
              style={{ color: "hsl(var(--bark))" }}
            />
          </div>
          <div className="flex-1 min-w-0">
            <h3
              className="font-display italic font-bold leading-tight text-ds-17"
              style={{ color: "hsl(var(--ink-deep))" }}
            >
              No jobs scheduled this week
            </h3>
            <p
              className="font-serif italic mt-1 text-ds-12"
              style={{ color: "hsl(var(--olivewood) / 0.8)" }}
            >
              Go browse — accepted jobs will land on this strip.
            </p>
            <Button
              variant="primary"
              size="sm"
              className="mt-2"
              onClick={() => navigate("/dashboard")}
            >
              Browse jobs
            </Button>
          </div>
        </div>
      </div>
    );
  }

  const openDayJobs = openDayISO ? jobsByDay.get(openDayISO) ?? [] : [];
  const openDayDate = openDayISO
    ? days.find((d) => d.iso === openDayISO)?.date ?? null
    : null;

  return (
    <>
      <section
        data-testid="helper-schedule-strip"
        className="rounded-2xl liquid-glass p-4"
      >
        <div className="mb-3">
          <h3
            className="font-display italic font-bold leading-tight text-ds-17"
            style={{ color: "hsl(var(--ink-deep))" }}
          >
            Your schedule
          </h3>
        </div>

        <ul
          className="flex gap-2 overflow-x-auto pb-1 -mx-1 px-1 snap-x"
          aria-label="Upcoming 7 days"
        >
          {days.map(({ iso, date }) => {
            const dayJobs = jobsByDay.get(iso) ?? [];
            const isToday = iso === todayISO;
            const isEmpty = dayJobs.length === 0;
            const weekday = date.toLocaleDateString("en-US", { weekday: "short" });
            const dayNum = date.getDate();
            const month = date.toLocaleDateString("en-US", { month: "short" });

            return (
              <li key={iso} className="snap-start">
                <button
                  type="button"
                  disabled={isEmpty}
                  onClick={() => setOpenDayISO(iso)}
                  aria-label={`${dayJobs.length} job${dayJobs.length === 1 ? "" : "s"} on ${weekday} ${month} ${dayNum}`}
                  aria-current={isToday ? "date" : undefined}
                  className={`w-28 shrink-0 rounded-ds-md p-2 text-left transition-all bg-[hsl(var(--parchment))] ${
                    isToday
                      ? "border-2 border-[hsl(var(--burnt-sienna))]"
                      : "border border-[hsl(var(--olivewood)/0.15)]"
                  } ${
                    isEmpty
                      ? "opacity-70 cursor-default"
                      : "hover:-translate-y-0.5 hover:shadow-sm active:scale-[0.98]"
                  }`}
                >
                  <div className="flex items-baseline justify-between gap-1">
                    <span
                      className="font-serif italic uppercase text-ds-10"
                      style={{
                        color: isToday
                          ? "hsl(var(--burnt-sienna))"
                          : "hsl(var(--olivewood) / 0.8)",
                        letterSpacing: "0.14em",
                      }}
                    >
                      {isToday ? "Today" : weekday}
                    </span>
                    <span
                      className="font-display italic font-bold tabular-nums leading-none text-ds-17"
                      style={{
                        color: "hsl(var(--ink-deep))",
                        letterSpacing: "-0.01em",
                      }}
                    >
                      {dayNum}
                    </span>
                  </div>

                  {isEmpty ? (
                    <p
                      className="mt-2 font-serif italic text-ds-11"
                      style={{
                        color: "hsl(var(--olivewood) / 0.8)",
                      }}
                    >
                      Open
                    </p>
                  ) : (
                    <>
                      <p
                        className="mt-1.5 font-sans font-semibold text-ds-11"
                        style={{
                          color: "hsl(var(--bark))",
                          letterSpacing: "0.02em",
                        }}
                      >
                        {dayJobs.length} {dayJobs.length === 1 ? "job" : "jobs"}
                      </p>
                      <ul className="mt-1 space-y-1">
                        {dayJobs.slice(0, 2).map((j) => {
                          const time = formatTime(j.start_time);
                          return (
                            <li
                              key={j.id}
                              className="leading-tight text-ds-11"
                            >
                              <span
                                className="block truncate font-serif italic"
                                style={{ color: "hsl(var(--ink-deep))" }}
                              >
                                {j.title}
                              </span>
                              <span
                                className="block truncate font-serif italic"
                                style={{ color: "hsl(var(--olivewood) / 0.8)" }}
                              >
                                {time ?? "Anytime"}
                              </span>
                            </li>
                          );
                        })}
                        {dayJobs.length > 2 && (
                          <li
                            className="font-serif italic text-ds-10"
                            style={{
                              color: "hsl(var(--burnt-sienna))",
                            }}
                          >
                            +{dayJobs.length - 2} more
                          </li>
                        )}
                      </ul>
                    </>
                  )}
                </button>
              </li>
            );
          })}
        </ul>
      </section>

      <Dialog
        open={openDayISO !== null}
        onOpenChange={(o) => {
          if (!o) setOpenDayISO(null);
        }}
      >
        <DialogContent>
          <DialogHero
            eyebrow={
              <>
                <CalendarDays className="w-3 h-3" /> Your schedule
              </>
            }
            title={
              openDayDate
                ? openDayDate.toLocaleDateString("en-US", {
                    weekday: "long",
                    month: "long",
                    day: "numeric",
                  })
                : "Schedule"
            }
          />
          <ul className="space-y-2.5">
            {openDayJobs.map((j) => {
              const time = formatTime(j.start_time);
              return (
                <li
                  key={j.id}
                  className="rounded-ds-md border border-[hsl(var(--olivewood)/0.15)] bg-[hsl(var(--parchment))] p-3"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1 min-w-0">
                      <h4
                        className="font-display italic font-bold leading-tight text-ds-15"
                        style={{
                          color: "hsl(var(--ink-deep))",
                          letterSpacing: "-0.01em",
                        }}
                      >
                        {j.title}
                      </h4>
                      <div
                        className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 font-serif italic text-ds-12"
                        style={{
                          color: "hsl(var(--olivewood) / 0.8)",
                        }}
                      >
                        <span className="inline-flex items-center gap-1">
                          <Clock className="w-3 h-3" aria-hidden />
                          {time ?? "Anytime"}
                        </span>
                        <span className="inline-flex items-center gap-1 min-w-0">
                          <MapPin className="w-3 h-3 shrink-0" aria-hidden />
                          <span className="truncate">{j.location}</span>
                        </span>
                      </div>
                    </div>
                    <span
                      className="shrink-0 text-ds-10 font-medium uppercase tracking-wide px-2 py-0.5 rounded-full"
                      style={{
                        background:
                          j.status === "in_progress"
                            ? "hsl(var(--burnt-sienna) / 0.12)"
                            : "hsl(var(--bark) / 0.10)",
                        color:
                          j.status === "in_progress"
                            ? "hsl(var(--burnt-sienna))"
                            : "hsl(var(--bark))",
                      }}
                    >
                      {jobStatusLabel(j.status)}
                    </span>
                  </div>
                </li>
              );
            })}
          </ul>
        </DialogContent>
      </Dialog>
    </>
  );
}

export default HelperScheduleStrip;
