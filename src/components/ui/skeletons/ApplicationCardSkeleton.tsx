import { Skeleton } from "@/components/ui/skeleton";
import {
  JOB_CARD_SHELL_FRAME,
  JOB_CARD_SHELL_RAIL,
  JOB_CARD_SHELL_TAB_SLOT,
  JOB_CARD_TITLE_PAD_WITH_TAB,
} from "@/components/activity/JobCardShell";
import { JOB_CATEGORY_TAB_FRAME } from "@/components/job/cardGeometry";

/**
 * ApplicationCardSkeleton — the placeholder for the helper-side application
 * card (`src/components/activity/AppliedJobCard.tsx`).
 *
 * It does not re-draw that card's frame; it IMPORTS it. Frame, category rail,
 * category-tab slot and the title row's tab clearance all come from
 * `JobCardShell`'s own exported geometry, so the reserved space is the real
 * space by construction and neither side can move without the other. Same
 * contract `MessageThreadSkeleton` has with `ConversationRow` and
 * `JobCardSkeleton` has with `cardGeometry`.
 *
 * Owner, 2026-09-19: loading states "jump and are not consistent with their
 * info". This one omitted two things every real applied card leads with:
 *
 *   - THE CATEGORY RAIL, the 6px colour stripe down the left edge. Absent
 *     here, so the bone was a plain card and the real card arrived wearing a
 *     coloured edge.
 *   - THE CATEGORY TAB, which overlays the card's top-left corner. That is
 *     not decoration either: JobCardTitleBar switches from `py-2.5` to
 *     `pt-6 pb-2.5` whenever a category is present, precisely to clear it.
 *     Omitting the tab made the placeholder a title-bar's worth of padding
 *     too short on every row, which is the size half of the report.
 *
 * The bones inside stay deliberately fewer than the card's parts. A
 * placeholder holds the shape and gets out of the way: a title bar, a payout
 * chip, a meta row, two description lines, an attribution line and one
 * action bar. Nothing stands in for the Accept/Decline pair or the tracker
 * panel — both conditional on the real card's state, and drawing them would
 * be inventing content. What has to match is the RESERVATION.
 */
export function ApplicationCardSkeleton() {
  return (
    <div className={JOB_CARD_SHELL_FRAME} aria-hidden>
      {/* Category rail — neutral olivewood while loading; the real card
          recolours it per category. */}
      <span
        className={JOB_CARD_SHELL_RAIL}
        style={{ background: "hsl(var(--olivewood) / 0.18)" }}
      />
      {/* Category tab, in the real tab's own box, so the ~20px it occupies is
          reserved rather than guessed. */}
      <div className={JOB_CARD_SHELL_TAB_SLOT}>
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

      {/* Title row — the card's own padding, tab clearance included. */}
      <div
        className={`${JOB_CARD_TITLE_PAD_WITH_TAB} flex items-center justify-between`}
        style={{ borderBottom: "0.5px solid hsl(var(--olivewood) / 0.10)" }}
      >
        <Skeleton
          className="h-4 w-[55%] rounded"
          style={{ background: "hsl(var(--olivewood) / 0.14)" }}
        />
        <Skeleton
          className="h-5 w-16 rounded-full shrink-0 ml-3"
          style={{ background: "hsl(var(--burnt-sienna) / 0.12)" }}
        />
      </div>

      {/* Summary block — date/location meta row + description preview +
          poster attribution. */}
      <div className="px-4 py-3 space-y-2.5">
        <div className="flex items-center gap-2.5">
          <Skeleton
            className="h-3 w-28 rounded"
            style={{ background: "hsl(var(--olivewood) / 0.12)" }}
          />
          <Skeleton
            className="h-3 w-24 rounded"
            style={{ background: "hsl(var(--olivewood) / 0.12)" }}
          />
        </div>
        <Skeleton
          className="h-3 w-[90%] rounded"
          style={{ background: "hsl(var(--olivewood) / 0.10)" }}
        />
        <Skeleton
          className="h-3 w-[60%] rounded"
          style={{ background: "hsl(var(--olivewood) / 0.10)" }}
        />
        <Skeleton
          className="h-3 w-32 rounded"
          style={{ background: "hsl(var(--olivewood) / 0.10)" }}
        />
      </div>

      {/* Action footer — single full-width button placeholder. */}
      <div
        className="px-4 py-3"
        style={{ borderTop: "0.5px solid hsl(var(--olivewood) / 0.10)" }}
      >
        <Skeleton
          className="h-9 w-full rounded-ds-md"
          style={{ background: "hsl(var(--olivewood) / 0.12)" }}
        />
      </div>
    </div>
  );
}
