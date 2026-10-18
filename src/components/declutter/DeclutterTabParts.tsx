/**
 * The Buying / Selling tab pieces shared by DeclutterTradeViews and
 * DeclutterHomeView (owner, 2026-10-18; src/lib/declutter/tabs.ts): the to-do
 * counts behind the tab badges, a section heading with its count, and the paid
 * orders on one side. Split out of DeclutterTradeViews to keep it under the
 * component size threshold; DeclutterTradeViews re-exports all three.
 */
import { useQuery } from "@tanstack/react-query";
import { fetchMyCart, fetchMyOffers } from "@/lib/declutter/api";
import { declutterTodo, type DeclutterTodo } from "@/lib/declutter/tabs";
import { PaidOrdersSection } from "./DeclutterHandoverViews";

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
 * Paid orders on one side (slice 4: book the pickup, hand over, porch photos,
 * no-shows, problems, payout, reviews): Purchases on Buying, the paid sales on Selling.
 */
export function PaidOrders({ side }: { side: "buyer" | "seller" }) {
  const cart = useQuery({ queryKey: ["declutter", "my-cart"], queryFn: fetchMyCart });
  const lines = (cart.data ?? []).filter((l) => l.my_side === side);
  const todo = declutterTodo(lines, []);
  // CartView / SalesWaiting on the same tab show this read's loading and error.
  if (!cart.data) return null;
  if (!lines.some((l) => l.status === "paid" && l.order_id)) {
    const buyer = side === "buyer";
    return (
      <section className="space-y-2" aria-label={buyer ? "Purchases" : "Sold: pickup and payout"}>
        <SectionHeading title={buyer ? "Purchases" : "Sold: pickup and payout"} />
        <p className="text-sm text-muted-foreground">
          {buyer ? "Nothing bought yet. After you pay, each order shows here with its pickup." : "Nothing sold yet. Once a buyer pays, the pickup and your payout show here."}
        </p>
      </section>
    );
  }
  return (
    <PaidOrdersSection
      cart={lines}
      label={side === "buyer" ? "Purchases" : "Sold: pickup and payout"}
      heading={
        side === "buyer"
          ? <SectionHeading title="Purchases" todo={todo.purchasesOpen} todoWords="to pick up" />
          : <SectionHeading title="Sold: pickup and payout" todo={todo.salesOpen} todoWords="to hand over" />
      }
    />
  );
}
