/**
 * CMP-5 (lead decision 2026-10-30): Selling's "drop the price?" nudge, the twin of the notice the server sweep sends
 * once per listing per 14 days. A listing live 14+ days, priced, with no price drop planned and not test data is due
 * (src/lib/declutter/priceNudge.ts). Polish audit 11-27 #11: ONE line above the list, not a line on every row ("9
 * haven't sold in 2 weeks. Drop prices"); its button opens Manage at Change price (about 15% off filled in) for the
 * first due listing, then the next once that one is dropped. The notice's link (`?tab=selling&manage=<id>&drop=1`)
 * opens the same sheet.
 */
import { useEffect } from "react";
import { useSearchParams } from "react-router-dom";
import type { DeclutterItem } from "@/lib/declutter/api";
import { dropOutlook, type DropState } from "@/lib/declutter/browseFilters";
import { priceNudgeDue, readPriceNudgeLink } from "@/lib/declutter/priceNudge";
import { InlineTextButton } from "@/components/ui/InlineTextButton";

/** The listings the nudge is for, in list order. "Drops on" is a drop the nightly sweep has planned (the screen's own
 *  rule, dropOutlook): with no drop planned the price stays where it is, and the nudge is the way down. */
export function priceNudgeItems(items: DeclutterItem[], dropStates: Map<string, DropState> | undefined): DeclutterItem[] {
  return items.filter((item) => priceNudgeDue(item, dropOutlook(item, dropStates?.get(item.id)).planned));
}

export function PriceNudgeSummary({ due, onOpen }: { due: DeclutterItem[]; onOpen: (itemId: string) => void }) {
  if (due.length === 0) return null;
  return (
    // Q2638 (audit 1102c R13): a neutral hint, not the warning ink.
    <p className="text-ds-13 text-muted-foreground" data-price-nudge={due.length}>
      {due.length === 1 ? "1 listing hasn't" : `${due.length} listings haven't`} sold in 2 weeks.{" "}
      <InlineTextButton className="font-semibold underline underline-offset-2" onClick={() => onOpen(due[0].id)}>
        {due.length === 1 ? "Drop the price" : "Drop prices"}
      </InlineTextButton>
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
