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
import { formatPrice, milesLabelShort, itemPriceLabel as englishPriceLabel } from "@/lib/declutter/distance";
import { PriceInclFee } from "./PriceInclFee";
import { PhotoTag, PhotoTagStack } from "@/components/ui/PhotoTag";
import { PRICE_BASE, PRICE_DEAL, PRICE_PAID } from "@/components/ui/designScale";
import { CONDITION_LABEL } from "@/lib/declutter/conditionLabels";
import { useLanguage } from "@/lib/i18n/language";
import type { MsgKey } from "@/lib/i18n/en";
import "@/lib/i18n/enDeclutter";

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

// F260q (owner 11-11): the card's words come from the dictionary (enDeclutter.ts / esDeclutter.ts).
const TAG_WORDS: Record<CardTag, MsgKey> = { drop: "decl.card.drop", delivery: "decl.card.delivery", new: "decl.card.new" };

/** The first row's photo is usually the page's largest paint: it does not wait for the browser's lazy-load check. */
const FIRST_ROW_PHOTO: Record<string, string> = { loading: "eager", fetchpriority: "high" };
/** A later row still above the fold (Q2705, 11-07): loads at once, at the browser's own priority (the entry preloads it). */
const ABOVE_FOLD_PHOTO: Record<string, string> = { loading: "eager" };
const LATER_PHOTO: Record<string, string> = { loading: "lazy" };

/** The card's photo source, in order: the card-sized thumbnail, then the full photo if the thumbnail fails, then none. */
type PhotoStage = "card" | "full" | "failed";

export function ItemCard({ item, photoPath, miles, approximate, save, saves, tag, bundle, firstRow, aboveFold, guestSaveTo }: { item: DeclutterItem; photoPath?: string; miles: number | null; approximate: boolean; save?: CardSave; saves?: number | null; tag?: CardTag | null; bundle?: boolean; firstRow?: boolean; aboveFold?: boolean;
  /** F052 (UI audit 11-09): a guest's heart, a link to sign-up ("Sign up to save items.") that comes back here. */
  guestSaveTo?: string }) {
  // Audit 11-10 F321: the short form ("3 mi", "About 1 mi"), so the condition beside it is not cut to "Lightly u...".
  const { t } = useLanguage();
  const itemPriceLabel = (cents: number) => (cents === 0 ? t("decl.chip.free") : englishPriceLabel(cents));
  const away = milesLabelShort(miles, approximate)?.replace(/^Under /, `${t("decl.card.under")} `).replace(/^About /, `${t("decl.card.about")} `) ?? null;
  const condition = CONDITION_LABEL[item.condition_stars] ? t(`decl.cond.${item.condition_stars}` as MsgKey) : null;
  // A photo that fails to load drops out, leaving the icon under it (never a blank tile). The card-sized thumbnail
  // comes first (owner 10-31: pictures were slow while scrolling); if it fails, the full photo; then the icon.
  const [photoStage, setPhotoStage] = useState<PhotoStage>("card");
  // F056 (UI audit 11-09): the photo is described by the title, once it has loaded. Before that (and for a photo that
  // fails) alt stays empty, so a browser never paints the broken-image glyph and the title over the tile's icon
  // (seen 11-09 on the seed rows at 1440). The card link's own name says the title either way (F050).
  const [photoLoaded, setPhotoLoaded] = useState(false);
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
  const photoLoadedNow = () => { setPhotoLoaded(true); photoSettled(); };
  useLoadPhotoAhead(photoRef, laterOpen && !early && !!photoPath && photoStage !== "failed");
  const card = (
    <Link
      to={`/declutter/item/${item.id}`}
      data-item-card=""
      className="group block rounded-2xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      {/* Owner 11-14 (Depop/Vinted audit item 8): a 3:4 photo on a phone and tablet; from lg the 4:5 tile as before. */}
      <span className="relative block aspect-[3/4] overflow-hidden rounded-xl bg-photo-empty lg:aspect-[4/5]">
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
            alt={photoLoaded ? item.title : ""}
            width={CARD_PHOTO_PX}
            height={CARD_PHOTO_PX}
            decoding="async"
            onLoad={photoLoadedNow}
            onError={() => { photoSettled(); setPhotoStage((s) => (s === "card" ? "full" : "failed")); }}
            className="relative h-full w-full object-cover"
          />
        )}
        {/* Owner pick 4 (11-08): "Porch pickup" and "Trades OK" are tags on the photo (one PhotoTag style, shared with
            Builder 3's trades badge), with the card's one rule tag (drop / delivery / new) under them. */}
        {(item.porch_ok || item.accepts_trades === true || tag) && (
          <PhotoTagStack>
            {item.porch_ok && <PhotoTag data-card-porch="">{t("decl.card.porch")}</PhotoTag>}
            {item.accepts_trades === true && <PhotoTag data-card-trades="">{t("decl.card.trades")}</PhotoTag>}
            {tag && (
              <PhotoTag data-card-tag={tag} tone={tag === "delivery" ? "plain" : "deal"} title={tag === "new" ? t("decl.card.newTitle") : t(TAG_WORDS[tag])}>
                {t(TAG_WORDS[tag])}
              </PhotoTag>
            )}
          </PhotoTagStack>
        )}
      </span>
      {/* Owner 11-14 (Depop/Vinted audit item 8): TWO text lines under the photo below lg: the title, then the bold
          price (with "$X incl. fee" beside it, the 11-07 rule). "Condition · distance" shows from lg only (owner pick 4,
          11-08, still the desktop card). Porch pickup stays a photo tag at every width. */}
      <span className="block min-w-0 px-0.5 pt-2">
        <span data-card-title className="block truncate text-ds-13 font-semibold leading-snug" title={item.title}>{item.title}</span>
        {(condition || away) && (
          // "Like new · 16 mi" on ONE line. #45 (deep audit 2026-10-28): the distance always shows whole (it never
          // shrinks); the condition gives way first.
          <span data-card-place="" className="hidden min-w-0 text-ds-11 text-muted-foreground lg:flex" title={[condition, away].filter(Boolean).join(" · ")}>
            {condition && <span data-card-condition={item.condition_stars} title={condition} className="min-w-0 truncate">{condition}</span>}
            {condition && away && <span data-card-sep="" className="shrink-0 whitespace-pre"> · </span>}
            {away && <span data-card-away className="shrink-0 whitespace-nowrap">{away}</span>}
          </span>
        )}
        {/* Owner 11-09 (10:35 PM, reverses pick 2 of 11-08): the LIST price is the big bold one, and "$X.XX incl. fee"
            sits under it, smaller (11-07 rule: the card keeps both numbers). Free stays in burnt sienna. */}
        {/* Below lg the price and "incl. fee" share the second line (wrapping only on a card too narrow for both). */}
        <span data-card-price="" className="mt-0.5 flex min-w-0 flex-wrap items-baseline gap-x-1.5 leading-tight lg:flex-col lg:items-start lg:gap-x-0">
          {item.current_price_cents > 0 ? (
            <>
              <span data-card-base-price="" className={`text-ds-16 ${PRICE_PAID}`}>
                {itemPriceLabel(item.current_price_cents)}
                {item.current_price_cents < item.price_cents && (
                  <span className={`ml-1.5 text-ds-11 ${PRICE_BASE}`}>
                    <span className="sr-only">{t("decl.card.wasPrice")}</span>
                    <s aria-hidden>{formatPrice(item.price_cents)}</s>
                  </span>
                )}
              </span>
              <PriceInclFee priceCents={item.current_price_cents} className={`text-ds-11 ${PRICE_BASE}`} />
            </>
          ) : (
            <span data-card-free="" className={`text-ds-16 ${PRICE_DEAL}`}>{itemPriceLabel(item.current_price_cents)}</span>
          )}
        </span>
      </span>
      {/* D-NEW12 (lead 2026-10-30): the seller has a bundle discount on. Under the text, never a second photo tag.
          Trades audit 11-08 #3 ("Trades OK", guests too) is a PhotoTag on the photo since owner pick 4 (11-08). */}
      {bundle && <Badge variant="sienna" data-card-bundle="" className="ml-0.5 mt-1 w-fit text-ds-11 leading-none">{t("decl.card.bundle")}</Badge>}
    </Link>
  );
  const savesText = savesWord(saves);
  if (!save && guestSaveTo) {
    // F052: the same heart and count a member sees; pressing it opens sign-up (saving needs an account).
    return (
      <div className="relative">
        {card}
        <Link
          to={guestSaveTo}
          data-card-heart=""
          data-card-guest-heart=""
          data-card-saves={saves ?? undefined}
          aria-label={`${t("decl.card.signUpToSave", { title: item.title })}${savesText ? t("decl.card.savedByShort", { n: saves ?? 0 }) : ""}`}
          className="absolute right-0.5 top-0.5 flex h-11 min-w-11 items-center justify-center rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <span className={`flex h-8 items-center justify-center gap-1 rounded-full bg-background/90 shadow-sm ${savesText ? "px-2.5" : "w-8"}`}>
            <Heart className="h-4 w-4 text-foreground" fill="none" aria-hidden />
            {savesText && <span aria-hidden className="text-ds-13 font-semibold tabular-nums text-foreground">{savesText}</span>}
          </span>
        </Link>
      </div>
    );
  }
  if (!save) {
    if (!savesText) return card;
    // A guest sees how many saved it (no heart to press: saving needs an account), over the photo like a member's.
    return (
      <div className="relative">
        {card}
        <span data-card-saves={saves ?? 0} className="pointer-events-none absolute right-1.5 top-1.5 flex h-8 items-center gap-1 rounded-full bg-background/90 px-2.5 text-ds-13 font-semibold tabular-nums text-foreground shadow-sm">
          <Heart className="h-3.5 w-3.5" aria-hidden />
          <span aria-hidden>{savesText}</span>
          <span className="sr-only">{saves === 1 ? t("decl.card.savedBy1") : t("decl.card.savedByN", { n: saves ?? 0 })}</span>
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
        aria-label={`${save.on ? t("decl.card.unsave", { title: item.title }) : t("decl.card.save", { title: item.title })}${savesText ? t("decl.card.savedByShort", { n: saves ?? 0 }) : ""}`}
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
