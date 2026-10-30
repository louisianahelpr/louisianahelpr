/**
 * CMP-5 (lead decision 2026-10-30): Selling's "drop the price?" nudge, the row twin of the notice the server sweep
 * sends once per listing per 14 days. A listing live 14+ days, priced, with no price drop planned and not test data
 * shows one line; its button opens Manage at Change price with about 15% off filled in (src/lib/declutter/priceNudge.ts).
 * The notice's link (`?tab=selling&manage=<id>&drop=1`) opens the same sheet.
 */
import { useEffect } from "react";
import { useSearchParams } from "react-router-dom";
import type { DeclutterItem } from "@/lib/declutter/api";
import { dropOutlook, type DropState } from "@/lib/declutter/browseFilters";
import { priceNudgeDue, readPriceNudgeLink } from "@/lib/declutter/priceNudge";

export function PriceNudgeLine({ item, dropState, onOpen }: { item: DeclutterItem; dropState: DropState | undefined; onOpen: () => void }) {
  // "Drops on" here is a drop the nightly sweep has planned (the screen's own rule, dropOutlook): with no drop
  // planned the price stays where it is, and the nudge is the way down.
  if (!priceNudgeDue(item, dropOutlook(item, dropState).planned)) return null;
  return (
    <p className="text-ds-13 text-[hsl(var(--sienna-ink))]" data-price-nudge="">
      Hasn't sold yet.{" "}
      <button type="button" className="font-semibold underline underline-offset-2" onClick={onOpen}>
        Drop the price?
      </button>
    </p>
  );
}

/** Opens the notice's `?manage=<id>&drop=1` once the seller's listings are in, then takes the params off the address. */
export function usePriceNudgeLink(items: DeclutterItem[] | undefined, open: (itemId: string) => void): void {
  const [params, setParams] = useSearchParams();
  const itemId = readPriceNudgeLink(params);
  useEffect(() => {
    if (!itemId || !items) return;
    if (items.some((i) => i.id === itemId && i.status === "live")) open(itemId);
    setParams((p) => {
      const next = new URLSearchParams(p);
      next.delete("manage");
      next.delete("drop");
      return next;
    }, { replace: true });
    // `open` is a stable setter pair from the caller; the link and the list are the triggers.
  }, [itemId, items]);
}
