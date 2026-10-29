/**
 * The seller's accepted sales waiting for the buyer to pay, with the way out (row 19). Moved out of
 * DeclutterTradeViews.tsx (componentSizeRatchet holds that file at 600 lines) when "Cancel sale" moved from
 * window.confirm to the in-app sheet (lead 2026-10-28, DeclutterConfirmSheet).
 */
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ErrorState } from "@/components/ui/ErrorState";
import { fetchMyCart, sellerCancelSale } from "@/lib/declutter/api";
import { declutterErrorMessage } from "@/lib/declutter/errors";
import { itemPriceLabel } from "@/lib/declutter/distance";
import { timeLeft } from "@/lib/declutter/timeLeft";
import { ConfirmSheet } from "./DeclutterConfirmSheet";
import { SellerTalks } from "./DeclutterHandoverTalk";

export function SalesWaiting() {
  const qc = useQueryClient();
  const cart = useQuery({ queryKey: ["declutter", "my-cart"], queryFn: fetchMyCart });
  const [asking, setAsking] = useState<string | null>(null);
  const cancel = useMutation({
    mutationFn: (itemId: string) => sellerCancelSale(itemId),
    onSettled: () => setAsking(null),
    onSuccess: (n) => {
      toast.success(`Sale cancelled. You have ${Math.min(n, 3)} of 3 strikes.`);
      // The same as DeclutterTradeViews' invalidateTrades (not imported: that file imports this one).
      void qc.invalidateQueries({ queryKey: ["declutter"] });
    },
    onError: (err) => toast.error(declutterErrorMessage(err)),
  });
  // Paid sales are handled by PaidOrders side="seller" (slice 4), below this on the Selling tab.
  const waiting = (cart.data ?? []).filter((l) => l.my_side === "seller" && l.status === "in_cart");
  if (cart.isError) {
    return <ErrorState variant="inline" title="We couldn't load your sales." body={declutterErrorMessage(cart.error)} onRetry={() => void cart.refetch()} />;
  }
  if (waiting.length === 0) return null;
  return (
    <section className="space-y-2" aria-label="Sold, waiting for the buyer to pay">
      <h2 className="text-base font-semibold">Sold, waiting for the buyer to pay</h2>
      {/* Q2462: a buyer who can use none of the ways offered opened a chat to agree one. */}
      <SellerTalks />
      <ul className="space-y-3">
        {waiting.map((l) => (
          <li key={l.line_id} className="rounded-2xl border border-border bg-card p-4 space-y-2">
            <p className="font-semibold">{l.item_title} · {itemPriceLabel(l.price_cents)}</p>
            <p className="text-sm text-muted-foreground">Waiting for the buyer to pay · {timeLeft(l.checkout_by)}</p>
            <button
              type="button"
              className="min-h-11 rounded-full border border-border px-4 py-2 text-sm font-semibold"
              disabled={cancel.isPending || !l.item_id}
              onClick={() => setAsking(l.item_id)}
            >
              Cancel sale
            </button>
          </li>
        ))}
      </ul>
      <ConfirmSheet open={asking !== null} title="Cancel this sale?" confirmLabel="Cancel sale" cancelLabel="Keep the sale" pending={cancel.isPending}
        onConfirm={() => { if (asking) cancel.mutate(asking); }} onClose={() => setAsking(null)} testId="cancel-sale">
        {/* Audit 1028 part 2, D2-10: the cancel also takes the listing down (declutter_seller_cancel_sale: withdrawn). */}
        You'll get a Declutter strike, and the buyer is told. Your listing comes down too; relist it from History. 3 strikes pause Declutter for you.
      </ConfirmSheet>
    </section>
  );
}
