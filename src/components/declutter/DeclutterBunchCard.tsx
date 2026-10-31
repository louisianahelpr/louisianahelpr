/**
 * One item on Sell a bunch's review screen (DeclutterBunchView): its photos,
 * title, price (with the fair-price hint), category, condition and description, every field editable; size only while
 * the photo tool hasn't answered it, as the single form does. The seller fixes the photo tool's grouping here (owner's
 * pop-up, 2026-10-29; DeclutterBunchPhotos): see, add, remove, move or split photos; merge the whole item into another;
 * or drop it. A possibly banned item is marked, and can still be listed
 * (the photo check decides); an item short of photos says what's missing
 * (bunchItemProblem).
 */
import { useState } from "react";
import { Loader2, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Switch } from "@/components/ui/switch";
import { OFFERS_TITLE, offersSettingLine } from "@/lib/declutter/offersOnPost";
import type { DeliverySize } from "@/lib/declutter/api";
import { bunchItemProblem, bunchItemTakesOffers, type BunchItem } from "@/lib/declutter/bunch";
import { TwoStepCategoryPicker } from "@/components/ui/TwoStepCategoryPicker";
import { CATEGORY_PICKER_GROUPS } from "@/lib/declutter/categoryIcons";
import { CONDITION_LABEL, SIZE_LABEL } from "./declutterUi";
import PriceHint from "./DeclutterPriceHint";
import { BunchPhotos, type BunchOther } from "./DeclutterBunchPhotos";
import { BuyerPreviewCard } from "./BuyerPreviewCard";

const field = "h-11 w-full min-w-0 rounded-2xl border border-input glass-field px-3 text-ds-15";

interface BunchCardProps {
  item: BunchItem;
  /** LEAD-OFFERS-CHOICE part (2): the seller's saved "Accept offers", for an item with no choice of its own. Absent: on. */
  offersDefault?: boolean;
  index: number;
  /** The other items, for "Move to" and "Merge into": key, the name the seller sees, and a first photo. */
  others: BunchOther[];
  urls: Map<string, string>;
  files: Map<string, File>;
  at: { lat: number; lng: number } | null;
  rewriting: boolean;
  /** Why the last "Write it" didn't work, on the card it was tapped on. */
  rewriteNote?: string | null;
  onChange: (patch: Partial<BunchItem>) => void;
  onMove: (photoKeys: string[], toKey: string) => void;
  onSplit: (photoKeys: string[]) => void;
  onRemovePhoto: (photoKey: string) => void;
  onCover: (photoKey: string) => void;
  onReorder: (photoKey: string, beforeKey: string | null) => void;
  /** False while a run is working on the list: nothing moves under it. */
  canDrag: boolean;
  onAddPhotos: (files: FileList | null) => void;
  onMerge: (intoKey: string) => void;
  onDrop: () => void;
  onRewrite: () => void;
  /** List this item again, from the photo that didn't go. */
  onRetryUpload?: () => void;
}

/** Typed dollars as cents, or null until it is a price a listing could have. */
function parsedPriceCents(price: string): number | null {
  const dollars = Number(price.trim());
  return price.trim() && Number.isFinite(dollars) && dollars > 0 ? Math.round(dollars * 100) : null;
}

/** "Item 3" until it has a name. */
export function bunchItemName(it: BunchItem, index: number): string {
  return it.title.trim() || `Item ${index + 1}`;
}

export function BunchCard({ item, offersDefault, index, others, urls, files, at, rewriting, rewriteNote, onChange, onMove, onSplit, onRemovePhoto, onCover, onReorder, canDrag, onAddPhotos, onMerge, onDrop, onRewrite, onRetryUpload }: BunchCardProps) {
  const [mergeInto, setMergeInto] = useState("");
  const id = item.key;
  const problem = bunchItemProblem(item);
  const name = bunchItemName(item, index);
  const noWords = !item.title.trim() && !item.description.trim();
  const mergeTarget = item.mergeHint ? others.find((o) => o.key === item.mergeHint) : undefined;
  const cents = item.free ? 0 : parsedPriceCents(item.price);
  const cover = item.photoKeys[0] ? urls.get(item.photoKeys[0]) : undefined;

  return (
    <div className="space-y-3 p-4" data-bunch-card="">
      {/* The row above says its name. */}
      <div className="flex items-center justify-end gap-2">
        <Button type="button" variant="outline" size="sm" className="shrink-0 rounded-full" disabled={rewriting} aria-label={rewriting ? undefined : `${noWords ? "Write it with AI" : "Write it again"}: ${name}`} onClick={onRewrite}>
          {rewriting ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" aria-hidden /> : <Sparkles className="mr-1.5 h-4 w-4" aria-hidden />}
          {rewriting ? "Writing…" : noWords ? "Write it with AI" : "Write it again"}
        </Button>
      </div>

      {noWords && !rewriting && <p className="text-ds-13 text-muted-foreground" data-bunch-no-words="">This one has no words yet. Tap Write it with AI, or fill it in below.</p>}
      {rewriteNote && <p className="text-ds-13 text-foreground" role="alert" data-bunch-rewrite-note="">{rewriteNote}</p>}
      {mergeTarget && (
        <div className="flex flex-wrap items-center gap-2 rounded-xl border border-border bg-muted/40 p-3" data-bunch-merge-hint="">
          <p className="min-w-0 flex-1 text-ds-13 text-foreground">This may be the same thing as "{mergeTarget.name}".</p>
          <Button type="button" variant="outline" size="sm" className="shrink-0 rounded-full" onClick={() => onMerge(mergeTarget.key)}>Merge them</Button>
        </div>
      )}

      {item.flagged && (
        <p className="rounded-xl border border-border bg-muted/40 p-3 text-ds-13 font-semibold text-foreground" data-bunch-flag="">
          This item may not be allowed. You can still list it: it gets a closer check, and if that check flags it, someone from Louisiana Helpr looks at it before it goes up. If the photos show the wrong thing, move them, then tap Write it again.
        </p>
      )}

      <BunchPhotos item={item} name={name} others={others} urls={urls} files={files} onMove={onMove} onSplit={onSplit} onRemove={onRemovePhoto} onCover={onCover} onReorder={onReorder} canDrag={canDrag} onAdd={onAddPhotos} />

      {item.title.trim() && cents != null && (
        // Only a local blob: preview (CodeQL js/xss-through-dom; the PhotoProof pattern).
        <BuyerPreviewCard src={cover?.startsWith("blob:") ? cover : null} title={item.title.trim()} cents={cents} />
      )}

      {item.failedPhoto && item.photoKeys.includes(item.failedPhoto) && (
        <div className="flex flex-wrap items-center gap-2 rounded-xl border border-border bg-muted/40 p-3" data-bunch-upload-failed="">
          <p className="min-w-0 flex-1 text-ds-13 text-foreground" role="alert">Photo {item.photoKeys.indexOf(item.failedPhoto) + 1} didn't finish sending, even after we tried again. It's still here, and so is everything else on this item.</p>
          <Button type="button" variant="outline" size="sm" className="shrink-0 rounded-full" onClick={onRetryUpload}>Try again</Button>
        </div>
      )}

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="min-w-0 sm:col-span-2">
          <label className="block text-ds-13 font-medium" htmlFor={`title-${id}`}>Title</label>
          <input id={`title-${id}`} className={field} maxLength={80} value={item.title} onChange={(e) => onChange({ title: e.target.value })} placeholder="Oak rocking chair" />
        </div>
        {/* Its own row at every width, so opening it never leaves an empty column under the field beside it. */}
        <div className="min-w-0 sm:col-span-2" data-bunch-category-row="">
          <label className="block text-ds-13 font-medium" htmlFor={`cat-${id}`}>Category</label>
          <TwoStepCategoryPicker id={`cat-${id}`} value={item.category} onChange={(category) => onChange({ category })} groups={CATEGORY_PICKER_GROUPS} triggerClassName="min-h-11 border-input px-3" />
        </div>
        <div className="min-w-0 space-y-2">
          {!item.free && (
            <div>
              <label className="block text-ds-13 font-medium" htmlFor={`price-${id}`}>Price ($)</label>
              <input id={`price-${id}`} className={field} inputMode="decimal" value={item.price} onChange={(e) => onChange({ price: e.target.value })} placeholder="Set a price" />
              {item.aiPrice && item.price === item.aiPrice && <p className="mt-1 text-ds-13 text-muted-foreground" data-bunch-price-suggested="">Our suggestion. Change it if you like.</p>}
            </div>
          )}
          <label className="flex min-h-11 items-center gap-3 text-ds-14 font-medium" data-bunch-free="">
            <Checkbox aria-label={`Give ${name} away free`} checked={!!item.free} onCheckedChange={(v) => onChange({ free: v === true })} />
            Give it away free
          </label>
        </div>
        {/* A free item is claimed, never offered on, so only a priced one has the switch. */}
        {!item.free && (() => {
          const on = bunchItemTakesOffers(item, { acceptsOffers: offersDefault });
          return (
            <div className="flex min-h-11 items-center gap-3 sm:col-span-2" data-bunch-offers={on ? "on" : "off"}>
              <label htmlFor={`offers-${id}`} className="min-w-0 flex-1">
                <span className="block text-ds-14 font-medium">{OFFERS_TITLE}</span>
                <span className="block text-ds-13 text-muted-foreground">{offersSettingLine(on)}</span>
              </label>
              <Switch id={`offers-${id}`} aria-label={`${OFFERS_TITLE} for ${name}`} checked={on} onCheckedChange={(v) => onChange({ acceptsOffers: v === true })} />
            </div>
          );
        })()}
        <div className="min-w-0">
          <label className="block text-ds-13 font-medium" htmlFor={`cond-${id}`}>Condition</label>
          <select id={`cond-${id}`} className={field} value={item.conditionStars} onChange={(e) => onChange({ conditionStars: Number(e.target.value) })}>
            {[5, 4, 3, 2, 1].map((s) => <option key={s} value={s}>{CONDITION_LABEL[s]}</option>)}
          </select>
        </div>
        {item.sizeUnknown && (
          <div className="min-w-0 sm:col-span-2" data-bunch-size="">
            <label className="block text-ds-13 font-medium" htmlFor={`size-${id}`}>Size</label>
            <select id={`size-${id}`} className={field} value="" onChange={(e) => onChange({ deliverySize: e.target.value as DeliverySize })}>
              <option value="" disabled>Pick a size</option>
              {(Object.keys(SIZE_LABEL) as DeliverySize[]).map((s) => <option key={s} value={s}>{SIZE_LABEL[s]}</option>)}
            </select>
          </div>
        )}
      </div>
      {!item.free && <PriceHint category={item.category} conditionStars={item.conditionStars} at={at} place="near_you" />}
      <div className="min-w-0">
        <label className="block text-ds-13 font-medium" htmlFor={`desc-${id}`}>Description</label>
        <textarea id={`desc-${id}`} rows={3} maxLength={2000} className="w-full min-w-0 rounded-2xl border border-input glass-field px-3 py-2 text-ds-15"
          value={item.description} onChange={(e) => onChange({ description: e.target.value })} />
      </div>

      {problem && <p className="text-ds-13 text-muted-foreground" data-bunch-problem="">{problem}</p>}

      <div className="flex flex-wrap items-end gap-2 border-t border-border pt-3">
        {others.length > 0 && (
          <>
            <div className="w-full" data-bunch-merge-row="">
              <label className="block text-ds-13 font-medium" htmlFor={`merge-${id}`}>Same thing as another item?</label>
              <select id={`merge-${id}`} className={field} value={mergeInto} onChange={(e) => setMergeInto(e.target.value)}>
                <option value="">Pick an item</option>
                {others.map((o) => <option key={o.key} value={o.key}>{o.name}</option>)}
              </select>
            </div>
            <Button type="button" variant="outline" size="sm" disabled={!mergeInto} aria-label={`Merge ${name}`} onClick={() => { onMerge(mergeInto); setMergeInto(""); }}>Merge</Button>
          </>
        )}
        <Button type="button" variant="outline" size="sm" aria-label={`Don't sell ${name}`} onClick={onDrop}>Don't sell this</Button>
      </div>
    </div>
  );
}
