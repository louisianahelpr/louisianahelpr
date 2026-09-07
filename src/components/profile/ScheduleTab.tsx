import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { MapPin, Clock, Calendar, ChevronLeft, ChevronRight, CalendarDays, CalendarPlus, Search, Plus, ListFilter } from "lucide-react";
import ProfileTabHeader from "@/components/profile/ProfileTabHeader";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";

import { supabase } from "@/integrations/supabase/client";
import { report } from "@/lib/errorLogger";
import type { Database } from "@/integrations/supabase/types";
import { jobStatusLabel } from "@/lib/statusLabels";
import { StatusBadge } from "@/components/StatusBadge";
import { categoryColors } from "@/components/activity/activityConstants";
import { JobCardShell } from "@/components/activity/JobCardShell";
import { todayLocalISO, formatJobDate } from "@/lib/dateUtils";
import { getCity } from "@/lib/locationUtils";
import { formatPrice, formatPriceFloor } from "@/lib/format";
import { helperTakeHomeDollars } from "@/lib/helperEarnings";
import { tierFeePercent } from "@/lib/subscriptionTiers";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { formatTime12 } from "@/components/TimePickerSelect";
import { inProgressBadgeTarget } from "@/components/dashboard/DashboardInProgressBadge";
import { bucketPostedJob } from "@/pages/activity/activityFilters";
import { exportJobRowToCalendar } from "@/lib/calendarExport";

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

/**
 * ONE schedule card, one shape — regardless of which fields the row carries.
 *
 * The three cards on this tab used to be three different cards. The category
 * icon sat inline with the title when the title was short and wrapped onto a
 * line of its own when it wasn't; the location printed a full street address
 * on one card and a city on the next; the status was stated twice, in two
 * vocabularies ("Open" + "Posted", "In progress" + "Assigned"); and money,
 * time and location came in whatever order the flex row happened to wrap them.
 *
 * The fix is to stop hand-rolling the card and adopt the one the activity
 * surfaces already use:
 *
 *  - `JobCardShell` (consumed as-is) paints the liquid-glass surface, the
 *    category colour rail and the category TAB over the top-left corner. The
 *    category is therefore no longer part of the title flow at all, which is
 *    what made cards 1 and 3 different shapes. It also replaces the old
 *    status-tinted card surface — `jobStatusColorClasses` is a CHIP palette,
 *    and stretching it over a whole card meant every card had a different
 *    background for a fact the status chip already states.
 *  - The header row (title + money chip) is JobCardTitleBar's geometry, which
 *    is itself JobPrice's `chip` variant verbatim — the component documented
 *    as "THE single money element". So the same figure is set at the same
 *    size, weight and colour here as on Browse / My Posts / My Jobs.
 *  - The meta row matches `JobCardMetaRow`'s visual language exactly (same
 *    icons, same `text-ds-11 text-muted-foreground`, same gaps, and the same
 *    location → date → time ORDER as the feed). It is *matched* rather than
 *    consumed for one concrete reason: that component's location chip is a
 *    real `<a>`/`<button>` map control, and this card's body is a single
 *    navigation `<button>` — an interactive element inside a button is
 *    invalid markup and breaks keyboard/AT focus order. The map lives one tap
 *    away on the job itself.
 *
 * Two facts, stated once each, on their own line under the meta row:
 *  - STATUS (where the job is in its life) → `StatusBadge`, the canonical
 *    dot-plus-label pill, once. The bare `jobStatusLabel` text that used to
 *    sit in the card's top-right corner is gone.
 *  - ROLE (which side of the job you are on) → a chip worded as a verb
 *    phrase. It has to exist because this list MIXES jobs you posted with
 *    jobs you were hired for, and it drives whose money the amount is. It
 *    used to read "Posted"/"Assigned", which are the vocabulary of job
 *    STATUS, so the card looked like it was contradicting itself. "You
 *    posted" / "You're helping" cannot be misread as a lifecycle state.
 */
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
  // Whose money is this? On a job you POSTED the budget is what you pay, so
  // the raw figure is right. On a job you were ASSIGNED it is not your money —
  // your take-home is the budget minus the platform fee, and that is the
  // number every other helper-facing surface shows (My Jobs, Earnings &
  // Payouts, Work Record). The whole job row is passed so `payment_status`
  // comes with it: these are LIVE jobs, so the escrow-time stamp must not be
  // trusted over the viewer's tier.
  // The two branches use DIFFERENT formatters, and that asymmetry is the point.
  // A gross budget is a number the poster typed, so it rounds (`formatPrice`).
  // A take-home is money OWED TO THE VIEWER, and a payout figure may never read
  // above the payout — so it floors, exactly as JobPrice, CompactJobCard,
  // AppliedJobCard and WorkRecord already do (owner, 2026-08-19). Both branches
  // shared `formatPrice` here, so an $83.60 take-home rendered "$84" on this
  // row while My Jobs rendered "$83" for the same job: the one number a helper
  // checks, answered two ways, with this screen quoting the higher of the two.
  const amount = isPosted
    ? formatPrice(job.budget)
    : formatPriceFloor(helperTakeHomeDollars(job, viewerFeePercent));
  const amountTitle = isPosted
    ? "Your budget for this job"
    : "Your take-home after the platform fee";

  return (
    <JobCardShell
      expandable={false}
      expanded={false}
      /* Never called — `expandable` is false, so JobCardShell wires no
         wrapper onClick and renders no expand button. This card navigates;
         it does not expand. */
      onToggle={() => {}}
      category={job.category}
    >
      <button
        type="button"
        onClick={() => navigate(to)}
        /* The accessible name states the same two facts the chips below show,
           in the same words, plus where the tap goes — the chips are inside
           this button, so without it a screen reader would read title, money,
           place, date, time, status and role as one undifferentiated run. */
        aria-label={`${job.title} — ${isPosted ? "you posted this" : "you're helping"}, ${jobStatusLabel(job.status).toLowerCase()}. Tap to ${destination}.`}
        /* `pt-6` clears the category tab JobCardShell paints over the top-left
           corner — the same allowance JobCardTitleBar and Browse's JobCard
           make, and the reason every card's title now starts at an identical
           offset from the card's top edge no matter how long it is. */
        className="btn-press w-full text-left block px-4 pt-6 pb-2 transition-transform active:scale-[0.99] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--ring))]"
      >
        <div className="flex items-center justify-between gap-3">
          <h4
            className="font-display italic font-bold leading-snug truncate min-w-0 text-headline-card"
            style={{ color: "hsl(var(--ink-deep))", letterSpacing: "-0.015em" }}
          >
            {job.title}
          </h4>
          {/* JobPrice `chip` / JobCardTitleBar geometry, value for value —
              change one, change all three. A currency symbol is typography,
              not an icon: the "$" is part of the same text node as the digits
              (a DollarSign glyph beside an already-prefixed string rendered as
              "$ $200"). */}
          <span
            className="inline-flex flex-col items-center justify-center px-2.5 py-1 rounded-ds-md text-center shrink-0 ml-3"
            title={amountTitle}
            style={{
              background: "hsl(var(--bark) / 0.10)",
              border: "0.5px solid hsl(var(--bark) / 0.28)",
            }}
          >
            <span
              className="font-display leading-none tabular-nums text-ds-17"
              style={{ fontWeight: 800, color: "hsl(var(--bark))", letterSpacing: "-0.02em" }}
            >
              <span style={{ fontSize: "0.82em", verticalAlign: "0.02em", marginRight: "0.5px" }}>$</span>
              {amount}
            </span>
          </span>
        </div>
        {/* Location → date → time, the same order and the same chips the feed
            and both activity cards use. The DATE is new here and not optional:
            "Upcoming jobs" is a date-sorted list that previously printed only
            a clock time, so two jobs a week apart read as though they were the
            same afternoon. The CITY replaces the raw `location` column, which
            printed a full street address on some rows and a city on others —
            `getCity` is the same normaliser JobCardMetaRow runs, so the
            schedule can never disagree with the cards it links to. The full
            address still travels in the exported calendar event, where it is
            the point. */}
        <div className="mt-1.5 flex items-center gap-x-2 min-[360px]:gap-x-3 sm:gap-x-5 flex-nowrap min-w-0 overflow-hidden text-ds-11 text-muted-foreground">
          {/* A job whose poster deleted their account is anonymised rather than
              removed (20260901033011), so it stands with no address. The chip
              drops out entirely rather than printing a pin with nothing beside
              it — the date and time hold the row on their own. */}
          {job.location && (
            <span className="flex items-center gap-1 min-[360px]:gap-1.5 min-w-0 shrink">
              <MapPin className="w-3 h-3 shrink-0" />
              <span className="truncate">{getCity(job.location)}</span>
            </span>
          )}
          <span className="flex items-center gap-1.5 shrink-0 whitespace-nowrap">
            <Calendar className="w-3 h-3 shrink-0" />
            {formatJobDate(job.date_needed)}
          </span>
          <span className="flex items-center gap-1.5 shrink-0 whitespace-nowrap">
            <Clock className="w-3 h-3 shrink-0" />
            {time}
          </span>
        </div>
        {/* The two chips that say what this job IS. Both are plain, inert
            spans, so they live INSIDE the navigation button — which also makes
            more of the card a tap target for the thing tapping the card does.

            They get a LINE OF THEIR OWN rather than sharing one with the
            calendar action, and that is a measured decision, not a stylistic
            one: sharing the line, the row fitted on a card whose status read
            "Open" and wrapped on one whose status read "In progress", so two
            cards in the same list came out different heights with the action
            in a different place — the exact defect this rebuild exists to
            remove. Structure must not depend on how long a label happens to
            be. */}
        <div className="mt-2 flex items-center gap-x-2 min-w-0">
          <StatusBadge status={job.status} className="shrink-0" />
          <span
            className="inline-flex items-center rounded-ds-pill px-2 py-0.5 text-ds-10 font-semibold leading-none whitespace-nowrap shrink-0"
            style={{
              background: "hsl(var(--ivory-sand) / 0.65)",
              border: "1px solid hsl(var(--olivewood) / 0.18)",
              color: "hsl(var(--olivewood))",
            }}
          >
            {isPosted ? "You posted" : "You're helping"}
          </span>
        </div>
      </button>
      {/* The one secondary action.

          "Add to calendar" used to be a full-width row of its own under a
          divider — the exact geometry a PRIMARY action gets, given to a
          secondary one, on every card in the list. It is a compact,
          right-aligned control now, with no rule above it. It has to be a
          sibling of the navigation button rather than a child (a button inside
          a button is invalid markup and breaks keyboard/AT focus order), which
          is the only reason it still occupies a row at all.

          Rendered unconditionally: `useProfileSchedule` only ever fetches
          open / accepted / in_progress jobs, so there is no settled row here
          to hide it from — and a branch that can never render is a branch that
          can never be verified. Every card gets the same footer. */}
      <div className="px-4 pb-2.5 pt-1 flex items-center">
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            void exportJobRowToCalendar(job);
          }}
          /* `min-h-[44px]` with `-my-2.5` buys the app's 44px tap floor
             without adding 20px of height to every card — the overhang lands
             on the card's own bottom padding, and the only thing above it is
             the navigation button's own generous hit area, so nothing can
             steal the tap. */
          className="btn-press ml-auto inline-flex items-center gap-1.5 min-h-[44px] -my-2.5 px-2 -mr-2 rounded-ds-sm text-ds-11 font-semibold active:scale-[0.96] transition-transform focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--ring))]"
          style={{ color: "hsl(var(--bark))" }}
        >
          <CalendarPlus className="w-3.5 h-3.5 shrink-0" aria-hidden />
          Add to calendar
        </button>
      </div>
    </JobCardShell>
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

type UpcomingFilter = "all" | "posted" | "applied";
const UPCOMING_FILTERS: { value: UpcomingFilter; label: string }[] = [
  { value: "all", label: "All" },
  { value: "posted", label: "Posted" },
  { value: "applied", label: "Applied" },
];

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
          {/* Calendar card — item 27, significantly more compact than before.
              The grid used to be `aspect-square` cells at full card width, so
              on any screen wider than a phone SE each day cell ballooned to
              50-60px for a calendar whose only job is "pick a date, glance at
              dots". Capping the grid at 280px and dropping cells to a fixed
              32px keeps every cell tappable (well over the 40px target isn't
              needed here — see aria-label + the whole-cell hit area) while
              giving the Upcoming-jobs list below far more of the screen. */}
          <div className="rounded-2xl liquid-glass p-3.5">
            <div className="max-w-[280px] mx-auto">
            <div className="flex items-center justify-between mb-2">
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
              <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setCurrentMonth(new Date(year, month + 1, 1))} aria-label="Next month"><ChevronRight className="w-3.5 h-3.5" /></Button>
            </div>
            <div className="grid grid-cols-7 gap-0.5 mb-0.5">
              {["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"].map((d) => (
                <div key={d} className="text-center font-serif italic uppercase py-0.5 text-ds-10" style={{ color: "hsl(var(--burnt-sienna))", letterSpacing: "0.18em" }}>
                  {d}
                </div>
              ))}
            </div>
            <div className="grid grid-cols-7 gap-0.5">
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
                    className={`relative h-8 flex flex-col items-center justify-center rounded-ds-sm text-ds-11 transition-colors ${
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
                    {/* Job dot(s) — one per DISTINCT category on this day (max
                        3, since a day rarely stacks more than that), colored
                        with the same per-category palette as the schedule
                        list below, instead of one undifferentiated primary
                        dot for every job regardless of type. */}
                    {hasJobs && (
                      <span className="absolute bottom-1 flex items-center gap-0.5">
                        {[...new Set(dayJobs.map((j) => j.category ?? "other"))]
                          .slice(0, 3)
                          .map((cat) => (
                            <span
                              key={cat}
                              className={`w-1.5 h-1.5 rounded-full ${
                                isSelected ? "bg-primary-foreground" : (categoryColors[cat] || categoryColors.other).dot
                              }`}
                            />
                          ))}
                      </span>
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
                    Job (dot color = job type)
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
                  <ScheduleCard key={job.id} job={job} isPosted={postedIds.has(job.id)} viewerFeePercent={viewerFeePercent} />
                ))
              )}
            </div>
          )}

          {!selectedDate && (
            <div className="space-y-3">
              <div className="flex items-center justify-between gap-2">
                <h3 className="font-display italic font-bold leading-tight text-headline-card" style={{ color: "hsl(var(--ink-deep))", letterSpacing: "-0.01em" }}>
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
                    className="w-[min(92vw,180px)] rounded-2xl border border-border/40 shadow-2xl bg-card p-1.5"
                    align="end"
                  >
                    {UPCOMING_FILTERS.map((opt) => {
                      const active = opt.value === upcomingFilter;
                      return (
                        <button
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
                  <ScheduleCard key={job.id} job={job} isPosted={postedIds.has(job.id)} viewerFeePercent={viewerFeePercent} />
                ))
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}
