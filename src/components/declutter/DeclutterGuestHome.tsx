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
import { SectionTabs } from "@/components/sections/SectionTabs";
import { ScrollAwayRows } from "@/components/sections/ScrollAway";
import { GuestSectionSwitch } from "@/components/sections/GuestSectionSwitch";
import { loadModule, untilReload } from "@/lib/loadModule";
import { t } from "@/lib/i18n/language";
import type { DeclutterTab } from "@/lib/declutter/tabs";
import type { DeclutterBrowseHeader, DeclutterChrome } from "./DeclutterBrowseView";
import { DeclutterGuestBrowseJoin } from "./DeclutterGuest";
import { DeclutterHomeSkeleton } from "./DeclutterSkeletons";
import "@/lib/i18n/enDeclutter";

// The same module DeclutterHomeView's member Browse and src/boot/declutterRoute.ts start, so one chunk serves all three.
const DeclutterBrowse = lazy(() => loadModule(() => import("./DeclutterBrowseView")).then((m) => (m ? { default: m.DeclutterBrowse } : untilReload())));

export function DeclutterGuestHome() {
  const desktop = useIsWebDesktop();
  const chrome = (browse: DeclutterBrowseHeader): DeclutterChrome => desktop ? {
    tabs: (
      <SectionTabs<DeclutterTab>
        label={t("decl.hv.view")}
        browseCount={browse.count}
        end={browse.end}
        value="browse"
        onChange={() => undefined}
        tabs={[]}
      />
    ),
  } : { search: browse.search, tabs: <ScrollAwayRows>{browse.chips}</ScrollAwayRows> };
  return <Suspense fallback={<DeclutterHomeSkeleton />}><DeclutterBrowse userId={null} chrome={chrome} top={<><GuestSectionSwitch at="declutter" /><DeclutterGuestBrowseJoin /></>} /></Suspense>;
}
