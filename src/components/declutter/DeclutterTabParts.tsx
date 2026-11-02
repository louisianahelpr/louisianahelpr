/**
 * The Buying / Selling tab pieces shared by DeclutterTradeViews and
 * DeclutterHomeView (owner, 2026-10-18; src/lib/declutter/tabs.ts): the to-do
 * counts behind the tab badges, a section heading with its count, and the paid
 * orders on one side. Split out of DeclutterTradeViews to keep it under the
 * component size threshold; DeclutterTradeViews re-exports all three.
 */
import { useState, type ReactNode } from "react";
import { useSellerReportsToAnswer } from "./useSellerReportsToAnswer";
import { useQuery } from "@tanstack/react-query";
import { HandCoins, PackageCheck, type LucideIcon } from "lucide-react";
import { fetchMyCart } from "@/lib/declutter/api";
import { declutterTodo } from "@/lib/declutter/tabs";
import { SectionHeading } from "./DeclutterTabHeads";
import { PaidOrdersSection } from "./DeclutterHandoverViews";
import type { BuyerOrderView } from "./BuyingOrders";
import { useLinkedOrder } from "./useLinkedOrder";
import { DeclutterEmptyCard } from "./DeclutterEmptyCard";

// useDeclutterTodo and SectionHeading live in the leaf DeclutterTabHeads (the /declutter first screen loads them without
// this module's order views); re-exported so every import of them from here still works.
export { SectionHeading, useDeclutterTodo } from "./DeclutterTabHeads";

/** A Selling list with nothing in it yet: the shared Declutter empty card (DeclutterEmptyCard). */
function SellerEmpty({ icon, title, children }: { icon: LucideIcon; title: string; children: ReactNode }) {
  return <DeclutterEmptyCard icon={icon} title={title} data-seller-empty="">{children}</DeclutterEmptyCard>;
}

/** "Offers on your items" with none yet (OffersSection side="seller"), from the real offer rules (half the price, 48 hours). */
export function NoSellerOffers() {
  return (
    <SellerEmpty icon={HandCoins} title="No offers yet">
      Buyers can offer from half your price. You have 48 hours to answer each one.
    </SellerEmpty>
  );
}

/**
 * Paid orders on one side (slice 4: book the pickup, hand over, porch photos,
 * no-shows, problems, payout, reviews): Purchases on Buying, the paid sales on Selling.
 */
export function PaidOrders({ side, views, show, scope, ended = false }: {
  side: "buyer" | "seller"; views?: Map<string, BuyerOrderView>; show?: (orderId: string) => boolean;
  /** Q2630: the only orders this list may draw, before the chip and the linked order (Buying's Your orders vs Ended). */
  scope?: (orderId: string) => boolean;
  /** Q2630: drawn inside Buying's Ended section, under its heading: no heading or empty card of its own. */
  ended?: boolean;
}) {
  const cart = useQuery({ queryKey: ["declutter", "my-cart"], queryFn: fetchMyCart });
  const lines = (cart.data ?? []).filter((l) => l.my_side === side && (!scope || !l.order_id || scope(l.order_id)));
  const todo = declutterTodo(lines, []);
  const [showDone, setShowDone] = useState(false);
  const linked = useLinkedOrder(); // BUY-30: the order a notice opened is never folded away or hidden by a chip
  // A3-78: a finished sale still waiting on the seller (a refund request to answer, the item back to confirm) is never
  // folded away: the seller's one deadline on the tab stays in the list.
  const awaiting = useSellerReportsToAnswer();
  // CartView / SalesWaiting on the same tab show this read's loading and error.
  if (!cart.data) return null;
  // Buying's tracker says "Nothing bought yet." once for the whole tab, and a chip shows only its own orders.
  if (views && !lines.some((l) => l.status === "paid" && l.order_id && (!show || show(l.order_id) || l.order_id === linked))) return null;
  if (!lines.some((l) => l.status === "paid" && l.order_id)) {
    if (ended) return null;
    const buyer = side === "buyer";
    // Q2629 (audit 1102c R4): a sale waiting for the buyer to pay (SalesWaiting, right above) read "Sold, waiting for the
    // buyer to pay" over "Nothing sold yet". While one waits, the empty card is left out.
    if (!buyer && lines.some((l) => l.status === "in_cart")) return null;
    return (
      <section className="space-y-2" aria-label={buyer ? "Purchases" : "Sold: pickup and payout"}>
        <SectionHeading title={buyer ? "Purchases" : "Sold: pickup and payout"} />
        {buyer ? (
          <p className="text-sm text-muted-foreground">Nothing bought yet. After you pay, each order shows here with its pickup.</p>
        ) : (
          <SellerEmpty icon={PackageCheck} title="Nothing sold yet">
            When a buyer pays, you book the pickup here and see your payout.
          </SellerEmpty>
        )}
      </section>
    );
  }
  // DA-3: a giver whose orders are all free items sold nothing and is paid nothing.
  const sold = lines.filter((l) => l.status === "paid" && l.order_id);
  const sellerTitle = sold.every((l) => l.price_cents === 0) ? "Given away: pickup" : "Sold: pickup and payout";
  // NIGHT-SELL-soldstates-2: Selling's finished sales (handed over, refunded) fold under one button, as Buying folds
  // Done, so the sales still to hand over are the list. A chip's own `show` (To answer's reports) is never folded.
  const done = new Set(side === "seller" && !show ? sold.filter((l) => (l.order_status === "handed_over" || l.order_status === "refunded") && !awaiting.has(l.order_id as string)).map((l) => l.order_id as string) : []);
  const allDone = done.size > 0 && sold.every((l) => done.has(l.order_id as string));
  // Q2630 (audit 1102c R5): a refunded sale did not go ahead, so the fold never calls it a "finished sale".
  const refundedDone = new Set(sold.filter((l) => l.order_status === "refunded" && done.has(l.order_id as string)).map((l) => l.order_id as string)).size;
  const finishedDone = done.size - refundedDone;
  const doneCounts = [finishedDone > 0 ? `${finishedDone} finished` : null, refundedDone > 0 ? `${refundedDone} refunded` : null].filter(Boolean).join(" and ");
  const doneKinds = [finishedDone > 0 ? "finished" : null, refundedDone > 0 ? "refunded" : null].filter(Boolean).join(" and ");
  const doneToggle = done.size > 0 && (
    <button type="button" className="text-sm font-medium underline underline-offset-2" aria-expanded={showDone} onClick={() => setShowDone((v) => !v)} data-done-sales-toggle="">
      {showDone ? `Hide ${doneKinds} sales` : `Show ${doneCounts} ${done.size === 1 ? "sale" : "sales"}`}
    </button>
  );
  if (allDone && !showDone && !(linked && done.has(linked))) {
    return (
      <section className="space-y-2" aria-label={sellerTitle}>
        <SectionHeading title={sellerTitle} todo={todo.salesOpen} todoWords="to hand over" />
        <p className="text-sm text-muted-foreground">Nothing to hand over right now.</p>
        {doneToggle}
      </section>
    );
  }
  return (
    <>
    <PaidOrdersSection
      cart={lines}
      views={views}
      show={done.size > 0 && !showDone ? (id) => !done.has(id) || id === linked : show}
      label={ended ? "Ended orders" : side === "buyer" ? "Purchases" : sellerTitle}
      heading={
        ended ? <></>
        : side === "buyer"
          ? views ? <SectionHeading title="Your orders" /> : <SectionHeading title="Purchases" todo={todo.purchasesOpen} todoWords="to pick up" />
          : <SectionHeading title={sellerTitle} todo={todo.salesOpen} todoWords="to hand over" />
      }
    />
    {doneToggle}
    </>
  );
}
