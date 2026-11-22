import { Link } from "react-router-dom";
import { useState } from "react";
import { InlineTextButton } from "@/components/ui/InlineTextButton";
import { Button } from "@/components/ui/button";
import { giftGuides as G, activeCodes, codesByStore, discountCodes, type DiscountCode } from "@/content/giftGuides";
import { guideBySlug } from "@/content/giftGuideCatalog";
import { DEAL_CODES, SALES, type Sale } from "@/content/giftGuidePicks";
import { cleanCodes, cleanSales } from "@/lib/giftGuideOfferCopy.mjs";
import { louisianaDay } from "@/content/giftGuideDeals.mjs";
import { GiftOut } from "./GiftOut";

/*
 * "Deals & codes" (codes + store sales), split out of GiftGuidesSidebar 2026-11-21 (train 1121i budget): only the
 * deals day pages render it, so keeping it in the menu's module put it, the offer-copy cleaning and the feed rows on
 * every guide page's critical path (/gift-guides/:slug measured 353 KB gz against its 352.8 cap).
 */
const CLEAN_DEAL_CODES = cleanCodes(DEAL_CODES);
const CLEAN_SALES = cleanSales(SALES);

/**
 * Today as YYYY-MM-DD in Louisiana, the day every code, sale and deal card is dated by (holiday audit 1121: the codes
 * box used the visitor's own zone while the deal cards used Louisiana's, so near midnight the two disagreed).
 */
const localToday = () => louisianaDay(new Date());

/**
 * "Discount codes" (owner 2026-11-18), inside the collapsed "Deals & codes" section: one box per store, by rank, each
 * code with its own copy button. Hidden while there are none.
 */
function DiscountCodes({ codes, first = Infinity }: { codes: DiscountCode[]; first?: number }) {
  const [all, setAll] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);
  if (codes.length === 0) return null;
  const copy = (code: string) => {
    void navigator.clipboard?.writeText(code).then(
      () => setCopied(code),
      // Clipboard refused (permissions or an old browser): the code stays on screen to copy by hand.
      () => setCopied(null),
    );
  };
  return (
    <div className="gg-codes" data-gift-codes="">
      <h2 className="gg-deals-sub">{G.codesLabel}</h2>
      <ul>
        {(all ? codesByStore(codes) : codesByStore(codes).slice(0, first)).map(({ store, codes: list }) => {
          // Holiday audit 1121 #81: a store with a link opens from its box, so a copied code has somewhere to go.
          const shop = list.find((c) => c.href)?.href;
          return (
          <li key={store} data-gift-code-store={store}>
            <span className="gg-code-store">
              {store}
              {shop && <GiftOut href={shop} className="gg-code-shop" data-gift-code-shop={store}>{G.codeShop} ›</GiftOut>}
            </span>
            {list.map((c) => (
              <span key={c.code} className="gg-code-one" data-gift-code={c.code}>
                <span className="gg-code-offer">{c.offer}</span>
                {c.dates ? <span className="gg-code-offer">{G.codeValid(c.dates)}</span> : c.expires && <span className="gg-code-offer">{G.dealEnds(c.expires)}</span>}
                <span className="gg-code-row">
                  <code>{c.code}</code>
                  <InlineTextButton className="no-underline" onClick={() => copy(c.code)} aria-label={`${G.copyCode} ${c.code}`}>
                    {copied === c.code ? G.copiedCode : G.copyCode}
                  </InlineTextButton>
                </span>
              </span>
            ))}
          </li>
          );
        })}
      </ul>
      {!all && codesByStore(codes).length > first && (
        <Button type="button" variant="link" size="inline" className="gg-link" onClick={() => setAll(true)} data-gift-all-codes="">{G.allCodesLabel(codesByStore(codes).length)}</Button>
      )}
    </div>
  );
}

/** The sales still on `today` (YYYY-MM-DD): a sale shows through its end day. */
export const liveSales = (sales: readonly Sale[], today: string) => {
  // One line per link (design audit r2 #10: 9 duplicate hrefs, Gilt and Gilt City repeating the same offers).
  const seen = new Set<string>();
  return sales.filter((x) => x.ends >= today && !seen.has(x.href) && Boolean(seen.add(x.href)));
};

/** Rows Deals & codes shows when opened, codes first (design spec 11-18 H5). */
const DEALS_ROWS = 8;
/** Of those, the rows the sales always keep while there are sales. */
const SALES_MIN = 3;

/** The sales the list shows before "See all sales". */
const SALES_FIRST = 12;

/**
 * "Sales" (follow-up batch 2026-11-18), under Discount codes in "Deals & codes": one line per live store sale, soonest
 * end first, the offer opening the sale (affiliate link) and the store opening its guide page; hidden while there are
 * none.
 */
export function SalesList({ sales, first = SALES_FIRST }: { sales: readonly Sale[]; first?: number }) {
  const [all, setAll] = useState(false);
  if (sales.length === 0) return null;
  return (
    <div className="gg-codes" data-gift-sales="">
      <h2 className="gg-deals-sub">{G.salesLabel}</h2>
      <ul>
        {(all ? sales : sales.slice(0, first)).map((x) => (
          <li key={`${x.slug} ${x.href}`} data-gift-sale={x.slug}>
            {guideBySlug(x.slug) && !guideBySlug(x.slug)!.empty ? <Link to={`/gift-guides/${x.slug}`} className="gg-code-store">{x.store}</Link> : <span className="gg-code-store">{x.store}</span>}
            <GiftOut href={x.href} className="gg-link">{x.offer}</GiftOut>
            <span className="gg-code-offer">{G.dealEnds(x.ends)}</span>
          </li>
        ))}
      </ul>
      {!all && sales.length > first && (
        <Button type="button" variant="link" size="inline" className="gg-link" onClick={() => setAll(true)} data-gift-all-sales="">{G.allSalesLabel(sales.length)}</Button>
      )}
    </div>
  );
}

/**
 * "Deals & codes" (owner redesign 11-18 PM: "Codes should be a section with the other discount stuff right?"): ONE
 * section holding the discount codes and the store sales, on the deals days only (owner 11-21: "Codes and deals
 * shouldn't randomly show in sections": no guide page carries it).
 * It starts COLLAPSED on every page and screen, the deals days too, and never opens by itself (owner 11-18: "discount
 * code shouldn't open expanded"; owner 11-21: "[Deals & codes box] should open collapsed"; no open state is remembered
 * across pages). Hidden while it holds nothing. `on` (a deals day, YYYY-MM-DD) keeps only the codes and sales that
 * still work on that day (owner 11-21: each day its own page with its own codes; giftGuideDeals.mjs codesDay).
 */
export function DealsAndCodes({ on }: { on?: string } = {}) {
  const day = on ?? localToday();
  // Holiday audit 1121 #57: the feed rows read through cleanCodes / cleanSales (no cut-off lines, non-sales, ALL CAPS or "Holiday code").
  const codes = activeCodes([...discountCodes, ...CLEAN_DEAL_CODES], day);
  const sales = liveSales(CLEAN_SALES, day);
  if (codes.length === 0 && sales.length === 0) return null;
  // Design spec 11-18 H5: a cream card; open, at most 8 rows show (codes first, then sales), each list with its See all.
  const stores = codesByStore(codes).length;
  // Holiday audit 1121: with 18 code stores all 8 rows went to codes, and "Sales" showed a heading over no rows; the
  // sales keep at least SALES_MIN rows whenever there are any.
  const codeRows = Math.min(stores, sales.length > 0 ? DEALS_ROWS - SALES_MIN : DEALS_ROWS);
  return (
    <details id="gift-codes" className="gg-deals" data-gift-deals-codes="">
      <summary><span className="gg-deals-title">{G.dealsAndCodesLabel}</span><span className="gg-deals-count" data-gift-deals-count="">{G.dealsCount(sales.length, codes.length)}</span></summary>
      <DiscountCodes codes={codes} first={codeRows} />
      <SalesList sales={sales} first={DEALS_ROWS - codeRows} />
    </details>
  );
}

