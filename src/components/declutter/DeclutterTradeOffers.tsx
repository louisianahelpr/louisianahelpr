/**
 * Declutter trades (owner 10-31), slice 3: the trade cards, both sides.
 *  - TradeOffersSection side="seller" (Selling, with the offers to answer): each open trade offer, the buyer's item
 *    offered for the seller's, with Accept / Decline (declutter_respond_swap). Accepting holds both items; each side
 *    then picks up the other's item from the cart, free.
 *  - TradeOffersSection side="buyer" (Buying): each trade offer from the last 7 days and what became of it, with
 *    Take it back while it is open.
 * Nothing is charged on any of these screens: an item-for-item trade moves no money. Before 20261106163703 is on the
 * server the read is empty and nothing shows.
 */
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Link, useSearchParams } from "react-router-dom";
import { toast } from "sonner";
import { ArrowLeftRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { declutterErrorMessage } from "@/lib/declutter/errors";
import { useMyTrades } from "./useMyTrades";
import { itemPriceLabel } from "@/lib/declutter/distance";
import { orderWhen } from "@/lib/declutter/timeLeft";
import { respondSwap, tradeStatusWords, type MyTrade, type SwapAction } from "@/lib/declutter/trades";
import { tradeBucket, underChip } from "@/lib/declutter/buyingBucket";
import type { OrderBucket } from "./OrderSteps";


/** Selling's "To answer" chip counts the open trade offers too (the same read and key the section uses). */
export function useTradeOffersToAnswer(userId: string | null): number {
  return (useMyTrades("seller", userId).data ?? []).filter((t) => t.status === "open").length;
}

/** F360c: the cart checkout holding this trade's item, scrolled to and focused; false when it is not on this page. */
export function goToTradeCheckout(itemId: string | null | undefined): boolean {
  if (!itemId) return false;
  const box = document.querySelector<HTMLElement>(`[data-cart-item="${CSS.escape(itemId)}"]`)?.closest<HTMLElement>("[data-checkout-seller]");
  if (!box) return false;
  box.scrollIntoView?.({ behavior: "smooth", block: "start" });
  box.setAttribute("tabindex", "-1");
  box.focus({ preventScroll: true });
  return true;
}

function Pair({ t }: { t: MyTrade }) {
  const give = t.my_side === "seller" ? t.item : t.offered;
  const get = t.my_side === "seller" ? t.offered : t.item;
  return (
    <ul className="divide-y divide-border text-sm" data-trade-pair="">
      <li className="flex min-h-11 items-center gap-3 py-2">
        <span className="shrink-0 text-muted-foreground">You give</span>
        <span className="min-w-0 flex-1 line-clamp-2 break-words font-semibold">{give?.title ?? "An item"}</span>
        {give && <span className="shrink-0 tabular-nums text-muted-foreground">{itemPriceLabel(give.current_price_cents)}</span>}
      </li>
      <li className="flex min-h-11 items-center gap-3 py-2">
        <span className="shrink-0 text-muted-foreground">You get</span>
        {get ? (
          <Link to={`/declutter/item/${get.id}`} className="min-w-0 flex-1 line-clamp-2 break-words font-semibold underline-offset-2 hover:underline" title={get.title}>{get.title}</Link>
        ) : <span className="min-w-0 flex-1 font-semibold">An item</span>}
        {get && <span className="shrink-0 tabular-nums text-muted-foreground">{itemPriceLabel(get.current_price_cents)}</span>}
      </li>
    </ul>
  );
}

/**
 * Trades audit 11-08 #10: the trade's one order chat, on both trade cards (DeclutterPage opens ?order_talk=, the same
 * chat as the order card's "Message ..." button). No new chat: it is the existing Declutter order chat.
 */
function TradeTalkButton({ orderId }: { orderId: string }) {
  const [params, setParams] = useSearchParams();
  const open = () => {
    const next = new URLSearchParams(params);
    next.set("order_talk", orderId);
    setParams(next);
  };
  return <Button type="button" variant="outline" size="sm" className="rounded-full" data-trade-talk={orderId} onClick={open}>Message about the trade</Button>;
}

function TradeCard({ t }: { t: MyTrade }) {
  const qc = useQueryClient();
  const open = t.status === "open" && new Date(t.respond_by).getTime() > Date.now();
  const act = useMutation({
    mutationFn: (a: SwapAction) => respondSwap(t.id, a),
    onSuccess: (_r, a) => {
      toast(a === "accept" ? "Trade accepted. Choose how you'll pick up their item in your cart within 48 hours."
        : a === "decline" ? "Declined. The buyer is told."
        : "Taken back. The seller won't see it anymore.");
      void qc.invalidateQueries({ queryKey: ["declutter"] });
    },
    onError: (err) => toast.error(declutterErrorMessage(err)),
  });
  return (
    <li data-trade-card={t.id} data-trade-status={t.status} className="space-y-3 rounded-2xl border border-border bg-card p-4">
      <p className="flex items-start gap-2 text-sm">
        <ArrowLeftRight className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden />
        <span>
          <span className="font-semibold">{t.my_side === "seller" ? "Trade offer" : "Your trade offer"}</span>
          {/* Audit 11-10 F401: a sentence with the deadline, not "Answer: 119 hours left" (a label with no value). */}
          {" "}{open ? `${t.my_side === "seller" ? "Answer by" : "Waiting on the seller until"} ${orderWhen(t.respond_by)}. No money changes hands.` : tradeStatusWords(t)}
        </span>
      </p>
      {/* F356 follow-up (owner 11-11): the seller sees who offered the trade, first name + last initial only, no link. */}
      {t.my_side === "seller" && t.buyer_display && <p className="text-ds-13 text-foreground" data-trade-buyer="">From {t.buyer_display}</p>}
      <Pair t={t} />
      {open && t.my_side === "seller" && (
        <div className="flex flex-wrap gap-2">
          {/* F401: Decline is a real outlined button, the same height as Accept, never plain text that looks disabled. */}
          <Button type="button" variant="outline" data-trade-decline="" disabled={act.isPending} onClick={() => act.mutate("decline")}>Decline</Button>
          <Button type="button" className="btn-grad-primary" data-trade-accept="" disabled={act.isPending} onClick={() => act.mutate("accept")}>Accept trade</Button>
        </div>
      )}
      {open && t.my_side === "buyer" && (
        <Button type="button" variant="outline" data-trade-withdraw="" disabled={act.isPending} onClick={() => act.mutate("withdraw")}>Take it back</Button>
      )}
      {/* Only while this member's own $0 line still waits for its pickup choice (checked out: the order card has it). */}
      {/* Audit 11-10 F360c: the accepted trade is also the cart's trade checkout, which holds the one pickup step. This
          link opens that checkout (scrolled to and focused when it is on the page) instead of a second, differently worded
          action that only reloaded the Buying tab. */}
      {t.status === "accepted" && t.my_line_status === "in_cart" && (
        <Link to="/declutter?tab=buying" data-trade-pickup="" className="inline-flex min-h-11 items-center text-ds-14 font-semibold text-[hsl(var(--sage-ink))] underline underline-offset-2"
          onClick={(e) => { if (goToTradeCheckout((t.my_side === "seller" ? t.offered : t.item)?.id)) e.preventDefault(); }}>
          Go to my trade in the cart
        </Link>
      )}
      {t.talk_order_id && <TradeTalkButton orderId={t.talk_order_id} />}
    </li>
  );
}

/**
 * Audit 11-10 F359f: on the owner's own item page, the open trade offers for THIS listing with Accept / Decline (the page
 * said only "Your listing is for sale" while a trade waited). The same read, key and card as Selling's section.
 */
export function ItemTradeOffers({ itemId, userId }: { itemId: string; userId: string }) {
  const rows = (useMyTrades("seller", userId).data ?? []).filter((t) => t.status === "open" && t.item?.id === itemId);
  if (!rows.length) return null;
  return (
    <section className="space-y-2" aria-label="Trade offers" data-item-trade-offers={itemId}>
      <ul className="space-y-3">{rows.map((t) => <TradeCard key={t.id} t={t} />)}</ul>
    </section>
  );
}

/** Selling: open trade offers to answer and accepted ones. Buying: each trade offer from the last 7 days. */
/** only (audit 11-10 F374, Buying's chips): just the trades that chip files (tradeBucket); nothing at all when none. */
export function TradeOffersSection({ side, userId, only = null }: { side: "buyer" | "seller"; userId: string | null; only?: OrderBucket | null }) {
  const q = useMyTrades(side, userId);
  const rows = underChip(q.data ?? [], only, (t) => tradeBucket(t, side));
  // A failed read says nothing here: the offers and orders around it are what the tab is for.
  if (!rows.length) return null;
  const title = side === "seller" ? "Trade offers" : "Your trade offers";
  return (
    <section className="space-y-2" aria-label={title} data-trade-offers={side}>
      <h2 className="text-base font-semibold">{title}</h2>
      <ul className="space-y-3">{rows.map((t) => <TradeCard key={t.id} t={t} />)}</ul>
    </section>
  );
}
