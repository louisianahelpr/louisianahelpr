/**
 * One item on Sell a bunch's review screen (DeclutterBunchView): its photos,
 * name, price (with the fair-price hint), category, condition, size and
 * details, every field editable. The seller fixes the photo tool's grouping
 * here (owner's pop-up, 2026-10-29): tap photos to choose them, then move them
 * to another item or split them into a new one; merge the whole item into
 * another; or drop it. A possibly banned item is marked and cannot be listed;
 * an item short of photos says what's missing (bunchItemProblem).
 */
import { useState } from "react";
import { Check, Loader2, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { DeliverySize } from "@/lib/declutter/api";
import { bunchItemProblem, type BunchItem } from "@/lib/declutter/bunch";
import { CATEGORY_LABEL, CONDITION_LABEL, SIZE_LABEL } from "./declutterUi";
import PriceHint from "./DeclutterPriceHint";

const field = "h-11 w-full min-w-0 rounded-2xl border border-input glass-field px-3 text-ds-15";

export interface BunchCardProps {
  item: BunchItem;
  index: number;
  /** The other items, for "Move to" and "Merge into": key and the name the seller sees. */
  others: { key: string; name: string }[];
  urls: Map<string, string>;
  at: { lat: number; lng: number } | null;
  rewriting: boolean;
  onChange: (patch: Partial<BunchItem>) => void;
  onMove: (photoKeys: string[], toKey: string) => void;
  onSplit: (photoKeys: string[]) => void;
  onMerge: (intoKey: string) => void;
  onDrop: () => void;
  onRewrite: () => void;
}

/** "Item 3" until it has a name. */
export function bunchItemName(it: BunchItem, index: number): string {
  return it.title.trim() || `Item ${index + 1}`;
}

export function BunchCard({ item, index, others, urls, at, rewriting, onChange, onMove, onSplit, onMerge, onDrop, onRewrite }: BunchCardProps) {
  const [chosen, setChosen] = useState<string[]>([]);
  const [moveTo, setMoveTo] = useState("");
  const [mergeInto, setMergeInto] = useState("");
  const id = item.key;
  const problem = bunchItemProblem(item);
  const live = chosen.filter((k) => item.photoKeys.includes(k));
  const toggle = (k: string) => setChosen((c) => (c.includes(k) ? c.filter((x) => x !== k) : [...c, k]));
  const name = bunchItemName(item, index);

  return (
    <li className="space-y-3 rounded-[20px] border border-border bg-card p-4" data-bunch-item="" data-flagged={item.flagged ? "" : undefined}>
      <div className="flex items-center justify-between gap-2">
        <h3 className="min-w-0 truncate text-ds-15 font-semibold" title={name}>{name}</h3>
        <Button type="button" variant="outline" size="sm" className="shrink-0 rounded-full" disabled={rewriting} onClick={onRewrite}>
          {rewriting ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" aria-hidden /> : <Sparkles className="mr-1.5 h-4 w-4" aria-hidden />}
          {rewriting ? "Writing…" : "Write it again"}
        </Button>
      </div>

      {item.flagged && (
        <p className="rounded-xl border border-border bg-muted/40 p-3 text-ds-13 font-semibold text-foreground" data-bunch-flag="">
          This may be an item you can't sell on Declutter, so it can't be listed from here. If the photos show the wrong thing, move them, then tap Write it again.
        </p>
      )}

      <div className="space-y-2">
        <p className="text-ds-13 text-muted-foreground">Tap photos to choose them, then move them or split them off.</p>
        <ul className="grid grid-cols-4 gap-2 sm:grid-cols-6">
          {item.photoKeys.map((k, i) => {
            const url = urls.get(k);
            const on = live.includes(k);
            return (
              <li key={k} className="relative">
                <button type="button" aria-pressed={on} onClick={() => toggle(k)}
                  className={`block w-full overflow-hidden rounded-xl ring-offset-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${on ? "ring-2 ring-[hsl(var(--bark))]" : ""}`}>
                  {url?.startsWith("blob:") && <img src={url} alt={`${name}, photo ${i + 1}`} className="aspect-square w-full object-cover bg-photo-empty" />}
                  {on && (
                    <span className="absolute right-1 top-1 flex h-6 w-6 items-center justify-center rounded-full bg-background text-foreground shadow" aria-hidden>
                      <Check className="h-4 w-4" />
                    </span>
                  )}
                </button>
              </li>
            );
          })}
        </ul>
        {live.length > 0 && (
          <div className="flex flex-wrap items-end gap-2" data-bunch-chosen="">
            {others.length > 0 && (
              <div className="min-w-0 flex-1">
                <label className="block text-ds-13 font-medium" htmlFor={`move-${id}`}>Move {live.length === 1 ? "this photo" : `these ${live.length} photos`} to</label>
                <select id={`move-${id}`} className={field} value={moveTo} onChange={(e) => setMoveTo(e.target.value)}>
                  <option value="">Pick an item</option>
                  {others.map((o) => <option key={o.key} value={o.key}>{o.name}</option>)}
                </select>
              </div>
            )}
            {others.length > 0 && (
              <Button type="button" variant="outline" size="sm" disabled={!moveTo} onClick={() => { onMove(live, moveTo); setChosen([]); setMoveTo(""); }}>Move</Button>
            )}
            {live.length < item.photoKeys.length && (
              <Button type="button" variant="outline" size="sm" onClick={() => { onSplit(live); setChosen([]); }}>Split into a new item</Button>
            )}
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="min-w-0 sm:col-span-2">
          <label className="block text-ds-13 font-medium" htmlFor={`title-${id}`}>Name</label>
          <input id={`title-${id}`} className={field} maxLength={80} value={item.title} onChange={(e) => onChange({ title: e.target.value })} placeholder="Oak rocking chair" />
        </div>
        <div className="min-w-0">
          <label className="block text-ds-13 font-medium" htmlFor={`price-${id}`}>Price ($)</label>
          <input id={`price-${id}`} className={field} inputMode="decimal" value={item.price} onChange={(e) => onChange({ price: e.target.value })} placeholder="40" />
        </div>
        <div className="min-w-0">
          <label className="block text-ds-13 font-medium" htmlFor={`cat-${id}`}>Category</label>
          <select id={`cat-${id}`} className={field} value={item.category} onChange={(e) => onChange({ category: e.target.value })}>
            {Object.entries(CATEGORY_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </div>
        <div className="min-w-0">
          <label className="block text-ds-13 font-medium" htmlFor={`cond-${id}`}>Condition</label>
          <select id={`cond-${id}`} className={field} value={item.conditionStars} onChange={(e) => onChange({ conditionStars: Number(e.target.value) })}>
            {[5, 4, 3, 2, 1].map((s) => <option key={s} value={s}>{CONDITION_LABEL[s]}</option>)}
          </select>
        </div>
        <div className="min-w-0">
          <label className="block text-ds-13 font-medium" htmlFor={`size-${id}`}>Size</label>
          <select id={`size-${id}`} className={field} value={item.deliverySize} onChange={(e) => onChange({ deliverySize: e.target.value as DeliverySize })}>
            {(Object.keys(SIZE_LABEL) as DeliverySize[]).map((s) => <option key={s} value={s}>{SIZE_LABEL[s]}</option>)}
          </select>
        </div>
      </div>
      <PriceHint category={item.category} conditionStars={item.conditionStars} at={at} place="near_you" />
      <div className="min-w-0">
        <label className="block text-ds-13 font-medium" htmlFor={`desc-${id}`}>Details</label>
        <textarea id={`desc-${id}`} rows={3} maxLength={2000} className="w-full min-w-0 rounded-2xl border border-input glass-field px-3 py-2 text-ds-15"
          value={item.description} onChange={(e) => onChange({ description: e.target.value })} />
      </div>

      {problem && !item.flagged && <p className="text-ds-13 text-muted-foreground" data-bunch-problem="">{problem}</p>}

      <div className="flex flex-wrap items-end gap-2 border-t border-border pt-3">
        {others.length > 0 && (
          <>
            <div className="min-w-0 flex-1">
              <label className="block text-ds-13 font-medium" htmlFor={`merge-${id}`}>Same thing as another item?</label>
              <select id={`merge-${id}`} className={field} value={mergeInto} onChange={(e) => setMergeInto(e.target.value)}>
                <option value="">Pick an item</option>
                {others.map((o) => <option key={o.key} value={o.key}>{o.name}</option>)}
              </select>
            </div>
            <Button type="button" variant="outline" size="sm" disabled={!mergeInto} onClick={() => { onMerge(mergeInto); setMergeInto(""); }}>Merge</Button>
          </>
        )}
        <Button type="button" variant="outline" size="sm" onClick={onDrop}>Don't sell this</Button>
      </div>
    </li>
  );
}
