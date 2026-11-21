import { Link } from "react-router-dom";
import { InlineTextButton } from "@/components/ui/InlineTextButton";
import { giftGuides as G, activeCodes, codesByStore, discountCodes, type DiscountCode } from "@/content/giftGuides";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { guideBySlug, type CatalogGuide } from "@/content/giftGuideCatalog";
import { DEAL_CODES, SALES, type Sale } from "@/content/giftGuidePicks";
import { GiftOut } from "./GiftOut";
import { DEALS_SLUG } from "@/content/giftGuideDeals.mjs";
import { FUN_TOOLS, FUN_WORDS } from "@/content/giftGuideFun1120";
import { EXTRAS_WORDS, FINDER_ANCHOR as FINDER_ID } from "@/content/giftGuideExtras1120";
import { PRINTABLES_PATH, PRINTABLES_WORDS, shownPrintables } from "@/content/printables";

/** The 25 Days sponsors page: an entry of its own in the menu's second block. */
const SPONSORS_SLUG = "25-days-sponsors";
/**
 * The three guides, each with a dot in its cover's colour (owner 11-21: "since it's just 3 guides now you don't really
 * need to filter it, maybe just do for her, him, kids with their color"; then the covers swapped to Her beige, Him
 * Christmas green, Kids Christmas red).
 */
const SIDE_GUIDES = [
  { slug: "her", dot: "oat" },
  { slug: "him", dot: "green" },
  { slug: "kids", dot: "red" },
] as const;

/**
 * The gift guides menu (owner 2026-11-21): a 220px sticky menu beside the page on desktop, after the page on a phone.
 * First block: All guides and the three guides as plain links, each with its cover's colour dot (no group headers or
 * +/− toggles). Second block, plain links: Black Friday deals, Small Business Saturday and Cyber Monday (the deals
 * page's sections), Free printables, the Louisiana Holiday Hub and 25 Days sponsors (owner 11-21: "free printables,
 * louisiana hub, sponsors go in the left panel ... and black friday deals, small business saturday and cyber monday";
 * earlier "move the holiday hub into the left column and remove it from the main holiday screen"). Then the fun tools. The open page (a
 * relationship view like /gift-guides/mom marks its guide, Her) is aria-current, drawn olive-soft.
 */
export function GiftGuidesSidebar({ active, myList = false, page }: { active: CatalogGuide | null; myList?: boolean; page?: string }) {
  const open = page ?? active?.view?.of ?? active?.slug ?? null;
  const current = (slug: string | null) => (!myList && open === slug ? ({ "aria-current": "page" } as const) : {});
  const guides = SIDE_GUIDES.flatMap((x) => {
    const g = guideBySlug(x.slug);
    return g && !g.empty ? [{ ...x, title: g.title }] : [];
  });
  return (
    <nav className="gg-side" aria-label={G.sidebarLabel} data-gift-sidebar="">
      <ul data-gift-side-guides="">
        <li><Link to="/gift-guides" {...current(null)} data-gift-side="">{G.allGuidesLabel}</Link></li>
        {guides.map((g) => (
          <li key={g.slug}>
            <Link to={`/gift-guides/${g.slug}`} {...current(g.slug)} data-gift-side={g.slug}><i className={`gg-dot gg-${g.dot}`} aria-hidden="true" data-gift-side-dot={g.dot} />{g.title}</Link>
          </li>
        ))}
      </ul>
      <ul className="gg-side-more" data-gift-side-more="">
        {/* The deals page's three day sections (owner 11-21: "black friday deals, small business saturday and cyber
            monday"); the deals page marks Black Friday, its first section. */}
        {G.sideDeals.map((d, i) => (
          <li key={d.id}><Link to={`/gift-guides/${DEALS_SLUG}#${d.id}`} {...(i === 0 ? current(DEALS_SLUG) : {})} data-gift-side-deals={d.id}>{d.label}</Link></li>
        ))}
        {shownPrintables().length > 0 && <li><Link to={PRINTABLES_PATH} data-gift-side-printables="">{PRINTABLES_WORDS.tile.title}</Link></li>}
        <li><Link to="/holidays" data-gift-side-holiday-hub="">{G.holidayHub.title}</Link></li>
        <li><Link to={`/gift-guides/${SPONSORS_SLUG}`} {...current(SPONSORS_SLUG)} data-gift-side-sponsors="">{G.sideSponsorsLabel}</Link></li>
      </ul>
      <p className="gg-side-h">{FUN_WORDS.toolsTitle}</p>
      <ul data-gift-side-tools="">
        <li><Link to={`/gift-guides#${FINDER_ID}`} data-gift-side-tool="finder">{EXTRAS_WORDS.finderTitle}</Link></li>
        {FUN_TOOLS.map((t) => (
          <li key={t.to}><Link to={t.to} data-gift-side-tool={t.to}>{t.title}</Link></li>
        ))}
      </ul>
    </nav>
  );
}

/** Today as YYYY-MM-DD in the visitor's own time zone. */
const localToday = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

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
      <h3 className="gg-deals-sub">{G.codesLabel}</h3>
      <ul>
        {(all ? codesByStore(codes) : codesByStore(codes).slice(0, first)).map(({ store, codes: list }) => (
          <li key={store} data-gift-code-store={store}>
            <span className="gg-code-store">{store}</span>
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
        ))}
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
      <h3 className="gg-deals-sub">{G.salesLabel}</h3>
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
 * section holding the discount codes and the store sales, on the deals page only (owner 11-21: "Codes and deals
 * shouldn't randomly show in sections": no guide page carries it).
 * It starts COLLAPSED on every page and screen and never opens by itself (owner 11-18: "discount code shouldn't open
 * expanded"; no open state is remembered across pages). Hidden while it holds nothing. The one exception is the deals
 * page itself (owner 11-21: "i dont see the discount codes or sales"), whose purpose is the codes and sales: there it
 * starts open (`open`).
 */
export function DealsAndCodes({ open = false }: { open?: boolean } = {}) {
  const today = localToday();
  const allCodes = activeCodes([...discountCodes, ...DEAL_CODES], today);
  const allSales = liveSales(SALES, today);
  const codes = allCodes;
  const sales = allSales;
  if (codes.length === 0 && sales.length === 0) return null;
  // Design spec 11-18 H5: a cream card; open, at most 8 rows show (codes first, then sales), each list with its See all.
  const stores = codesByStore(codes).length;
  const codeRows = Math.min(stores, DEALS_ROWS);
  return (
    <details id="gift-codes" className="gg-deals" open={open} data-gift-deals-codes="">
      <summary><span className="gg-deals-title">{G.dealsAndCodesLabel}</span><span className="gg-deals-count" data-gift-deals-count="">{G.dealsCount(sales.length, codes.length)}</span></summary>
      <DiscountCodes codes={codes} first={codeRows} />
      <SalesList sales={sales} first={DEALS_ROWS - codeRows} />
    </details>
  );
}

