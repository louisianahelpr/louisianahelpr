import { useState, type ReactNode } from "react";
import { InlineTextButton } from "@/components/ui/InlineTextButton";
import { Check, Copy } from "lucide-react";
import { giftGuides as G, type DiscountCode } from "@/content/giftGuides";
import type { Sale } from "@/content/giftGuidePicks";
import { storePhoto } from "@/content/giftGuideStorePhotos";
import { DEALS_SLUG, DEALS_WORDS } from "@/content/giftGuideDeals.mjs";
import { offerOnly } from "@/lib/giftGuideOfferCopy.mjs";
import { GiftOut } from "./GiftOut";
import { START_OPEN } from "./startOpen";
import { WISH_CORE as WISH } from "@/content/giftWishListCore";
import { Heart, isSaved, itemId, togglePick, useGiftList } from "./giftList";
import { heartTapped } from "./GiftGuideHints";
import { onAnyList, requestSaveFor } from "./saveForPeople";
import { usePlan } from "./fun/plannerStore";

/**
 * The deals days' discount codes and store sales as photo cards (owner 2026-11-21: "for discount codes we should do the
 * image for the place, like Muck Boot show a Muck Boot picture like the rest of the guides, and the retailer and code
 * below where they can copy and open site"; then "same for sales"). They replace the collapsed "Deals & codes" box,
 * whose four-line code boxes "take up too much space". Each card: the store's own product photo (a local cutout,
 * src/content/giftGuideStorePhotos.ts; a store with none shows its name in the well, never an invented photo), the
 * store's name linking to the store, one muted line (the offer and its dates), then a code card's code chip (tap to
 * copy; "Copied"; a refused clipboard selects the code) and every card's open-site icon (new tab).
 * A store with several sales is one card listing them (Ulta's eight sales were eight copies of one photo).
 */

// The codes and sales rules (no React) live in giftGuideDealCounts.ts, so the menu's counts can use them without the cards.
export { codeCardCount, codesOn, liveSales, salesOn } from "@/content/giftGuideDealCounts";
import { bestCode } from "@/content/giftGuideDealCounts";

export const CARD_WORDS = {
  codesTitle: "Discount codes",
  salesTitle: "Sales",
  // Owner pop-up 2026-11-24: "Biggest store sales" (was "Top deals"); one word list with the pre-JS body (DEALS_WORDS).
  dealsTitle: DEALS_WORDS.topTitle,
  openSite: (store: string) => `Open ${store} site`,
  copyCode: (code: string) => `Copy code ${code}`,
  copied: "Copied",
  moreSales: (n: number) => `+${n} more`,
  moreCodes: (n: number) => `+${n} more ${n === 1 ? "code" : "codes"}`,
};


/** The photo: the store's cutout. A store with no photo shows none (guides polish 1122 #14: its name is already the card's
 *  heading; a tinted name tile was a box with no photo in it). */
function StorePhoto({ store, href }: { store: string; href: string }) {
  const src = storePhoto(store);
  const [ok, setOk] = useState(true);
  if (!src || !ok) return null;
  return (
    <GiftOut href={href} className="gg-deal-photo" data-gift-store-photo="photo">
      <img loading="lazy" decoding="async" src={src} alt="" width={200} height={200} onError={() => setOk(false)} />
      <span className="sr-only">{CARD_WORDS.openSite(store)} ({G.newTab})</span>
    </GiftOut>
  );
}

/**
 * A code or sale card's wish-list heart (consistency audit 1122 #13: hearts were on the Top deals cards only): the same
 * Heart, place (.gg-heart-deal, the card's top-right) and save as a Top deal: My Wish List, or anyone's list when the
 * "save for" sheet is up. `name` is what the list shows (the store and its offer).
 */
function CardHeart({ href, name, store }: { href: string; name: string; store: string }) {
  const [wish, plan] = [useGiftList(), usePlan()];
  const id = itemId(href);
  const saved = isSaved(wish, id) || onAnyList(plan, href);
  const image = storePhoto(store);
  return (
    <Heart saved={saved} label={WISH.saveForLabel(name)} className="gg-heart-deal" data={{ "data-gift-card-heart": store }}
      onToggle={() => { if (!requestSaveFor({ href, name, guide: DEALS_SLUG, ...(image ? { image } : {}) })) heartTapped(togglePick({ href, name, guide: DEALS_SLUG, id })); }} />
  );
}

function Card({ store, href, name, line, children, data }: { store: string; href: string; name: string; line: ReactNode; children?: ReactNode; data: Record<`data-${string}`, string> }) {
  return (
    <li className="gg-deal gg-store-card" {...data}>
      <StorePhoto store={store} href={href} />
      <CardHeart href={href} name={name} store={store} />
      <div className="gg-card-head">
        {/* Polish audit 1122 #20: no arrow icon beside the name (the name, like the photo, is the link to the site). */}
        <GiftOut href={href} className="gg-deal-brand gg-card-store" data-gift-code-shop={store}>{store}<span className="sr-only"> ({G.newTab})</span></GiftOut>
      </div>
      <div className="gg-deal-meta gg-card-line">{line}</div>
      {children && <div className="gg-card-actions">{children}</div>}
    </li>
  );
}

/** A code chip: the code with a copy icon, one piece; tap copies it and says Copied. The Top deals cards use it too. */
export function CodeChip({ code }: { code: string }) {
  const [copied, setCopied] = useState(false);
  const select = (el: Element | null) => {
    const sel = window.getSelection();
    if (!el || !sel) return;
    const range = document.createRange();
    range.selectNodeContents(el);
    sel.removeAllRanges();
    sel.addRange(range);
  };
  const copy = (chip: HTMLElement) => {
    const text = chip.querySelector("code");
    if (!navigator.clipboard) {
      select(text);
      return;
    }
    void navigator.clipboard.writeText(code).then(
      () => setCopied(true),
      // Clipboard refused (permissions or an old browser): select the code so it can be copied by hand.
      () => {
        setCopied(false);
        select(text);
      },
    );
  };
  return (
    <>
      <InlineTextButton className="gg-code-chip" onClick={(e) => copy(e.currentTarget)} aria-label={CARD_WORDS.copyCode(code)} data-gift-code-copy={code}>
        <code>{code}</code>
        {copied ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />}
      </InlineTextButton>
      <span className="gg-code-copied" aria-live="polite" data-gift-code-copied={copied ? "" : undefined}>{copied ? CARD_WORDS.copied : ""}</span>
    </>
  );
}

/**
 * One card per store (guides audit 1122 #13: Bonheur Jewelry showed three times with one photo). The store's best code
 * leads the card; any others sit under a "+N more codes" button, each with its own offer, dates and copy chip.
 */
function CodeCard({ store, codes }: { store: string; codes: DiscountCode[] }) {
  // Owner 2026-11-22 ("make everything open expanded"): a store's other codes show on arrival (START_OPEN).
  const [all, setAll] = useState(START_OPEN);
  const best = bestCode(codes);
  const others = codes.filter((c) => c !== best);
  const href = best.href as string;
  // Polish audit 1127 #93: the offer in ink like every deal card, its dates on their own 12px grey line (were one grey line).
  const line = (c: DiscountCode) => {
    const when = DEALS_WORDS.runs(c.starts, c.expires);
    return <><span className="gg-card-offer">{offerOnly(c.offer)}</span>{when && <span className="gg-card-when">{when}</span>}</>;
  };
  return (
    <Card store={store} href={href} name={`${store}: ${best.offer}`} line={
      <>
        {line(best)}
        {all && (
          <ul className="gg-card-sales" data-gift-code-more-list={store}>
            {others.map((c) => (
              <li key={c.code || c.offer} data-gift-code-extra={c.code}>
                <span>{line(c)}</span>
                {c.code && <CodeChip code={c.code} />}
              </li>
            ))}
          </ul>
        )}
        {!all && others.length > 0 && (
          <InlineTextButton className="gg-card-more" onClick={() => setAll(true)} data-gift-code-more={store}>{CARD_WORDS.moreCodes(others.length)}</InlineTextButton>
        )}
      </>
    } data={{ "data-gift-code": best.code, "data-gift-code-store": store }}>
      {/* A no-code sale (code "", Bruno Marc's Black Friday 25%) has nothing to copy. */}
      {best.code && <CodeChip code={best.code} />}
    </Card>
  );
}


/** The codes that work on `day`, one card per store. */
export function CodeCards({ codes }: { codes: DiscountCode[] }) {
  // Holiday audit 1121 #81: every code carries its store link (affiliate, else the brand's plain home page).
  // A code with no link (none today; src/test/giftGuideHolidayPolish1121c.test.tsx) is not drawn as a dead card.
  const byStore = new Map<string, DiscountCode[]>();
  for (const c of codes) if (c.href) byStore.set(c.store, [...(byStore.get(c.store) ?? []), c]);
  return (
    <ul className="gg-deal-grid" data-gift-codes="">
      {[...byStore.entries()].map(([store, list]) => <CodeCard key={store} store={store} codes={list} />)}
    </ul>
  );
}

/** The store sales on `day`, one card per store. */
export function SaleCards({ stores }: { stores: { store: string; sales: Sale[] }[] }) {
  return (
    <ul className="gg-deal-grid" data-gift-sales="">
      {stores.map(({ store, sales }) => <SaleCard key={store} store={store} sales={sales} />)}
    </ul>
  );
}

const SALE_LINES = 2;

function SaleCard({ store, sales }: { store: string; sales: Sale[] }) {
  // Owner 2026-11-22 ("make everything open expanded"): every sale of the store shows on arrival (START_OPEN).
  const [all, setAll] = useState(START_OPEN);
  const shown = all ? sales : sales.slice(0, SALE_LINES);
  return (
    <Card store={store} href={sales[0].href} name={`${store}: ${sales[0].offer}`} data={{ "data-gift-sale-store": store }} line={
      <ul className="gg-card-sales">
        {shown.map((x) => (
          <li key={x.href} data-gift-sale={x.slug}>
            <GiftOut href={x.href} className="gg-card-sale">{offerOnly(x.offer)}</GiftOut> <span className="gg-card-when">{DEALS_WORDS.runs(null, x.ends)}</span>
          </li>
        ))}
        {!all && sales.length > SALE_LINES && (
          <li><InlineTextButton className="gg-card-more" onClick={() => setAll(true)} data-gift-sale-more={store}>{CARD_WORDS.moreSales(sales.length - SALE_LINES)}</InlineTextButton></li>
        )}
      </ul>
    } />
  );
}

/** The cards' own styles (the photo, store name and grid come from the deal cards' .gg-deal rules). */
export const CARD_CSS = `
.gg-store-card .gg-card-store{color:var(--gg-ink);text-decoration:none}
.gg-store-card .gg-card-store:hover,.gg-store-card .gg-card-store:focus-visible{text-decoration:underline}
.gg-card-line{font-size:12.5px;line-height:1.4;overflow-wrap:anywhere}
.gg-card-sales{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:4px}
.gg-card-sale{color:var(--gg-ink);text-decoration:none}
.gg-card-offer{color:var(--gg-ink)}
[data-gift-codes] .gg-card-when{font-size:12px}
.gg-card-sale:hover,.gg-card-sale:focus-visible{text-decoration:underline}
.gg-card-when{display:block;color:var(--gg-muted);white-space:nowrap}
.gg-card-more{min-height:44px;padding:0;border:0;background:none;color:var(--gg-olive);font-weight:700;font-size:12.5px}
.gg-card-head{display:flex;align-items:flex-start;gap:4px;margin-top:2px}
.gg-card-head .gg-card-store{flex:1;min-width:0;margin:0}
.gg-store-card:not(:has(>.gg-deal-photo))>.gg-card-head{padding-right:38px}
.gg-store-card .gg-card-store{display:flex;align-items:center;min-height:44px}
.gg-card-actions{display:flex;flex-wrap:wrap;align-items:center;gap:4px 8px;margin-top:auto;padding-top:4px}
.gg-code-chip{display:inline-flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:2px 6px;width:100%;min-height:44px;min-width:0;padding:4px 8px;border:0;border-radius:10px;background:var(--gg-soft);color:var(--gg-ink);cursor:pointer}
.gg-code-chip code{font-size:12.5px;font-weight:700;letter-spacing:0;white-space:nowrap;text-align:left}
.gg-code-chip svg{width:15px;height:15px;flex:none;color:var(--gg-olive)}
.gg-code-copied{font-size:12px;font-weight:700;color:var(--gg-olive)}
.gg-code-copied:empty{display:none}
/* Visual audit 1122-night #4: on a phone (under 480px) two Sales cards side by side squeezed the busiest stores'
   4-5 deals into a ~130px column, a wall of text. There each Sales card takes the full row, its photo a 96px square on
   the left and the store name and every deal beside it (the heart stays top-right). 480px and up: unchanged. */
/* Guide visual audit 1123b #3 (Med): on a phone the Sales lines were 12.5px links 15-33px tall, stacked ~4px apart (59 on
   Black Friday, 35 on Cyber Monday; one hardware store has 5 in one card), hard to read and easy to mis-tap. Under 768px every
   deal card's text is 14px and each sale (its offer with its end date under it) is one tap row at least 44px tall: the
   link's hit area covers the whole row (::after), so the date stays right under its offer, and rows sit 12px apart. The
   one-column layout below stays. Black Friday and Cyber Monday share these cards, so both pages change together. */
@media (max-width:767px){
.gg-card-line{font-size:14px}
.gg-card-sales{gap:4px}
.gg-card-sales>li[data-gift-sale]{position:relative;min-height:44px;padding:4px 0}
.gg-card-sale::after{content:"";position:absolute;inset:0}
.gg-card-more{font-size:14px}
.gg-card-when{font-size:12.5px}
}
@media (max-width:479px){
.gg-deal-grid[data-gift-sales]{grid-template-columns:minmax(0,1fr)}
[data-gift-sales]>.gg-store-card:has(>.gg-deal-photo){display:grid;grid-template-columns:96px minmax(0,1fr);column-gap:12px;row-gap:4px;align-content:start}
[data-gift-sales]>.gg-store-card>.gg-deal-photo{grid-column:1;grid-row:1/span 3;align-self:start;height:96px}
[data-gift-sales]>.gg-store-card:has(>.gg-deal-photo)>:is(.gg-card-head,.gg-card-line,.gg-card-actions){grid-column:2}
[data-gift-sales]>.gg-store-card>.gg-card-head{padding-right:38px}
}
`;
