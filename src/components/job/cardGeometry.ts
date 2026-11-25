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
 */

/** Outer card: border, background, shadow, radius. */
export const JOB_CARD_FRAME =
  "relative h-full rounded-2xl border border-border/60 bg-card shadow-[var(--card-shadow)]";

/** Inner clip — rounds the rail, tab and body into one continuous shape. */
export const JOB_CARD_CLIP = "relative h-full overflow-hidden rounded-2xl";

/** The badge rail: category tab + at most one secondary chip, in flow. */
export const JOB_CARD_BADGE_ROW = "relative z-20 flex items-stretch gap-1";

/** Body padding. `pt-2` is a gap under the rail, not a reservation for it. */
export const JOB_CARD_BODY = "w-full px-3.5 pt-2 pb-2.5";

/** Title + price share one row. */
export const JOB_CARD_TITLE_ROW = "flex items-center justify-between gap-3";

/** The meta block below the title row. */
export const JOB_CARD_META = "mt-1 flex flex-col gap-0.5 text-ds-11 leading-tight";

/** Photo-first rows (Q2043): the tile and the text column side by side. Shared with the pre-boot Browse shell
 *  (src/lib/browseShellCards.mjs), which must match byte for byte, and with JobCardSkeleton (Jobs audit 11-21, P10). */
export const JOB_CARD_MEDIA_ROW = "flex items-stretch";
/** The text column beside the tile; `job-card-media-col` is the container index.css's meta-row query reads (P9). */
export const JOB_CARD_TEXT_COL = "job-card-media-col min-w-0 flex-1";
/** The feed card's ROW frame (every Browse card that is not a photo hero): a hairline under it, no box. JobCard and
 *  JobCardSkeleton both wear it, so the bones' frame is the row's by construction (Jobs audit 11-21, P10). */
export const JOB_CARD_ROW_FRAME = "group relative h-full cursor-pointer border-b border-border focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary";

/**
 * THE COMPACT ROW (owner 11-25, signed-out Jobs on her phone: "This needs polishing. They take up too much space."):
 * a 40px tile (was 48), 10px above and below (was 12), ONE meta line (category · place · day · time, no calendar or
 * clock icons; index.css "compact rows"), a semibold title, and no empty poster line on a guest
 * row (JobCard): 6+ jobs on a 375 phone screen. JobCard, JobCardSkeleton and the pre-boot Browse shell
 * (src/lib/browseShellCards.mjs, byte for byte) all wear these. Guard: src/test/phoneCompactBrowse1125.test.tsx.
 */
export const JOB_ROW_MEDIA_PAD = "py-2.5";
export const JOB_ROW_MEDIA = "relative shrink-0 self-start w-10 h-10 overflow-hidden rounded-xl";
export const JOB_ROW_BADGE_LINE = "flex pl-3 pt-2.5 -mb-1.5 empty:hidden";
export const JOB_ROW_BODY = "w-full pl-3 pt-2.5 pb-2.5";
