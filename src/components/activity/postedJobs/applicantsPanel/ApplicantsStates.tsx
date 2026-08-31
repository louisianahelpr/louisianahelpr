import { AlertCircle, CalendarClock, Pencil, Rocket, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { BarkPillButton } from "@/components/ui/BarkPillButton";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/ui/EmptyState";
import { ShareJobButton } from "@/components/jobs/ShareJobButton";
import { formatPrice } from "@/lib/format";
import { daysPastDue, jobDateMs, todayMs } from "@/lib/jobDate";
import { BOOST_DURATION_HOURS } from "@/lib/productPrices";
import { type Job } from "../../activityConstants";
import { type JobAnalytics } from "../useJobAnalytics";

/**
 * Loading skeleton for the applicants list — two cards matching the real
 * card height. Static, no props. Extracted verbatim from ApplicantsPanel.
 */
export function ApplicantsLoadingState() {
  return (
    <div className="space-y-3" role="status" aria-label="Loading applicants" aria-busy="true">
      {[0, 1].map((i) => (
        <div
          key={i}
          className="rounded-ds-md p-3.5 flex items-start gap-3"
          style={{
            background: "var(--surface-premium)",
            backdropFilter: "blur(16px)",
            WebkitBackdropFilter: "blur(16px)",
            border: "0.5px solid hsl(var(--bark) / 0.18)",
          }}
        >
          <Skeleton className="w-11 h-11 rounded-full shrink-0 mt-0.5" />
          <div className="flex-1 space-y-2">
            <Skeleton className="h-3.5 w-2/5" />
            <Skeleton className="h-3 w-3/5" />
            <Skeleton className="h-3 w-1/2" />
          </div>
          <Skeleton className="h-9 w-16 rounded-ds-sm shrink-0" />
        </div>
      ))}
    </div>
  );
}

/**
 * Error state for the applicants list — retry re-runs the parent's load.
 * Pure presentational. Extracted verbatim from ApplicantsPanel.
 */
export function ApplicantsErrorState({ onRetry }: { onRetry: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center py-16 gap-4 text-center px-6">
      <AlertCircle className="w-8 h-8 text-destructive" />
      <div className="space-y-1">
        <p className="font-semibold text-foreground text-ds-15">Couldn't load applicants</p>
        {/* Deliberately NOT "check your connection" — most failures here are
            server-side, and blaming the user's wifi is a false diagnosis.
            Matches the shared ErrorState's default copy. */}
        <p className="text-ds-13 text-muted-foreground">
          Tap Try again. If it sticks, our end is having a hiccup — not yours.
        </p>
      </div>
      <Button
        variant="outline"
        size="sm"
        className="rounded-ds-md btn-press"
        onClick={onRetry}
      >
        Retry
      </Button>
    </div>
  );
}

/**
 * WHERE A JOB WITH NO APPLICANTS ACTUALLY IS.
 *
 * The empty state used to say ONE thing — "Your job was just posted!" — on
 * every job it rendered for, regardless of when the job was posted (owner,
 * 2026-08-31: "This doesn't feel right"). On a six-day-old post with nobody
 * applying that sentence is both factually false and the wrong tone: the
 * poster's problem is that nothing is happening, and the app is congratulating
 * them for starting.
 *
 * So the state asks the two questions that actually change the advice:
 *   HOW LONG has it been up (is silence still normal?), and
 *   HOW LONG until it is needed (is there still time to change anything?).
 *
 * `imminent` outranks `quiet` because the deadline is the binding constraint —
 * a job posted an hour ago that is needed tomorrow is not "fresh", it is
 * nearly out of runway. `overdue` outranks everything: nothing about
 * attracting applicants matters once the day is gone.
 */
export type ApplicantsEmptyPhase = "fresh" | "quiet" | "imminent" | "overdue";

/** Whole days from today to the job's day. Negative once it has passed. */
function daysUntilNeeded(job: { date_needed?: string | null }): number | null {
  const ms = jobDateMs(job.date_needed);
  if (ms === null) return null;
  return Math.round((ms - todayMs()) / 86_400_000);
}

/** Whole hours since the job was posted. */
function hoursSincePosted(job: { created_at?: string | null }, now = Date.now()): number {
  const t = job.created_at ? Date.parse(job.created_at) : NaN;
  if (Number.isNaN(t)) return 0;
  return Math.max(0, Math.floor((now - t) / 3_600_000));
}

export function applicantsEmptyPhase(
  job: { created_at?: string | null; date_needed?: string | null },
  now = Date.now(),
): ApplicantsEmptyPhase {
  const until = daysUntilNeeded(job);
  if (until !== null && until < 0) return "overdue";
  if (until !== null && until <= 1) return "imminent";
  return hoursSincePosted(job, now) < 24 ? "fresh" : "quiet";
}

/** "3 hours" / "1 hour" / "40 minutes" — the age, said in words. */
function agePhrase(hours: number): string {
  if (hours < 1) return "moments ago";
  if (hours === 1) return "an hour ago";
  if (hours < 24) return `${hours} hours ago`;
  const days = Math.round(hours / 24);
  return days === 1 ? "yesterday" : `${days} days ago`;
}

interface ApplicantsEmptyStateProps {
  selectedJob: Job;
  /** Reach for this job. `viewCount` is what turns "nobody has applied" into a
   *  diagnosis — a post nobody has OPENED has a different problem from one
   *  twenty-three people opened and passed over. Undefined until the query
   *  resolves, or when the job has never been viewed. */
  jobAnalytics?: JobAnalytics;
  /** Opens JobBoostDialog for this job. Optional — the button is simply not
   *  offered when the host cannot open it, rather than rendering a control
   *  that goes nowhere. */
  onBoost?: (jobId: string) => void;
  /** Opens EditJobDialog for this job. Same optionality rule as onBoost. */
  onEdit?: (job: Job) => void;
}

/**
 * A secondary lever — one of the two things a poster can actually DO about
 * silence, beside sharing. Rendered as a full-width row so the label and its
 * one-line reason both fit at 320px, and so the whole row is the 44px+ target
 * rather than just the words.
 */
function LeverRow({
  icon: Icon,
  label,
  detail,
  onClick,
}: {
  icon: typeof Rocket;
  label: string;
  detail: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="w-full min-h-[52px] rounded-ds-md px-3.5 py-2.5 flex items-center gap-3 text-left btn-press motion-safe:transition-colors"
      style={{
        background: "hsl(var(--parchment) / 0.55)",
        border: "0.5px solid hsl(var(--olivewood) / 0.20)",
      }}
    >
      <Icon
        className="w-4 h-4 shrink-0"
        style={{ color: "hsl(var(--bark))" }}
        strokeWidth={1.8}
        aria-hidden
      />
      <span className="min-w-0 flex-1">
        <span
          className="block text-ds-13 font-sans font-semibold leading-snug"
          style={{ color: "hsl(var(--ink-deep))" }}
        >
          {label}
        </span>
        <span
          className="block text-ds-11 font-serif italic leading-snug"
          style={{ color: "hsl(var(--olivewood) / 0.85)" }}
        >
          {detail}
        </span>
      </span>
    </button>
  );
}

/**
 * Empty state — nobody has applied to this job yet.
 *
 * Two things this fixes, both reported by the owner on 2026-08-31.
 *
 * 1. THE COPY STATED SOMETHING IT HAD NOT CHECKED. See
 *    {@link applicantsEmptyPhase} — the four branches replace the single
 *    unconditional "Your job was just posted!".
 *
 * 2. IT FILLED A THIRD OF THE SCREEN. The old markup was a bare
 *    `flex-col items-center pt-12 pb-6` stack, so it ended wherever its
 *    content ended and left two thirds of the panel blank — the third screen
 *    flagged for exactly that. It now renders through the app's canonical
 *    `EmptyState` card (the same primitive My Posts, Messages, Browse, Home
 *    History and Pet Profiles use), which is `flex-1` and fills whatever
 *    wrapper sizes it.
 *
 *    The wrapper has to state a height because nothing above it does:
 *    <AppPage>'s scroll column is `h-full`, but its `.animate-ds-page-in` and
 *    `space-y-4` children are plain blocks, so `min-h-full` here would resolve
 *    against `auto` and collapse. The `calc()` below is therefore measured,
 *    not guessed — see the constant.
 */
export function ApplicantsEmptyState({
  selectedJob,
  jobAnalytics,
  onBoost,
  onEdit,
}: ApplicantsEmptyStateProps) {
  const phase = applicantsEmptyPhase(selectedJob);
  const views = jobAnalytics?.viewCount ?? 0;
  const hours = hoursSincePosted(selectedJob);
  const until = daysUntilNeeded(selectedJob);
  const budget = typeof selectedJob.budget === "number" ? `$${formatPrice(selectedJob.budget)}` : null;
  const where = selectedJob.location?.trim() || "you";
  const daysUp = Math.max(1, Math.round(hours / 24));

  /**
   * ONE glossy pill per screen, and it is whichever lever this phase says is
   * the next thing to do.
   *
   * The first cut always made Share the pill and dropped Boost/Edit into the
   * quiet rows below it — which put the outlined "Give it a new date" ABOVE
   * the glossy "Copy link" on an overdue job, i.e. the real primary rendered
   * as the secondary and the secondary rendered as the primary. Two competing
   * weights in the wrong order is a hierarchy defect whatever the copy says,
   * so the pill moves with the advice.
   */
  const shareJob = {
    id: selectedJob.id,
    title: selectedJob.title,
    budget: selectedJob.budget,
    category: selectedJob.category,
  };
  const sharePrimary = <ShareJobButton variant="primary" job={shareJob} />;
  /**
   * Share, demoted to a quiet row.
   *
   * NOT `<ShareJobButton />` bare: its default variant is `Button
   * variant="default"`, which is ALSO `btn-grad-primary` (see button.tsx —
   * default / primary / bark are three names for the one glossy treatment), so
   * the plain mount rendered a second full-strength glossy pill directly under
   * the real one. Two competing primaries is the same hierarchy defect the
   * pill-swap above exists to fix, just in the other direction.
   *
   * Passing `style` is what drops it to `variant="ghost"` (ShareJobButton
   * switches on the presence of the prop, so the forced parchment text colour
   * lets an override through), and the tokens below are LeverRow's, so the row
   * reads as a sibling of Edit / Boost rather than a third kind of control.
   */
  const shareSecondary = (
    <ShareJobButton
      key="share"
      job={shareJob}
      className="w-full h-auto min-h-[52px] justify-start rounded-ds-md px-3.5 py-2.5 gap-1 font-sans font-semibold text-ds-13 btn-press"
      style={{
        background: "hsl(var(--parchment) / 0.55)",
        border: "0.5px solid hsl(var(--olivewood) / 0.20)",
        color: "hsl(var(--ink-deep))",
      }}
    />
  );

  let title: string;
  let body: string;
  let icon = Users;
  let action: React.ReactNode = sharePrimary;
  const levers: React.ReactNode[] = [];

  const editLever = onEdit ? (
    <LeverRow
      key="edit"
      icon={Pencil}
      label="Edit the job"
      // Every field named here is genuinely editable in EditJobDialog while no
      // helpr is attached (title, description, category, location, date, start
      // time, budget) — do not name a field the dialog does not carry.
      // (The overdue branch promotes this same handler to the glossy pill and
      // labels it "Give it a new date", so this row never renders there.)
      detail="Budget, date, category or detail"
      onClick={() => onEdit(selectedJob)}
    />
  ) : null;

  const boostLever = onBoost ? (
    <LeverRow
      key="boost"
      icon={Rocket}
      label="Boost it to the top"
      // Duration from productPrices (the mirror of create-boost-payment). The
      // PRICE is deliberately not quoted here: it varies by membership tier and
      // by whether a Pro poster's monthly credit is spent, and JobBoostDialog
      // is the surface that resolves that. Quoting a number this row cannot
      // guarantee would be the price-that-isn't-the-price defect that dialog's
      // own comments forbid.
      detail={`Featured placement for ${BOOST_DURATION_HOURS} hours`}
      onClick={() => onBoost(selectedJob.id)}
    />
  ) : null;

  switch (phase) {
    case "fresh":
      title = "No one has applied yet";
      // The ONLY branch entitled to the old copy's optimism, because it is the
      // only one where the claim is true. No levers: nothing has gone wrong
      // after an hour, and offering fixes for a non-problem is its own defect.
      body = `You posted this ${agePhrase(hours)}, so it's only just reached the feed for Helprs near ${where}. Sharing it reaches the ones who aren't browsing today.`;
      break;

    case "quiet":
      title = "Still no applications";
      body = views > 0
        // The honest read of "looked at and passed over". Stated as the two
        // things the poster can change, not as a verdict on the job.
        ? `It has been up ${daysUp} days, and ${views} Helprs have opened it without applying.${budget ? ` When a post gets looked at and skipped, it is usually the ${budget} or a description that doesn't say enough to price the work.` : ""}`
        : `It has been up ${daysUp} days and no Helpr has opened it yet. Getting it in front of people is the first problem to solve.`;
      if (editLever) levers.push(editLever);
      if (boostLever) levers.push(boostLever);
      break;

    case "imminent":
      icon = CalendarClock;
      title = until === 0 ? "It's needed today and nobody has applied" : "It's needed tomorrow and nobody has applied";
      body = `Moving the date later in the week widens who can say yes${onBoost ? " — boosting puts it at the top of the feed in the meantime" : ""}.`;
      // Boost leads: on this timescale it is the only lever that can still
      // change the outcome today. Share drops to a quiet row rather than
      // disappearing — it costs nothing and still works.
      if (onBoost) {
        action = (
          <BarkPillButton className="w-full max-w-xs" onClick={() => onBoost(selectedJob.id)}>
            <Rocket className="w-4 h-4 mr-1.5" aria-hidden /> Boost it to the top
          </BarkPillButton>
        );
        levers.push(shareSecondary);
      }
      if (editLever) levers.push(editLever);
      break;

    case "overdue": {
      icon = CalendarClock;
      const late = daysPastDue(selectedJob.date_needed);
      title = "This job's day has passed";
      // Deliberately says nothing about money. Whether a poster has been
      // charged at this point depends on the checkout step of the post flow,
      // and an empty state is not the place to assert a payment fact it has
      // not read.
      body = `It was due ${late <= 1 ? "yesterday" : `${late} days ago`} and nobody applied, so it was never booked. Give it a new date and it goes back into the feed for Helprs near ${where}.`;
      // Re-dating leads. NO Boost on this branch on purpose: paying to feature
      // a job whose day is already gone buys nothing, and offering it would be
      // selling the poster something that cannot help them.
      if (onEdit) {
        action = (
          <BarkPillButton className="w-full max-w-xs" onClick={() => onEdit(selectedJob)}>
            <Pencil className="w-4 h-4 mr-1.5" aria-hidden /> Give it a new date
          </BarkPillButton>
        );
        levers.push(shareSecondary);
      }
      break;
    }
  }

  return (
    /**
     * MEASURED, NOT GUESSED — these two numbers are what actually sits above
     * and below this card inside <AppPage>, read off the rendered page rather
     * than estimated:
     *
     *   below, both cases: the scroll column's own
     *     `safe-bottom + 96px + 1rem` dock clearance = 112px on web.
     *   above, mobile (<900px): safe-area top + ProfileTabHeader + the
     *     job-title subtitle = 108px at 320/375, 124px at 768.
     *   above, web-desktop (>=900px): the same block PLUS the desktop top bar
     *     = 180px at 1440.
     *
     * 16rem / 19rem clear both with ~20px of slack, so the card reaches the
     * dock with no dead band AND never forces the column to scroll on an empty
     * state. Measured at 320 / 375 / 768 / 1440; card bottom lands at 82-93%
     * of the viewport (it was 34-49% before).
     *
     * The 900px switch is NOT a Tailwind breakpoint on purpose: it is the
     * exact media query `useAppShellViewport` uses to set `html.web-desktop`
     * (`matchMedia('(min-width: 900px)')`), which is what adds the top bar
     * this number is compensating for. Keying it to `lg:` instead would drift
     * from the thing it is measuring.
     *
     * `100dvh` (not `vh`) so the iOS toolbar collapsing does not leave a gap,
     * matching AppShell's own lock.
     */
    <div className="flex min-h-[calc(100dvh-16rem)] [@media(min-width:900px)]:min-h-[calc(100dvh-19rem)]">
      <EmptyState
        variant="inline"
        icon={icon}
        /* NO `eyebrow`. `.text-display-eyebrow` is `display: none` app-wide
           (index.css:1966 — "all eyebrows gone", 2026-07-25), so anything
           passed here renders to nothing. The first draft of this state put
           the timing fact there ("Was due 4 days ago") and it was invisible in
           the render; every branch now carries its timing in the title or the
           body, where it is actually read. */
        title={title}
        body={body}
        action={action}
        footnote={
          levers.length > 0 ? (
            <div className="w-full max-w-xs space-y-2 pt-1">{levers}</div>
          ) : undefined
        }
      />
    </div>
  );
}
