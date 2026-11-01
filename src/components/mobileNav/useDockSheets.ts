import { useEffect } from "react";
import { createLazyModule } from "@/lib/lazyModule";
import { whenPageSettled } from "@/lib/routePrefetch";

/**
 * The create sheet and the guest gate sheet for the bottom dock, fetched after the page has settled (B85, 11-01).
 *
 * WHY THIS EXISTS. MobileNav imported both sheets statically, and through them the Radix dialog stack, the sheet
 * primitive and the icon group holding its close X: ~30 KB gz the dock's first frame never draws (neither sheet
 * exists until a tap). B84 measured that loading the dock with the page costs Home's LCP +0.3 s, because those bytes
 * share the pipe with Home's own. So the dock draws without them, they are fetched once the page has settled (or at
 * once when a tap opens one), and the sheet mounts open when the module arrives.
 *
 * src/test/dockSheetsLoadOnTap.test.ts keeps MobileNav and the desktop rail from importing the sheets statically.
 * Do not turn the import back into a static one.
 */
type DockSheets = typeof import("./dockSheets");

const sheets = createLazyModule<DockSheets>(() => import("./dockSheets"), "MobileNav.loadDockSheets");

/** Warms the module once the page has settled (not while the dock is hidden), and at once when a sheet is wanted. */
export function useDockSheetsLoader(dockHidden: boolean, wanted: boolean): DockSheets | null {
  useEffect(() => {
    if (dockHidden) return;
    return whenPageSettled(sheets.start);
  }, [dockHidden]);
  useEffect(() => {
    if (wanted) sheets.start();
  }, [wanted]);
  return sheets.use();
}
