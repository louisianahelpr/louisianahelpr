import { Link } from "react-router-dom";
import { giftGuides as G, activeCodes, codesByStore, discountCodes, type DiscountCode } from "@/content/giftGuides";
import { useState } from "react";
import { MyListLink } from "./GiftGuideMyList";
import { ROWS, guidesIn, searchGuides, type CatalogGuide } from "@/content/giftGuideCatalog";
import { ICON_STROKE_PX } from "@/lib/iconWeight";

/**
 * Every guide by group (owner's final design 2026-11-18): a 220px sticky menu beside the page on desktop, above it on
 * phones. Each group is a <details> that starts COLLAPSED; tapping its name opens it (+ / −). On a guide's page only
 * that guide's group starts open, and the open guide (or "All guides" on the landing) is aria-current, drawn
 * olive-soft. Each group carries a small square in its covers' palette. "For kids" lists Girls, Boys and
 * Gender-Neutral (owner 2026-11-18); their age guides open from those pages. Keyed on the open guide, so moving to
 * another guide resets which group is open.
 */
export function GiftGuidesSidebar({ active, myList = false }: { active: CatalogGuide | null; myList?: boolean }) {
  const current = (slug: string | null) => (!myList && (active?.slug ?? null) === slug ? ({ "aria-current": "page" } as const) : {});
  const [query, setQuery] = useState("");
  const found = searchGuides(query);
  return (
    <nav key={active?.slug ?? ""} className="gg-side" aria-label={G.sidebarLabel} data-gift-sidebar="">
      {/* Owner 2026-11-18: a search box at the top of the menu filters every guide by its title or group. */}
      <label className="gg-search">
        <svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true"><circle cx="11" cy="11" r="7" fill="none" stroke="currentColor" strokeWidth={ICON_STROKE_PX} /><path d="M20 20l-4-4" stroke="currentColor" strokeWidth={ICON_STROKE_PX} strokeLinecap="round" /></svg>
        <input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search" aria-label="Search gift guides" data-gift-search="" />
      </label>
      <MyListLink current={myList} />
      {query.trim() ? (
        <ul data-gift-search-results="" aria-live="polite">
          {found.length === 0 && <li className="gg-search-none">{G.searchNone}</li>}
          {found.map((g) => (
            <li key={g.slug}>
              <Link to={`/gift-guides/${g.slug}`} {...current(g.slug)} data-gift-found={g.slug}>{g.age ? `${g.title}, ${g.lead.replace(/^gifts for /, "")}` : g.title}</Link>
            </li>
          ))}
        </ul>
      ) : (<>
      {/* Owner 2026-11-18: the codes sit at the TOP of the menu; a code past its last day hides itself. */}
      <DiscountCodes codes={activeCodes(discountCodes, localToday())} />
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
      </>)}
    </nav>
  );
}

/** Today as YYYY-MM-DD in the visitor's own time zone. */
const localToday = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

/**
 * The sidebar's "Discount codes" section (owner 2026-11-18): one box per store, by rank, each code with its own copy
 * button. Hidden while there are none.
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
    <details open className="gg-codes" data-gift-codes="">
      <summary>{G.codesLabel}</summary>
      <ul>
        {codesByStore(codes).map(({ store, codes: list }) => (
          <li key={store} data-gift-code-store={store}>
            <span className="gg-code-store">{store}</span>
            {list.map((c) => (
              <span key={c.code} className="gg-code-one" data-gift-code={c.code}>
                <span className="gg-code-offer">{c.offer}</span>
                {c.dates ? <span className="gg-code-offer">{G.codeValid(c.dates)}</span> : c.expires && <span className="gg-code-offer">{G.codeEnds(c.expires)}</span>}
                <span className="gg-code-row">
                  <code>{c.code}</code>
                  <button type="button" onClick={() => copy(c.code)} aria-label={`${G.copyCode} ${c.code}`}>
                    {copied === c.code ? G.copiedCode : G.copyCode}
                  </button>
                </span>
              </span>
            ))}
          </li>
        ))}
      </ul>
    </details>
  );
}
