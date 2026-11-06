/**
 * "Report this listing" on a Homes listing page (audit 11-05 A-H2, the rest of docs/NOT-LAUNCHED.md Q2187). Owner
 * rule (10-29, 10-31): listings go live at once, and an admin acts only on a report or a failed automatic check, so a
 * report is how a bad listing reaches an admin. It opens the shared ReportDialog with reported_type 'home_listing'.
 * The report lands in the admin reports queue, where an admin can take the listing down (rentals_admin_remove_listing).
 * The database refuses a report of your own listing, or of one a member can't be shown
 * (report_message_party_and_copy, 20261106165850), so the page never offers the button to the owner.
 */
import { lazy, Suspense, useState } from "react";
import { Flag } from "lucide-react";
import { Button } from "@/components/ui/button";

const ReportDialog = lazy(() => import("@/components/ReportDialog"));

export function HomeListingReport({ listingId }: { listingId: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="flex justify-center pt-2" data-report-home-listing="">
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
          <ReportDialog open={open} onClose={() => setOpen(false)} reportedType="home_listing" reportedId={listingId} />
        </Suspense>
      )}
    </div>
  );
}
