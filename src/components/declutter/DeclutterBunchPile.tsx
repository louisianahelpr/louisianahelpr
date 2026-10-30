/**
 * Photos that aren't sorted yet on Sell a bunch (owner 2026-10-30: "bulk upload added it as each picture a separate
 * item and don't even write the listing with ai"). They stay together with the reason, never one item per photo, and
 * can't be listed until the seller chooses: sort them again, say they're all one item, or leave them out.
 */
import { Button } from "@/components/ui/button";
import { DECLUTTER_MAX_PHOTOS } from "@/lib/declutter/photoRules";
import type { BunchItem } from "@/lib/declutter/bunch";

interface BunchPileCardProps {
  item: BunchItem;
  urls: Map<string, string>;
  /** Sorting or listing is going: nothing here can start another. */
  busy: boolean;
  onSortAgain: () => void;
  onOneItem: () => void;
  onDrop: () => void;
}

export function BunchPileCard({ item, urls, busy, onSortAgain, onOneItem, onDrop }: BunchPileCardProps) {
  const n = item.photoKeys.length;
  const heading = n === 1 ? "1 photo not sorted yet" : `${n} photos not sorted yet`;
  return (
    <li className="space-y-3 rounded-[20px] border border-border bg-card p-4" data-bunch-item="" data-bunch-not-sorted="">
      <h3 className="min-w-0 break-words text-ds-15 font-semibold">{heading}</h3>
      <p className="text-ds-13 text-foreground" role="alert" data-bunch-not-sorted-reason="">{item.sortReason}</p>
      <ul className="grid grid-cols-4 gap-2 sm:grid-cols-6">
        {item.photoKeys.map((k, i) => {
          const url = urls.get(k);
          return (
            <li key={k} className="block aspect-square w-full overflow-hidden rounded-xl bg-photo-empty">
              {url?.startsWith("blob:") && <img src={url} alt={`Not sorted, photo ${i + 1}`} loading="lazy" decoding="async" className="aspect-square w-full object-cover" data-bunch-thumb="" />}
            </li>
          );
        })}
      </ul>
      <div className="flex flex-wrap items-center gap-2 border-t border-border pt-3">
        <Button type="button" size="sm" className="rounded-full" disabled={busy} onClick={onSortAgain}>Sort again</Button>
        {n <= DECLUTTER_MAX_PHOTOS && (
          <Button type="button" variant="outline" size="sm" className="rounded-full" disabled={busy} onClick={onOneItem}>{n === 1 ? "This is one item" : "These are one item"}</Button>
        )}
        <Button type="button" variant="outline" size="sm" className="rounded-full" disabled={busy} onClick={onDrop}>Don't sell {n === 1 ? "this" : "these"}</Button>
      </div>
    </li>
  );
}
