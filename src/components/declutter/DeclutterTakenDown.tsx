/**
 * Taken-down listings (owner 2026-10-28, walkthrough shots 48-49; deep audit SE-1): a listing the seller took down
 * stays in their history under "Taken down" with a way back. Relist puts it back to a draft
 * (declutter_reopen_listing, 20261028180400; its words and prices kept, its photos were deleted at take-down) and
 * opens the sell flow on it, where every listing rule runs again at publish.
 */
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { PhotoPlaceholder } from "@/components/ui/PhotoPlaceholder";
import { categoryIcon } from "@/lib/declutter/categoryIcons";
import { reopenListing, type CartLine, type DeclutterItem } from "@/lib/declutter/api";
import { declutterErrorMessage } from "@/lib/declutter/errors";
import { itemPriceLabel } from "@/lib/declutter/distance";
import { SectionHeading } from "./DeclutterTabParts";
import { EndedSaleRows } from "./DeclutterEndedSales";

/** Relist a taken-down listing: back to a draft, then the sell flow on it (photos first: they were deleted). */
function useReopenListing() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  return useMutation({
    mutationFn: (itemId: string) => reopenListing(itemId).then(() => itemId),
    onSuccess: (itemId) => {
      toast("Back in your listings. Add photos and put it up again.");
      void qc.invalidateQueries({ queryKey: ["declutter"] });
      navigate(`/declutter/sell?item=${itemId}`);
    },
    onError: (err) => toast.error(declutterErrorMessage(err)),
  });
}

export function ReopenListingButton({ itemId }: { itemId: string }) {
  const reopen = useReopenListing();
  return (
    <Button type="button" size="sm" disabled={reopen.isPending} onClick={() => reopen.mutate(itemId)}>
      {reopen.isPending ? "Relisting…" : "Relist"}
    </Button>
  );
}

/**
 * The Selling tab's history: every listing taken down (withdrawn, with Relist) or marked sold elsewhere (A2-5,
 * 'sold_elsewhere': kept as a record, no Relist), newest first; then (A2-20) the sales that ended without a
 * handover, from the last 30 days (DeclutterEndedSales).
 */
export function TakenDownSection({ items, ended = [] }: { items: DeclutterItem[]; ended?: CartLine[] }) {
  if (items.length === 0 && ended.length === 0) return null;
  return (
    <section className="space-y-2" aria-label="Selling history" data-taken-down="">
      <SectionHeading title="Selling history" />
      <ul className="divide-y divide-border overflow-hidden rounded-[20px] border border-border bg-card">
        {items.map((item) => (
          <li key={item.id} className="flex flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center" data-taken-down-row="">
            <div className="flex min-w-0 flex-1 items-center gap-3">
              {/* Its photos were deleted at take-down: the category icon stands in. */}
              <PhotoPlaceholder icon={categoryIcon(item.category)} seed={item.category} className="h-16 w-16 shrink-0 rounded-2xl" iconClassName="h-6 w-6" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-ds-15 font-semibold text-muted-foreground" title={item.title}>{item.title}</p>
                <p className="line-clamp-2 text-ds-13 text-muted-foreground">
                  {item.status === "sold_elsewhere" ? "Sold elsewhere." : "Taken down. Buyers can't see it."}
                </p>
              </div>
              <span className="shrink-0 text-ds-15 font-bold tabular-nums text-muted-foreground">{itemPriceLabel(item.current_price_cents)}</span>
            </div>
            {item.status === "withdrawn" && (
              <div className="flex sm:shrink-0 sm:justify-end">
                <ReopenListingButton itemId={item.id} />
              </div>
            )}
          </li>
        ))}
        <EndedSaleRows lines={ended} />
      </ul>
    </section>
  );
}
