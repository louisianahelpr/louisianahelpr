/**
 * The seller's accepted sales waiting for the buyer to pay, with the way out (row 19). Moved out of
 * DeclutterTradeViews.tsx (componentSizeRatchet holds that file at 600 lines) when "Cancel sale" moved from
 * window.confirm to the in-app sheet (lead 2026-10-28, DeclutterConfirmSheet).
 * DA-3 (audit 2026-10-30): a FREE item claimed by someone is not a sale and nobody pays, so its giver read
 * "Sold, waiting for the buyer to pay" and "Cancel sale" about a give-away. Free lines now list apart, in give-away
 * words ("Claimed, they're choosing a pickup", "Cancel claim"); paid lines keep the sale words.
 */
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ErrorState } from "@/components/ui/ErrorState";
import { fetchMyCart, sellerCancelSale, type CartLine } from "@/lib/declutter/api";
import { declutterErrorMessage } from "@/lib/declutter/errors";
import { itemPriceLabel } from "@/lib/declutter/distance";
import { timeLeft } from "@/lib/declutter/timeLeft";
import { ConfirmSheet } from "./DeclutterConfirmSheet";
import { SellerTalks } from "./DeclutterHandoverTalk";

/** The words for one kind of waiting line: a paid sale, or a free item someone claimed. */
const WORDS = {
  paid: {
    heading: "Sold, waiting for the buyer to pay",
    line: "Waiting for the buyer to pay",
    cancel: "Cancel sale",
    sheetTitle: "Cancel this sale?",
    keep: "Keep the sale",
    told: "the buyer is told",
    done: "Sale cancelled.",
  },
  free: {
    heading: "Claimed, they're choosing a pickup",
    line: "They're choosing how to pick it up",
    cancel: "Cancel claim",
    sheetTitle: "Cancel this claim?",
    keep: "Keep the claim",
    told: "the person who claimed it is told",
    done: "Claim cancelled.",
  },
} as const;
type Kind = keyof typeof WORDS;

/**
 * The Selling tab's chip for these lines (DA-3): "To be paid" over a free claim told a giver they would be paid.
 * Only free claims waiting: "Claimed"; only paid sales: "To be paid"; both: "Waiting". The same read (and key) as
 * SalesWaiting, so it adds no request.
 */
export function useWaitingChipLabel(): string {
  const cart = useQuery({ queryKey: ["declutter", "my-cart"], queryFn: fetchMyCart });
  const waiting = (cart.data ?? []).filter((l) => l.my_side === "seller" && l.status === "in_cart");
  const free = waiting.filter((l) => l.price_cents === 0).length;
  if (free === 0) return "To be paid";
  return free === waiting.length ? "Claimed" : "Waiting";
}

export function SalesWaiting() {
  const qc = useQueryClient();
  const cart = useQuery({ queryKey: ["declutter", "my-cart"], queryFn: fetchMyCart });
  const [asking, setAsking] = useState<{ itemId: string; kind: Kind } | null>(null);
  const cancel = useMutation({
    mutationFn: ({ itemId }: { itemId: string; kind: Kind }) => sellerCancelSale(itemId),
    onSettled: () => setAsking(null),
    onSuccess: (n, { kind }) => {
      toast.success(`${WORDS[kind].done} You have ${Math.min(n, 3)} of 3 strikes.`);
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
  const groups: [Kind, CartLine[]][] = [
    ["paid", waiting.filter((l) => l.price_cents !== 0)],
    ["free", waiting.filter((l) => l.price_cents === 0)],
  ];
  const w = asking ? WORDS[asking.kind] : WORDS.paid;
  return (
    <div className="space-y-6">
      {/* Q2462: a buyer who can use none of the ways offered opened a chat to agree one. */}
      <SellerTalks />
      {groups.map(([kind, lines]) => lines.length > 0 && (
        <section key={kind} className="space-y-2" aria-label={WORDS[kind].heading} data-waiting-kind={kind}>
          <h2 className="text-base font-semibold">{WORDS[kind].heading}</h2>
          <ul className="space-y-3">
            {lines.map((l) => (
              <li key={l.line_id} className="rounded-2xl border border-border bg-card p-4 space-y-2">
                <p className="font-semibold">{l.item_title} · {itemPriceLabel(l.price_cents)}</p>
                <p className="text-sm text-muted-foreground">{WORDS[kind].line} · {timeLeft(l.checkout_by)}</p>
                <button
                  type="button"
                  className="min-h-11 rounded-full border border-border px-4 py-2 text-sm font-semibold"
                  disabled={cancel.isPending || !l.item_id}
                  onClick={() => l.item_id && setAsking({ itemId: l.item_id, kind })}
                >
                  {WORDS[kind].cancel}
                </button>
              </li>
            ))}
          </ul>
        </section>
      ))}
      <ConfirmSheet open={asking !== null} title={w.sheetTitle} confirmLabel={w.cancel} cancelLabel={w.keep} pending={cancel.isPending}
        onConfirm={() => { if (asking) cancel.mutate(asking); }} onClose={() => setAsking(null)} testId="cancel-sale">
        {/* Audit 1028 part 2, D2-10: the cancel also takes the listing down (declutter_seller_cancel_sale: withdrawn,
            and it gives the seller a strike for a free claim too). */}
        You'll get a Declutter strike, and {w.told}. Your listing comes down too; relist it from History. 3 strikes pause Declutter for you.
      </ConfirmSheet>
    </div>
  );
}
