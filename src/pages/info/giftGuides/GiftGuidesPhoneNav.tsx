import { useEffect, useState, type ComponentType } from "react";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { loadModule, untilReload } from "@/lib/loadModule";
import { report } from "@/lib/errorLogger";
import { giftGuides as G } from "@/content/giftGuides";
import type { CatalogGuide } from "@/content/giftGuideCatalog";
import { DEAL_DAY_SLUGS, oldDealsTarget } from "@/content/giftGuideDeals.mjs";
import { PRINTABLES_PATH } from "@/content/printables";
import { openEntry, sideGuides } from "./GiftGuidesSidebar";

/** A menu group the sheet can open at (the ids GiftGuidesMenu gives its headings, with the sheet's own prefix). */
type Group = "guides" | "deals" | "free" | "fun" | "la";
const SHEET_PREFIX = "gg-sheet";
type SheetModule = { GiftGuidesPhoneSheet: ComponentType<{ open: boolean; onClose: () => void; active: CatalogGuide | null; myList: boolean; page?: string; idPrefix: string }> };
const loadSheet = () => loadModule(() => import("./GiftGuidesPhoneSheet"));

/**
 * The phone's gift guides navigation (owner 2026-11-21, two iPhone screenshots: the whole grouped menu sat at the very
 * bottom of the page under the affiliate text; "We need a way to organize this on the phones"). Up to 767px only (the
 * desktop sidebar is unchanged): one sticky row of chips right under the header that scrolls sideways on its own,
 * never the page: Her, Him, Kids (each with its cover's colour dot, the open one filled), Deals and Printables (their
 * pages), Make it fun and Louisiana (the menu sheet, opened at that group), and Menu (the whole grouped menu, the same
 * groups and order as the desktop sidebar, in the shared bottom Sheet). Every chip is 44px tall.
 * Guard: src/test/giftGuidesPhoneNav1121.test.tsx.
 */
export function GiftGuidesPhoneNav({ active, myList = false, page }: { active: CatalogGuide | null; myList?: boolean; page?: string }) {
  const [sheet, setSheet] = useState<Group | null>(null);
  const open = myList ? null : openEntry({ active, page });
  // Open at a group: once the sheet has drawn, bring that group's heading to the top of it.
  useEffect(() => {
    if (!sheet || sheet === "guides") return;
    const t = window.setTimeout(() => document.getElementById(`${SHEET_PREFIX}-${sheet}`)?.scrollIntoView({ block: "start" }), 60);
    return () => window.clearTimeout(t);
  }, [sheet]);
  // The sheet's chunk (the dialog stack) loads on the first chip tap, never on the page's critical path.
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
  const chip = (on: boolean) => (on ? "gg-chip-nav is-on" : "gg-chip-nav");
  const dealDayOpen = open !== undefined && open !== null && (DEAL_DAY_SLUGS as readonly string[]).includes(open);
  return (
    <nav className="gg-pnav" aria-label={G.phoneNavLabel} data-gift-phone-nav="">
      <ul className="gg-pnav-row">
        {sideGuides().map((g) => (
          <li key={g.slug}>
            <Link to={`/gift-guides/${g.slug}`} className={chip(open === g.slug)} {...(open === g.slug ? { "aria-current": "page" as const } : {})} data-gift-chip={g.slug}>
              <i className={`gg-dot gg-${g.dot}`} aria-hidden="true" />{g.title}
            </Link>
          </li>
        ))}
        <li>
          {/* Deals by day (11-21): the chip opens the first day page and is current on any of the three. */}
          <Link to={`/gift-guides/${oldDealsTarget("")}`} className={chip(dealDayOpen)} {...(dealDayOpen ? { "aria-current": "page" as const } : {})} data-gift-chip="deals">{G.sideHeads.deals}</Link>
        </li>
        <li><Link to={PRINTABLES_PATH} className={chip(false)} data-gift-chip="printables">{G.phoneNavPrintables}</Link></li>
        <li>
          <Button type="button" variant="outline" size="sm" className={chip(open === "finder")} aria-haspopup="dialog" onClick={() => setSheet("fun")} data-gift-chip="fun">{G.phoneNavFun}</Button>
        </li>
        <li><Button type="button" variant="outline" size="sm" className={chip(false)} aria-haspopup="dialog" onClick={() => setSheet("la")} data-gift-chip="louisiana">{G.sideHeads.louisiana}</Button></li>
        <li>
          <Button type="button" variant="outline" size="sm" className="gg-chip-nav gg-chip-menu" aria-haspopup="dialog" onClick={() => setSheet("guides")} data-gift-chip="menu">
            <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path d="M4 7h16M4 12h16M4 17h16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></svg>
            {G.phoneNavMenu}
          </Button>
        </li>
      </ul>
      {SheetPart && <SheetPart open={sheet !== null} onClose={() => setSheet(null)} active={active} myList={myList} page={page} idPrefix={SHEET_PREFIX} />}
    </nav>
  );
}
