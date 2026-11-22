import type { MouseEvent } from "react";
import { Sheet, SheetContent, SheetHero } from "@/components/ui/sheet";
import { giftGuides as G } from "@/content/giftGuides";
import type { CatalogGuide } from "@/content/giftGuideCatalog";
import { GiftGuidesMenu } from "./GiftGuidesSidebar";

/**
 * The phone nav's menu sheet (owner 2026-11-21): the whole grouped menu in the shared bottom Sheet. Its own chunk,
 * loaded on the first chip tap (GiftGuidesPhoneNav), so the dialog stack never rides the guide page's critical path
 * (train 1121g build: it put /gift-guides/<slug> at 369 KB gz against a 336 KB budget).
 * Guard: src/test/giftGuidesPhoneNav1121.test.tsx.
 */
export function GiftGuidesPhoneSheet({ open, onClose, active, myList, page, idPrefix }: {
  open: boolean;
  onClose: () => void;
  active: CatalogGuide | null;
  myList: boolean;
  page?: string;
  idPrefix: string;
}) {
  // A link tapped in the sheet closes it (the page underneath changes).
  const closeOnLink = (e: MouseEvent) => {
    if ((e.target as HTMLElement).closest("a")) onClose();
  };
  return (
    <Sheet open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <SheetContent side="bottom" className="gg gg-sheet-menu" data-gift-menu-sheet="">
        <SheetHero title={G.sidebarLabel} />
        {/* Not a second <nav>: the sheet IS the menu, opened from the row's own nav landmark. */}
        <div className="gg-sheet-menu-body" onClick={closeOnLink} role="presentation">
          <GiftGuidesMenu active={active} myList={myList} page={page} idPrefix={idPrefix} />
        </div>
      </SheetContent>
    </Sheet>
  );
}
