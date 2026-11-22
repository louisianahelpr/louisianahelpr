import { useEffect, useRef, useState, type ComponentType } from "react";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { loadModule, untilReload } from "@/lib/loadModule";
import { report } from "@/lib/errorLogger";
import { ICON_STROKE_PX } from "@/lib/iconWeight";
import { giftGuides as G } from "@/content/giftGuides";
import type { CatalogGuide } from "@/content/giftGuideCatalog";
import { DEAL_DAY_SLUGS, oldDealsTarget } from "@/content/giftGuideDeals.mjs";
import { PRINTABLE_PAGES } from "@/content/printables";
import { FUN_TOOLS } from "@/content/giftGuideFun1120";
import { openEntry, sideGuides } from "./GiftGuidesSidebar";

const SHEET_PREFIX = "gg-sheet";
type SheetModule = { GiftGuidesPhoneSheet: ComponentType<{ open: boolean; onClose: () => void; active: CatalogGuide | null; myList: boolean; page?: string; idPrefix: string }> };
const loadSheet = () => loadModule(() => import("./GiftGuidesPhoneSheet"));
/** The pages the "More" sheet holds beyond the chips: the gift finder, the fun tools and the 25 Days sponsors page. */
const MORE_PAGES: readonly string[] = ["finder", "25-days-sponsors", ...FUN_TOOLS.map((t) => t.to)];
const PRINTABLE_PATHS: readonly string[] = PRINTABLE_PAGES.map((p) => p.path);

/**
 * The phone's gift guides navigation (owner 2026-11-21, two iPhone screenshots: the whole grouped menu sat at the very
 * bottom of the page under the affiliate text; "We need a way to organize this on the phones"). Up to 767px only (the
 * desktop sidebar is unchanged): one sticky row of chips right under the header that scrolls sideways on its own,
 * never the page: Her, Him, Kids (each with its cover's colour dot, the open one filled), Deals and Printables (their
 * pages, each filled on its own pages), then "More", pinned at the row's right edge so it always shows (polish audit
 * 1122 #6: Menu was the 8th chip, out of view at 375, and Make it fun / Louisiana / Menu all opened the same sheet).
 * More opens the whole grouped menu (the same groups and order as the desktop sidebar) in the shared bottom Sheet.
 * Every chip is 44px tall. Drawn on every guides page: GiftGuides.tsx and GuidesFrame (polish audit 1122 #3).
 * Guard: src/test/giftGuidesPhoneNav1121.test.tsx, src/test/giftGuidesPolishUi1122.test.tsx.
 */
export function GiftGuidesPhoneNav({ active, myList = false, page }: { active: CatalogGuide | null; myList?: boolean; page?: string }) {
  const [sheet, setSheet] = useState(false);
  const open = myList ? null : openEntry({ active, page });
  // The sheet's chunk (the dialog stack) loads on the first tap of More, never on the page's critical path.
  const [SheetPart, setSheetPart] = useState<SheetModule["GiftGuidesPhoneSheet"] | null>(null);
  useEffect(() => {
    if (!sheet || SheetPart) return;
    let live = true;
    void loadSheet()
      .then((m) => m ?? untilReload())
      .then(
        (m) => { if (live) setSheetPart(() => m.GiftGuidesPhoneSheet); },
        (e) => report(e as Error, { tags: { source: "GiftGuidesPhoneNav.loadSheet" } }),
      );
    return () => {
      live = false;
    };
  }, [sheet, SheetPart]);
  // The filled chip in view: on a printables page Printables sits past the row's right edge at 375.
  const row = useRef<HTMLUListElement>(null);
  useEffect(() => {
    const r = row.current;
    const on = r?.querySelector<HTMLElement>(".is-on");
    if (r && on && on.offsetLeft + on.offsetWidth > r.clientWidth) r.scrollLeft = on.offsetLeft - 20;
  }, [page, active]);
  const chip = (on: boolean) => (on ? "gg-chip-nav is-on" : "gg-chip-nav");
  const cur = (on: boolean) => (on ? { "aria-current": "page" as const } : {});
  const dealDayOpen = open !== null && (DEAL_DAY_SLUGS as readonly string[]).includes(open);
  const printablesOpen = open !== null && PRINTABLE_PATHS.includes(open);
  const moreOpen = open !== null && MORE_PAGES.includes(open);
  return (
    <nav className="gg-pnav" aria-label={G.phoneNavLabel} data-gift-phone-nav="">
      <ul className="gg-pnav-row" ref={row}>
        {sideGuides().map((g) => (
          <li key={g.slug}>
            <Link to={`/gift-guides/${g.slug}`} className={chip(open === g.slug)} {...(open === g.slug ? { "aria-current": "page" as const } : {})} data-gift-chip={g.slug}>
              <i className={`gg-dot gg-${g.dot}`} aria-hidden="true" />{g.title}
            </Link>
          </li>
        ))}
        <li>
          {/* Deals by day (11-21): the chip opens the first day page and is current on any of the three. */}
          <Link to={`/gift-guides/${oldDealsTarget("")}`} className={chip(dealDayOpen)} {...cur(dealDayOpen)} data-gift-chip="deals">{G.sideHeads.deals}</Link>
        </li>
        {/* Straight to the first printables page (polish audit 1122 #6: the old address bounced to Gift tags). */}
        <li><Link to={PRINTABLE_PAGES[0].path} className={chip(printablesOpen)} {...cur(printablesOpen)} data-gift-chip="printables">{G.phoneNavPrintables}</Link></li>
      </ul>
      <Button type="button" variant="outline" size="sm" className={`${chip(moreOpen)} gg-chip-menu`} aria-haspopup="dialog" onClick={() => setSheet(true)} data-gift-chip="menu">
        <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path d="M4 7h16M4 12h16M4 17h16" fill="none" stroke="currentColor" strokeWidth={ICON_STROKE_PX} strokeLinecap="round" /></svg>
        {G.phoneNavMenu}
      </Button>
      {SheetPart && <SheetPart open={sheet} onClose={() => setSheet(false)} active={active} myList={myList} page={page} idPrefix={SHEET_PREFIX} />}
    </nav>
  );
}
