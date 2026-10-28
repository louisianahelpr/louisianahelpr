/**
 * The Buying / Selling tab pieces shared by DeclutterTradeViews and
 * DeclutterHomeView (owner, 2026-10-18; src/lib/declutter/tabs.ts): the to-do
 * counts behind the tab badges, a section heading with its count, and the paid
 * orders on one side. Split out of DeclutterTradeViews to keep it under the
 * component size threshold; DeclutterTradeViews re-exports all three.
 */
import type { ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { HandCoins, PackageCheck, type LucideIcon } from "lucide-react";
import { fetchMyCart, fetchMyOffers } from "@/lib/declutter/api";
import { declutterTodo, type DeclutterTodo } from "@/lib/declutter/tabs";
import { PaidOrdersSection } from "./DeclutterHandoverViews";
import type { BuyerOrderView } from "./BuyingOrders";

/**
 * What needs the member on each side (the Buying / Selling badges), from the
 * same two reads the tabs show, so a tab never counts something it doesn't list.
 * `settled` is true once both reads answered (an error is an answer: no badge).
 */
export function useDeclutterTodo(): { todo: DeclutterTodo | null; settled: boolean } {
  const cart = useQuery({ queryKey: ["declutter", "my-cart"], queryFn: fetchMyCart });
  const offers = useQuery({ queryKey: ["declutter", "my-offers"], queryFn: fetchMyOffers });
  const settled = !cart.isLoading && !offers.isLoading;
  const todo = cart.data && offers.data ? declutterTodo(cart.data, offers.data) : null;
  return { todo, settled };
}

/** A Buying / Selling section's heading, with how many of its things need the member. */
export function SectionHeading({ title, todo, todoWords }: { title: string; todo?: number; todoWords?: string }) {
  return (
    <h2 className="text-base font-semibold">
      {title}
      {todo ? <span className="font-normal text-muted-foreground"> · {todo} {todoWords}</span> : null}
    </h2>
  );
}

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
  // CartView / SalesWaiting on the same tab show this read's loading and error.
  if (!cart.data) return null;
  // Buying's tracker says "Nothing bought yet." once for the whole tab, and a chip shows only its own orders.
  if (views && !lines.some((l) => l.status === "paid" && l.order_id && (!show || show(l.order_id)))) return null;
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
  return (
    <PaidOrdersSection
      cart={lines}
      views={views}
      show={show}
      label={side === "buyer" ? "Purchases" : "Sold: pickup and payout"}
      heading={
        side === "buyer"
          ? views ? <SectionHeading title="Your orders" /> : <SectionHeading title="Purchases" todo={todo.purchasesOpen} todoWords="to pick up" />
          : <SectionHeading title="Sold: pickup and payout" todo={todo.salesOpen} todoWords="to hand over" />
      }
    />
  );
}
