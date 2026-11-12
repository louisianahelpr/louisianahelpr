/**
 * Photos that aren't sorted yet on Sell a bunch (owner 2026-10-30: "bulk upload added it as each picture a separate
 * item and don't even write the listing with ai"). They stay together with the reason, never one item per photo, and
 * can't be listed until the seller chooses: sort them again, say they're all one item, or leave them out.
 */
import { Button } from "@/components/ui/button";
import { DECLUTTER_MAX_PHOTOS } from "@/lib/declutter/photoRules";
import type { BunchItem } from "@/lib/declutter/bunch";
import "@/lib/i18n/enListingParts";
import { t } from "@/lib/i18n/language";

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
  const heading = n === 1 ? t("lp.bp.pile1") : t("lp.bp.pileN", { n });
  return (
    <li className="space-y-3 rounded-[20px] border border-border bg-card p-4" data-bunch-item="" data-bunch-not-sorted="">
      <h3 className="min-w-0 break-words text-ds-15 font-semibold">{heading}</h3>
      <p className="text-ds-13 text-foreground" role="alert" data-bunch-not-sorted-reason="">{item.sortReason}</p>
      <ul className="grid grid-cols-4 gap-2 sm:grid-cols-6">
        {item.photoKeys.map((k, i) => {
          const url = urls.get(k);
          return (
            <li key={k} className="block aspect-square w-full overflow-hidden rounded-xl bg-photo-empty">
              {url?.startsWith("blob:") && <img loading="lazy" src={url} alt={t("lp.bp.pileAlt", { n: i + 1 })} decoding="async" className="aspect-square w-full bg-photo-empty object-cover" data-bunch-thumb="" />}
            </li>
          );
        })}
      </ul>
      <div className="flex flex-wrap items-center gap-2 border-t border-border pt-3">
        <Button type="button" size="sm" className="rounded-full" disabled={busy} onClick={onSortAgain}>{t("lp.bp.sortAgain")}</Button>
        {n <= DECLUTTER_MAX_PHOTOS && (
          <Button type="button" variant="outline" size="sm" className="rounded-full" disabled={busy} onClick={onOneItem}>{n === 1 ? t("lp.bp.oneItem1") : t("lp.bp.oneItemN")}</Button>
        )}
        <Button type="button" variant="outline" size="sm" className="rounded-full" disabled={busy} onClick={onDrop}>{n === 1 ? t("lp.bc.drop") : t("lp.bp.dropN")}</Button>
      </div>
    </li>
  );
}
