import { Skeleton } from "@/components/ui/skeleton";
import {
  JOB_CARD_BADGE_ROW,
  JOB_CARD_BODY,
  JOB_CARD_CLIP,
  JOB_CARD_FRAME,
  JOB_CARD_META,
  JOB_CARD_RAIL,
  JOB_CARD_TITLE_ROW,
  JOB_CATEGORY_TAB_FRAME,
} from "@/components/job/cardGeometry";

/**
 * JobCardSkeleton — the placeholder for the browse-feed job card
 * (`src/components/dashboard/JobCard.tsx`).
 *
 * It does not re-draw that card's frame; it IMPORTS it. Frame, clip, rail,
 * badge row, body padding, title row and meta block all come from JobCard's
 * own exported geometry, and the category tab's box comes from
 * `JobCategoryTab`. The reserved space is therefore the real space by
 * construction, and neither side can be changed without the other following.
 *
 * Owner, 2026-09-19: loading states "jump and are not consistent with their
 * info". This one did both, in four ways at once:
 *
 *   - it drew a 44px AVATAR circle. The card has not had a poster avatar
 *     since that moved to JobPosterCard, so the bone promised a face that
 *     never arrived — the "not consistent with their info" defect exactly.
 *   - body padding `py-3` against the card's `pt-2 pb-2.5`.
 *   - rail `w-1` against `w-1.5`.
 *   - no category tab at all, while every real card leads with one in flow.
 *
 * Measured on the built app at 375 against prod, the feed's bones and its
 * cards did not share a row height, so the list stepped as it filled.
 *
 * The bones inside are deliberately fewer than the card's parts. A
 * placeholder holds the shape and gets out of the way: one title bar, one
 * price tile, two meta lines. Nothing stands in for the Urgent / Boosted /
 * Just-in chips, which are conditional on the real card — drawing them would
 * be inventing content. What has to match is the RESERVATION, and it does.
 */
export function JobCardSkeleton() {
  return (
    <div className={JOB_CARD_FRAME} aria-hidden>
      <div className={JOB_CARD_CLIP}>
        {/* Category rail — neutral olivewood while loading; the real card
            recolours it per category. */}
        <span
          className={JOB_CARD_RAIL}
          style={{ background: "hsl(var(--olivewood) / 0.18)" }}
        />
        {/* Badge rail. An empty tab in the real tab's own box, so the ~20px
            this row occupies is reserved rather than guessed — omitting it
            left every bone a tab shorter than the card it stood in for. */}
        <div className={JOB_CARD_BADGE_ROW}>
          <span
            className={JOB_CATEGORY_TAB_FRAME}
            style={{
              background: "hsl(var(--olivewood) / 0.10)",
              borderColor: "hsl(var(--olivewood) / 0.14)",
              color: "transparent",
            }}
          >
            <Skeleton
              className="h-2.5 w-14 rounded"
              style={{ background: "hsl(var(--olivewood) / 0.16)" }}
            />
          </span>
        </div>
        <div className={JOB_CARD_BODY}>
          {/* Title + price share the top row, price chip centred against the
              title — the card's own arrangement. */}
          <div className={JOB_CARD_TITLE_ROW}>
            <Skeleton
              className="h-5 flex-1 min-w-0 max-w-[70%] rounded"
              style={{ background: "hsl(var(--olivewood) / 0.14)" }}
            />
            {/* The price chip's OWN box (MoneyChip: px-2.5 py-1 around a
                text-ds-17 leading-none figure), holding an invisible figure so
                it is the chip's height at every text size. A fixed h-9 bone
                stood here: 36px against the real 27, so every bone was 7px
                taller than its card and a 5-card feed stepped 35px when the
                cards landed (Q169, measured at 375). */}
            <span
              className="relative inline-flex shrink-0 items-center justify-center rounded-ds-md px-2.5 py-1 overflow-hidden"
              // MoneyChip's own 0.5px border, transparent: part of its box.
              style={{ background: "hsl(var(--olivewood) / 0.12)", border: "0.5px solid transparent" }}
            >
              <span className="invisible font-sans leading-none tabular-nums text-ds-17">$000</span>
            </span>
          </div>
          {/* Meta — location · date on one line, in the card's own meta block
              so the `mt-1.5` and the line height are not restated here. */}
          <div className={JOB_CARD_META}>
            <div className="flex items-center gap-x-2">
              {/* A zero-width character gives this row the meta block's real
                  line box (text-ds-11 leading-tight), not the 12px bone's. */}
              <span className="invisible w-0">{"​"}</span>
              <Skeleton
                className="h-3 w-24 rounded"
                style={{ background: "hsl(var(--olivewood) / 0.10)" }}
              />
              <Skeleton
                className="h-3 w-20 rounded"
                style={{ background: "hsl(var(--olivewood) / 0.10)" }}
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * RecommendedJobCardSkeleton — the "Picked for you" card in BrowseTasksFeed.
 *
 * The recommended card is the SAME JobCard with `recommended` set, which adds
 * one chip to the badge rail and changes nothing about the card's box. It used
 * to be a second hand-drawn skeleton here with its own padding (`pt-6 pb-3`),
 * its own rail width (`w-1.5` vs the plain one's `w-1`) and its own price tile
 * (`h-11 w-[52px]`) — two approximations of one card, already disagreeing with
 * each other as well as with the card.
 *
 * So it is the same skeleton plus the chip it actually adds.
 */
export function RecommendedJobCardSkeleton() {
  return (
    <div className="relative" aria-hidden>
      <JobCardSkeleton />
      {/* The secondary chip rides in the badge rail beside the category tab;
          it is drawn here as an overlay at that rail's own offset so the
          shared skeleton above stays the single description of the card. */}
      <span
        className={JOB_CATEGORY_TAB_FRAME}
        style={{
          position: "absolute",
          top: 0,
          left: "calc(0.25rem + 6.5rem)",
          background: "hsl(var(--burnt-sienna) / 0.10)",
          borderColor: "hsl(var(--burnt-sienna) / 0.20)",
          color: "transparent",
        }}
      >
        <Skeleton
          className="h-2.5 w-12 rounded"
          style={{ background: "hsl(var(--burnt-sienna) / 0.20)" }}
        />
      </span>
    </div>
  );
}
