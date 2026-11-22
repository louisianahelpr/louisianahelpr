import { Link } from "react-router-dom";
import { giftGuides as G } from "@/content/giftGuides";
import { guideBySlug, type CatalogGuide } from "@/content/giftGuideCatalog";
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
