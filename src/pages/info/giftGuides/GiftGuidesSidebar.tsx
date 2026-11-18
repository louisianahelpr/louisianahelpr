import { Link } from "react-router-dom";
import { giftGuides as G, activeCodes, codesByStore, discountCodes, type DiscountCode } from "@/content/giftGuides";
import { useState } from "react";
import { ROWS, guidesIn, type CatalogGuide } from "@/content/giftGuideCatalog";

/**
 * Every guide by group (owner's final design 2026-11-18): a 220px sticky menu beside the page on desktop, above it on
 * phones. Each group is a <details> that starts COLLAPSED; tapping its name opens it (+ / −). On a guide's page only
 * that guide's group starts open, and the open guide (or "All guides" on the landing) is aria-current, drawn
 * olive-soft. Each group carries a small square in its covers' palette. "For kids" lists Girls, Boys and
 * Gender-Neutral (owner 2026-11-18); their age guides open from those pages. Keyed on the open guide, so moving to
 * another guide resets which group is open.
 */
export function GiftGuidesSidebar({ active }: { active: CatalogGuide | null }) {
  const current = (slug: string | null) => ((active?.slug ?? null) === slug ? ({ "aria-current": "page" } as const) : {});
  return (
    <nav key={active?.slug ?? ""} className="gg-side" aria-label={G.sidebarLabel} data-gift-sidebar="">
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
