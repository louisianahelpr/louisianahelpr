import { Sheet, SheetContent, SheetHero } from "@/components/ui/sheet";
import type { ApplyConfirmDialogProps } from "@/components/dashboard/applyConfirmDialog/types";
import { ApplyBody } from "@/components/dashboard/applyConfirmDialog/ApplyBody";

/**
 * ApplyConfirmDialog — the STANDALONE apply surface, for the QuickApply deep
 * link (`?apply=<jobId>`), where there is no job-detail sheet to step out of.
 *
 * The normal route no longer uses this at all. Applying from the feed now
 * happens as the second step of the job-detail sheet itself
 * (JobDetailDialog's `applyStep`), so the two surfaces are one.
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
  const { open, onClose, confirmApplyJob, applyLoading } = props;
  const isInstantBook = !!(confirmApplyJob as any)?.instant_book;

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
      >
        <div className="px-5 pt-5">
          <SheetHero
            eyebrow={isInstantBook ? "You're booking" : "You're applying"}
            title={confirmApplyJob ? confirmApplyJob.title : isInstantBook ? "Book This Job" : "Apply for This Job"}
          />
        </div>
        {/* `min-w-0` is structural, not decoration. SheetContent is a grid, so
            this body is a grid item whose default `min-width:auto` makes the
            column's minimum equal the item's content-based minimum — one wide
            child (a long unbroken title, a pasted URL in the pitch) would then
            stretch every row past the sheet's right edge. That exact failure
            is what apply-dialog-fit.spec.ts guards. Do not remove it. */}
        <div className="min-w-0 overflow-y-auto overflow-x-hidden overscroll-contain px-5 pb-5 pt-3">
          <ApplyBody {...props} />
        </div>
      </SheetContent>
    </Sheet>
  );
}
