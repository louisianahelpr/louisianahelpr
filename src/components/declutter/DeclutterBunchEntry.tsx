/**
 * "Sell a bunch"'s way in (owner 2026-10-29): a row in "More ways to sell",
 * for everyone who can see Declutter (the page's own gate is 'declutter').
 */
import { Link } from "react-router-dom";
import { ChevronRight, Images } from "lucide-react";

export function SellBunchEntry() {
  return (
    <Link
      to="/declutter/sell?mode=bunch"
      data-sell-bunch-entry=""
      className="flex min-h-14 items-center gap-3 px-4 py-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
    >
      <Images className="h-5 w-5 shrink-0" aria-hidden />
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-semibold">Sell a bunch</span>
        <span className="block text-xs text-muted-foreground">Add photos of everything; we'll write each listing for you to check</span>
      </span>
      <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
    </Link>
  );
}
