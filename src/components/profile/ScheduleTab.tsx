import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { MapPin, DollarSign, Clock, ChevronLeft, ChevronRight, CalendarDays, Search, Plus } from "lucide-react";
import ProfileTabHeader from "@/components/profile/ProfileTabHeader";

import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";
import { jobStatusColorClasses } from "@/lib/statusColors";
import { jobStatusLabel } from "@/lib/statusLabels";
import { todayLocalISO } from "@/lib/dateUtils";

type Job = Database["public"]["Tables"]["jobs"]["Row"];

const ScheduleCard = ({ job, isPosted }: { job: Job; isPosted: boolean }) => (
  // Card surface tint mirrors the canonical status palette so an "in
  // progress" calendar entry reads in the same sienna family as the chip
  // for that state elsewhere. Border is left to the canvas (`bg-card`)
  // for terminal states so the calendar doesn't shout with cancelled
  // jobs.
  <div className={`rounded-ds-md border border-border/40 p-3 ${jobStatusColorClasses(job.status)}`}>

    <div className="flex items-start justify-between gap-3">
      <div className="flex-1">
        <div className="flex items-center gap-2 flex-wrap mb-1">
          <h4 className="font-semibold text-ds-13">{job.title}</h4>
          <span className="text-ds-11 px-2 py-0.5 rounded-full bg-card font-medium">{isPosted ? "Posted" : "Assigned"}</span>
        </div>
        <div className="flex flex-wrap gap-3 text-ds-11 text-muted-foreground">
          <span className="flex items-center gap-1"><MapPin className="w-3 h-3" /> {job.location}</span>
          <span className="flex items-center gap-1"><DollarSign className="w-3 h-3" /> ${job.budget}</span>
          {job.start_time && <span className="flex items-center gap-1"><Clock className="w-3 h-3" /> {job.start_time}</span>}
        </div>
      </div>
      <span className="text-ds-11 font-medium">{jobStatusLabel(job.status)}</span>
    </div>
  </div>
);

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
      if (error) return new Map();
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
          title="My schedule"
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
                <h2 className="font-display italic font-bold leading-tight text-headline-card" style={{ color: "hsl(var(--ink-deep))", letterSpacing: "-0.01em" }}>
                  {currentMonth.toLocaleDateString("en-US", { month: "long", year: "numeric" })}
                </h2>
                {/* "Today" reset surfaces only when the user has flipped
                    away from the current month — saves cognitive load
                    when it isn't useful. */}
                {viewingDifferentMonth && (
                  <button
                    type="button"
                    onClick={() => { setCurrentMonth(new Date()); setSelectedDate(null); }}
                    className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[0.66rem] font-sans font-semibold tracking-wide active:scale-[0.96] transition-transform"
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
                <div key={d} className="text-center font-serif italic uppercase py-1" style={{ fontSize: "0.6rem", color: "hsl(var(--burnt-sienna))", letterSpacing: "0.18em" }}>
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
                <div className="mt-3 pt-3 flex items-center gap-4 flex-wrap font-serif italic text-[0.7rem]" style={{ borderTop: "0.5px solid hsl(var(--olivewood) / 0.10)", color: "hsl(var(--olivewood) / 0.8)" }}>
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
                  <p className="font-serif italic max-w-[260px]" style={{ fontSize: "0.85rem", color: "hsl(var(--olivewood) / 0.8)" }}>
                    Nothing scheduled for this day.
                  </p>
                </div>
              ) : (
                selectedJobs.map((job) => (
                  <ScheduleCard key={job.id} job={job} isPosted={postedJobs.some((j) => j.id === job.id)} />
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
                    <p className="font-display italic font-bold" style={{ fontSize: "1rem", color: "hsl(var(--ink-deep))", letterSpacing: "-0.015em" }}>
                      Calendar's clear.
                    </p>
                    <p className="font-serif italic max-w-[260px]" style={{ fontSize: "0.82rem", color: "hsl(var(--olivewood) / 0.8)" }}>
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
                      <Search className="w-3.5 h-3.5 mr-1.5" /> Browse open jobs
                    </Button>
                    <Button
                      variant="bark"
                      size="sm"
                      className="rounded-ds-md"
                      onClick={() => navigate("/post-job")}
                    >
                      <Plus className="w-3.5 h-3.5 mr-1.5" /> Post a job
                    </Button>
                  </div>
                </div>
              ) : (
                upcomingJobs.map((job) => (
                  <ScheduleCard key={job.id} job={job} isPosted={postedJobs.some((j) => j.id === job.id)} />
                ))
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}
