/**
 * The browse-feed job card's geometry, in ONE place.
 *
 * Owner, 2026-09-19: loading states "jump and are not consistent with their
 * info". `JobCardSkeleton` stood in for `JobCard` and described a different
 * card: a 44px AVATAR circle the card has not had since the poster moved to
 * JobPosterCard, `py-3` against the card's `pt-2 pb-2.5`, a `w-1` rail against
 * `w-1.5`, and no category tab at all — so the bone was too tall in the body,
 * too short overall, and promised a face that never arrived. Its doc comment
 * asserted it mirrored "the real card"; trust the declaration, never the
 * comment beside it.
 *
 * WHY ITS OWN MODULE and not exports on `JobCard.tsx`. `GuestBrowseSkeleton`
 * is imported STATICALLY by `src/App.tsx` (it is `/browse`'s Suspense
 * fallback) and renders `JobCardSkeleton`. Had the skeleton reached for these
 * strings on `JobCard` itself, that import would have pulled JobCard — and
 * with it date-fns, the geo helpers, parishCentroids and useDrivingTime — onto
 * the entry chunk, to paint a placeholder. Same reasoning as
 * `DashboardRouteSkeleton`'s refusal to import `DashboardTitleBar`. Strings in
 * a leaf module cost nothing and both sides can hold them.
 *
 * `JOB_CATEGORY_TAB_FRAME` lives here for the same reason: `JobCategoryTab`
 * itself pulls in `activityConstants` (the whole category colour table) and
 * `CategoryIcon` (a lucide bundle), neither of which a grey placeholder box
 * needs.
 */

/** Outer card: border, background, shadow, radius. */
export const JOB_CARD_FRAME =
  "relative h-full rounded-2xl border border-border/60 bg-card shadow-[var(--card-shadow)]";

/** Inner clip — rounds the rail, tab and body into one continuous shape. */
export const JOB_CARD_CLIP = "relative h-full overflow-hidden rounded-2xl";

/** Category rail — the full-height colour stripe down the left edge. */
export const JOB_CARD_RAIL = "absolute left-0 top-0 bottom-0 w-1.5";

/** The badge rail: category tab + at most one secondary chip, in flow. */
export const JOB_CARD_BADGE_ROW = "relative z-20 flex items-stretch gap-1";

/** Body padding. `pt-2` is a gap under the rail, not a reservation for it. */
export const JOB_CARD_BODY = "w-full px-3.5 pt-2 pb-2.5";

/** Title + price share one row. */
export const JOB_CARD_TITLE_ROW = "flex items-center justify-between gap-3";

/** The meta block below the title row. */
export const JOB_CARD_META = "mt-1.5 flex flex-col gap-0.5 text-ds-11 leading-tight";

/**
 * The category tab's own box, without its category colour
 * (`src/components/job/JobCategoryTab.tsx`).
 *
 * A placeholder RESERVES this tab's height from here rather than guessing at a
 * number beside it — the skeleton that omitted the tab entirely left every
 * bone ~20px shorter than the card it stood in for, and the feed stepped down
 * as the real cards landed.
 */
export const JOB_CATEGORY_TAB_FRAME =
  "inline-flex items-center gap-1 pl-3 pr-2.5 py-1 rounded-l-none rounded-br-lg rounded-tr-none border-b border-r text-ds-10 font-semibold leading-none shadow-sm";
