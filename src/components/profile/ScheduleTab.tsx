import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { MapPin, Clock, ChevronLeft, ChevronRight, CalendarDays, Search, Plus } from "lucide-react";
import ProfileTabHeader from "@/components/profile/ProfileTabHeader";

import { supabase } from "@/integrations/supabase/client";
import { report } from "@/lib/errorLogger";
import type { Database } from "@/integrations/supabase/types";
import { jobStatusColorClasses } from "@/lib/statusColors";
import { jobStatusLabel } from "@/lib/statusLabels";
import { todayLocalISO } from "@/lib/dateUtils";
import { formatPrice } from "@/lib/format";
import { helperTakeHomeDollars } from "@/lib/helperEarnings";
import { tierFeePercent } from "@/lib/subscriptionTiers";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { formatTime12 } from "@/components/TimePickerSelect";
import { inProgressBadgeTarget } from "@/components/dashboard/DashboardInProgressBadge";
import { bucketPostedJob } from "@/pages/activity/activityFilters";

type Job = Database["public"]["Tables"]["jobs"]["Row"];

/**
 * Where a schedule row goes when you tap it.
 *
 * The list is a MIX: some rows are jobs this user POSTED, some are jobs they
 * were ASSIGNED, and the two live on different screens — so one destination
 * can't serve both.
 *
 * Neither half invents a status→route table. The assigned half delegates to
 * {@link inProgressBadgeTarget}, the app's single router for "the helper's
 * live job", so the calendar and the dashboard pill land in the same place
 * for the same job. The posted half has no such router, so it reuses the
 * other existing primitive — `bucketPostedJob`, the same classifier My Posts
 * uses to build its own filter chips — which guarantees the filter we hand
 * the URL is one the page actually accepts.
 *
 * The one place the badge router doesn't reach: it only models a LIVE job
 * (in progress vs. upcoming), because that's all the dashboard pill ever
 * shows. The calendar also lists settled jobs — picking a past date is the
 * whole point of a calendar — and sending a completed job to the active list
 * would land the user on a screen their job isn't on. So terminal statuses
 * are mapped to the My Jobs filter key that actually holds them (each one
 * verified against `filteredAppliedApps` in `pages/activity/activityFilters`),
 * and everything still-running goes through the shared router untouched.
 */
const TERMINAL_ASSIGNED_FILTER: Record<string, string> = {
  completed: "completed",
  cancelled: "not_selected",
  disputed: "disputed",
  revision_requested: "revision",
};

function scheduleRowTarget(job: Job, isPosted: boolean): { to: string; destination: string } {
  if (isPosted) {
    return {
      to: `/my-posts?filter=${bucketPostedJob(job)}`,
      destination: "open this job in My Posts",
    };
  }
  const settled = TERMINAL_ASSIGNED_FILTER[job.status];
  if (settled) {
    return { to: `/my-jobs?filter=${settled}`, destination: "open this job in My Jobs" };
  }
  return inProgressBadgeTarget(job);
}

const ScheduleCard = ({
  job,
  isPosted,
  viewerFeePercent,
}: {
  job: Job;
  isPosted: boolean;
  /** The viewer's live tier rate, used only when the job carries no
      trustworthy stamped fee — see `helperEarnings.isSettledForDisplay`. */
  viewerFeePercent: number;
}) => {
  const navigate = useNavigate();
  const { to, destination } = scheduleRowTarget(job, isPosted);
  const time = formatTime12(job.start_time);

  return (
    // A schedule row is a shortcut to the job, so it is a real <button>, not
    // a decorated <div>: it gets keyboard focus, an accessible name that says
    // where it goes, and the global 44px min tap target. There are no nested
    // interactive children, so the whole card can be the control.
    //
    // Card surface tint mirrors the canonical status palette so an "in
    // progress" calendar entry reads in the same sienna family as the chip
    // for that state elsewhere. Border is left to the canvas (`bg-card`)
    // for terminal states so the calendar doesn't shout with cancelled
    // jobs.
    <button
      type="button"
      onClick={() => navigate(to)}
      aria-label={`${job.title} — ${isPosted ? "posted by you" : "assigned to you"}. Tap to ${destination}.`}
      className={`btn-press w-full text-left block rounded-ds-md border border-border/40 p-3 transition-transform active:scale-[0.99] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--ring))] ${jobStatusColorClasses(job.status)}`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap mb-1">
            <h4 className="font-semibold text-ds-13">{job.title}</h4>
            <span className="text-ds-11 px-2 py-0.5 rounded-full bg-card font-medium">{isPosted ? "Posted" : "Assigned"}</span>
          </div>
          <div className="flex flex-wrap gap-3 text-ds-11 text-muted-foreground">
            <span className="flex items-center gap-1"><MapPin className="w-3 h-3 shrink-0" /> {job.location}</span>
            {/* A currency symbol is typography, not an icon: the "$" belongs
                in the same text node as the digits. A DollarSign glyph beside
                a string that already carried one rendered as "$ $200". */}
            {/* Whose money is this? On a job you POSTED the budget is what you
                pay, so the raw figure is right. On a job you were ASSIGNED it
                is not your money — your take-home is the budget minus the
                platform fee, and that is the number every other helper-facing
                surface shows (My Jobs, Earnings & Payouts, Work Record). This
                row used to print the raw budget either way, so the same job
                read $85 here and $74 on the job card, in identical type.
                The whole job row is passed so `payment_status` comes with it:
                these are LIVE jobs, so the escrow-time stamp must not be
                trusted over the viewer's tier. */}
            <span className="tabular-nums">
              ${formatPrice(isPosted ? job.budget : helperTakeHomeDollars(job, viewerFeePercent))}
            </span>
            <span className="flex items-center gap-1"><Clock className="w-3 h-3 shrink-0" /> {time}</span>
          </div>
        </div>
        <span className="text-ds-11 font-medium shrink-0">{jobStatusLabel(job.status)}</span>
      </div>
    </button>
  );
};

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

export function ScheduleTab({ postedJobs, assignedJobs, loading, userId, onBack, hideHeader = false }: ScheduleTabProps) {
  // The viewer's own tier rate — the fallback used for assigned jobs whose
  // stamped fee isn't yet authoritative. Resolved once here rather than per
  // card. Same ladder Earnings & Payouts and Work Record use.
  const { profile: viewerProfile } = useCurrentUser();
  const viewerFeePercent = tierFeePercent(
    viewerProfile?.subscription_tier,
    viewerProfile?.subscription_expires_at ?? null,
  );
  const navigate = useNavigate();
  const [currentMonth, setCurrentMonth] = useState(new Date());
  const [selectedDate, setSelectedDate] = useState<string | null>(null);

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
  const upcomingJobs = allJobs.filter((j) => j.date_needed >= today).sort((a, b) => a.date_needed.localeCompare(b.date_needed)).slice(0, 10);

  return (
    <div className="space-y-4">
      {!hideHeader && (
        <ProfileTabHeader
          title="Schedule"
          onBack={onBack}
        />
      )}

      {loading ? (
        <div className="space-y-4">
          <div className="rounded-2xl liquid-glass p-5 space-y-4">
            <div className="flex items-center justify-between">
              <Skeleton className="h-8 w-8 rounded-md" />
              <Skeleton className="h-5 w-32 rounded" />
              <Skeleton className="h-8 w-8 rounded-md" />
            </div>
            <div className="grid grid-cols-7 gap-1">
              {Array.from({ length: 35 }).map((_, i) => (
                <Skeleton key={i} className="h-9 rounded" />
              ))}
            </div>
          </div>
          <div className="space-y-3">
            <Skeleton className="h-5 w-32 rounded" />
            <Skeleton className="h-20 rounded-ds-md" />
            <Skeleton className="h-20 rounded-ds-md" />
          </div>
        </div>
      ) : (
        <>
          <div className="rounded-2xl liquid-glass p-5">
            <div className="flex items-center justify-between mb-4">
              <Button variant="ghost" size="icon" onClick={() => setCurrentMonth(new Date(year, month - 1, 1))} aria-label="Previous month"><ChevronLeft className="w-4 h-4" /></Button>
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
                <h2 className="font-display italic font-bold leading-tight text-headline-card" style={{ color: "hsl(var(--ink-deep))", letterSpacing: "-0.01em" }}>
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
              <Button variant="ghost" size="icon" onClick={() => setCurrentMonth(new Date(year, month + 1, 1))} aria-label="Next month"><ChevronRight className="w-4 h-4" /></Button>
            </div>
            <div className="grid grid-cols-7 gap-1 mb-1">
              {["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"].map((d) => (
                <div key={d} className="text-center font-serif italic uppercase py-1 text-ds-10" style={{ color: "hsl(var(--burnt-sienna))", letterSpacing: "0.18em" }}>
                  {d}
                </div>
              ))}
            </div>
            <div className="grid grid-cols-7 gap-1">
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
                    key={day}
                    onClick={() => setSelectedDate(isSelected ? null : dateStr)}
                    title={blockedReason ?? undefined}
                    aria-label={blockedReason ? `${dateStr} — ${blockedReason.toLowerCase()}` : undefined}
                    className={`relative aspect-square flex flex-col items-center justify-center rounded-ds-sm text-ds-13 transition-colors ${
                      isSelected ? "bg-primary text-primary-foreground" :
                      isToday ? "text-primary font-bold ring-2 ring-primary/70 ring-inset bg-primary/8" :
                      isBlocked ? "text-muted-foreground/70 bg-muted/30 hover:bg-muted/50" :
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
                    {hasJobs && (
                      <span className={`absolute bottom-1 w-1.5 h-1.5 rounded-full ${
                        isSelected ? "bg-primary-foreground" :
                        inProgressOnDay ? "bg-[hsl(var(--burnt-sienna))]" : "bg-primary"
                      }`} />
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
                <div className="mt-3 pt-3 flex items-center gap-4 flex-wrap font-serif italic text-ds-11" style={{ borderTop: "0.5px solid hsl(var(--olivewood) / 0.10)", color: "hsl(var(--olivewood) / 0.8)" }}>
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

          {selectedDate && (
            <div className="space-y-3">
              <div>
                <h3 className="font-display italic font-bold leading-tight text-headline-card" style={{ color: "hsl(var(--ink-deep))", letterSpacing: "-0.01em" }}>
                  {new Date(selectedDate + "T12:00:00").toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" })}
                </h3>
              </div>
              {selectedJobs.length === 0 ? (
                <div className="rounded-2xl liquid-glass flex flex-col items-center text-center gap-3 px-6 py-8">
                  <div
                    className="w-12 h-12 rounded-full flex items-center justify-center"
                    style={{
                      backgroundColor: "hsla(0, 0%, 100%, 0.55)",
                      border: "1px solid hsl(var(--olivewood) / 0.10)",
                      boxShadow:
                        "inset 0 1px 1px 0 rgba(255, 255, 255, 0.65), " +
                        "0 1px 2px hsl(var(--olivewood) / 0.05), " +
                        "0 6px 14px -4px hsl(var(--olivewood) / 0.10)",
                    }}
                  >
                    <CalendarDays className="w-5 h-5" style={{ color: "hsl(var(--bark))" }} strokeWidth={1.75} />
                  </div>
                  <p className="font-serif italic max-w-[260px] text-ds-14" style={{ color: "hsl(var(--olivewood) / 0.8)" }}>
                    Nothing scheduled for this day.
                  </p>
                </div>
              ) : (
                selectedJobs.map((job) => (
                  <ScheduleCard key={job.id} job={job} isPosted={postedJobs.some((j) => j.id === job.id)} viewerFeePercent={viewerFeePercent} />
                ))
              )}
            </div>
          )}

          {!selectedDate && (
            <div className="space-y-3">
              <div>
                <h3 className="font-display italic font-bold leading-tight text-headline-card" style={{ color: "hsl(var(--ink-deep))", letterSpacing: "-0.01em" }}>
                  Upcoming jobs
                </h3>
              </div>
              {upcomingJobs.length === 0 ? (
                <div className="rounded-2xl liquid-glass flex flex-col items-center text-center gap-3 px-6 py-10">
                  <div
                    className="w-14 h-14 rounded-full flex items-center justify-center"
                    style={{
                      backgroundColor: "hsla(0, 0%, 100%, 0.55)",
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
                    <p className="font-display italic font-bold text-ds-16" style={{ color: "hsl(var(--ink-deep))", letterSpacing: "-0.015em" }}>
                      Calendar's clear.
                    </p>
                    <p className="font-serif italic max-w-[260px] text-ds-13" style={{ color: "hsl(var(--olivewood) / 0.8)" }}>
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
                      className="rounded-ds-md"
                      onClick={() => navigate("/dashboard")}
                    >
                      <Search className="w-3.5 h-3.5 mr-1.5" /> Browse Open Jobs
                    </Button>
                    <Button
                      variant="primary"
                      size="sm"
                      className="rounded-ds-md"
                      onClick={() => navigate("/post-job")}
                    >
                      <Plus className="w-3.5 h-3.5 mr-1.5" /> Post a Job
                    </Button>
                  </div>
                </div>
              ) : (
                upcomingJobs.map((job) => (
                  <ScheduleCard key={job.id} job={job} isPosted={postedJobs.some((j) => j.id === job.id)} viewerFeePercent={viewerFeePercent} />
                ))
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}
