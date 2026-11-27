import { Sheet, SheetContent, SheetHero } from "@/components/ui/sheet";
import type { ApplyConfirmDialogProps } from "@/components/dashboard/applyConfirmDialog/types";
import { ApplyBody } from "@/components/dashboard/applyConfirmDialog/ApplyBody";

/**
 * ApplyConfirmDialog — the STANDALONE apply surface, for the QuickApply deep
 * link (`?apply=<jobId>`), where there is no job-detail sheet to step out of.
 *
 * The normal route no longer uses this at all. Applying from the feed happens
 * on the job-detail sheet itself (JobDetailDialog's `applyForm`) — one sheet,
 * one CTA, no step change.
 *
 * Why this stopped being an AlertDialog (owner, 2026-08-28: "I don't like how
 * one opens at the bottom then the next is in the middle"): the job-detail
 * sheet rises from the bottom edge, and this — a centred AlertDialog — faded
 * in at the middle of the viewport after the sheet had already dropped away.
 * Three motions, two anchors, for what is one continuous act. It is a bottom
 * sheet now, so even on the deep-link path the apply surface arrives from the
 * same edge every other job surface in the app uses.
 */
export function ApplyConfirmDialog(props: ApplyConfirmDialogProps) {
  const { open, onClose, applyLoading } = props;

  return (
    <Sheet
      open={open}
      onOpenChange={(o) => {
        // No dismissing mid-submit — the guard the old footer Cancel carried
        // travels with it.
        if (!o && !applyLoading) onClose();
      }}
    >
      <SheetContent
        side="bottom"
        className="grid grid-rows-[auto_minmax(0,1fr)] max-h-[92dvh] p-0"
        // Board 58 (lead): initial focus goes to the sheet, not the fee breakdown's disclosure (a heavy ring at open).
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          (event.currentTarget as HTMLElement | null)?.focus({ preventScroll: true });
        }}
      >
        <div className="px-5 pt-5">
          <SheetHero title="Apply for this job" />
          {/* The `eyebrow` here never rendered either, and unlike the
              subtitles it is NOT relocated: eyebrows were deleted globally
              (owner, 2026-09-02) and are not coming back. It said
              "You're applying" / "You're booking" above a title that already
              says which. */}
        </div>
        {/* `min-w-0` is structural, not decoration. SheetContent is a grid, so
            this body is a grid item whose default `min-width:auto` makes the
            column's minimum equal the item's content-based minimum — one wide
            child (a long unbroken title, a pasted URL in the pitch) would then
            stretch every row past the sheet's right edge. That exact failure
            is what e2e/journeys/apply-sheet.spec.ts guards. Do not remove it. */}
        <div className="min-w-0 overflow-y-auto overflow-x-hidden overscroll-contain px-5 pb-5 pt-3 space-y-3.5">
          {/* Polish audit 11-27 #45: no card repeating the job's title and details here (the job page is right behind
              the sheet, and it was a card over the money box). Guard: src/test/applySheetFlat1127.test.tsx. */}
          <ApplyBody {...props} />
        </div>
      </SheetContent>
    </Sheet>
  );
}
