/**
 * "Report this shop" and an item's "Report" (Shops H2, audit 11-05). Owner rule (10-29, 10-31): shops and items go
 * live at once and admin acts only on a report or a failed automatic check, so a report is how one reaches an admin.
 * Opens the shared ReportDialog with the shop / shop_item type; the report lands in the admin reports queue, where an
 * admin can hide the shop (shops_admin_set_hidden) or take the item down (shops_admin_take_down_item). The database
 * refuses a report of your own shop or of one a member can't be shown (report_message_party_and_copy,
 * 20261105182210), so the owner never gets these buttons either.
 */
import { lazy, Suspense, useState } from "react";
import { Link } from "react-router-dom";
import { Flag } from "lucide-react";
import { Button } from "@/components/ui/button";

const ReportDialog = lazy(() => import("@/components/ReportDialog"));

/** The button under a shop's page. Signed out, it asks the visitor to sign in and brings them back. */
export function ShopReportShop({ shopId, signedIn = true }: { shopId: string; signedIn?: boolean }) {
  const [open, setOpen] = useState(false);
  if (!signedIn) {
    const back = encodeURIComponent(`/shops/${shopId}`);
    return (
      <p className="pt-2 text-center text-sm text-muted-foreground" data-report-shop="">
        Something wrong with this shop?{" "}
        <Link className="link-standard inline-flex min-h-11 items-center px-1 font-semibold" to={`/login?redirect=${back}`}>Sign in to report it</Link>
      </p>
    );
  }
  return (
    <div className="flex justify-center pt-2" data-report-shop="">
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="border border-border font-medium tracking-normal text-muted-foreground [&_svg]:size-4"
        onClick={() => setOpen(true)}
      >
        <Flag className="h-4 w-4" aria-hidden />
        Report this shop
      </Button>
      {open && (
        <Suspense fallback={null}>
          <ReportDialog open={open} onClose={() => setOpen(false)} reportedType="shop" reportedId={shopId} />
        </Suspense>
      )}
    </div>
  );
}

/** A small "Report" under one item's card. */
export function ShopReportItem({ itemId, title }: { itemId: string; title: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="gap-1 px-1 text-ds-11 font-normal tracking-normal text-muted-foreground [&_svg]:size-3"
        aria-label={`Report ${title}`}
        data-report-item=""
        onClick={() => setOpen(true)}
      >
        <Flag className="h-3 w-3" aria-hidden />
        Report
      </Button>
      {open && (
        <Suspense fallback={null}>
          <ReportDialog open={open} onClose={() => setOpen(false)} reportedType="shop_item" reportedId={itemId} />
        </Suspense>
      )}
    </>
  );
}
