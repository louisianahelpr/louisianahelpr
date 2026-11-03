import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { ProfileTabBodyReserve } from "@/components/profile/ProfileTabFallback";
import { SCHEDULE_LAYOUT_CLASS } from "@/components/profile/scheduleLayout";
import { ChevronLeft, ChevronRight, CalendarDays, Search, Plus, ListFilter } from "lucide-react";
import ProfileTabHeader from "@/components/profile/ProfileTabHeader";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

import { supabase } from "@/integrations/supabase/client";
import { report } from "@/lib/errorLogger";
import type { ReadableJobRow } from "@/lib/jobColumns";
import { todayLocalISO } from "@/lib/dateUtils";
import { tierFeePercent } from "@/lib/subscriptionTiers";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { ProfileTabBody } from "@/components/profile/ProfileTabBody";

import { ScheduleCard } from "@/components/profile/schedule/ScheduleCard";

// jobs.offered_to_helper_id is not client-selectable (20260915045110).
type Job = ReadableJobRow;

interface ScheduleTabProps {
  postedJobs: Job[];
  assignedJobs: Job[];
  loading: boolean;
  userId: string;
  onBack: () => void;
  /** When the parent owns the tab header (e.g. the merged
      Schedule + Availability tab), suppress the local one so the
      surface doesn't render two stacked headers. Default false to
      preserve standalone behavior. */
  hideHeader?: boolean;
}

type UpcomingFilter = "all" | "posted" | "applied";
const UPCOMING_FILTERS: { value: UpcomingFilter; label: string }[] = [
  { value: "all", label: "All" },
  { value: "posted", label: "Posted" },
  { value: "applied", label: "Applied" },
];

/**
 * The tab's two-column layout (VN-41, owner 2026-09-15: "Side by side").
 *
 * The owner saw a ~280px calendar floating in a full-width card with ~650px of
 * blank card either side of it, and the Upcoming jobs list pushed below it. At
 * 1024px and up the calendar takes the LEFT column and the list takes the
 * RIGHT, both starting at the same top edge (`items-start`, so a short list
 * does not stretch the calendar card and vice versa).
 *
 * The calendar column is `clamp(320px, 42%, 480px)` — about 5/12 of the
 * content width, never narrower than a usable month grid and never wider than
 * 480px — and the list gets the rest (`minmax(0,1fr)`, so a long job title
 * truncates instead of widening the track past the viewport). Against the
 * Profile content box: 1440 with the rail open is ~1144px wide, so the
 * calendar lands at 480 and the list at ~640; 1024 with the rail open is
 * ~728px, so 320 / ~384.
 *
 * `min-[1024px]`, NOT `lg:`. This project's `lg` is 900 (tailwind.config.ts —
 * it has to match WEB_DESKTOP_QUERY), and at 900 with the 248px rail open the
 * content box is ~604px: two columns there would squeeze the list to ~260px.
 * Below 1024 the page stacks exactly as before, calendar then list; the gap
 * is `gap-section` (--section-gap, Q191: 12px on a phone, 16px from sm),
 * the same rhythm as every other Profile tab's section stack.
 *
 * While loading, the tab shows the shared ProfileTabBodyReserve (Q169) and
 * the whole layout arrives at once. Pinned by ScheduleTab.layout.test.tsx,
 * which compiles this string through the real Tailwind config.
 */
export { SCHEDULE_LAYOUT_CLASS }; // re-exported for the layout test; lives in ./scheduleLayout so the placeholder draws the same grid (Q2013)

export function ScheduleTab({ postedJobs, assignedJobs, loading, userId, onBack, hideHeader = false }: ScheduleTabProps) {
  // The viewer's own tier rate — the fallback used for assigned jobs whose
  // stamped fee isn't yet authoritative. Resolved once here rather than per
  // card. Same ladder the Money tab and Work Record use.
  const { profile: viewerProfile } = useCurrentUser();
  const viewerFeePercent = tierFeePercent(
    viewerProfile?.subscription_tier,
    viewerProfile?.subscription_expires_at ?? null,
  );
  const navigate = useNavigate();
  const [currentMonth, setCurrentMonth] = useState(new Date());
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  // Upcoming-list filter (item 27) — Posted/Applied/All toggle for the
  // "Upcoming jobs" list. "Applied" reuses the same meaning as elsewhere on
  // this tab: jobs assigned to the viewer (they applied and got picked),
  // not raw applications.
  const [upcomingFilter, setUpcomingFilter] = useState<UpcomingFilter>("all");

  // Self-blocked dates — rows in helper_availability with a
  // specific_date and is_available=false. These are the "I marked
  // myself unavailable" exceptions. Surfaced as grey-out cells with a
  // hover tooltip so the poster of the page knows *why* a date is
  // grey at a glance.
  const { data: blockedDates = new Map<string, "marked_unavailable">() } = useQuery<
    Map<string, "marked_unavailable">
  >({
    queryKey: ["schedule", "blocked", userId],
    queryFn: async () => {
      if (!userId) return new Map();
      const { data, error } = await supabase
        .from("helper_availability")
        .select("specific_date, is_available")
        .eq("helper_id", userId)
        .not("specific_date", "is", null)
        .eq("is_available", false);
      if (error) {
        // Degrade to "no blocked dates" but observably — a dropped error
        // here silently un-greys days the helper marked unavailable.
        report(error, { severity: "warning", tags: { source: "ScheduleTab.blockedDates" } });
        return new Map();
      }
      const m = new Map<string, "marked_unavailable">();
      (data as Array<{ specific_date: string | null }>).forEach((row) => {
        if (row.specific_date) m.set(row.specific_date, "marked_unavailable");
      });
      return m;
    },
    enabled: !!userId,
    staleTime: 60_000,
    gcTime: 5 * 60_000,
  });

  // True when the user has navigated away from the current month — used
  // to surface a "Today" reset button only when it's actually useful.
  const todayDate = new Date();
  const viewingDifferentMonth =
    currentMonth.getFullYear() !== todayDate.getFullYear() ||
    currentMonth.getMonth() !== todayDate.getMonth();

  const allJobs = [...postedJobs, ...assignedJobs];
  const jobsByDate = new Map<string, Job[]>();
  allJobs.forEach((j) => {
    const key = j.date_needed;
    if (!jobsByDate.has(key)) jobsByDate.set(key, []);
    jobsByDate.get(key)!.push(j);
  });

  const year = currentMonth.getFullYear();
  const month = currentMonth.getMonth();
  const firstDay = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  // Local "today" (NOT UTC) so the highlighted cell + "Upcoming" filter
  // match the user's actual day. See todayLocalISO.
  const today = todayLocalISO();
  const days: (number | null)[] = [];
  for (let i = 0; i < firstDay; i++) days.push(null);
  for (let i = 1; i <= daysInMonth; i++) days.push(i);
  const getDateStr = (day: number) => `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  const selectedJobs = selectedDate ? (jobsByDate.get(selectedDate) || []) : [];
  const postedIds = new Set(postedJobs.map((j) => j.id));
  const upcomingSource =
    upcomingFilter === "posted" ? postedJobs :
    upcomingFilter === "applied" ? assignedJobs :
    allJobs;
  const upcomingJobs = upcomingSource.filter((j) => j.date_needed >= today).sort((a, b) => a.date_needed.localeCompare(b.date_needed)).slice(0, 10);

  return (
    <ProfileTabBody>
      {!hideHeader && (
        <ProfileTabHeader
          title="Schedule"
          onBack={onBack}
        />
      )}

      {loading ? (
        // The SAME placeholder the tab's chunk load showed a moment earlier
        // (Q169): one skeleton, not two. The calendar-shaped one that stood
        // here drew 5 week rows of 36px bones against a taller real calendar
        // with its legend, so "Upcoming jobs" dropped 156px when the data
        // landed (CLS 0.14 at 375).
        <ProfileTabBodyReserve tab="schedule" />
      ) : (
        <div data-testid="schedule-layout" className={SCHEDULE_LAYOUT_CLASS}>
          {/* Calendar card — item 27, significantly more compact than before.
              The grid used to be `aspect-square` cells at full card width, so
              on any screen wider than a phone SE each day cell ballooned to
              50-60px for a calendar whose only job is "pick a date, glance at
              dots". Capping the grid at 280px and dropping cells to a fixed
              32px keeps every cell tappable (well over the 40px target isn't
              needed here — see aria-label + the whole-cell hit area) while
              giving the Upcoming-jobs list below far more of the screen.

              That cap is for the STACKED layout only. From 1024px the calendar
              has a column of its own (VN-41), so the cap lifts
              (`min-[1024px]:max-w-none`) and the day cells go square
              (`aspect-square`) to fill it — at 1440 that is ~60px cells in a
              480px column instead of 32px cells in a 280px island. */}
          <div data-testid="schedule-calendar" className="rounded-2xl liquid-glass p-3.5 min-w-0 min-[1024px]:p-5">
            <div className="max-w-[280px] mx-auto min-[1024px]:max-w-none">
            <div className="flex items-center justify-between mb-2 min-[1024px]:mb-3">
              <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setCurrentMonth(new Date(year, month - 1, 1))} aria-label="Previous month"><ChevronLeft className="w-3.5 h-3.5" /></Button>
              <div className="flex flex-col items-center gap-1">
                {/* The month name is editorial (Bodoni Moda italic); the YEAR
                    is a figure, and figures in this app are set in the sans
                    face with tabular-nums (see the headline-scale note in
                    index.css — numeric sites sit outside the Bodoni scale on
                    purpose). Bodoni Moda is a didone: at the ~15px this
                    caption renders at, its italic "6" is a near-twin of "0",
                    and this caption was read off a device as "August 2020".
                    The date maths was never wrong — header and grid both
                    derive from the same `currentMonth`, so they cannot
                    disagree — the digits were simply not legible enough to
                    trust. Splitting the year onto the numeric face removes
                    the ambiguity without changing a single value. */}
                <h2 className="font-display font-bold leading-tight text-headline-card" style={{ color: "hsl(var(--ink-deep))", letterSpacing: "-0.01em" }}>
                  {currentMonth.toLocaleDateString("en-US", { month: "long" })}{" "}
                  <span className="font-sans not-italic font-semibold tabular-nums" style={{ letterSpacing: "0.01em" }}>
                    {currentMonth.getFullYear()}
                  </span>
                </h2>
                {/* "Today" reset surfaces only when the user has flipped
                    away from the current month — saves cognitive load
                    when it isn't useful. */}
                {viewingDifferentMonth && (
                  <button
                    type="button"
                    onClick={() => { setCurrentMonth(new Date()); setSelectedDate(null); }}
                    className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-ds-11 font-sans font-semibold tracking-wide active:scale-[0.96] transition-transform"
                    style={{
                      background: "hsl(var(--bark) / 0.10)",
                      color: "hsl(var(--bark))",
                      border: "1px solid hsl(var(--bark) / 0.22)",
                    }}
                  >
                    Today
                  </button>
                )}
              </div>
              <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setCurrentMonth(new Date(year, month + 1, 1))} aria-label="Next month"><ChevronRight className="w-3.5 h-3.5" /></Button>
            </div>
            <div className="grid grid-cols-7 gap-0.5 mb-0.5 min-[1024px]:gap-1 min-[1024px]:mb-1">
              {["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"].map((d) => (
                <div key={d} className="text-center font-sans font-semibold py-0.5 text-ds-11 min-[1024px]:py-1 min-[1024px]:text-ds-12 text-muted-foreground">
                  {d}
                </div>
              ))}
            </div>
            <div className="grid grid-cols-7 gap-0.5 min-[1024px]:gap-1">
              {days.map((day, i) => {
                if (day === null) return <div key={`e-${i}`} />;
                const dateStr = getDateStr(day);
                const dayJobs = jobsByDate.get(dateStr) ?? [];
                const hasJobs = dayJobs.length > 0;
                const isToday = dateStr === today;
                const isSelected = dateStr === selectedDate;
                // Derive the *reason* a date is blocked: an in-progress
                // job sitting on this date is a hard block (you're
                // already on the clock), self-marked unavailability is
                // a soft block. Either way we render the cell greyed
                // out + carry a `title` tooltip explaining why.
                const inProgressOnDay = dayJobs.some((j) => j.status === "in_progress" || j.status === "accepted");
                const selfMarked = blockedDates.has(dateStr);
                const blockedReason: string | null = inProgressOnDay
                  ? "Blocked: job in progress"
                  : selfMarked
                    ? "Blocked: you marked yourself unavailable"
                    : null;
                const isBlocked = blockedReason !== null;
                return (
                  <button
                    aria-pressed={isSelected}
                    key={day}
                    onClick={() => setSelectedDate(isSelected ? null : dateStr)}
                    title={blockedReason ?? undefined}
                    aria-label={blockedReason ? `${dateStr} — ${blockedReason.toLowerCase()}` : undefined}
                    className={`relative h-8 min-[1024px]:h-auto min-[1024px]:aspect-square flex flex-col items-center justify-center rounded-ds-sm text-ds-11 min-[1024px]:text-ds-14 transition-colors ${
                      isSelected ? "btn-grad-primary text-[hsl(var(--parchment))]" :
                      isToday ? "text-primary font-bold ring-2 ring-primary/70 ring-inset bg-primary/8" :
                      // text-muted-foreground at FULL strength, not /70. The
                      // date numeral is the only thing identifying the cell,
                      // and at 11px /70 measured 2.97:1 light / 4.05:1 dark
                      // against the 4.5:1 it needs. "Blocked" is already
                      // carried by the muted fill, the title tooltip and the
                      // aria-label — dimming the number below AA to say it
                      // again spends legibility on a signal three other things
                      // already give. Full strength measures 5.46 / 6.77.
                      isBlocked ? "text-muted-foreground bg-muted/30 hover:bg-muted/50" :
                      "hover:bg-secondary text-foreground"
                    }`}
                    style={
                      isSelected
                        ? {
                            // Canonical glossy selected-control treatment
                            // (matches the Subscription billing pills):
                            // drop shadow + inset parchment top-highlight so
                            // the picked day reads as elevated, not a flat
                            // fill.
                            boxShadow:
                              "0 1px 2px rgba(0,0,0,0.08), inset 0 1px 0 hsl(var(--parchment) / 0.2)",
                          }
                        : isBlocked && !isToday
                          ? {
                              // Subtle diagonal hatch + grey backdrop —
                              // signals "unavailable" without screaming.
                              backgroundImage:
                                "repeating-linear-gradient(135deg, transparent 0 4px, hsl(var(--olivewood) / 0.06) 4px 5px)",
                            }
                          : undefined
                    }
                  >
                    {day}
                    {/* ONE olive dot for a day with work (spec v2 rebuild, audit
                        2026-10-21: no per-category colours; sections and
                        categories are told apart by icon and name, never by a
                        rainbow of dots). The day's jobs are listed below it. */}
                    {hasJobs && (
                      <span
                        aria-hidden
                        className={`absolute bottom-1 min-[1024px]:bottom-2 w-1.5 h-1.5 rounded-full ${isSelected ? "bg-primary-foreground" : "bg-primary"}`}
                      />
                    )}
                  </button>
                );
              })}
            </div>
            {/* Legend — quick decoder so users intuit the bark dot
                without trial-and-error. Micro-chips inline, italic
                serif to match the rest of the chrome. Blocked entry is
                only added when at least one cell on the current month
                is actually blocked, so the legend stays minimal on
                clear weeks. */}
            {(() => {
              const monthHasBlocked = days.some((d) => {
                if (d === null) return false;
                const ds = getDateStr(d);
                if (blockedDates.has(ds)) return true;
                return (jobsByDate.get(ds) ?? []).some((j) => j.status === "in_progress" || j.status === "accepted");
              });
              return (
                <div className="mt-3 pt-3 flex items-center gap-4 flex-wrap font-sans text-ds-11" style={{ borderTop: "0.5px solid hsl(var(--olivewood) / 0.10)", color: "hsl(var(--olivewood) / 0.8)" }}>
                  <span className="inline-flex items-center gap-1.5">
                    <span className="w-3 h-3 rounded ring-2 ring-primary/70 ring-inset bg-primary/8" aria-hidden />
                    Today
                  </span>
                  <span className="inline-flex items-center gap-1.5">
                    <span className="w-1.5 h-1.5 rounded-full bg-primary" aria-hidden />
                    Has a job
                  </span>
                  {monthHasBlocked && (
                    <span className="inline-flex items-center gap-1.5">
                      <span
                        className="w-3 h-3 rounded bg-muted/30"
                        style={{
                          backgroundImage:
                            "repeating-linear-gradient(135deg, transparent 0 3px, hsl(var(--olivewood) / 0.18) 3px 4px)",
                        }}
                        aria-hidden
                      />
                      Blocked
                    </span>
                  )}
                </div>
              );
            })()}
            </div>
          </div>

          {/* The list column. Exactly one of its two states renders — the
              selected day's jobs, or Upcoming jobs — so it is ONE grid cell
              either way and the calendar never loses its left column when a
              day is picked. */}
          <div data-testid="schedule-list" className="min-w-0">
          {selectedDate && (
            <div className="space-y-3">
              <div>
                <h3 className="font-display font-bold leading-tight text-headline-card" style={{ color: "hsl(var(--ink-deep))", letterSpacing: "-0.01em" }}>
                  {new Date(selectedDate + "T12:00:00").toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" })}
                </h3>
              </div>
              {selectedJobs.length === 0 ? (
                <div className="rounded-2xl liquid-glass flex flex-col items-center text-center gap-3 px-6 py-8">
                  <div
                    className="w-12 h-12 rounded-full flex items-center justify-center"
                    style={{
                      backgroundColor: "hsl(var(--card) / 0.55)",
                      border: "1px solid hsl(var(--olivewood) / 0.10)",
                      boxShadow:
                        "inset 0 1px 1px 0 rgba(255, 255, 255, 0.65), " +
                        "0 1px 2px hsl(var(--olivewood) / 0.05), " +
                        "0 6px 14px -4px hsl(var(--olivewood) / 0.10)",
                    }}
                  >
                    <CalendarDays className="w-5 h-5" style={{ color: "hsl(var(--bark))" }} strokeWidth={1.75} />
                  </div>
                  <p className="font-sans max-w-[260px] text-ds-14" style={{ color: "hsl(var(--olivewood) / 0.8)" }}>
                    Nothing scheduled for this day.
                  </p>
                </div>
              ) : (
                selectedJobs.map((job) => (
                  <ScheduleCard key={job.id} job={job} isPosted={postedIds.has(job.id)} viewerFeePercent={viewerFeePercent} />
                ))
              )}
            </div>
          )}

          {!selectedDate && (
            <div className="space-y-3">
              <div className="flex items-center justify-between gap-2">
                <h3 className="font-display font-bold leading-tight text-headline-card" style={{ color: "hsl(var(--ink-deep))", letterSpacing: "-0.01em" }}>
                  Upcoming jobs
                </h3>
                {/* Posted/Applied/All toggle (item 27) — the list mixes jobs
                    this user posted with jobs they're assigned to, with no
                    way to look at just one side. Segmented pill matches the
                    ScheduleCard's own "Posted"/"Assigned" chip labels. */}
                <Popover>
                  <PopoverTrigger asChild>
                    <button
                      type="button"
                      aria-label={`Filter: ${UPCOMING_FILTERS.find((f) => f.value === upcomingFilter)?.label}`}
                      className="shrink-0 inline-flex items-center gap-1.5 rounded-full h-8 px-3 text-ds-11 font-sans font-semibold active:scale-[0.96] transition-all"
                      style={{
                        background: "hsl(var(--ivory-sand) / 0.65)",
                        border: "1px solid hsl(var(--olivewood) / 0.18)",
                        color: "hsl(var(--olivewood))",
                      }}
                    >
                      <ListFilter className="w-3.5 h-3.5 shrink-0" />
                      {UPCOMING_FILTERS.find((f) => f.value === upcomingFilter)?.label}
                    </button>
                  </PopoverTrigger>
                  <PopoverContent
                    aria-label="Filter upcoming jobs"
                    className="w-[min(92vw,180px)] rounded-2xl border border-border/40 shadow-2xl bg-card p-1.5" align="end"
                  >
                    {UPCOMING_FILTERS.map((opt) => {
                      const active = opt.value === upcomingFilter;
                      return (
                        <button
                          aria-pressed={active}
                          key={opt.value}
                          type="button"
                          onClick={() => setUpcomingFilter(opt.value)}
                          className={`w-full text-left px-2.5 h-9 rounded-md text-ds-13 font-sans font-medium transition-colors ${
                            active ? "btn-grad-primary text-[hsl(var(--parchment))]" : "text-foreground hover:bg-secondary/70"
                          }`}
                        >
                          {opt.label}
                        </button>
                      );
                    })}
                  </PopoverContent>
                </Popover>
              </div>
              {upcomingJobs.length === 0 ? (
                <div className="rounded-2xl liquid-glass flex flex-col items-center text-center gap-3 px-6 py-10">
                  <div
                    className="w-14 h-14 rounded-full flex items-center justify-center"
                    style={{
                      backgroundColor: "hsl(var(--card) / 0.55)",
                      border: "1px solid hsl(var(--olivewood) / 0.10)",
                      boxShadow:
                        "inset 0 1px 1px 0 rgba(255, 255, 255, 0.65), " +
                        "0 1px 2px hsl(var(--olivewood) / 0.05), " +
                        "0 6px 14px -4px hsl(var(--olivewood) / 0.10)",
                    }}
                  >
                    <CalendarDays className="w-6 h-6" style={{ color: "hsl(var(--bark))" }} strokeWidth={1.75} />
                  </div>
                  <div className="space-y-1">
                    <p className="font-display font-bold text-ds-16" style={{ color: "hsl(var(--ink-deep))", letterSpacing: "-0.015em" }}>
                      Calendar's clear.
                    </p>
                    <p className="font-sans max-w-[260px] text-ds-13" style={{ color: "hsl(var(--olivewood) / 0.8)" }}>
                      No upcoming jobs yet — book one and it'll show up here.
                    </p>
                  </div>
                  {/* Actionable empty state — Browse for helprs looking
                      to apply, Post for posters. Both routes are dock
                      destinations so users get back into the flow
                      without hunting through the bottom nav. */}
                  <div className="flex flex-wrap items-center justify-center gap-2 pt-1">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => navigate("/home")}
                    >
                      <Search className="w-3.5 h-3.5 mr-1.5" /> Browse open Jobs
                    </Button>
                    <Button
                      variant="primary"
                      size="sm"
                      onClick={() => navigate("/post-job")}
                    >
                      <Plus className="w-3.5 h-3.5 mr-1.5" /> Post a job
                    </Button>
                  </div>
                </div>
              ) : (
                upcomingJobs.map((job) => (
                  <ScheduleCard key={job.id} job={job} isPosted={postedIds.has(job.id)} viewerFeePercent={viewerFeePercent} />
                ))
              )}
            </div>
          )}
          </div>
        </div>
      )}
    </ProfileTabBody>
  );
}
