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
import type { DeliverySize } from "@/lib/declutter/api";
import { bunchItemProblem, bunchItemTakesOffers, bunchItemTakesTrades, type BunchItem } from "@/lib/declutter/bunch";
import { TwoStepCategoryPicker } from "@/components/ui/TwoStepCategoryPicker";
import { CATEGORY_PICKER_GROUPS } from "@/lib/declutter/categoryIcons";
import { CONDITION_LABEL, SIZE_LABEL } from "./declutterUi";
import PriceHint from "./DeclutterPriceHint";
import { BunchPhotos, type BunchOther } from "./DeclutterBunchPhotos";
import { BuyerPreviewCard } from "./BuyerPreviewCard";
import { Textarea } from "@/components/ui/textarea";
import { NativeSelect } from "@/components/ui/select";
import "@/lib/i18n/enListingParts";
import { t } from "@/lib/i18n/language";

const field = "h-11 w-full min-w-0 rounded-2xl border border-input glass-field px-3 text-ds-15";

interface BunchCardProps {
  item: BunchItem;
  /** LEAD-OFFERS-CHOICE part (2): the seller's saved "Accept offers", for an item with no choice of its own. Absent: on. */
  offersDefault?: boolean;
  /** Declutter trades item 4: the seller's saved "Open to trades", for an item with no choice of its own. Absent: off. */
  tradesDefault?: boolean;
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
  return it.title.trim() || t("lp.b.item", { n: index + 1 });
}

export function BunchCard({ item, offersDefault, tradesDefault, index, others, urls, files, at, rewriting, rewriteNote, onChange, onMove, onSplit, onRemovePhoto, onCover, onReorder, canDrag, onAddPhotos, onMerge, onDrop, onRewrite, onRetryUpload }: BunchCardProps) {
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
        <Button type="button" variant="outline" size="sm" className="shrink-0 rounded-full" disabled={rewriting} aria-label={rewriting ? undefined : t("lp.bc.writeAria", { action: noWords ? t("lp.bc.writeForMe") : t("lp.bc.writeAgain"), name })} onClick={onRewrite}>
          {rewriting ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" aria-hidden /> : <Sparkles className="mr-1.5 h-4 w-4" aria-hidden />}
          {rewriting ? t("lp.bc.writing") : noWords ? t("lp.bc.writeForMe") : t("lp.bc.writeAgain")}
        </Button>
      </div>

      {noWords && !rewriting && <p className="text-ds-13 text-muted-foreground" data-bunch-no-words="">{t("lp.bc.noWords")}</p>}
      {rewriteNote && <p className="text-ds-13 text-foreground" role="alert" data-bunch-rewrite-note="">{rewriteNote}</p>}
      {mergeTarget && (
        <div className="flex flex-wrap items-center gap-2 rounded-xl border border-border bg-muted/40 p-3" data-bunch-merge-hint="">
          <p className="min-w-0 flex-1 text-ds-13 text-foreground">{t("lp.bc.sameAs", { name: mergeTarget.name })}</p>
          <Button type="button" variant="outline" size="sm" className="shrink-0 rounded-full" onClick={() => onMerge(mergeTarget.key)}>{t("lp.bc.mergeThem")}</Button>
        </div>
      )}

      {item.flagged && (
        <p className="rounded-xl border border-border bg-muted/40 p-3 text-ds-13 font-semibold text-foreground" data-bunch-flag="">
          {t("lp.bc.flagged")}
        </p>
      )}

      <BunchPhotos item={item} name={name} others={others} urls={urls} files={files} onMove={onMove} onSplit={onSplit} onRemove={onRemovePhoto} onCover={onCover} onReorder={onReorder} canDrag={canDrag} onAdd={onAddPhotos} />

      {item.title.trim() && cents != null && (
        // Only a local blob: preview (CodeQL js/xss-through-dom; the PhotoProof pattern).
        <BuyerPreviewCard src={cover?.startsWith("blob:") ? cover : null} title={item.title.trim()} cents={cents} />
      )}

      {item.failedPhoto && item.photoKeys.includes(item.failedPhoto) && (
        <div className="flex flex-wrap items-center gap-2 rounded-xl border border-border bg-muted/40 p-3" data-bunch-upload-failed="">
          <p className="min-w-0 flex-1 text-ds-13 text-foreground" role="alert">{t("lp.bc.photoFailed", { n: item.photoKeys.indexOf(item.failedPhoto) + 1 })}</p>
          <Button type="button" variant="outline" size="sm" className="shrink-0 rounded-full" onClick={onRetryUpload}>{t("lp.bc.tryAgain")}</Button>
        </div>
      )}

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="min-w-0 sm:col-span-2">
          <label className="block text-ds-13 font-medium" htmlFor={`title-${id}`}>{t("lp.bc.title")}</label>
          <input id={`title-${id}`} className={field} maxLength={80} value={item.title} onChange={(e) => onChange({ title: e.target.value })} placeholder={t("lp.bc.titlePh")} />
        </div>
        {/* Its own row at every width, so opening it never leaves an empty column under the field beside it. */}
        <div className="min-w-0 sm:col-span-2" data-bunch-category-row="">
          <label className="block text-ds-13 font-medium" htmlFor={`cat-${id}`}>{t("lp.bc.category")}</label>
          <TwoStepCategoryPicker id={`cat-${id}`} value={item.category} onChange={(category) => onChange({ category })} groups={CATEGORY_PICKER_GROUPS} triggerClassName="min-h-11 border-input px-3" />
        </div>
        <div className="min-w-0 space-y-2">
          {!item.free && (
            <div>
              <label className="block text-ds-13 font-medium" htmlFor={`price-${id}`}>{t("lp.bc.price")}</label>
              <input id={`price-${id}`} className={field} inputMode="decimal" value={item.price} onChange={(e) => onChange({ price: e.target.value })} placeholder={t("lp.bc.pricePh")} />
              {item.aiPrice && item.price === item.aiPrice && <p className="mt-1 text-ds-13 text-muted-foreground" data-bunch-price-suggested="">{t("lp.bc.ourSuggestion")}</p>}
            </div>
          )}
          <label className="flex min-h-11 items-center gap-3 text-ds-14 font-medium" data-bunch-free="">
            <Checkbox aria-label={t("lp.bc.freeAria", { name })} checked={!!item.free} onCheckedChange={(v) => onChange({ free: v === true })} />
            {t("lp.bc.free")}
          </label>
        </div>
        {/* A free item is claimed, never offered on, so only a priced one has the switch. */}
        {!item.free && (() => {
          const on = bunchItemTakesOffers(item, { acceptsOffers: offersDefault });
          return (
            <div className="flex min-h-11 items-center gap-3 sm:col-span-2" data-bunch-offers={on ? "on" : "off"}>
              <label htmlFor={`offers-${id}`} className="min-w-0 flex-1">
                <span className="block text-ds-14 font-medium">{t("lp.ld.offersTitle")}</span>
                <span className="block text-ds-13 text-muted-foreground">{on ? t("lp.ld.offersOn") : t("lp.ld.offersOff")}</span>
              </label>
              <Switch id={`offers-${id}`} aria-label={t("lp.bc.forName", { label: t("lp.ld.offersTitle"), name })} checked={on} onCheckedChange={(v) => onChange({ acceptsOffers: v === true })} />
            </div>
          );
        })()}
        {/* Declutter trades item 4: "Open to trades" under Accept offers; a free item is claimed, never traded. */}
        {!item.free && (() => {
          const on = bunchItemTakesTrades(item, { acceptsTrades: tradesDefault });
          return (
            <div className="flex min-h-11 items-center gap-3 sm:col-span-2" data-bunch-trades={on ? "on" : "off"}>
              <label htmlFor={`trades-${id}`} className="min-w-0 flex-1">
                <span className="block text-ds-14 font-medium">{t("lp.ld.tradesTitle")}</span>
                <span className="block text-ds-13 text-muted-foreground">{on ? t("lp.ld.tradesOn") : t("lp.ld.tradesOff")}</span>
              </label>
              <Switch id={`trades-${id}`} aria-label={t("lp.bc.forName", { label: t("lp.ld.tradesTitle"), name })} checked={on} onCheckedChange={(v) => onChange({ acceptsTrades: v === true })} />
            </div>
          );
        })()}
        <div className="min-w-0">
          <label className="block text-ds-13 font-medium" htmlFor={`cond-${id}`}>{t("lp.bc.condition")}</label>
          <NativeSelect id={`cond-${id}`} value={item.conditionStars} onChange={(e) => onChange({ conditionStars: Number(e.target.value) })}>
            {[5, 4, 3, 2, 1].map((s) => <option key={s} value={s}>{CONDITION_LABEL[s]}</option>)}
          </NativeSelect>
        </div>
        {item.sizeUnknown && (
          <div className="min-w-0 sm:col-span-2" data-bunch-size="">
            <label className="block text-ds-13 font-medium" htmlFor={`size-${id}`}>{t("lp.bc.size")}</label>
            <NativeSelect id={`size-${id}`} value="" onChange={(e) => onChange({ deliverySize: e.target.value as DeliverySize })}>
              <option value="" disabled>{t("lp.bc.pickSize")}</option>
              {(Object.keys(SIZE_LABEL) as DeliverySize[]).map((s) => <option key={s} value={s}>{SIZE_LABEL[s]}</option>)}
            </NativeSelect>
          </div>
        )}
      </div>
      {!item.free && <PriceHint category={item.category} conditionStars={item.conditionStars} at={at} place="near_you" />}
      <div className="min-w-0">
        <label className="block text-ds-13 font-medium" htmlFor={`desc-${id}`}>{t("lp.bc.description")}</label>
        <Textarea id={`desc-${id}`} rows={3} maxLength={2000} className="w-full min-w-0 rounded-2xl border border-input glass-field px-3 py-2 text-ds-15"
          value={item.description} onChange={(e) => onChange({ description: e.target.value })} />
      </div>

      {problem && <p className="text-ds-13 text-muted-foreground" data-bunch-problem="">{problem}</p>}

      <div className="flex flex-wrap items-end gap-2 border-t border-border pt-3">
        {others.length > 0 && (
          <>
            <div className="w-full" data-bunch-merge-row="">
              <label className="block text-ds-13 font-medium" htmlFor={`merge-${id}`}>{t("lp.bc.sameThing")}</label>
              <NativeSelect id={`merge-${id}`} value={mergeInto} onChange={(e) => setMergeInto(e.target.value)}>
                <option value="">{t("lp.bc.pickItem")}</option>
                {others.map((o) => <option key={o.key} value={o.key}>{o.name}</option>)}
              </NativeSelect>
            </div>
            <Button type="button" variant="outline" size="sm" disabled={!mergeInto} aria-label={t("lp.bc.mergeAria", { name })} onClick={() => { onMerge(mergeInto); setMergeInto(""); }}>{t("lp.bc.merge")}</Button>
          </>
        )}
        <Button type="button" variant="outline" size="sm" aria-label={t("lp.bc.dropAria", { name })} onClick={onDrop}>{t("lp.bc.drop")}</Button>
      </div>
    </div>
  );
}
