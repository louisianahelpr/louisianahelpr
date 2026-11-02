/**
 * The Declutter item card (Browse grid and the item page's "More from this
 * seller" / "Similar items" rows): one card for every list of items.
 */
import { useEffect, useRef, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Link } from "react-router-dom";
import { Heart } from "lucide-react";
import { PhotoPlaceholder } from "@/components/ui/PhotoPlaceholder";
import { categoryIcon } from "@/lib/declutter/categoryIcons";
import { CARD_PHOTO_PX, photoCardUrl, photoPublicUrl, type DeclutterItem, type DeclutterPhoto } from "@/lib/declutter/api";
import { cardPhotoSrcSet, CARD_PHOTO_SIZES } from "@/lib/declutter/photoSizes";
import { useLoadPhotoAhead } from "./useLoadPhotoAhead";
import { holdForFirstRowPhoto, useLaterPhotosOpen } from "./firstRowPhotoGate";
import { formatPrice, milesLabel, itemPriceLabel } from "@/lib/declutter/distance";

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
const LATER_PHOTO: Record<string, string> = { loading: "lazy" };

/** The card's photo source, in order: the card-sized thumbnail, then the full photo if the thumbnail fails, then none. */
type PhotoStage = "card" | "full" | "failed";

export function ItemCard({ item, photoPath, miles, approximate, save, tag, bundle, firstRow }: { item: DeclutterItem; photoPath?: string; miles: number | null; approximate: boolean; save?: CardSave; tag?: CardTag | null; bundle?: boolean; firstRow?: boolean }) {
  const away = milesLabel(miles, approximate);
  // A photo that fails to load drops out, leaving the icon under it (never a blank tile). The card-sized thumbnail
  // comes first (owner 10-31: pictures were slow while scrolling); if it fails, the full photo; then the icon.
  const [photoStage, setPhotoStage] = useState<PhotoStage>("card");
  const photoRef = useRef<HTMLImageElement>(null);
  // B77: a later card's photo waits for the first row's (firstRowPhotoGate.ts), so the largest paint loads alone.
  const laterOpen = useLaterPhotosOpen(!firstRow && !!photoPath);
  const firstRowDone = useRef<(() => void) | null>(null);
  useEffect(() => {
    if (!firstRow || !photoPath) return;
    const done = holdForFirstRowPhoto();
    firstRowDone.current = done;
    return done;
  }, [firstRow, photoPath]);
  const photoSettled = () => firstRowDone.current?.();
  useLoadPhotoAhead(photoRef, laterOpen && !firstRow && !!photoPath && photoStage !== "failed");
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
        {photoPath && photoStage !== "failed" && (firstRow || laterOpen) && (
          // width/height: the photo's own square, so the browser knows its shape before a byte arrives (the tile is
          // aspect-square, so nothing moves either way); decoding="async" keeps decoding off the scroll.
          <img
            ref={photoRef}
            src={photoStage === "card" ? photoCardUrl(photoPath) : photoPublicUrl(photoPath)}
            srcSet={photoStage === "card" ? cardPhotoSrcSet(photoPublicUrl(photoPath), photoCardUrl(photoPath), CARD_PHOTO_PX) : undefined}
            sizes={photoStage === "card" ? CARD_PHOTO_SIZES : undefined}
            alt=""
            width={CARD_PHOTO_PX}
            height={CARD_PHOTO_PX}
            decoding="async"
            {...(firstRow ? FIRST_ROW_PHOTO : LATER_PHOTO)}
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
        <span data-card-title className="mt-0.5 block truncate text-sm font-semibold leading-snug" title={item.title}>{item.title}</span>
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
  if (!save) return card;
  // The heart sits OVER the photo as the card link's sibling (a button inside a link is not allowed).
  return (
    <div className="relative">
      {card}
      <button
        type="button"
        data-card-heart=""
        aria-pressed={save.on}
        // A3-98 (audit 7, 11-01): one word for keeping something for later, app-wide: Save (the owner's word; Jobs' "Save job").
        aria-label={save.on ? `Remove ${item.title} from saved` : `Save ${item.title}`}
        disabled={save.pending}
        onClick={save.toggle}
        className="absolute right-0.5 top-0.5 flex h-11 w-11 items-center justify-center rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <span className="flex h-8 w-8 items-center justify-center rounded-full bg-background/90 shadow-sm">
          <Heart className={`h-4 w-4 ${save.on ? "text-[hsl(var(--burnt-sienna))]" : "text-foreground"}`} fill={save.on ? "currentColor" : "none"} aria-hidden />
        </span>
      </button>
    </div>
  );
}
