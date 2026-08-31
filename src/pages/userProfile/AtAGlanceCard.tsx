import {
  Clock,
  CheckCircle,
  Timer,
  RotateCcw,
  Star,
  XCircle,
  ClipboardList,
  Hammer,
  Repeat,
  Sprout,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type {
  ProfileStatsShape,
  ResponseMetrics,
  CancellationRate,
  PosterReputation,
  PetCareSignal,
} from "./types";

/**
 * AT A GLANCE — every number this profile can honestly show, in ONE grid.
 *
 * This replaces two blocks that used to sit one under the other:
 * `ProfileStatsGrid` (three fixed toggle tiles — Reviews / Posted / Completed)
 * and `TrackRecordCard` (its own "TRACK RECORD" all-caps heading over a second
 * card of metric cells). Both were the same shape — a big value over a quiet
 * label — drawn twice, in two different card treatments, with a section label
 * between them. The result read as two unrelated widgets rather than one
 * answer to "what is this person's record?" (owner, 2026-08-31: "it reads as a
 * stack of unrelated cards rather than one designed screen").
 *
 * Three things the merge fixes beyond the visual:
 *
 * 1. **No more "★ —" next to real numbers.** A zero-review profile used to
 *    render an em-dash where every neighbouring tile had a figure, which reads
 *    as a value that failed to load. It now says "New" over "No reviews yet",
 *    and the cell is not a button, because expanding it leads to an empty
 *    panel.
 *
 * 2. **No more "0 Completed" on a pure poster.** The posted/completed pair was
 *    fixed at three tiles for everyone, so someone who only ever posts jobs was
 *    shown a zero for a role they do not play. Cells are now emitted only for
 *    the sides of the marketplace this person is actually on, and the labels
 *    say which side ("Jobs posted" / "Jobs completed").
 *
 * 3. **Cancel rate is no longer the visual climax.** It rendered burnt-sienna
 *    from 15% up, which made a 1-in-6 rate the loudest thing on a stranger's
 *    profile after their name. The alarm now starts at 30% and it sits LAST,
 *    after the things this person did well, instead of alone in its own card.
 *
 * Every cell is self-hiding, and when nothing at all qualifies the card falls
 * through to a deliberate new-member state rather than an empty scaffold — a
 * brand-new account is the common case in a young marketplace and must look
 * intentional, not broken.
 */

type Cell = {
  key: string;
  icon: React.ComponentType<{ className?: string; style?: React.CSSProperties }>;
  value: string;
  label: string;
  tone?: string;
  onClick?: () => void;
  selected?: boolean;
};

/** One metric cell — big value, quiet label. The only shape in this grid. */
const MetricCell = ({ cell }: { cell: Cell }) => {
  const tone = cell.tone ?? "hsl(var(--ink-deep))";
  const interactive = !!cell.onClick;
  const body = (
    <>
      <span className="flex items-center gap-1.5 min-w-0">
        <cell.icon
          className="w-3.5 h-3.5 shrink-0"
          style={{
            color: cell.selected
              ? "hsl(var(--parchment) / 0.75)"
              : "hsl(var(--olivewood) / 0.55)",
          }}
        />
        <span
          className="font-display italic font-bold tabular-nums text-ds-18 leading-none truncate"
          style={{ color: cell.selected ? "hsl(var(--parchment))" : tone }}
        >
          {cell.value}
        </span>
      </span>
      <span
        className="font-sans text-ds-11 leading-snug text-left"
        style={{
          color: cell.selected
            ? "hsl(var(--parchment) / 0.85)"
            : "hsl(var(--olivewood) / 0.8)",
        }}
      >
        {cell.label}
      </span>
    </>
  );

  // Non-interactive cells stay <div>s: a stat that expands nothing must not be
  // focusable or announced as a control (the old grid left zero-count tiles in
  // the tab order doing nothing).
  if (!interactive) {
    return (
      <div
        className="flex flex-col gap-0.5 rounded-ds-md px-3 py-2.5 sm:py-3.5 min-w-0 min-h-[58px] justify-center"
        style={{ background: "hsl(var(--olivewood) / 0.05)" }}
      >
        {body}
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={cell.onClick}
      aria-pressed={!!cell.selected}
      className={cn(
        // min-h-[58px] clears the 44px tap-target floor with room to spare.
        "flex flex-col gap-0.5 rounded-ds-md px-3 py-2.5 sm:py-3.5 min-w-0 min-h-[58px] justify-center text-left",
        "transition-all focus:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        // SELECTED = GLOSSY. Project rule: a selected control wears the
        // primary gradient (`btn-grad-primary`), never a flat tint.
        cell.selected
          ? "btn-grad-primary"
          : "hover:brightness-[0.98] active:scale-[0.99]",
      )}
      style={
        cell.selected
          ? {
              boxShadow:
                "inset 0 1px 1px 0 rgba(255,255,255,0.28), 0 6px 14px -6px hsl(var(--bark) / 0.5)",
            }
          : { background: "hsl(var(--olivewood) / 0.05)" }
      }
    >
      {body}
    </button>
  );
};

type Props = {
  isOwnProfile: boolean;
  displayName: string;
  /** e.g. "Aug 2026" — used only by the new-member state. */
  memberSinceLabel: string | null;
  stats: ProfileStatsShape;
  postedJobsCount: number;
  workedJobsCount: number;
  responseMetrics: ResponseMetrics;
  onTimeArrivalRate: number | null;
  revisionFrequency: number | null;
  cancellationRate: CancellationRate;
  posterReputation: PosterReputation | null;
  petCareSignal: PetCareSignal | null | undefined;
  /** % of this helper's clients who hired them again. Public RPC. */
  repeatHirePercent: number | null;
  showReviews: boolean;
  showPostedJobs: boolean;
  showWorkedJobs: boolean;
  onToggleReviews: () => void;
  onTogglePosted: () => void;
  onToggleWorked: () => void;
};

export const AtAGlanceCard = ({
  isOwnProfile,
  displayName,
  memberSinceLabel,
  stats,
  postedJobsCount,
  workedJobsCount,
  responseMetrics,
  onTimeArrivalRate,
  revisionFrequency,
  cancellationRate,
  posterReputation,
  petCareSignal,
  repeatHirePercent,
  showReviews,
  showPostedJobs,
  showWorkedJobs,
  onToggleReviews,
  onTogglePosted,
  onToggleWorked,
}: Props) => {
  const cells: Cell[] = [];

  // ── Rating ───────────────────────────────────────────────────────────
  // At zero it still says something — "no reviews yet" is a material fact
  // about a stranger — but it says it in words, not as "★ —" beside real
  // figures, and it is not a button, because expanding it opens nothing.
  // It is pushed only when there is at least one other cell to sit beside;
  // on its own it would be the lonely placeholder the new-member state below
  // exists to replace.
  const hasRating = stats.reviewCount > 0;
  if (hasRating) {
    cells.push({
      key: "rating",
      icon: Star,
      value: stats.avgRating.toFixed(1),
      label: `${stats.reviewCount} review${stats.reviewCount === 1 ? "" : "s"}`,
      onClick: onToggleReviews,
      selected: showReviews,
    });
  }

  // ── The two sides of the marketplace, only where they apply ──────────
  if (postedJobsCount > 0) {
    cells.push({
      key: "posted",
      icon: ClipboardList,
      value: String(postedJobsCount),
      label: "Jobs posted",
      onClick: onTogglePosted,
      selected: showPostedJobs,
    });
  }
  if (workedJobsCount > 0) {
    cells.push({
      key: "worked",
      icon: Hammer,
      value: String(workedJobsCount),
      label: "Jobs completed",
      onClick: onToggleWorked,
      selected: showWorkedJobs,
    });
  }

  // ── How they behave ──────────────────────────────────────────────────
  if (responseMetrics.totalApplications > 0 && responseMetrics.avgResponseHours !== null) {
    const h = responseMetrics.avgResponseHours;
    cells.push({
      key: "reply",
      icon: Clock,
      value: h < 1 ? `${Math.round(h * 60)}m` : h < 24 ? `${h.toFixed(1)}h` : `${Math.round(h / 24)}d`,
      label: "Avg. reply time",
    });
  }

  if (responseMetrics.totalApplications > 0 && responseMetrics.acceptanceRate !== null) {
    cells.push({
      key: "accept",
      icon: CheckCircle,
      value: `${responseMetrics.acceptanceRate.toFixed(0)}%`,
      label: "Accept rate",
    });
  }

  if (onTimeArrivalRate !== null) {
    cells.push({
      key: "ontime",
      icon: Timer,
      value: `${onTimeArrivalRate.toFixed(0)}%`,
      label: "Arrived on time",
      tone:
        onTimeArrivalRate >= 85
          ? "hsl(var(--ink-deep))"
          : onTimeArrivalRate >= 65
          ? "hsl(var(--gold-warm))"
          : "hsl(var(--burnt-sienna))",
    });
  }

  // Repeat-hire rate was already fetched on this page (public SECURITY DEFINER
  // RPC, `helper_repeat_hire_percent`) but only ever used as a hidden gate for
  // a milestone — the number itself was never shown. It is the single best
  // "would someone book them again?" signal a stranger can be given, so it is
  // now a cell of its own.
  if (repeatHirePercent !== null && repeatHirePercent > 0) {
    cells.push({
      key: "repeat",
      icon: Repeat,
      value: `${Math.round(repeatHirePercent)}%`,
      label: "Clients who rebooked",
    });
  }

  if (posterReputation !== null) {
    cells.push({
      key: "poster",
      icon: Star,
      value: posterReputation.avgRating.toFixed(1),
      label: `As a poster · ${posterReputation.reviewCount} review${posterReputation.reviewCount === 1 ? "" : "s"}`,
    });
  }

  if (revisionFrequency !== null) {
    cells.push({
      key: "revisions",
      icon: RotateCcw,
      value: `${revisionFrequency.toFixed(0)}%`,
      label: "Needed revisions",
      tone:
        revisionFrequency <= 10
          ? "hsl(var(--ink-deep))"
          : revisionFrequency <= 25
          ? "hsl(var(--gold-warm))"
          : "hsl(var(--burnt-sienna))",
    });
  }

  if (petCareSignal && petCareSignal.distinctPets > 0) {
    cells.push({
      key: "pets",
      icon: ClipboardList,
      value: String(petCareSignal.distinctPets),
      label: `${petCareSignal.distinctPets === 1 ? "Pet" : "Pets"} cared for · ${petCareSignal.reportCount} ${petCareSignal.reportCount === 1 ? "report" : "reports"}`,
    });
  }

  /* CANCEL RATE — last, and no longer alarming at one-in-six.
     Neutral on your own profile: being shown your worst number in red every
     time you open your own preview is punishment, not information, so the
     owner sees plain ink and the underlying count. Visitors keep a graded
     colour — that IS the trust signal they came for — but the thresholds now
     start the warning at 30%, not 15%. */
  if (cancellationRate.rate !== null) {
    cells.push({
      key: "cancel",
      icon: XCircle,
      value: `${cancellationRate.rate.toFixed(0)}%`,
      label: isOwnProfile
        ? `${cancellationRate.cancelled} of ${cancellationRate.total} jobs cancelled`
        : `Cancelled · ${cancellationRate.cancelled} of ${cancellationRate.total} jobs`,
      tone:
        isOwnProfile || cancellationRate.rate < 15
          ? "hsl(var(--ink-deep))"
          : cancellationRate.rate < 30
          ? "hsl(var(--gold-warm))"
          : "hsl(var(--burnt-sienna))",
    });
  }

  // See the note on `hasRating`: the zero-state review cell goes FIRST, and
  // only alongside real company.
  if (!hasRating && cells.length > 0) {
    cells.unshift({
      key: "rating",
      icon: Star,
      value: "New",
      label: "No reviews yet",
    });
  }

  const label = (
    <h2
      id="at-a-glance-heading"
      className="font-sans font-semibold uppercase tracking-wider text-ds-11 mb-2.5"
      style={{ color: "hsl(var(--olivewood) / 0.7)", letterSpacing: "0.12em" }}
    >
      At a glance
    </h2>
  );

  // ── NEW MEMBER ───────────────────────────────────────────────────────
  // Nothing measurable yet. Say so, in the person's own terms, and say what
  // will appear here — a young marketplace shows this state constantly and it
  // has to read as a profile that is simply new, not as a page that broke.
  if (cells.length === 0) {
    return (
      <section aria-labelledby="at-a-glance-heading">
        {label}
        <div
          className="rounded-ds-md px-4 py-3.5 flex items-start gap-3"
          style={{ background: "hsl(var(--olivewood) / 0.05)" }}
        >
          <Sprout
            className="w-4 h-4 shrink-0 mt-0.5"
            style={{ color: "hsl(var(--bark) / 0.7)" }}
            aria-hidden
          />
          <div className="min-w-0">
            <p
              className="font-sans font-semibold text-ds-13"
              style={{ color: "hsl(var(--ink-deep))" }}
            >
              {isOwnProfile ? "You're new here" : "New to Helpr"}
            </p>
            <p
              className="font-serif italic text-ds-13 leading-relaxed mt-0.5 max-w-[60ch]"
              style={{ color: "hsl(var(--olivewood) / 0.9)" }}
            >
              {isOwnProfile
                ? "Your rating, reply time and job history will appear here once you finish your first job."
                : `${displayName} joined${memberSinceLabel ? ` in ${memberSinceLabel}` : ""} and hasn't built a public record yet. Ratings, reply time and job history appear here after their first job.`}
            </p>
          </div>
        </div>
      </section>
    );
  }

  return (
    <section aria-labelledby="at-a-glance-heading">
      {label}
      {/* Fills the width it is given: two-up on the narrowest phone, six-up on
          a desktop frame — so the card is never a short row of tiles stranded
          in a wide, empty band. */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6 gap-2">
        {cells.map((c) => (
          <MetricCell key={c.key} cell={c} />
        ))}
      </div>
      {/* A tapped tile opens its list further down the page; say so once,
          quietly, rather than leaving three of the cells looking like buttons
          for no stated reason. */}
      {cells.some((c) => c.onClick) && (
        <p
          className="mt-2 font-serif italic text-ds-11"
          style={{ color: "hsl(var(--olivewood) / 0.65)" }}
        >
          Tap a highlighted figure to see what's behind it.
        </p>
      )}
    </section>
  );
};
