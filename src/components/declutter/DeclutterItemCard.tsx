/**
 * The Declutter item card (Browse grid and the item page's "More from this
 * seller" / "Similar items" rows): one card for every list of items.
 */
import { useEffect, useRef, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Link } from "react-router-dom";
import { Heart } from "lucide-react";
import { PhotoPlaceholder } from "@/components/ui/PhotoPlaceholder";
import { categoryIcon } from "@/lib/declutter/categoryIcons";
import { CARD_PHOTO_PX, photoCardUrl, photoPublicUrl, type DeclutterItem, type DeclutterPhoto } from "@/lib/declutter/api";
import { cardPhotoSrcSet, CARD_PHOTO_SIZES } from "@/lib/declutter/photoSizes";
import { useLoadPhotoAhead } from "./useLoadPhotoAhead";
import { holdForFirstRowPhoto, useLaterPhotosOpen } from "./firstRowPhotoGate";
import { formatPrice, milesLabel, itemPriceLabel } from "@/lib/declutter/distance";
import { PriceInclFee } from "./PriceInclFee";
import { CONDITION_LABEL } from "@/lib/declutter/conditionLabels";

export function firstPhotos(photos: DeclutterPhoto[]): Map<string, string> {
  const out = new Map<string, string>();
  for (const p of photos) if (!out.has(p.item_id)) out.set(p.item_id, p.storage_path);
  return out;
}

/**
 * A Browse card (board 25 / 39, HELPR-DESIGN-SPEC v2 §3 "Item card"): the
 * square photo first (or the category icon on a soft tint, never a blank box),
 * at most ONE tag on the photo, then the price in money ink with the old price
 * struck through, the title on ONE line and a small place line. No stars on an
 * item card (spec §3: stars are for people; a seller's rating lives on the item
 * page's seller card). No box around it: the photo's corners are the card.
 */
/** The card's heart (the Declutter watchlist, row 46): whether this member watches the item, and the toggle. */
export interface CardSave {
  on: boolean;
  toggle: () => void;
  pending?: boolean;
}

/** "3" beside the heart, or nothing for none or a count not read yet (owner 11-07: the heart shows the save count). */
function savesWord(n: number | null | undefined): string | null {
  return n && n > 0 ? (n > 999 ? "999+" : String(n)) : null;
}

/**
 * The one tag a card's photo may wear, only from a real rule: "May drop
 * tonight" (the nightly drop could lower it this evening; the stop is private,
 * so never "Drops"), or "Helpr delivery" (a big item; delivery is offered on
 * every item while Declutter is open, and the spec puts it first for big ones),
 * or "New" (BUY-53: opened from a saved search, it went live after the member
 * last looked, the same rule as the search's "N new" count).
 */
export type CardTag = "drop" | "delivery" | "new";

const TAG_WORDS: Record<CardTag, string> = { drop: "May drop tonight", delivery: "Helpr delivery", new: "New" };

/** The first row's photo is usually the page's largest paint: it does not wait for the browser's lazy-load check. */
const FIRST_ROW_PHOTO: Record<string, string> = { loading: "eager", fetchpriority: "high" };
/** A later row still above the fold (Q2705, 11-07): loads at once, at the browser's own priority (the entry preloads it). */
const ABOVE_FOLD_PHOTO: Record<string, string> = { loading: "eager" };
const LATER_PHOTO: Record<string, string> = { loading: "lazy" };

/** The card's photo source, in order: the card-sized thumbnail, then the full photo if the thumbnail fails, then none. */
type PhotoStage = "card" | "full" | "failed";

export function ItemCard({ item, photoPath, miles, approximate, save, saves, tag, bundle, firstRow, aboveFold }: { item: DeclutterItem; photoPath?: string; miles: number | null; approximate: boolean; save?: CardSave; saves?: number | null; tag?: CardTag | null; bundle?: boolean; firstRow?: boolean; aboveFold?: boolean }) {
  const away = milesLabel(miles, approximate);
  // A photo that fails to load drops out, leaving the icon under it (never a blank tile). The card-sized thumbnail
  // comes first (owner 10-31: pictures were slow while scrolling); if it fails, the full photo; then the icon.
  const [photoStage, setPhotoStage] = useState<PhotoStage>("card");
  const photoRef = useRef<HTMLImageElement>(null);
  // B77: a later card's photo waits for the first row's (firstRowPhotoGate.ts), so the largest paint loads alone.
  // Q2705 (11-07): every card above the fold counts as first (on a tall phone the largest paint is on the second row).
  const early = !!firstRow || !!aboveFold;
  const laterOpen = useLaterPhotosOpen(!early && !!photoPath);
  const firstRowDone = useRef<(() => void) | null>(null);
  useEffect(() => {
    if (!early || !photoPath) return;
    const done = holdForFirstRowPhoto();
    firstRowDone.current = done;
    return done;
  }, [early, photoPath]);
  const photoSettled = () => firstRowDone.current?.();
  useLoadPhotoAhead(photoRef, laterOpen && !early && !!photoPath && photoStage !== "failed");
  const card = (
    <Link
      to={`/declutter/item/${item.id}`}
      data-item-card=""
      className="group block rounded-2xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <span className="relative block aspect-square overflow-hidden rounded-2xl bg-photo-empty">
        {/* The category icon is ALWAYS the tile's ground (audit #32, 2026-10-21: a blank
            sand tile read as a failed load). A real photo covers it; a photo still
            loading, one that fails, or one with nothing opaque in it (prod's E2E
            fixture photos are 1x1 transparent PNGs) shows the icon, never a blank box. */}
        <PhotoPlaceholder icon={categoryIcon(item.category)} seed={item.category} className="absolute inset-0 h-full w-full" />
        {photoPath && photoStage !== "failed" && (early || laterOpen) && (
          // width/height: the photo's own square, so the browser knows its shape before a byte arrives (the tile is
          // aspect-square, so nothing moves either way); decoding="async" keeps decoding off the scroll.
          // `loading` comes BEFORE src/srcSet on purpose: React 18 writes attributes in prop order, and WebKit starts
          // the fetch the moment src is set on the new element, so a `loading="lazy"` written after it was ignored
          // (a11y-prod-webkit 41598471444: 1536 card photos; locally all 200 of 200 cards' photos on one /declutter
          // load in WebKit vs 14 in Chromium). Guard: src/test/declutterLazyPhotoBeforeSrc.test.tsx.
          <img
            ref={photoRef}
            {...(firstRow ? FIRST_ROW_PHOTO : aboveFold ? ABOVE_FOLD_PHOTO : LATER_PHOTO)}
            src={photoStage === "card" ? photoCardUrl(photoPath) : photoPublicUrl(photoPath)}
            srcSet={photoStage === "card" ? cardPhotoSrcSet(photoPublicUrl(photoPath), photoCardUrl(photoPath), CARD_PHOTO_PX) : undefined}
            sizes={photoStage === "card" ? CARD_PHOTO_SIZES : undefined}
            alt=""
            width={CARD_PHOTO_PX}
            height={CARD_PHOTO_PX}
            decoding="async"
            onLoad={photoSettled}
            onError={() => { photoSettled(); setPhotoStage((s) => (s === "card" ? "full" : "failed")); }}
            className="relative h-full w-full object-cover"
          />
        )}
        {tag && (
          // Opaque card under the tint, so the tag reads the same on any photo.
          <span data-card-tag={tag} className="absolute bottom-2 left-2 max-w-[calc(100%-1rem)] rounded-full bg-card shadow-sm">
            <span
              className={`block rounded-full truncate px-2.5 py-1 text-ds-11 font-semibold leading-none ${tag === "delivery" ? "border border-border text-foreground" : "bg-[hsl(var(--burnt-sienna)/0.14)] text-[hsl(var(--sienna-ink))]"}`}
              title={tag === "new" ? "New since you last looked at this search" : TAG_WORDS[tag]}
            >
              {TAG_WORDS[tag]}
            </span>
          </span>
        )}
      </span>
      <span className="block min-w-0 px-0.5 pt-2">
        <span data-card-price className="block min-w-0 text-base font-bold leading-tight tabular-nums text-[hsl(var(--burnt-sienna))]">
          {itemPriceLabel(item.current_price_cents)}
          {item.current_price_cents < item.price_cents && (
            <span className="ml-1.5 text-xs font-medium text-muted-foreground">
              <span className="sr-only">Price dropped, was </span>
              <s aria-hidden>{formatPrice(item.price_cents)}</s>
            </span>
          )}
        </span>
        {/* Owner 11-07 (Vinted review): what the buyer pays with the fee, under the price. */}
        <PriceInclFee priceCents={item.current_price_cents} />
        <span data-card-title className="mt-0.5 block truncate text-sm font-semibold leading-snug" title={item.title}>{item.title}</span>
        {/* Owner 11-07 (Vinted review): the condition under the title, in the item page's own words. */}
        {CONDITION_LABEL[item.condition_stars] && (
          <span data-card-condition={item.condition_stars} className="block truncate text-xs text-foreground/80" title={CONDITION_LABEL[item.condition_stars]}>{CONDITION_LABEL[item.condition_stars]}</span>
        )}
        {/* Deep audit 2026-10-28 #45: at 390 the one truncating line cut the distance off ("Mid City, Baton Ro…").
            The town has its own line and may truncate; the distance sits on the next line and always shows whole. */}
        <span data-card-place className="block min-w-0 text-xs text-muted-foreground" title={`${item.area_label}${away ? ` · ${away}` : ""}`}>
          <span data-card-area className="block truncate" title={item.area_label}>{item.area_label}</span>
          {(away || item.porch_ok) && (
            // DA-16: the same line at every width, one line tall. "Porch pickup" wraps out of sight when it can't fit whole
            // (it gives way first, board 39), so a narrow card never shows half of it and the distance always shows.
            <span data-card-how="" className="flex h-[1lh] min-w-0 flex-wrap overflow-hidden">
              {away && <span data-card-away className="shrink-0 whitespace-nowrap">{away}</span>}
              {item.porch_ok && <span data-card-porch="" className="min-w-0 whitespace-pre" title="Porch pickup">{away ? " · " : ""}Porch pickup</span>}
            </span>
          )}
        </span>
      </span>
      {/* D-NEW12 (lead 2026-10-30): the seller has a bundle discount on. Under the text, never a second photo tag. */}
      {bundle && <Badge variant="sienna" data-card-bundle="" className="ml-0.5 mt-1 w-fit text-ds-11 leading-none">Bundle deal</Badge>}
    </Link>
  );
  const savesText = savesWord(saves);
  if (!save) {
    if (!savesText) return card;
    // A guest sees how many saved it (no heart to press: saving needs an account), over the photo like a member's.
    return (
      <div className="relative">
        {card}
        <span data-card-saves={saves ?? 0} className="pointer-events-none absolute right-1.5 top-1.5 flex h-8 items-center gap-1 rounded-full bg-background/90 px-2.5 text-ds-13 font-semibold tabular-nums text-foreground shadow-sm">
          <Heart className="h-3.5 w-3.5" aria-hidden />
          <span aria-hidden>{savesText}</span>
          <span className="sr-only">{`Saved by ${saves} ${saves === 1 ? "person" : "people"}`}</span>
        </span>
      </div>
    );
  }
  // The heart sits OVER the photo as the card link's sibling (a button inside a link is not allowed).
  return (
    <div className="relative">
      {card}
      <Button
        type="button"
        variant="ghost"
        size="iconCompact"
        data-card-heart=""
        aria-pressed={save.on}
        // A3-98 (audit 7, 11-01): one word for keeping something for later, app-wide: Save (the owner's word; Jobs' "Save job").
        aria-label={`${save.on ? `Remove ${item.title} from saved` : `Save ${item.title}`}${savesText ? `, saved by ${saves}` : ""}`}
        data-card-saves={saves ?? undefined}
        disabled={save.pending}
        onClick={save.toggle}
        className="absolute right-0.5 top-0.5 disabled:opacity-100 [&_svg]:size-4"
      >
        <span className={`flex h-8 items-center justify-center gap-1 rounded-full bg-background/90 shadow-sm ${savesText ? "px-2.5" : "w-8"}`}>
          <Heart className={`h-4 w-4 ${save.on ? "text-[hsl(var(--burnt-sienna))]" : "text-foreground"}`} fill={save.on ? "currentColor" : "none"} aria-hidden />
          {savesText && <span aria-hidden className="text-ds-13 font-semibold tabular-nums text-foreground">{savesText}</span>}
        </span>
      </Button>
    </div>
  );
}
