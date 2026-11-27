import { Skeleton } from "@/components/ui/skeleton";
import { JOB_CARD_MEDIA_ROW, JOB_CARD_META, JOB_CARD_ROW_FRAME, JOB_CARD_TEXT_COL, JOB_CARD_TITLE_ROW, JOB_ROW_BODY, JOB_ROW_MEDIA, JOB_ROW_MEDIA_PAD } from "@/components/job/cardGeometry";

/** A zero-width character: gives a bone row the real text's line box without showing anything. */
const ZW = "\u200b";

/**
 * JobCardSkeleton — the placeholder for the browse-feed job card
 * (`src/components/dashboard/JobCard.tsx`), in the card's ROW form, the one every feed card takes.
 *
 * Jobs audit 11-21 (P10): the bone still drew the retired bordered card (a rounded frame with a tab corner, about
 * 85px tall), while the loaded list is flat rows (an icon tile, the title, a two-line meta block at a phone's column
 * width, the price, a hairline under each), about 100-120px tall. The page jumped when the list landed. It now
 * IMPORTS the row's own geometry: JOB_CARD_MEDIA_ROW, the tile's box (JOB_ROW_MEDIA inside the row's JOB_ROW_MEDIA_PAD; 40px in 10px since owner 11-25),
 * JOB_CARD_TEXT_COL (so the meta row's container query, index.css, gives it the card's one or two lines at the same
 * column widths), the row's body padding, JOB_CARD_TITLE_ROW and JOB_CARD_META. Each bone sits in an invisible line
 * box of the real text's class, so the reservation is the real height at every text size.
 *
 * History (owner 2026-09-19, "loading states jump and are not consistent with their info"): no avatar (the card has
 * none), no category rail (T3, 2026-10-18), the price chip's own box (Q169: a fixed h-9 bone was 7px taller).
 * The bones are fewer than the card's parts: one title bar, one price box, two meta bars. Nothing stands in for the
 * Urgent / Boosted / Just in badge, which a row draws only when it has one.
 */
export function JobCardSkeleton({ badge = false }: { badge?: boolean } = {}) {
  return (
    <div data-feed-row-skeleton="" className={JOB_CARD_ROW_FRAME} aria-hidden>
      <div className={JOB_CARD_MEDIA_ROW}>
        {/* The tile, in the row's own py-3 (JobCard: row ? "py-3"), at JobCardMedia's 48px. */}
        <div className={JOB_ROW_MEDIA_PAD}>
          <Skeleton className={JOB_ROW_MEDIA} style={{ background: "hsl(var(--olivewood) / 0.10)" }} />
        </div>
        <div className={JOB_CARD_TEXT_COL}>
          {/* The badge line a row draws above the title only when it has a badge (RecommendedJobCardSkeleton). */}
          {badge && (
            <div className="flex pl-3 pt-2.5 -mb-1.5">
              <span className="inline-flex items-center text-ds-10 leading-tight">
                <span className="invisible w-0">{ZW}</span>
                <Skeleton className="h-2.5 w-20 rounded" style={{ background: "hsl(var(--burnt-sienna) / 0.18)" }} />
              </span>
            </div>
          )}
          <div className={JOB_ROW_BODY}>
            <div className={JOB_CARD_TITLE_ROW}>
              {/* The title's own line box (text-headline-card, leading-tight, display bold). */}
              <span className="text-headline-card flex-1 min-w-0 font-display font-bold leading-tight flex items-center">
                <span className="invisible w-0">{ZW}</span>
                <Skeleton className="h-4 w-[70%] rounded" style={{ background: "hsl(var(--olivewood) / 0.14)" }} />
              </span>
              {/* The price chip's OWN box (MoneyChip: px-2.5 py-1 around a text-ds-17 leading-none figure), holding an
                  invisible figure so it is the chip's height at every text size (Q169). */}
              <span
                className="relative inline-flex shrink-0 self-start items-center justify-center rounded-ds-md px-2.5 py-1 overflow-hidden"
                style={{ background: "hsl(var(--olivewood) / 0.12)", border: "0.5px solid transparent" }}
              >
                <span className="invisible font-sans leading-none tabular-nums text-ds-17">$000</span>
              </span>
            </div>
            {/* The meta block, with the card's own meta row: the same classes and the same break, so index.css's
                rules (Q2222 below 360px, the media column's container query) give it the card's lines. */}
            <div className={JOB_CARD_META}>
              <div className="job-meta-row flex items-center gap-x-2 flex-nowrap max-[359px]:flex-wrap overflow-hidden">
                <span className="flex items-center gap-1">
                  <span className="invisible w-0">{ZW}</span>
                  <Skeleton className="h-3 w-24 rounded" style={{ background: "hsl(var(--olivewood) / 0.10)" }} />
                </span>
                <span aria-hidden data-meta-break className="hidden max-[359px]:block basis-full h-0.5" />
                <span data-meta-dot className="shrink-0 opacity-0 max-[359px]:hidden">·</span>
                <span className="inline-flex shrink-0 items-center gap-1">
                  <span className="invisible w-0">{ZW}</span>
                  <Skeleton className="h-3 w-20 rounded" style={{ background: "hsl(var(--olivewood) / 0.10)" }} />
                </span>
              </div>
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
 * The recommended card is the SAME JobCard with `recommended` set: its row draws the Recommended badge on the line
 * above the title. So it is the same skeleton with that badge line, never a second hand-drawn card.
 */
export function RecommendedJobCardSkeleton() {
  return <JobCardSkeleton badge />;
}
