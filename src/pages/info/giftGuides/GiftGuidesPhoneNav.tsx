import { useEffect, useState, type MouseEvent } from "react";
import { Link } from "react-router-dom";
import { Sheet, SheetContent, SheetHero } from "@/components/ui/sheet";
import { giftGuides as G } from "@/content/giftGuides";
import type { CatalogGuide } from "@/content/giftGuideCatalog";
import { DEALS_SLUG } from "@/content/giftGuideDeals.mjs";
import { PRINTABLES_PATH } from "@/content/printables";
import { GiftGuidesMenu, openEntry, sideGuides } from "./GiftGuidesSidebar";

/** A menu group the sheet can open at (the ids GiftGuidesMenu gives its headings, with the sheet's own prefix). */
type Group = "guides" | "deals" | "free" | "fun" | "la";
const SHEET_PREFIX = "gg-sheet";

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
  // A link tapped in the sheet closes it (the page underneath changes).
  const closeOnLink = (e: MouseEvent) => {
    if ((e.target as HTMLElement).closest("a")) setSheet(null);
  };
  const chip = (on: boolean) => (on ? "gg-chip-nav is-on" : "gg-chip-nav");
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
          <Link to={`/gift-guides/${DEALS_SLUG}`} className={chip(open === DEALS_SLUG)} {...(open === DEALS_SLUG ? { "aria-current": "page" as const } : {})} data-gift-chip="deals">{G.sideHeads.deals}</Link>
        </li>
        <li><Link to={PRINTABLES_PATH} className={chip(false)} data-gift-chip="printables">{G.phoneNavPrintables}</Link></li>
        <li>
          <button type="button" className={chip(open === "finder")} aria-haspopup="dialog" onClick={() => setSheet("fun")} data-gift-chip="fun">{G.phoneNavFun}</button>
        </li>
        <li><button type="button" className={chip(false)} aria-haspopup="dialog" onClick={() => setSheet("la")} data-gift-chip="louisiana">{G.sideHeads.louisiana}</button></li>
        <li>
          <button type="button" className="gg-chip-nav gg-chip-menu" aria-haspopup="dialog" onClick={() => setSheet("guides")} data-gift-chip="menu">
            <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path d="M4 7h16M4 12h16M4 17h16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></svg>
            {G.phoneNavMenu}
          </button>
        </li>
      </ul>
      <Sheet open={sheet !== null} onOpenChange={(o) => { if (!o) setSheet(null); }}>
        <SheetContent side="bottom" className="gg gg-sheet-menu" data-gift-menu-sheet="">
          <SheetHero title={G.sidebarLabel} />
          {/* Not a second <nav>: the sheet IS the menu, opened from the row's own nav landmark. */}
          <div className="gg-sheet-menu-body" onClick={closeOnLink} role="presentation">
            <GiftGuidesMenu active={active} myList={myList} page={page} idPrefix={SHEET_PREFIX} />
          </div>
        </SheetContent>
      </Sheet>
    </nav>
  );
}
