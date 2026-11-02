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

// useDeclutterTodo and SectionHeading live in the leaf DeclutterTabHeads (the /declutter first screen loads them without
// this module's order views); re-exported so every import of them from here still works.
export { SectionHeading, useDeclutterTodo } from "./DeclutterTabHeads";

/**
 * A Selling list with nothing in it yet (owner 2026-10-28: designed empty states, not a bare grey sentence): the
 * list's icon on the olive tint, what will show here, and when. A dashed edge: the slot the first one fills.
 */
function SellerEmpty({ icon: Icon, title, children }: { icon: LucideIcon; title: string; children: ReactNode }) {
  return (
    <div data-seller-empty="" className="flex items-start gap-3 rounded-[20px] border border-dashed border-border bg-card/60 px-4 py-4">
      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[hsl(var(--olive)/0.35)] text-[hsl(var(--bark))]" aria-hidden>
        <Icon className="h-5 w-5" strokeWidth={1.75} />
      </span>
      <div className="min-w-0">
        <p className="text-ds-15 font-semibold">{title}</p>
        <p className="text-ds-13 text-muted-foreground">{children}</p>
      </div>
    </div>
  );
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
export function PaidOrders({ side, views, show }: { side: "buyer" | "seller"; views?: Map<string, BuyerOrderView>; show?: (orderId: string) => boolean }) {
  const cart = useQuery({ queryKey: ["declutter", "my-cart"], queryFn: fetchMyCart });
  const lines = (cart.data ?? []).filter((l) => l.my_side === side);
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
    const buyer = side === "buyer";
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
  const doneToggle = done.size > 0 && (
    <button type="button" className="text-sm font-medium underline underline-offset-2" aria-expanded={showDone} onClick={() => setShowDone((v) => !v)} data-done-sales-toggle="">
      {showDone ? "Hide finished sales" : `Show ${done.size} finished ${done.size === 1 ? "sale" : "sales"}`}
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
      label={side === "buyer" ? "Purchases" : sellerTitle}
      heading={
        side === "buyer"
          ? views ? <SectionHeading title="Your orders" /> : <SectionHeading title="Purchases" todo={todo.purchasesOpen} todoWords="to pick up" />
          : <SectionHeading title={sellerTitle} todo={todo.salesOpen} todoWords="to hand over" />
      }
    />
    {doneToggle}
    </>
  );
}
