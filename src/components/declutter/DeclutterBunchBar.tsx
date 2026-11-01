/** The bar that stays in view on Sell a bunch: where sorting and listing have got to, Undo, and what's left before listing. */
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { listingProgressLine, sortProgressLine, type BunchItem, type BunchPhoto } from "@/lib/declutter/bunch";

/** The last change that can be taken back: what the list and photos were, and what to say about it. */
export interface BunchUndo {
  said: string;
  before: BunchItem[];
  photos: BunchPhoto[];
  /** A merge set aside a price the seller typed: offered here, as a choice. */
  otherPrice?: { intoKey: string; price: string };
}

/**
 * Whether the list step (its List button and the confirm tick above it) is on screen. Owner 2026-11-01: ONE list
 * button; once the step is in view the bar's "Next: list N items" goes, and the step's own List button, with the tick
 * visible right above it, is the one. No IntersectionObserver (an old WebView): the bar keeps its Next, as before.
 */
export function useListStepInView(active: boolean): boolean {
  const [inView, setInView] = useState(false);
  useEffect(() => {
    const section = active ? document.getElementById("bunch-list")?.closest("section") : null;
    if (!section || typeof IntersectionObserver === "undefined") { setInView(false); return; }
    const io = new IntersectionObserver((entries) => setInView(entries.some((e) => e.isIntersecting)), { threshold: 0.15 });
    io.observe(section);
    return () => io.disconnect();
  }, [active]);
  return inView;
}

export function BunchBar({ sorting, found, listing, runNames, undo, itemCount, readyCount, needs, onNeeds, onNext, onUndo, onUseOtherPrice }: {
  sorting: { done: number; total: number; retrying?: boolean } | null;
  found: number;
  listing: { done: number; total: number } | null;
  runNames: string[];
  undo: BunchUndo | null;
  itemCount: number;
  readyCount: number;
  needs: string | null;
  onNeeds: (() => void) | null;
  onNext: () => void;
  onUndo: () => void;
  onUseOtherPrice: () => void;
}) {
  const listStepInView = useListStepInView(itemCount > 0);
  const nextRow = !listing && !sorting && itemCount > 0 && !(listStepInView && !(needs && onNeeds));
  if (!sorting && !listing && !undo && !nextRow) return null;
  return (
    <div className="sticky bottom-3 z-20 space-y-2 rounded-2xl border border-border bg-card p-3 shadow-md" data-bunch-bar="">
      {sorting && (
        <p className="text-sm text-foreground" role="status" aria-live="polite" data-bunch-sorting="">
          {sortProgressLine(sorting.done, sorting.total, found)} {sorting.retrying ? "The connection dropped, so we're trying again. " : ""}Keep this page open.
        </p>
      )}
      {listing && (
        <p className="text-sm text-foreground" role="status" aria-live="polite" data-bunch-progress="">
          {listingProgressLine(listing.done, listing.total, runNames)} Keep this page open.
        </p>
      )}
      {undo && !listing && (
        <div className="flex flex-wrap items-center gap-2" role="status" data-bunch-undo="">
          <p className="min-w-0 flex-1 text-sm">{undo.said}{undo.otherPrice ? " We kept its price." : ""}</p>
          {undo.otherPrice && (
            <Button type="button" variant="outline" size="sm" className="rounded-full" onClick={onUseOtherPrice}>
              Use ${undo.otherPrice.price} instead
            </Button>
          )}
          <Button type="button" variant="outline" size="sm" className="rounded-full" onClick={onUndo}>Undo</Button>
        </div>
      )}
      {nextRow && (
        <div className="flex flex-wrap items-center gap-2">
          {needs && onNeeds ? (
            <Button type="button" variant="link" size="sm" className="h-auto min-w-0 flex-1 justify-start whitespace-normal p-0 text-left underline" data-bunch-needs="" onClick={onNeeds}>{needs}</Button>
          ) : (
            <span className="min-w-0 flex-1 text-sm text-muted-foreground">All {itemCount === 1 ? "set" : `${itemCount} set`}.</span>
          )}
          {!listStepInView && <Button type="button" size="sm" className="rounded-full" disabled={readyCount === 0} data-bunch-next="" onClick={onNext}>Next: list {readyCount} {readyCount === 1 ? "item" : "items"}</Button>}
        </div>
      )}
    </div>
  );
}
