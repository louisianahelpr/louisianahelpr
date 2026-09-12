import {
  Star,
  XCircle,
  ClipboardList,
  Hammer,
  Sprout,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type {
  ProfileStatsShape,
  ReplyLatency,
  CancellationRate,
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
          className="font-sans font-bold tabular-nums text-ds-18 leading-none truncate"
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
  /**
   * The owner's own median reply time. Owner-only by construction — see the
   * cell below and `get_my_reply_latency()` (20260901005108).
   */
  replyLatency: ReplyLatency;
  onTimeArrivalRate: number | null;
  revisionFrequency: number | null;
  cancellationRate: CancellationRate;
  /**
   * % of this helper's clients who hired them again. NULL below three
   * distinct clients — ungated, one returning customer published a boldfaced
   * "100% Clients who rebooked", which sat next to "New · No reviews yet" on
   * the same card and made a stranger doubt both.
   */
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
  replyLatency: _replyLatency,
  onTimeArrivalRate: _onTimeArrivalRate,
  revisionFrequency: _revisionFrequency,
  cancellationRate,
  repeatHirePercent: _repeatHirePercent,
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

  /* ── EXACTLY FOUR TILES ──────────────────────────────────────────────
     Owner, 2026-09-11, asked a second time and told me not to ask again:
     this card shows Rating · Jobs posted · Jobs completed · Cancelled, and
     nothing else. Deleted here with that ruling: "Typical reply time"
     (owner-only, `get_my_reply_latency()`), "Arrived on time", "Posters who
     rebooked" and "Needed revisions".

     The RPCs and the props behind them are untouched — the props are still
     accepted and simply not rendered — so nothing else that reads those
     numbers changes, and restoring a tile is a three-line edit rather than a
     data re-plumb. What is gone is the DISPLAY: seven tiles wrapping to three
     rows at 375 made the two numbers a stranger actually came for (rating,
     jobs done) weigh the same as a derived percentage most profiles cannot
     even populate. */

  /* ── ACCEPT RATE: DELETED, NOT REPAIRED ───────────────────────────────
     It was `accepted / total` over the applications this member sent, and no
     arithmetic fixes what it is: a tally of hiring decisions other people
     made, rendered as a property of the applicant. A helper who reaches for
     harder jobs, who is new, or who simply was not picked carries the low
     number, and none of them has a lever to move it.

     The denominator made it worse rather than merely unfair. `pending` — an
     application nobody has answered yet — counted as a miss, so a poster who
     ghosts lowered the HELPER's score. On prod 2026-09-01, 16 of 27
     applications were pending and only 2 were rejected: the number was
     overwhelmingly a measure of poster inactivity, attributed to helpers.

     And publishing it shapes behaviour in the direction the marketplace least
     wants — the rational response to a visible accept rate is to stop applying
     to competitive jobs. There is no honest label for "other people's choices
     about you", so this is a deletion, not a relabel. */


  /* NO SECOND RATING TILE. A separate "As a poster · N reviews" star sat here
     alongside the profile's main rating, so one person showed two different
     scores inches apart and the reader had to work out which one meant what.
     Owner, 2026-09-11: "no one rating" — this account has ONE reputation,
     which is the same reason the app is never role-based.

     Deleting it loses nothing: `get_public_profile_stats.avg_rating` already
     counts poster reviews as well as helper ones. Verified against prod
     rather than assumed — user 96c9899e has 0 completed jobs as a helper, 6
     posted jobs, and still reports `avg_rating` 5.00 from a review that also
     shows up in `poster_review_count`. So a pure poster keeps their rating;
     it is just no longer printed twice.

     `poster_avg_rating` remains in the RPC and is untouched — it carries a
     3-review floor and was returning null here anyway. */

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

  /* No section heading, no "tap a highlighted figure" hint and no
     "not enough history yet" line here any more — all three deleted by the
     owner (2026-09-11: "delete", pointing at each). The tiles stand alone;
     the section keeps an `aria-label` so the landmark stays named for
     assistive tech now that the visible heading it used to point at is gone. */

  // ── NEW MEMBER ───────────────────────────────────────────────────────
  // Nothing measurable yet. Say so, in the person's own terms, and say what
  // will appear here — a young marketplace shows this state constantly and it
  // has to read as a profile that is simply new, not as a page that broke.
  if (cells.length === 0) {
    return (
      <section aria-label="At a glance">
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
              className="font-sans text-ds-13 leading-relaxed mt-0.5 max-w-[60ch]"
              style={{ color: "hsl(var(--olivewood) / 0.9)" }}
            >
              {/* Two different promises, because the two readers see two
                  different cards. Reply time is owner-only, so telling a
                  visitor it will appear here is a promise the page cannot
                  keep — the previous copy made it to both. */}
              {isOwnProfile
                ? "Your rating, job history and reply time will appear here as you work and answer messages."
                : `${displayName} joined${memberSinceLabel ? ` in ${memberSinceLabel}` : ""} and hasn't built a public record yet. Ratings and job history appear here after their first job.`}
            </p>
          </div>
        </div>
      </section>
    );
  }

  return (
    <section aria-label="At a glance">
      {/* Four tiles max (see "EXACTLY FOUR TILES" above), so the grid tops out
          at four columns: two-up on a phone, one row from `sm`. A six-column
          track would have stranded four tiles in two-thirds of a desktop
          frame. */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        {cells.map((c) => (
          <MetricCell key={c.key} cell={c} />
        ))}
      </div>
    </section>
  );
};
