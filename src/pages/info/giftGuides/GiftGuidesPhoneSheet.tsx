import type { MouseEvent } from "react";
import { Link } from "react-router-dom";
import { Sheet, SheetContent, SheetHero } from "@/components/ui/sheet";
import { giftGuides as G } from "@/content/giftGuides";
import type { CatalogGuide } from "@/content/giftGuideCatalog";
import { GiftGuidesMenu } from "./GiftGuidesSidebar";

/**
 * The phone's menu sheet (owner 2026-11-21; 11-22 opened by the head row's three-line icon): the whole grouped menu,
 * plus My Wish List, in the shared bottom Sheet. Its own chunk, loaded on the first tap (GuidesMenuButton), so the dialog stack never rides the guide page's critical path
 * (train 1121g build: it put /gift-guides/<slug> at 369 KB gz against a 336 KB budget).
 * Guard: src/test/giftGuidesPhoneNav1121.test.tsx.
 */
export function GiftGuidesPhoneSheet({ open, onClose, active, myList, page, idPrefix, join }: {
  open: boolean;
  onClose: () => void;
  active: CatalogGuide | null;
  myList: boolean;
  page?: string;
  idPrefix: string;
  /** Polish audit 11-27 #7: for a signed-out visitor, the "Join / Log in" words (GuidesMenuButton), drawn as the first row. */
  join?: string;
}) {
  // A link tapped in the sheet closes it (the page underneath changes).
  const closeOnLink = (e: MouseEvent) => {
    if ((e.target as HTMLElement).closest("a")) onClose();
  };
  // Polish audit 11-27 #7: a guest's phone has no site bar on the guides' pages, so the menu's first row is the bar's
  // "Join / Log in" (the same sign-up screen, whose Log in tab is one tap away).
  return (
    <Sheet open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <SheetContent side="bottom" className="gg gg-sheet-menu" data-gift-menu-sheet="">
        <SheetHero title={G.menuSheetTitle} />
        {/* Not a <nav>: the sheet IS the menu, a dialog opened from the head row's three-line button. */}
        <div className="gg-sheet-menu-body" onClick={closeOnLink} role="presentation">
          {join && <Link to="/signup" className="gg-sheet-join" data-gift-menu-join="">{join}</Link>}
          <GiftGuidesMenu active={active} myList={myList} page={page} idPrefix={idPrefix} wishList />
        </div>
      </SheetContent>
    </Sheet>
  );
}
