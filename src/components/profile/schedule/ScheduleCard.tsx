import { useNavigate } from "react-router-dom";
import { MapPin, Clock, Calendar, CalendarPlus } from "lucide-react";
import { jobStatusLabel } from "@/lib/statusLabels";
import { StatusBadge } from "@/components/StatusBadge";
import { JobCardShell } from "@/components/job-card/JobCardShell";
import { formatJobDate } from "@/lib/dateUtils";
import { getCity } from "@/lib/locationUtils";
import { formatPrice, formatPriceFloor } from "@/lib/format";
import { helperTakeHomeDollars, isSettledForDisplay } from "@/lib/helperEarnings";
import { useFirstPayoutFeeDollars } from "@/hooks/useFirstPayoutFee";
import { jobStartTimeLabel } from "@/lib/jobDate";
import { inProgressBadgeTarget } from "@/components/dashboard/DashboardInProgressBadge";
import { bucketPostedJob } from "@/components/job-card/activityFilters";
import { exportJobRowToCalendar } from "@/lib/calendarExport";
import { isGiveawayFixedPayJob } from "@/lib/helprFlatFee";
import type { ReadableJobRow } from "@/lib/jobColumns";

// One row of the Schedule tab, moved out of ScheduleTab.tsx unchanged (Q806, componentSizeRatchet).

// jobs.offered_to_helper_id is not client-selectable (20260915045110).
type Job = ReadableJobRow;

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
 * verified against `filteredAppliedApps` in `components/job-card/activityFilters`),
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
      to: `/posts?filter=${bucketPostedJob(job)}`,
      destination: "open this job in My Posts",
    };
  }
  const settled = TERMINAL_ASSIGNED_FILTER[job.status];
  if (settled) {
    return { to: `/jobs?filter=${settled}`, destination: "open this job in My Jobs" };
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
 *    real `<a>`/`<button>` map control, and a tap anywhere on this card is
 *    the card's navigation button (stretched under the rows) — a second
 *    pointer target on the location would split one card into two
 *    destinations. The map lives one tap away on the job itself. The meta
 *    row's right side carries the card's one secondary action, "Add to
 *    calendar" (VN-41).
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
export const ScheduleCard = ({
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
  const firstPayoutFee = useFirstPayoutFeeDollars();
  const { to, destination } = scheduleRowTarget(job, isPosted);
  // ONE rule for "when" (src/lib/jobDate.ts): a clock time, the word
  // "Flexible" only when the poster ticked `is_flexible_schedule`, else null
  // and the chip below does not render.
  //
  // This read `formatTime12(job.start_time)`, and `formatTime12` answers the
  // literal string "Flexible" for a NULL time — so this row printed a
  // scheduling promise on every timeless job. Verified live on prod
  // 2026-09-19: 184 of 260 jobs have a null `start_time` and ZERO carry the
  // flag, i.e. every one of those was a claim no poster had made.
  const time = jobStartTimeLabel(job.start_time, job.is_flexible_schedule);
  // Whose money is this? On a job you POSTED the budget is what you pay, so
  // the raw figure is right. On a job you were ASSIGNED your take-home is the
  // budget minus the platform fee (and, Q753, the one-time setup fee while
  // unpaid), as on every other helper-facing surface. The whole job row is
  // passed so `payment_status` comes with it: these are LIVE jobs, so the
  // escrow-time stamp must not be trusted over the viewer's tier.
  // The two branches use DIFFERENT formatters, and that asymmetry is the point.
  // A gross budget is a number the poster typed, so it rounds (`formatPrice`).
  // A take-home is money OWED TO THE VIEWER, and a payout figure may never read
  // above the payout — so it floors, as JobPrice, CompactJobCard, AppliedJobCard
  // and WorkRecord do (owner, 2026-08-19). Both branches shared `formatPrice`,
  // so an $83.60 take-home read "$84" here while My Jobs read "$83".
  const amount = isPosted
    ? formatPrice(job.budget)
    : formatPriceFloor(helperTakeHomeDollars(job, viewerFeePercent, isSettledForDisplay(job) ? 0 : firstPayoutFee));
  // Q1272 (2): says why the figure is lower while the one-time setup fee is still owed.
  const fixedPay = isGiveawayFixedPayJob(job);
  const feeTakenHere = !isPosted && !isSettledForDisplay(job) && job.status !== "disputed" && firstPayoutFee > 0;
  const amountTitle = isPosted ? "Your budget for this job" : fixedPay ? undefined : `Your take-home${feeTakenHere ? ` after the one-time $${formatPrice(firstPayoutFee)} setup fee from your first payout` : ""}`;

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
      {/* ONE ROW for the secondary action (VN-41, owner 2026-09-15: "Side by
          side"). "Add to calendar" used to own a whole row under the chips,
          only because it could not live inside the navigation button (a
          button inside a button is invalid markup and breaks keyboard/AT
          focus order). The rows now sit OUTSIDE the navigation button, and the
          button is stretched over the whole card beneath them, so:
            - the calendar action can sit in the meta row's right side, a
              true sibling of the navigation button, not a child of it;
            - a tap anywhere else on the card still navigates, exactly as
              before (the rows are `pointer-events-none`; only the calendar
              action opts back in, and it paints above the overlay);
            - assistive tech hears exactly what it heard before: the
              navigation button's aria-label (which always overrode the rows
              it wrapped), then "Add to calendar". The visual rows are
              aria-hidden so they are not read a second time. */}
      <div className="relative">
        <button
          type="button"
          onClick={() => navigate(to)}
          /* The accessible name states the same two facts the chips below show,
             in the same words, plus where the tap goes — without it a screen
             reader would read title, money, place, date, time, status and role
             as one undifferentiated run. */
          aria-label={`${job.title} — ${isPosted ? "you posted this" : "you're helping"}, ${jobStatusLabel(job.status).toLowerCase()}. Tap to ${destination}.`}
          className="peer absolute inset-0 w-full h-full rounded-2xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[hsl(var(--ring))]"
        />
        {/* `pt-6` clears the category tab JobCardShell paints over the top-left
            corner — the same allowance JobCardTitleBar and Browse's JobCard
            make, and the reason every card's title starts at an identical
            offset from the card's top edge no matter how long it is. The press
            feedback the navigation button used to carry on itself now rides
            `peer-active`, because the button is an empty overlay. */}
        <div
          data-testid="schedule-card-body"
          className="pointer-events-none px-4 pt-6 pb-3 transition-transform peer-active:scale-[0.99] motion-reduce:transition-none motion-reduce:peer-active:scale-100"
        >
          <div aria-hidden className="flex items-center justify-between gap-3">
            <h4
              className="job-card-title senior-clamp-2 font-sans font-bold leading-snug truncate min-w-0 text-headline-card"
              style={{ color: "hsl(var(--ink-deep))", letterSpacing: "-0.015em" }}
            >
              {job.title}
            </h4>
            {/* JobPrice `chip` / JobCardTitleBar geometry, value for value —
                change one, change all three. A currency symbol is typography,
                not an icon: the "$" is part of the same text node as the digits
                (a DollarSign glyph beside an already-prefixed string rendered as
                "$ $200").

                `pointer-events-auto` so its `title` tooltip (whose money this
                is) still shows on hover under the rows' pointer-events-none;
                the click it now receives navigates exactly as the overlay
                button would. Keyboard and AT reach that same navigation through
                the overlay button, so this is a pointer-only duplicate. */}
            <span
              className="pointer-events-auto cursor-pointer inline-flex flex-col items-center justify-center px-2.5 py-1 rounded-full text-center shrink-0 ml-3"
              title={amountTitle}
              onClick={() => navigate(to)}
              // Money is rust on the money tint (spec v2 §3 job card: "price
              // pill (rust on money tint)"); it was olive, the action colour.
              style={{ background: "hsl(var(--accent-ink) / 0.10)" }}
            >
              <span
                className="font-sans leading-none tabular-nums text-ds-17"
                style={{ fontWeight: 800, color: "hsl(var(--accent-ink))", letterSpacing: "-0.02em" }}
              >
                <span style={{ fontSize: "0.82em", verticalAlign: "0.02em", marginRight: "0.5px" }}>$</span>
                {amount}
              </span>
            </span>
          </div>
          {/* Meta row: location → date → time on the left, the calendar action
              on the right.

              Location → date → time is the same order and the same chips the
              feed and both activity cards use. The DATE is not optional:
              "Upcoming jobs" is a date-sorted list, and a row that printed only
              a clock time made two jobs a week apart read as the same
              afternoon. The CITY replaces the raw `location` column, which
              printed a full street address on some rows and a city on others —
              `getCity` is the same normaliser JobCardMetaRow runs, so the
              schedule can never disagree with the cards it links to. The full
              address still travels in the exported calendar event, where it is
              the point.

              The facts truncate (location first, it is the only `shrink`
              chip); the action never does — it is `shrink-0`, so a long city
              gives way to it instead of pushing it off the card. */}
          <div data-testid="schedule-card-meta-row" className="mt-1.5 flex items-center gap-3 min-w-0">
            <div
              aria-hidden
              className="job-meta-row flex flex-1 items-center gap-x-2 min-[360px]:gap-x-3 sm:gap-x-5 flex-nowrap min-w-0 overflow-hidden text-ds-11 text-muted-foreground"
            >
              {/* A job whose poster deleted their account is anonymised rather
                  than removed (20260901033011), so it stands with no address.
                  The chip drops out entirely rather than printing a pin with
                  nothing beside it — the date and time hold the row on their
                  own. */}
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
              {/* Drops out entirely — icon included — when the job has neither
                  a start time nor the flexible flag, exactly as the location
                  chip above does for an anonymised job. A clock face with
                  nothing beside it is the "empty block" this pass removed. */}
              {time && (
                <span className="flex items-center gap-1.5 shrink-0 whitespace-nowrap">
                  <Clock className="w-3 h-3 shrink-0" />
                  {time}
                </span>
              )}
            </div>
            {/* The one secondary action. Rendered unconditionally:
                `useProfileSchedule` only ever fetches open / accepted /
                in_progress jobs, so there is no settled row here to hide it
                from — and a branch that can never render is a branch that can
                never be verified. */}
            <button
              type="button"
              aria-label="Add to calendar"
              onClick={(e) => {
                e.stopPropagation();
                void exportJobRowToCalendar(job);
              }}
              /* `min-h-[44px]` with `-my-3.5` buys the app's 44px tap floor
                 without making the meta row 44px tall — the overhang lands in
                 the gaps above and below the row. `pointer-events-auto` +
                 `relative z-[1]` lift it out of the rows' pointer-events-none
                 and above the stretched navigation button. */
              className="btn-press pointer-events-auto relative z-[1] shrink-0 inline-flex items-center gap-1.5 min-h-[44px] -my-3.5 px-2 -mr-2 rounded-ds-sm text-ds-11 font-semibold whitespace-nowrap active:scale-[0.96] transition-transform focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--ring))]"
              style={{ color: "hsl(var(--bark))" }}
            >
              <CalendarPlus className="w-3.5 h-3.5 shrink-0" aria-hidden />
              {/* Icon-only where the card is narrow (phone, and the 1024–1279
                  two-column list), so the city in the same row is not cut to
                  "N…" or dropped. Measured on the cloud branch at 375: the city
                  vanished; at 1024: "N…". */}
              <span className="hidden min-[480px]:inline min-[1024px]:hidden min-[1280px]:inline">Add to calendar</span>
            </button>
          </div>
          {/* The two chips that say what this job IS — STATUS (where the job
              is in its life, `StatusBadge`, once) and ROLE (which side of the
              job you are on, worded as a verb phrase so it cannot be misread as
              a lifecycle state).

              They keep a LINE OF THEIR OWN rather than sharing one with the
              calendar action, and that is a measured decision, not a stylistic
              one: sharing the line, the row fitted on a card whose status read
              "Open" and wrapped on one whose status read "In progress", so two
              cards in the same list came out different heights with the action
              in a different place. Structure must not depend on how long a
              label happens to be. */}
          <div aria-hidden className="mt-2 flex items-center gap-x-2 min-w-0">
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
        </div>
      </div>
    </JobCardShell>
  );
};
