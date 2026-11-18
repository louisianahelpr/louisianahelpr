import type { CartLine } from "@/lib/declutter/api";

/**
 * Trades audit 11-08 #2: a trade line's price reads "Trade", never "Free". Its own file (11-18 train, Q178): the item
 * page's offer panel (DeclutterYourOffer) needs only this, and importing it from DeclutterCartWords put the checkout
 * card words and their dictionary (enDeclBuy) on every cold public item page. DeclutterCartWords re-exports it.
 */
export const isTradeLine = (l: Pick<CartLine, "source">): boolean => l.source === "swap";
