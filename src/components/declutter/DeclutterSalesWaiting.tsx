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
import { Button } from "@/components/ui/button";
import { ErrorState } from "@/components/ui/ErrorState";
import { fetchMyCart, sellerCancelSale, type CartLine } from "@/lib/declutter/api";
import { declutterErrorMessage } from "@/lib/declutter/errors";
import { itemPriceLabel } from "@/lib/declutter/distance";
import { byClock, timeLeft } from "@/lib/declutter/timeLeft";
import { NextStep } from "@/components/ui/NextStep";
import { ConfirmSheet } from "./DeclutterConfirmSheet";
import { SellerTalks } from "./DeclutterHandoverTalk";
import { DeclutterEmptyCard } from "./DeclutterEmptyCard";
import { HandCoins } from "lucide-react";
import { t, useLanguage } from "@/lib/i18n/language";
import type { MsgKey } from "@/lib/i18n/en";
import "@/lib/i18n/enDeclSell";

type Kind = "paid" | "free" | "swap";
const FIELDS = ["heading", "line", "cancel", "sheetTitle", "keep", "done", "body"] as const;
/**
 * The words for one kind of waiting line: a paid sale, a free item someone claimed, or a trade (area 06b H1: in the
 * member's language, enDeclSell dsl.sw.*). Owner 2026-10-30 (B100, 20261030132149): no strike for cancelling a free
 * claim. Trades audit 11-08 #2/#5: backing out ends the whole trade at once on the server (declutter_end_swap), no strike.
 */
function wordsFor(): Record<Kind, Record<(typeof FIELDS)[number], string>> {
  const one = (k: Kind) => Object.fromEntries(FIELDS.map((f) => [f, t(`dsl.sw.${k}.${f}` as MsgKey)])) as Record<(typeof FIELDS)[number], string>;
  return { paid: one("paid"), free: one("free"), swap: one("swap") };
}

/**
 * The Selling tab's chip for these lines (DA-3): "To be paid" over a free claim told a giver they would be paid.
 * Only free claims waiting: "Claimed"; only paid sales: "To be paid"; both: "Waiting". The same read (and key) as
 * SalesWaiting, so it adds no request.
 */
export function useWaitingChipLabel(): string {
  const cart = useQuery({ queryKey: ["declutter", "my-cart"], queryFn: fetchMyCart });
  const waiting = (cart.data ?? []).filter((l) => l.my_side === "seller" && l.status === "in_cart");
  const free = waiting.filter((l) => l.price_cents === 0 && l.source !== "swap").length;
  const swaps = waiting.filter((l) => l.source === "swap").length;
  if (swaps === waiting.length && swaps > 0) return t("dsl.sw.traded");
  if (free === 0 && swaps === 0) return t("dsl.sw.toBePaid");
  return free === waiting.length ? t("dsl.sw.claimed") : t("dsl.sw.waiting");
}

/** `emptyNotice`: on the seller's own chip (NIGHT-SELL-Sellinglist-3: an empty "To be paid" chip was a blank page). */
export function SalesWaiting({ emptyNotice = false }: { emptyNotice?: boolean } = {}) {
  const qc = useQueryClient();
  useLanguage();
  const WORDS = wordsFor();
  const cart = useQuery({ queryKey: ["declutter", "my-cart"], queryFn: fetchMyCart });
  const [asking, setAsking] = useState<{ itemId: string; kind: Kind } | null>(null);
  const cancel = useMutation({
    mutationFn: ({ itemId }: { itemId: string; kind: Kind }) => sellerCancelSale(itemId),
    onSettled: () => setAsking(null),
    onSuccess: (n, { kind }) => {
      // A free claim gives no strike (20261030132149), so its toast names no strike count.
      toast(kind === "paid" ? `${WORDS[kind].done} ${t("dsl.sw.strikesNow", { n: Math.min(n, 3) })}` : WORDS[kind].done);
      // The same as DeclutterTradeViews' invalidateTrades (not imported: that file imports this one).
      void qc.invalidateQueries({ queryKey: ["declutter"] });
    },
    onError: (err) => toast.error(declutterErrorMessage(err)),
  });
  // Paid sales are handled by PaidOrders side="seller" (slice 4), below this on the Selling tab.
  const waiting = (cart.data ?? []).filter((l) => l.my_side === "seller" && l.status === "in_cart");
  if (cart.isError) {
    return <ErrorState variant="inline" title={t("dsl.sw.loadError")} body={declutterErrorMessage(cart.error)} onRetry={() => void cart.refetch()} />;
  }
  if (waiting.length === 0) return emptyNotice && cart.isSuccess
    // Area 06 M15 (design audit 11-18): the same iconed empty card as every other Selling list.
    ? <DeclutterEmptyCard icon={HandCoins} title={t("dsl.sw.emptyWaiting")} data-seller-empty="">{null}</DeclutterEmptyCard> : null;
  const groups: [Kind, CartLine[]][] = [
    ["paid", waiting.filter((l) => l.price_cents !== 0)],
    ["swap", waiting.filter((l) => l.source === "swap")],
    ["free", waiting.filter((l) => l.price_cents === 0 && l.source !== "swap")],
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
                <p className="font-semibold">{l.item_title}{kind === "swap" ? " · Trade" : ` · ${itemPriceLabel(l.price_cents)}`}</p>
                {/* A3-24 (audit 11-01): the shared next-step line with the hold's end ("by 7:45 PM": 30 minutes for Buy
                    now, 24 hours after an accepted offer, the line's checkout_by); the button below is the way out. */}
                <NextStep className="!text-sm" value={{ who: "them", text: WORDS[kind].line, by: kind === "paid" ? byClock(l.checkout_by) : timeLeft(l.checkout_by) }} />
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="border border-border py-2 text-sm font-semibold tracking-normal disabled:opacity-100"
                  disabled={cancel.isPending || !l.item_id}
                  onClick={() => l.item_id && setAsking({ itemId: l.item_id, kind })}
                >
                  {WORDS[kind].cancel}
                </Button>
              </li>
            ))}
          </ul>
        </section>
      ))}
      <ConfirmSheet open={asking !== null} title={w.sheetTitle} confirmLabel={w.cancel} cancelLabel={w.keep} pending={cancel.isPending} destructive
        onConfirm={() => { if (asking) cancel.mutate(asking); }} onClose={() => setAsking(null)} testId="cancel-sale">
        {/* Audit 1028 part 2, D2-10: a paid cancel also takes the listing down (declutter_seller_cancel_sale: withdrawn,
            with a strike). B100: a free claim cancel gives no strike and puts the item back up. */}
        {w.body}
      </ConfirmSheet>
    </div>
  );
}
