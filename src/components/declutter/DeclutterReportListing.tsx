/**
 * "Report this listing" on a Declutter item page (item B, owner 2026-10-29: listings go live when posted, and a
 * report is how one reaches an admin). Opens the shared ReportDialog with the listing type; the report lands in the
 * admin reports queue, where an admin can take the listing down (declutter_admin_take_down_item).
 */
import { Button } from "@/components/ui/button";
import { lazy, Suspense, useState } from "react";
import { Flag } from "lucide-react";

const ReportDialog = lazy(() => import("@/components/ReportDialog"));

export function DeclutterReportListing({ itemId }: { itemId: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="flex justify-center pt-2" data-report-listing="">
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="border border-border font-medium tracking-normal text-muted-foreground [&_svg]:size-4"
        onClick={() => setOpen(true)}
      >
        <Flag className="h-4 w-4" aria-hidden />
        Report this listing
      </Button>
      {open && (
        <Suspense fallback={null}>
          <ReportDialog open={open} onClose={() => setOpen(false)} reportedType="declutter_item" reportedId={itemId} />
        </Suspense>
      )}
    </div>
  );
}
