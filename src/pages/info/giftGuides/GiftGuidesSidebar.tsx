import { Link } from "react-router-dom";
import { InlineTextButton } from "@/components/ui/InlineTextButton";
import { giftGuides as G, activeCodes, codesByStore, discountCodes, type DiscountCode } from "@/content/giftGuides";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { guideBySlug, type CatalogGuide } from "@/content/giftGuideCatalog";
import { DEAL_CODES, SALES, type Sale } from "@/content/giftGuidePicks";
import { GiftOut } from "./GiftOut";
import { louisianaDay } from "@/content/giftGuideDeals.mjs";
import { FUN_TOOLS, FUN_WORDS } from "@/content/giftGuideFun1120";
import { EXTRAS_WORDS, FINDER_ANCHOR as FINDER_ID } from "@/content/giftGuideExtras1120";
import { PRINTABLES_PATH, shownPrintables } from "@/content/printables";

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

/** The free printables the menu links into (anchors on the printables page), each only while it is shown. */
const SIDE_PRINTABLES = [
  { id: "gift-tags", anchor: "pr-tags", label: "Gift tags" },
  { id: "coloring-book", anchor: "pr-coloring", label: "Coloring books" },
  { id: "thanksgiving-banner", anchor: "pr-banners", label: "Banners" },
] as const;

/**
 * The gift guides menu (owner 2026-11-21: "guides, deals, free, make it fun should all be their own section and
 * everything else is a subsection ... right now it's messy"): five headed groups, each heading a plain small-caps
 * label (never a link), one divider style, 44px rows, the open page drawn olive-soft (aria-current):
 *   GUIDES: All guides, Her, Him, Kids (each with its cover's colour dot: beige, Christmas green, Christmas red);
 *   DEALS: Black Friday, Small Business Saturday, Cyber Monday (the deals page's day sections);
 *   FREE PRINTABLES: Gift tags, Coloring books, Banners (sections of the printables page, while each is shown);
 *   MAKE IT FUN: the gift finder and the fun tools;
 *   LOUISIANA: Holiday Hub, 25 Days sponsors, Shop Small.
 * A 220px sticky menu beside the page on desktop. On a phone (owner 11-21: "We need a way to organize this on the
 * phones") the sidebar is hidden and the same groups open in a bottom sheet from the chip row (GiftGuidesPhoneNav).
 */
export function GiftGuidesSidebar({ active, myList = false, page }: MenuProps) {
  return (
    <nav className="gg-side" aria-label={G.sidebarLabel} data-gift-sidebar="">
      <GiftGuidesMenu active={active} myList={myList} page={page} />
    </nav>
  );
}

interface MenuProps { active: CatalogGuide | null; myList?: boolean; page?: string }

/** The live guides with their cover dots, for the menu and the phone's chip row (GiftGuidesPhoneNav). */
export const sideGuides = () => SIDE_GUIDES.flatMap((x) => {
  const g = guideBySlug(x.slug);
  return g && !g.empty ? [{ ...x, title: g.title }] : [];
});

/** Which menu entry is open: a page key, a relationship view's guide (Mom -> Her), or the guide itself. */
export const openEntry = ({ active, page }: MenuProps) => page ?? active?.view?.of ?? active?.slug ?? null;

/**
 * The grouped menu's body, shared by the desktop sidebar and the phone's menu sheet (owner 11-21: "We need a way to
 * organize this on the phones"). `idPrefix` keeps the group heading ids unique when both are in the page.
 */
export function GiftGuidesMenu({ active, myList = false, page, idPrefix = "gg-side" }: MenuProps & { idPrefix?: string }) {
  const open = openEntry({ active, page });
  const current = (slug: string | null) => (!myList && open === slug ? ({ "aria-current": "page" } as const) : {});
  const guides = sideGuides();
  const shown = new Set(shownPrintables().map((p) => p.id));
  const printables = SIDE_PRINTABLES.filter((p) => shown.has(p.id));
  return (
    <>
      <p className="gg-side-h" id={`${idPrefix}-guides`}>{G.sideHeads.guides}</p>
      <ul data-gift-side-guides="" aria-labelledby={`${idPrefix}-guides`}>
        <li><Link to="/gift-guides" {...current(null)} data-gift-side="">{G.allGuidesLabel}</Link></li>
        {guides.map((g) => (
          <li key={g.slug}>
            <Link to={`/gift-guides/${g.slug}`} {...current(g.slug)} data-gift-side={g.slug}><i className={`gg-dot gg-${g.dot}`} aria-hidden="true" data-gift-side-dot={g.dot} />{g.title}</Link>
          </li>
        ))}
      </ul>
      <p className="gg-side-h" id={`${idPrefix}-deals`}>{G.sideHeads.deals}</p>
      <ul data-gift-side-deals-group="" aria-labelledby={`${idPrefix}-deals`}>
        {/* Holiday audit 1121 (High): each day is its own page, so each entry opens that page and is marked current on
            it (it was a #anchor on the one-page address that never scrolled, with Black Friday always marked). */}
        {G.sideDeals.map((d) => (
          <li key={d.id}><Link to={`/gift-guides/${d.id}`} {...current(d.id)} data-gift-side-deals={d.id}>{d.label}</Link></li>
        ))}
      </ul>
      {printables.length > 0 && (
        <>
          <p className="gg-side-h" id={`${idPrefix}-free`}>{G.sideHeads.free}</p>
          <ul data-gift-side-printables-group="" aria-labelledby={`${idPrefix}-free`}>
            {printables.map((p) => <li key={p.id}><Link to={`${PRINTABLES_PATH}#${p.anchor}`} data-gift-side-printables={p.id}>{p.label}</Link></li>)}
          </ul>
        </>
      )}
      <p className="gg-side-h" id={`${idPrefix}-fun`}>{FUN_WORDS.toolsTitle}</p>
      <ul data-gift-side-tools="" aria-labelledby={`${idPrefix}-fun`}>
        <li><Link to={`/gift-guides#${FINDER_ID}`} {...current("finder")} data-gift-side-tool="finder">{EXTRAS_WORDS.finderTitle}</Link></li>
        {FUN_TOOLS.map((t) => (
          <li key={t.to}><Link to={t.to} {...current(t.to)} data-gift-side-tool={t.to}>{t.title}</Link></li>
        ))}
      </ul>
      <p className="gg-side-h" id={`${idPrefix}-la`}>{G.sideHeads.louisiana}</p>
      <ul data-gift-side-more="" aria-labelledby={`${idPrefix}-la`}>
        <li><Link to="/holidays" data-gift-side-holiday-hub="">{G.sideHolidayHub}</Link></li>
        <li><Link to={`/gift-guides/${SPONSORS_SLUG}`} {...current(SPONSORS_SLUG)} data-gift-side-sponsors="">{G.sideSponsorsLabel}</Link></li>
        <li><Link to="/shop-small" {...current("/shop-small")} data-gift-side-shop-small="">{G.sideShopSmall}</Link></li>
      </ul>
    </>
  );
}

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
  const codes = activeCodes([...discountCodes, ...DEAL_CODES], day);
  const sales = liveSales(SALES, day);
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

