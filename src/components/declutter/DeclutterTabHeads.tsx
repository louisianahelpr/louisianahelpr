/**
 * The small Buying / Selling pieces Declutter's first screen draws before any tab's body: the to-do counts behind the
 * tab badges, a section heading, and the strikes line. A leaf on purpose (the /declutter order chunk, lead 11-01): it
 * imports no order, handover or offer view, so DeclutterHomeView can load the Buying and Selling bodies on demand.
 * DeclutterTabParts and DeclutterTradeViews re-export these, so every older import still works.
 * Guard: src/test/declutterTabsLoadOnDemand.test.ts.
 */
import { useQuery } from "@tanstack/react-query";
import { fetchMyActiveStrikes, fetchMyCart, fetchMyOffers } from "@/lib/declutter/api";
import { declutterTodo, type DeclutterTodo } from "@/lib/declutter/tabs";
import { DeclutterNotice } from "./declutterUi";

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
 * "You have N of 3 strikes" (rows 7, 16, 17). Nothing when there are none.
 * Design audit 11-17 #2: the full card sat above every tab's feed. It is full on Selling (`full`) and whenever
 * Declutter is paused (3 strikes); every other tab gets the one line, in the same warning tone.
 */
export function StrikeCount({ userId, full = true }: { userId: string; full?: boolean }) {
  const strikes = useQuery({ queryKey: ["declutter", "strikes", userId], queryFn: () => fetchMyActiveStrikes(userId) });
  const n = strikes.data ?? 0;
  if (n === 0) return null;
  const title = `You have ${Math.min(n, 3)} of 3 strikes.`;
  if (!full && n < 3) {
    return (
      <p role="status" data-strike-line="" className="rounded-xl border border-[hsl(var(--burnt-sienna)/0.3)] bg-[hsl(var(--burnt-sienna)/0.06)] px-3 py-2 text-ds-13 font-semibold text-foreground">
        {title}
      </p>
    );
  }
  return (
    <DeclutterNotice tone="warn" title={title}>
      {n >= 3
        ? "Declutter is paused for you until one of them goes away. Each strike goes away 1 year after you got it."
        : "Each strike goes away 1 year after you got it. At 3 strikes you can't buy or sell on Declutter until one goes away."}
    </DeclutterNotice>
  );
}
