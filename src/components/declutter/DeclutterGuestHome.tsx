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
import { Link } from "react-router-dom";
import { useIsWebDesktop } from "@/hooks/useIsWebDesktop";
import { useGuestPublicFrame } from "@/hooks/useGuestPublicFrame";
import { GuestSectionSwitch } from "@/components/sections/GuestSectionSwitch";
import { SectionAddLink } from "@/components/sections/SectionAddLink";
import { SELL_START_PATH } from "@/lib/declutter/sellChooser";
import { loadModule, untilReload } from "@/lib/loadModule";
import { t } from "@/lib/i18n/language";
import type { DeclutterBrowseHeader, DeclutterChrome } from "./DeclutterBrowseView";
import { DeclutterGuestBrowseJoin } from "./DeclutterGuest";
import { DeclutterHomeSkeleton } from "./DeclutterSkeletons";
import "@/lib/i18n/enDeclutter";
import "@/lib/i18n/enDeclBrowse";

// The same module DeclutterHomeView's member Browse and src/boot/declutterRoute.ts start, so one chunk serves all three.
const DeclutterBrowse = lazy(() => loadModule(() => import("./DeclutterBrowseView")).then((m) => (m ? { default: m.DeclutterBrowse } : untilReload())));

/**
 * Deep audit 11-22 #11: guest Declutter had no way to sell ("Sell" was not on the page at 1440). Since 11-21 a guest
 * fills in a listing first and signs up at the end, so the guest screen offers the same "+ Sell something" as the
 * member's soft add button: at the end of the count row on desktop, at the end of the Jobs | Declutter row on a phone.
 */
// On a phone the short "+ Sell" (the member's floating button's words), so it stands apart from the Jobs | Declutter
// chips at the other end of that row instead of reading as a third chip.
const guestSell = (short = false) => <SectionAddLink to={SELL_START_PATH} label={t(short ? "decl.hv.sell" : "decl.sellSomething")} data-guest-sell="" />;

// Polish audit 11-27 #7: in the title row "Sell" is a plain text button (a pill there cut the title to "Declu…" at 375).
const titleRowSell = (
  <Link to={SELL_START_PATH} data-guest-sell="" className="inline-flex min-h-11 shrink-0 items-center px-2 text-ds-15 font-semibold text-[hsl(var(--bark))] link-standard">
    {t("decl.hv.sell")}
  </Link>
);

export function DeclutterGuestHome() {
  const desktop = useIsWebDesktop();
  // Polish audit 11-27 #7: on the web a guest's phone already has the site bar (Jobs, Declutter and Gifts icons), so the
  // "Jobs | Declutter" chips under the title were a second header row. There "+ Sell" sits in the title row beside the
  // search and Filters, and the chip row is gone. The app (no site bar) keeps the switch row.
  const siteBar = useGuestPublicFrame();
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
        {guestSell()}
        {browse.end}
      </div>
    ),
  } : {
    // M13: the "Jobs | Declutter" switch sits ABOVE the category chips (under them it read as one more filter row).
    search: siteBar ? <div className="flex min-w-0 items-center justify-end" data-guest-title-row-sell="">{browse.search}{titleRowSell}</div> : browse.search,
    // Owner 11-25: no category chips under it any more (they are in Filters), so the row is the whole strip.
    tabs: siteBar ? undefined : <div className="flex items-center justify-between gap-2 pb-2"><GuestSectionSwitch at="declutter" className="min-w-0" />{guestSell(true)}</div>,
  };
  return <Suspense fallback={<DeclutterHomeSkeleton />}><DeclutterBrowse userId={null} chrome={chrome} top={<DeclutterGuestBrowseJoin />} /></Suspense>;
}
