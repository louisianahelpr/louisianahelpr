// `Sprout` went with the new-member fallback (2026-09-19) — see the block
// where it used to render, below the cells array.
import {
  Star,
  ClipboardList,
  Hammer,
  Users,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { ProfileStatsShape, ReplyLatency } from "./types";

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
 * 2. **The labels say WHICH SIDE** — "Jobs posted" / "Jobs completed" — rather
 *    than a bare "Posted" / "Completed" that left the reader to guess.
 *
 *    SUPERSEDED, kept so the history reads: this point used to say cells were
 *    "emitted only for the sides of the marketplace this person is actually
 *    on", so a pure poster was not shown "0 Completed". Owner, 2026-09-19,
 *    looking at the result: "this should display 4 boxes always. even if it
 *    has zero data yet bc rn it looks empty." Self-hiding cells left a dead
 *    column in the `sm:grid-cols-4` track, which reads worse than the zero it
 *    was avoiding. All four tiles render unconditionally now — see the cells
 *    array.
 *
 * 3. **Cancel rate is no longer the visual climax.** It rendered burnt-sienna
 *    from 15% up, which made a 1-in-6 rate the loudest thing on a stranger's
 *    profile after their name. The alarm now starts at 30% and it sits LAST,
 *    after the things this person did well, instead of alone in its own card.
 *
 * The card always renders the same four tiles — Rating · Jobs completed ·
 * Jobs posted · Worked together — zeros included, so a brand-new account
 * (the common case in a young marketplace) shows a complete grid of honest
 * zeros rather than a part-filled row. There is no self-hiding cell and no
 * separate new-member state any more; both are explained at their old sites
 * below.
 */

/**
 * The record strip's geometry, in ONE place, exported for the /user/:id
 * loading placeholder (UserProfile.tsx). That placeholder hand-drew its tiles
 * as `p-3` boxes of two bones in a plain `grid-cols-2`: 64px tiles against
 * these 58px ones at 375, and a 2x2 block at 1440 where this grid is one row
 * of four. Shared, so the two cannot drift apart again.
 */
export const METRIC_CELL_FRAME =
  "flex flex-col gap-0.5 rounded-ds-md px-3 py-2.5 sm:py-3.5 min-w-0 min-h-[58px] justify-center";
/** Two-up on a phone, one row of four from `sm` (see the note at the grid). */
export const AT_A_GLANCE_GRID = "grid grid-cols-2 auto-rows-fr gap-2 sm:grid-cols-4";

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
const MetricCell = ({ cell, className }: { cell: Cell; className?: string }) => {
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
        className={cn(METRIC_CELL_FRAME, className)}
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
        METRIC_CELL_FRAME,
        "text-left",
        className,
        // Outline, not ring: the selected state below paints an inline
        // boxShadow, which is the property Tailwind's ring lives in, so a
        // ring could never show on the selected cell.
        "transition-all focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
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
  /**
   * e.g. "Aug 2026". Fed the new-member state, which is deleted — accepted
   * and unread now; see the destructuring below.
   */
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
  /**
   * % of this helper's clients who hired them again. NULL below three
   * distinct clients — ungated, one returning customer published a boldfaced
   * "100% Clients who rebooked", which sat next to "New · No reviews yet" on
   * the same card and made a stranger doubt both.
   */
  repeatHirePercent: number | null;
  /**
   * Completed jobs the VIEWER and this member have done together. Its own
   * tile, FOURTH (owner, 2026-09-19; it was second from VN-16, 2026-09-14).
   * ALWAYS rendered, including at 0 and on your own profile — 0 is what
   * almost everyone sees, and the own-profile view exists to show the
   * stranger's card. Already 0 by construction on your own profile and for a
   * signed-out visitor (`wantsMutual`, useUserProfileData.ts).
   */
  mutualJobsCount: number;
  showReviews: boolean;
  showPostedJobs: boolean;
  showWorkedJobs: boolean;
  onToggleReviews: () => void;
  onTogglePosted: () => void;
  onToggleWorked: () => void;
};

export const AtAGlanceCard = ({
  // Accepted and NOT read any more — see the "FOUR TILES, ALWAYS" block below.
  // Both only ever fed the new-member fallback, which is unreachable now that
  // the grid always emits four cells. Kept on the props so UserProfile.tsx is
  // unchanged, same convention as the four metric props above.
  isOwnProfile: _isOwnProfile,
  displayName: _displayName,
  memberSinceLabel: _memberSinceLabel,
  stats,
  postedJobsCount,
  workedJobsCount,
  replyLatency: _replyLatency,
  onTimeArrivalRate: _onTimeArrivalRate,
  revisionFrequency: _revisionFrequency,
  repeatHirePercent: _repeatHirePercent,
  mutualJobsCount,
  showReviews,
  showPostedJobs,
  showWorkedJobs,
  onToggleReviews,
  onTogglePosted,
  onToggleWorked,
}: Props) => {
  /* ── FOUR TILES, ALWAYS, ZEROS INCLUDED ──────────────────────────────
     Owner, 2026-09-19, from a live /user/… screenshot: "this should display 4
     boxes always. even if it has zero data yet bc rn it looks empty."

     What it was: every cell was `push`ed behind its own `> 0` guard, so a
     zero silently REMOVED a tile while the `sm:grid-cols-4` track kept its
     fourth column — the screenshot that prompted this showed three tiles and
     a dead quarter of whitespace, which reads as a value that failed to load
     rather than as a number that is genuinely zero. A zero is a fact about
     this person; withholding it is not neutral, it just looks broken.

     So the array below is POSITIONAL, not built by push-then-unshift: four
     entries, in the order the owner set, every render. The consequences are
     handled here rather than left as branches nothing can take —

       - the `cells.length === 0` new-member state is DELETED (it can no
         longer be reached; see the block where it used to live);
       - the odd-count `col-span-2` rule is DELETED (four is never odd);
       - the old `hasRating` / `unshift` pair is gone — the rating cell is
         simply the first element, in one of its two forms.

     A zero tile is deliberately NOT a button. MetricCell's rule stands: a
     stat that expands nothing must not be focusable or announced as a
     control, so `onClick` is attached only where there is a panel behind it.
     That is why the interactive props are spread conditionally rather than
     passed unconditionally. */
  const cells: Cell[] = [
    // ── 1. Rating ──
    // At zero it still says something — "no reviews yet" is a material fact
    // about a stranger — but it says it in words, not as "★ —" beside real
    // figures, and it is not a button, because expanding it opens nothing.
    stats.reviewCount > 0
      ? {
          key: "rating",
          icon: Star,
          value: stats.avgRating.toFixed(1),
          label: `${stats.reviewCount} review${stats.reviewCount === 1 ? "" : "s"}`,
          onClick: onToggleReviews,
          selected: showReviews,
        }
      : { key: "rating", icon: Star, value: "New", label: "No reviews yet" },

    // ── 2. Jobs completed ──
    // Completed before posted (most-to-least-important order): work someone
    // actually did for other people outranks how often they posted.
    {
      key: "worked",
      icon: Hammer,
      value: String(workedJobsCount),
      label: "Jobs completed",
      ...(workedJobsCount > 0 ? { onClick: onToggleWorked, selected: showWorkedJobs } : {}),
    },

    // ── 3. Jobs posted ──
    {
      key: "posted",
      icon: ClipboardList,
      value: String(postedJobsCount),
      label: "Jobs posted",
      ...(postedJobsCount > 0 ? { onClick: onTogglePosted, selected: showPostedJobs } : {}),
    },

    // ── 4. Worked together ──
    // FOURTH, after this person's own record — not second.
    //
    // Owner, 2026-09-19: "the correct order for the profile should be review,
    // jobs completed, jobs posted, worked together, cancelled." It sat second
    // from VN-16 (2026-09-14) until then.
    //
    // The reason the order is right, worth keeping so nobody "restores" the
    // old one: the first three tiles are what this PERSON did — their rating,
    // the jobs they finished, the jobs they posted. "Worked together" is not
    // about them at all, it is about the VIEWER's relationship with them, so
    // it belongs after their own record rather than interrupting it.
    //
    // NO `!isOwnProfile` GATE, and no preview-only wording. Owner, 2026-09-19
    // (pop-up): 0 is what almost everyone sees — anyone who has not hired you
    // yet — so it is the honest default and needs no caveat. `mutualJobsCount`
    // is already 0 by construction on your own profile and for a signed-out
    // visitor (`wantsMutual` in useUserProfileData.ts), so this tile shows the
    // stranger's view on the preview without a branch, which is the whole
    // point of /user/<your own id> ("How others see you").
    //
    // Not a button — there is no panel behind it. It used to be a quiet line
    // under the bio in ProfileHeaderCard.
    { key: "together", icon: Users, value: String(mutualJobsCount), label: "Worked together" },
  ];

  /* ── WHY FOUR AND NOT FIVE ───────────────────────────────────────────
     See the CANCELLED block below for why there is no fifth.

     Superseded, kept so the history reads: owner, 2026-09-19 had five —
     Rating · Jobs completed · Jobs posted · Worked together · Cancelled.

     Superseded, kept so the history reads: owner, 2026-09-14 (VN-16) had
     Rating · Worked together · Jobs completed · Jobs posted · Cancelled,
     itself changing the 2026-09-11 ruling below from four tiles to five.

     The 2026-09-11 ruling ("EXACTLY FOUR TILES", asked twice): this card shows
     Rating · Jobs posted · Jobs completed · Cancelled, and nothing else.
     Deleted with that ruling, and still deleted: "Typical reply time"
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

  /* ── CANCELLED: DELETED, NOT RELABELLED OR RECOMPUTED ─────────────────
     Owner's call, 2026-09-19, from a live profile reading
     "50% · Cancelled · 35 of 70 jobs". Reconciled against prod: 32 of those
     35 cancellations were made BY THE POSTER, and every one of them was
     counted against the HELPER whose profile was printing the 50%.

     That is the SAME defect accept rate was deleted for, and the note above
     already names it — "a tally of other people's decisions rendered as a
     property of this person". A poster who books and then calls it off moves
     a number on the helper's page, and the helper has no lever to move it
     back. There is no honest label for that, so this is a deletion.

     Recomputing it was considered and rejected on top of the above, because
     the row it sat in did not reconcile with itself either: the three tiles
     counted three different universes — `Jobs completed` is helper-side only,
     `Jobs posted` is poster-side and every status, and `Cancelled` was BOTH
     sides and every status. "35 of 70" therefore shared no denominator with
     any other figure on the card, so a reader comparing them was comparing
     nothing.

     DO NOT RE-ADD IT. A corrected cancelled-by-this-person rate is a new
     metric with a new definition and needs the owner's sign-off, not a
     restoration of this one.

     `cancellationRate` (the prop, the hook field and `get_public_profile_stats`'s
     `jobs_total` / `cancelled_jobs` / `cancellation_rate` columns) went with
     it — see useUserProfileData.ts. */

  /* No section heading, no "tap a highlighted figure" hint and no
     "not enough history yet" line here any more — all three deleted by the
     owner (2026-09-11: "delete", pointing at each). The tiles stand alone;
     the section keeps an `aria-label` so the landmark stays named for
     assistive tech now that the visible heading it used to point at is gone. */

  /* ── THE NEW-MEMBER STATE IS DELETED, NOT HIDDEN ─────────────────────
     A `cells.length === 0` branch used to return a "You're new here" /
     "New to Helpr" Sprout panel instead of the grid, because every cell
     self-hid at zero and a brand-new account produced an empty scaffold.

     With four tiles emitted unconditionally, `cells.length` is the literal
     4 on every render and that branch is unreachable — and a branch that
     cannot be taken is not a state, it is dead code that reads as though the
     screen still has an empty case to worry about. It is removed rather than
     left guarded so the next reader is not misled about what this card can
     render.

     Nothing is lost by it: a brand-new member now shows "New · No reviews
     yet" beside three honest zeros, which is the same fact the panel spelled
     out in prose, in the shape the rest of the card already uses. The one
     thing that did go is the owner-only promise ("…and reply time will appear
     here"), which was a second reason to drop it — on /user/<your own id>,
     whose entire job is to show what a STRANGER sees, a sentence only you can
     ever read is the wrong thing to render. */

  return (
    <section aria-label="At a glance">
      {/* EXACTLY FOUR TILES: two-up on a phone, one row of four from `sm`.
          The `md:grid-cols-5` track and its fifth-tile span went with
          Cancelled — a five-tile row is no longer reachable, and a branch
          that cannot be taken is not a layout.

          THE ODD-COUNT `col-span-2` RULE WENT THE SAME WAY (2026-09-19). It
          existed so a ragged last tile would span both phone columns at an
          odd count; `cells` is now a fixed four-element array, so no odd
          count is reachable either. Both rows are full two-up, and the rule
          would be another unreachable branch dressed as a layout.

          `auto-rows-fr`: every tile is as tall as the tallest, across rows
          too. Two-up at 375, a label that wraps ("31 of 61 jobs cancelled")
          made row 2 70.3px under a 58px row 1 (OPEN.md; guarded by
          e2e/journeys/stat-tile-heights.spec.ts) — that label was the
          Cancelled tile's and is gone, but the invariant stays: the four
          labels are all one or two words, so no tile wraps past the two lines
          its neighbours use. */}
      <div className={AT_A_GLANCE_GRID}>
        {cells.map((c) => (
          <MetricCell key={c.key} cell={c} />
        ))}
      </div>
    </section>
  );
};
