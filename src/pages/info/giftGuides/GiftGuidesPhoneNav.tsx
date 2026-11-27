import { useEffect, useState, type ComponentType } from "react";
import { RoundIconButton } from "@/components/ui/RoundIconButton";
import { definitelyGuest } from "@/lib/persistedAuthToken";
import { wordInLang } from "@/lib/i18n/inLang";
import { loadModule, untilReload } from "@/lib/loadModule";
import { report } from "@/lib/errorLogger";
import { ICON_STROKE_PX } from "@/lib/iconWeight";
import { giftGuides as G } from "@/content/giftGuides";
import type { CatalogGuide } from "@/content/giftGuideCatalog";

const SHEET_PREFIX = "gg-sheet";
type SheetModule = { GiftGuidesPhoneSheet: ComponentType<{ open: boolean; onClose: () => void; active: CatalogGuide | null; myList: boolean; page?: string; idPrefix: string; join?: string }> };
const loadSheet = () => loadModule(() => import("./GiftGuidesPhoneSheet"));

/**
 * The phone's guides menu (owner 2026-11-22, iPhone screenshot of /gift-guides: "Remove everything under the holiday
 * gift guides on the phone view. Remove the search order by, hers him kids deals. Only thing that will stay is the 3
 * line with no circle around it and the heart. Both of those will go on the right of the holiday gift guide"). Up to
 * 767px only (the desktop sidebar is unchanged): a plain three-line icon on the right of the head row (GuidesHeadRow),
 * no circle, border or pill, a 44x44 tap target. It replaces 11-21's sticky chip row (Her, Him, Kids, Deals,
 * Printables, More) and opens the same grouped menu "More" opened (the desktop sidebar's groups, plus My Wish List) in
 * the shared bottom Sheet, so every guides page stays one tap away.
 * Guard: src/test/giftGuidesPhoneNav1121.test.tsx, src/test/giftGuidePhoneHead1122.test.tsx.
 */
/** The window event the phone's menu tip sends to open this menu (GiftGuideMenuHint.tsx, owner 11-22 11:40 PM). */
const OPEN_MENU_EVENT = "lh-gg-open-menu";
/** Open the guides menu, exactly as tapping the head row's three-line icon does. */
export const openGuidesMenu = () => window.dispatchEvent(new Event(OPEN_MENU_EVENT));

export function GuidesMenuButton({ active, myList = false, page }: { active: CatalogGuide | null; myList?: boolean; page?: string }) {
  const [sheet, setSheet] = useState(false);
  useEffect(() => {
    const open = () => setSheet(true);
    window.addEventListener(OPEN_MENU_EVENT, open);
    return () => window.removeEventListener(OPEN_MENU_EVENT, open);
  }, []);
  // The sheet's chunk (the dialog stack) loads on the first tap, never on the page's critical path.
  const [SheetPart, setSheetPart] = useState<SheetModule["GiftGuidesPhoneSheet"] | null>(null);
  useEffect(() => {
    if (!sheet || SheetPart) return;
    let live = true;
    void loadSheet()
      .then((m) => m ?? untilReload())
      .then(
        (m) => { if (live) setSheetPart(() => m.GiftGuidesPhoneSheet); },
        (e) => report(e as Error, { tags: { source: "GuidesMenuButton.loadSheet" } }),
      );
    return () => {
      live = false;
    };
  }, [sheet, SheetPart]);
  return (
    <>
      <RoundIconButton className="gg-icon gg-head-menu" aria-label={G.phoneMenuLabel} aria-haspopup="dialog" aria-expanded={sheet} onClick={() => setSheet(true)} data-gift-head-menu="">
        <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><path d="M4 7h16M4 12h16M4 17h16" fill="none" stroke="currentColor" strokeWidth={ICON_STROKE_PX} strokeLinecap="round" /></svg>
      </RoundIconButton>
      {SheetPart && <SheetPart open={sheet} onClose={() => setSheet(false)} active={active} myList={myList} page={page} idPrefix={SHEET_PREFIX} join={definitelyGuest() ? wordInLang("g.joinOrLogIn", "Join / Log in") : undefined} />}
    </>
  );
}
