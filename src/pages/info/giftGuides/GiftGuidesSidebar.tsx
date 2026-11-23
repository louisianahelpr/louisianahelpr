import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { giftGuides as G } from "@/content/giftGuides";
import { guideBySlug, type CatalogGuide } from "@/content/giftGuideCatalog";
import { FUN_TOOLS, FUN_WORDS } from "@/content/giftGuideFun1120";
import { EXTRAS_WORDS, FINDER_ANCHOR as FINDER_ID } from "@/content/giftGuideExtras1120";
import { PRINTABLE_PAGES, printablesCount } from "@/content/printables";
import { CHUNK_PICK_COUNTS } from "@/content/giftGuidePicks";
import { loadModule, untilReload } from "@/lib/loadModule";
import { WISH_CORE as WISH } from "@/content/giftWishListCore";
import { MY_LIST_SLUG } from "./giftList";

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
 * The gift guides menu (owner 2026-11-21: "guides, deals, free, make it fun should all be their own section and
 * everything else is a subsection ... right now it's messy"): five headed groups, each heading a plain small-caps
 * label (never a link), one divider style, 44px rows, the open page drawn olive-soft (aria-current):
 *   GUIDES: All guides, Her, Him, Kids (each with its cover's colour dot: beige, Christmas green, Christmas red);
 *   DEALS: Black Friday, Small Business Saturday, Cyber Monday (the deals page's day sections);
 *   FREE PRINTABLES: Gift tags, Coloring books, Banners (each its own page, owner 11-21, while it has something shown);
 *   MAKE IT FUN: the gift finder and the fun tools;
 *   LOUISIANA: Holiday Hub, 25 Days sponsors (owner 11-21: Shop Small left: "it's already listed with small business
 *   saturday"; /shop-small opens that page).
 * A 220px sticky menu beside the page on desktop. On a phone (owner 11-21: "We need a way to organize this on the
 * phones") the sidebar is hidden and the same groups open in a bottom sheet from the head row's three-line icon (owner
 * 11-22, GuidesMenuButton in GiftGuidesPhoneNav.tsx).
 */
export function GiftGuidesSidebar({ active, myList = false, mine = myList, page }: MenuProps & { mine?: boolean }) {
  return (
    <nav className="gg-side" aria-label={G.sidebarLabel} data-gift-sidebar="">
      <GiftGuidesMenu active={active} myList={myList} mine={mine} page={page} wishList />
    </nav>
  );
}

interface MenuProps { active: CatalogGuide | null; myList?: boolean; page?: string }

/** The live guides with their cover dots, for the menu (desktop sidebar and the phone's menu sheet). */
const sideGuides = () => SIDE_GUIDES.flatMap((x) => {
  const g = guideBySlug(x.slug);
  return g && !g.empty ? [{ ...x, title: g.title }] : [];
});

/**
 * The number on the right of a menu row (owner 2026-11-22, 7:52 PM: "should we put the number of items in each section on
 * the right of the section name? like her (# of items) same for the free printable ones below?"; pop-up 7:55 PM: "Number
 * on the right"): the same number the page itself shows, muted, tabular, read by a screen reader with its noun ("Her 159
 * gifts"). Tools with no list (All guides, the finder, the fun tools, My Wish List) get none.
 * Guard: src/test/giftGuideRailCounts1122.test.tsx.
 */
const N = ({ n, noun = "items" }: { n?: number; noun?: string }) => (n ? <span className="gg-side-n">{" "}{n}<span className="sr-only"> {noun}</span></span> : null);

/**
 * The numbers that change with the date or live (Black Friday, Cyber Monday, the Holiday Hub, and Small Business
 * Saturday with its approved "Featured local" businesses: railCounts.ts), from their own chunk once the menu has drawn,
 * so a guide page's first paint carries none of them; read once per page load and shared by every menu on the page.
 * Small Business Saturday's number shows once its read is back (sponsors + featured local), never the sponsors first.
 */
let live: Record<string, number> = {};
let started = false;
const subs = new Set<() => void>();
const put = (r: Record<string, number>) => {
  live = { ...live, ...r };
  subs.forEach((f) => f());
};
const useLiveCounts = () => {
  const [, tick] = useState(0);
  useEffect(() => {
    const f = () => tick((x) => x + 1);
    subs.add(f);
    if (!started) {
      started = true;
      void loadModule(() => import("./railCounts")).then((m) => m ?? untilReload()).then((m) => {
        void m.smallBizCount().then((n) => put({ "small-business-saturday": n }));
        return m.railCounts();
      }).then(put, (e) => console.warn("gift guides: menu counts failed", e));
    }
    return () => void subs.delete(f);
  }, []);
  return live;
};

/** Which menu entry is open: a page key, a relationship view's guide (Mom -> Her), or the guide itself. */
const openEntry = ({ active, page }: MenuProps) => page ?? active?.view?.of ?? active?.slug ?? null;

/**
 * The grouped menu's body, shared by the desktop sidebar and the phone's menu sheet (owner 11-21: "We need a way to
 * organize this on the phones"). `idPrefix` keeps the group heading ids unique when both are in the page. `wishList`:
 * My Wish List under the guides (owner 11-22: the phone's three-line menu replaced its chip row, so it holds every guides
 * page; guide consistency audit 1122 #19: the desktop sidebar lists it too, so the two menus match). `mine`: the open
 * page is the visitor's own wish list (someone's shared list marks no entry current, holiday audit 1121).
 */
export function GiftGuidesMenu({ active, myList = false, mine = myList, page, idPrefix = "gg-side", wishList = false }: MenuProps & { idPrefix?: string; wishList?: boolean; mine?: boolean }) {
  const open = openEntry({ active, page });
  const current = (slug: string | null) => (!myList && open === slug ? ({ "aria-current": "page" } as const) : {});
  const guides = sideGuides();
  const printables = PRINTABLE_PAGES.map((p) => ({ ...p, n: printablesCount(p.key) })).filter((p) => p.n > 0);
  const n = useLiveCounts();
  return (
    <>
      <p className="gg-side-h" id={`${idPrefix}-guides`}>{G.sideHeads.guides}</p>
      <ul data-gift-side-guides="" aria-labelledby={`${idPrefix}-guides`}>
        <li><Link to="/gift-guides" {...current(null)} data-gift-side="">{G.allGuidesLabel}</Link></li>
        {guides.map((g) => (
          <li key={g.slug}>
            <Link to={`/gift-guides/${g.slug}`} {...current(g.slug)} data-gift-side={g.slug}><i className={`gg-dot gg-${g.dot}`} aria-hidden="true" data-gift-side-dot={g.dot} />{g.title}<N n={CHUNK_PICK_COUNTS[g.slug]} noun="gifts" /></Link>
          </li>
        ))}
        {wishList && <li><Link to={`/gift-guides/${MY_LIST_SLUG}`} {...(mine ? ({ "aria-current": "page" } as const) : {})} data-gift-side-wish-list="">{WISH.title}</Link></li>}
      </ul>
      <p className="gg-side-h" id={`${idPrefix}-deals`}>{G.sideHeads.deals}</p>
      <ul data-gift-side-deals-group="" aria-labelledby={`${idPrefix}-deals`}>
        {/* Holiday audit 1121 (High): each day is its own page, so each entry opens that page and is marked current on
            it (it was a #anchor on the one-page address that never scrolled, with Black Friday always marked). */}
        {G.sideDeals.map((d) => (
          <li key={d.id}><Link to={`/gift-guides/${d.id}`} {...current(d.id)} data-gift-side-deals={d.id}>{d.label}<N n={n[d.id]} /></Link></li>
        ))}
      </ul>
      {printables.length > 0 && (
        <>
          <p className="gg-side-h" id={`${idPrefix}-free`}>{G.sideHeads.free}</p>
          <ul data-gift-side-printables-group="" aria-labelledby={`${idPrefix}-free`}>
            {printables.map((p) => <li key={p.key}><Link to={p.path} {...current(p.path)} data-gift-side-printables={p.key}>{p.label}<N n={p.n} /></Link></li>)}
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
        {/* Guide consistency audit 1122 #2: the Hub is marked open on its own page, as every other entry is. */}
        <li><Link to="/holidays" {...current("/holidays")} data-gift-side-holiday-hub="">{G.sideHolidayHub}<N n={n["/holidays"]} /></Link></li>
        <li><Link to={`/gift-guides/${SPONSORS_SLUG}`} {...current(SPONSORS_SLUG)} data-gift-side-sponsors="">{G.sideSponsorsLabel}<N n={CHUNK_PICK_COUNTS[SPONSORS_SLUG]} noun="gifts" /></Link></li>
      </ul>
    </>
  );
}
