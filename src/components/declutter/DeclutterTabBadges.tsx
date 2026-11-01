/**
 * The Buying / Selling badge counts and the section heading, split out of DeclutterTabParts (B77, 2026-11-01):
 * Declutter's tab row waits on these counts before any tab draws, and DeclutterTabParts pulls the paid-order views
 * (DeclutterHandoverViews), which only a tab's own lists need. DeclutterTabParts and DeclutterTradeViews re-export both.
 */
import { useQuery } from "@tanstack/react-query";
import { fetchMyCart, fetchMyOffers } from "@/lib/declutter/api";
import { declutterTodo, type DeclutterTodo } from "@/lib/declutter/tabs";

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
