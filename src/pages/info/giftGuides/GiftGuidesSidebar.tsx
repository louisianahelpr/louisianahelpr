import { Link } from "react-router-dom";
import { InlineTextButton } from "@/components/ui/InlineTextButton";
import { giftGuides as G, activeCodes, codesByStore, discountCodes, type DiscountCode } from "@/content/giftGuides";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { ROWS, guideBySlug, guidesIn, type CatalogGuide } from "@/content/giftGuideCatalog";
import { DEAL_CODES, SALES, type Sale } from "@/content/giftGuidePicks";
import { GiftOut } from "./GiftOut";

/**
 * Every guide by group (owner's final design 2026-11-18): a 220px sticky menu beside the page on desktop, after it on
 * phones. Each group is a <details> that starts COLLAPSED; tapping its name opens it (+ / −). On a guide's page only
 * that guide's group starts open, and the open guide (or "All guides" on the landing) is aria-current, drawn
 * olive-soft. Each group carries a small square in its covers' palette. "For kids" lists Girls, Boys and
 * Gender-Neutral (owner 2026-11-18); their age guides open from those pages. Keyed on the open guide, so moving to
 * another guide resets which group is open.
 */
export function GiftGuidesSidebar({ active, myList = false }: { active: CatalogGuide | null; myList?: boolean }) {
  const current = (slug: string | null) => (!myList && (active?.slug ?? null) === slug ? ({ "aria-current": "page" } as const) : {});
  return (
    <nav key={active?.slug ?? ""} className="gg-side" aria-label={G.sidebarLabel} data-gift-sidebar="">
      {/* Owner redesign 11-18 PM: search and My list moved to the slim row under the title, and the codes and sales to
          the page's one "Deals & codes" section; the menu is only the guides. */}
      <ul>
        <li><Link to="/gift-guides" {...current(null)} data-gift-side="">{G.allGuidesLabel}</Link></li>
      </ul>
      {ROWS.map(({ row, label, tint }) => (
        <details key={row} open={row === active?.row} data-gift-group={row}>
          <summary><i className={`gg-dot gg-${tint}`} aria-hidden="true" />{label}</summary>
          <ul>
            {guidesIn(row).map((g) => (
              <li key={g.slug}>
                <Link to={`/gift-guides/${g.slug}`} {...current(g.slug)} data-gift-side={g.slug}>{g.title}</Link>
              </li>
            ))}
          </ul>
        </details>
      ))}
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
export function DiscountCodes({ codes }: { codes: DiscountCode[] }) {
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
        {codesByStore(codes).map(({ store, codes: list }) => (
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
    </div>
  );
}

/** The sales still on `today` (YYYY-MM-DD): a sale shows through its end day. */
export const liveSales = (sales: readonly Sale[], today: string) => {
  // One line per link (design audit r2 #10: 9 duplicate hrefs, Gilt and Gilt City repeating the same offers).
  const seen = new Set<string>();
  return sales.filter((x) => x.ends >= today && !seen.has(x.href) && Boolean(seen.add(x.href)));
};

/** The sales the list shows before "See all sales". */
const SALES_FIRST = 12;

/**
 * "Sales" (follow-up batch 2026-11-18), under Discount codes in "Deals & codes": one line per live store sale, soonest
 * end first, the offer opening the sale (affiliate link) and the store opening its guide page; hidden while there are
 * none.
 */
export function SalesList({ sales }: { sales: readonly Sale[] }) {
  const [all, setAll] = useState(false);
  if (sales.length === 0) return null;
  return (
    <div className="gg-codes" data-gift-sales="">
      <h3 className="gg-deals-sub">{G.salesLabel}</h3>
      <ul>
        {(all ? sales : sales.slice(0, SALES_FIRST)).map((x) => (
          <li key={`${x.slug} ${x.href}`} data-gift-sale={x.slug}>
            {guideBySlug(x.slug) && !guideBySlug(x.slug)!.empty ? <Link to={`/gift-guides/${x.slug}`} className="gg-code-store">{x.store}</Link> : <span className="gg-code-store">{x.store}</span>}
            <GiftOut href={x.href} className="gg-link">{x.offer}</GiftOut>
            <span className="gg-code-offer">{G.dealEnds(x.ends)}</span>
          </li>
        ))}
      </ul>
      {!all && sales.length > SALES_FIRST && (
        <Button type="button" variant="link" size="inline" className="gg-link" onClick={() => setAll(true)} data-gift-all-sales="">{G.allSalesLabel(sales.length)}</Button>
      )}
    </div>
  );
}

/**
 * "Deals & codes" (owner redesign 11-18 PM: "Codes should be a section with the other discount stuff right?"): ONE
 * section holding the discount codes and the store sales, after the landing's guide rows and after a guide's picks.
 * It starts COLLAPSED on every page and screen and never opens by itself (owner 11-18: "discount code shouldn't open
 * expanded"; no open state is remembered across pages). Hidden while it holds nothing.
 */
export function DealsAndCodes() {
  const today = localToday();
  const codes = activeCodes([...discountCodes, ...DEAL_CODES], today);
  const sales = liveSales(SALES, today);
  if (codes.length === 0 && sales.length === 0) return null;
  return (
    <details id="gift-codes" className="gg-deals" data-gift-deals-codes="">
      <summary>{G.dealsAndCodesLabel}</summary>
      <DiscountCodes codes={codes} />
      <SalesList sales={sales} />
    </details>
  );
}
