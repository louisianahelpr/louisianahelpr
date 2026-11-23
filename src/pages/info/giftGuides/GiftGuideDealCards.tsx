import { useState, type ReactNode } from "react";
import { InlineTextButton } from "@/components/ui/InlineTextButton";
import { Check, Copy } from "lucide-react";
import { activeCodes, codesByStore, discountCodes, giftGuides as G, type DiscountCode } from "@/content/giftGuides";
import { DEAL_CODES, SALES, type Sale } from "@/content/giftGuidePicks";
import { cleanCodes, cleanSales } from "@/lib/giftGuideOfferCopy.mjs";
import { storePhoto } from "@/content/giftGuideStorePhotos";
import { DEAL_EVENTS, DEALS_SLUG, DEALS_WORDS } from "@/content/giftGuideDeals.mjs";
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

const CLEAN_CODES = cleanCodes(DEAL_CODES);
const CLEAN_SALES = cleanSales(SALES);

export const CARD_WORDS = {
  codesTitle: "Discount codes",
  salesTitle: "Sales",
  dealsTitle: "Top deals",
  openSite: (store: string) => `Open ${store} site`,
  copyCode: (code: string) => `Copy code ${code}`,
  copied: "Copied",
  moreSales: (n: number) => `+${n} more`,
  moreCodes: (n: number) => `+${n} more ${n === 1 ? "code" : "codes"}`,
};

/** The sales still on `today` (YYYY-MM-DD): a sale shows through its end day, one line per link. */
export const liveSales = (sales: readonly Sale[], today: string) => {
  // One line per link (design audit r2 #10: 9 duplicate hrefs, Gilt and Gilt City repeating the same offers).
  const seen = new Set<string>();
  return sales.filter((x) => x.ends >= today && !seen.has(x.href) && Boolean(seen.add(x.href)));
};

/** The codes that work on `day` (YYYY-MM-DD), by store rank, one entry per code. */
export const codesOn = (day: string): DiscountCode[] => codesByStore(activeCodes([...discountCodes, ...CLEAN_CODES], day)).flatMap((s) => s.codes);

/** The store sales on `day`, one entry per store (its sales soonest end first), the stores in first-sale order. */
export const salesOn = (day: string) => {
  const stores = new Map<string, Sale[]>();
  // Guides audit 1122 #15: a line that names the OTHER deal day (Cyber Monday's "Black Friday Deals Are in") is left off;
  // a line that names both days ("Black Friday/Cyber Monday") stays.
  const here = DEAL_EVENTS.find((e) => e.kind === "deals" && e.day === day);
  const other = here && DEAL_EVENTS.filter((e) => e.kind === "deals" && e !== here).map((e) => e.title);
  const namesOther = (offer: string) => Boolean(here && other!.some((t) => offer.includes(t)) && !offer.includes(here.title));
  for (const x of liveSales(CLEAN_SALES.filter((s) => !namesOther(s.offer)), day)) stores.set(x.store, [...(stores.get(x.store) ?? []), x]);
  return [...stores.entries()].map(([store, sales]) => ({ store, sales }));
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

/** The bigger the percent in a code's offer, the better it is; an offer with none ranks after one with a percent. */
const codePercent = (c: DiscountCode) => Number(/(\d+)\s*%/.exec(c.offer)?.[1] ?? 0);

/**
 * One card per store (guides audit 1122 #13: Bonheur Jewelry showed three times with one photo). The store's best code
 * leads the card; any others sit under a "+N more codes" button, each with its own offer, dates and copy chip.
 */
function CodeCard({ store, codes }: { store: string; codes: DiscountCode[] }) {
  // Owner 2026-11-22 ("make everything open expanded"): a store's other codes show on arrival (START_OPEN).
  const [all, setAll] = useState(START_OPEN);
  const best = codes.reduce((a, c) => (codePercent(c) > codePercent(a) ? c : a), codes[0]);
  const others = codes.filter((c) => c !== best);
  const href = best.href as string;
  const line = (c: DiscountCode) => [c.offer, DEALS_WORDS.runs(c.starts, c.expires)].filter(Boolean).join(" · ");
  return (
    <Card store={store} href={href} name={`${store}: ${best.offer}`} line={
      <>
        {line(best)}
        {all && (
          <ul className="gg-card-sales" data-gift-code-more-list={store}>
            {others.map((c) => (
              <li key={c.code} data-gift-code-extra={c.code}>
                <span>{line(c)}</span>
                <CodeChip code={c.code} />
              </li>
            ))}
          </ul>
        )}
        {!all && others.length > 0 && (
          <InlineTextButton className="gg-card-more" onClick={() => setAll(true)} data-gift-code-more={store}>{CARD_WORDS.moreCodes(others.length)}</InlineTextButton>
        )}
      </>
    } data={{ "data-gift-code": best.code, "data-gift-code-store": store }}>
      <CodeChip code={best.code} />
    </Card>
  );
}

/** How many cards the codes make: one per store with a link. */
export const codeCardCount = (codes: readonly DiscountCode[]) => new Set(codes.filter((c) => c.href).map((c) => c.store)).size;

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
            <GiftOut href={x.href} className="gg-card-sale">{x.offer}</GiftOut> <span className="gg-card-when">{DEALS_WORDS.runs(null, x.ends)}</span>
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
`;
