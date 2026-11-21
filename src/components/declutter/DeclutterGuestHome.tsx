/**
 * BUY-16: a signed-out visitor's /declutter (DeclutterGate lets one in only while Declutter is open to everyone):
 * Browse alone, with a sign-up line on top. Buying, Selling, Deliver, Wanted and Free and the settings gear are a
 * member's own.
 *
 * Its own file (Q2705, 2026-11-14): DeclutterHomeEntry draws it for a guest without loading DeclutterHomeView, whose
 * member screens (the What next sheets, My listings, the confirm and still-available sheets and their dialog code)
 * a guest never sees and used to download on the first round.
 */
import { lazy, Suspense } from "react";
import { useIsWebDesktop } from "@/hooks/useIsWebDesktop";
import { ScrollAwayRows } from "@/components/sections/ScrollAway";
import { GuestSectionSwitch } from "@/components/sections/GuestSectionSwitch";
import { loadModule, untilReload } from "@/lib/loadModule";
import { t } from "@/lib/i18n/language";
import type { DeclutterBrowseHeader, DeclutterChrome } from "./DeclutterBrowseView";
import { DeclutterGuestBrowseJoin } from "./DeclutterGuest";
import { DeclutterHomeSkeleton } from "./DeclutterSkeletons";
import "@/lib/i18n/enDeclutter";
import "@/lib/i18n/enDeclBrowse";

// The same module DeclutterHomeView's member Browse and src/boot/declutterRoute.ts start, so one chunk serves all three.
const DeclutterBrowse = lazy(() => loadModule(() => import("./DeclutterBrowseView")).then((m) => (m ? { default: m.DeclutterBrowse } : untilReload())));

export function DeclutterGuestHome() {
  const desktop = useIsWebDesktop();
  // Owner 11-20 (site polish A3): a guest has Browse alone, so a lone "Browse 41" tab read as a tab row of one. The row
  // says "41 items" plainly (nothing while the list loads), with the same search and Filters at its end.
  const chrome = (browse: DeclutterBrowseHeader): DeclutterChrome => desktop ? {
    tabs: (
      // Owner 11-21 (header polish): the count, search, location and Filters on ONE centre line (items-center), with
      // the same 4px under them as above the hairline.
      <div data-testid="section-tabs" data-guest-count-row="" className="flex items-center gap-1 pb-1 border-b border-border/60">
        <p data-testid="browse-count-only" className="flex h-11 min-w-0 flex-1 items-center text-ds-15 font-semibold tabular-nums text-foreground">
          {browse.count === undefined ? null : browse.count === 1 ? t("decl.results.one") : t("decl.results.many", { n: browse.count })}
        </p>
        {browse.end}
      </div>
    ),
  } : {
    // M13: the "Jobs | Declutter" switch sits ABOVE the category chips (under them it read as one more filter row).
    search: browse.search, tabs: <><GuestSectionSwitch at="declutter" className="pb-2" /><ScrollAwayRows>{browse.chips}</ScrollAwayRows></>,
  };
  return <Suspense fallback={<DeclutterHomeSkeleton />}><DeclutterBrowse userId={null} chrome={chrome} top={<DeclutterGuestBrowseJoin />} /></Suspense>;
}
