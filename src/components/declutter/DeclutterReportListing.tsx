/**
 * "Report this listing" on a Declutter item page (item B, owner 2026-10-29: listings go live when posted, and a
 * report is how one reaches an admin). Opens the shared ReportDialog with the listing type; the report lands in the
 * admin reports queue, where an admin can take the listing down (declutter_admin_take_down_item).
 */
import { lazy, Suspense, useState } from "react";
import { Flag } from "lucide-react";

const ReportDialog = lazy(() => import("@/components/ReportDialog"));

export function DeclutterReportListing({ itemId }: { itemId: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="flex justify-center pt-2" data-report-listing="">
      <button
        type="button"
        className="inline-flex min-h-11 items-center gap-2 rounded-full border border-border px-4 text-ds-14 font-medium text-muted-foreground"
        onClick={() => setOpen(true)}
      >
        <Flag className="h-4 w-4" aria-hidden />
        Report this listing
      </button>
      {open && (
        <Suspense fallback={null}>
          <ReportDialog open={open} onClose={() => setOpen(false)} reportedType="declutter_item" reportedId={itemId} />
        </Suspense>
      )}
    </div>
  );
}
