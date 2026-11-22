import type { ReactNode } from "react";
import { shippingLine } from "@/content/giftGuideShipping";
import type { CatalogGuide } from "@/content/giftGuideCatalog";
import type { PageBanner } from "@/content/giftGuides";
import { GuidesHeadRow } from "./GuidesHeadRow";
import { GiftGuidesPhoneNav } from "./GiftGuidesPhoneNav";
import { GiftGuidesWords } from "./GiftGuideCover";

const SHIP_TAIL = " for Christmas delivery";

/**
 * The "Order by Dec 15 for Christmas delivery" pill. Visual check 11-18: at 375 the long pill squeezed "Gift guides"
 * into "Gift / guid / es", so a phone gets the short words; polish audit 1122 #5: in a phone's count row it reads
 * "By Dec 15" (its "Order " hidden by the CSS), so the count, the pill and the four icons fit one row at 375.
 */
function GuideShipPill({ ship }: { ship: string }) {
  const head = ship.endsWith(SHIP_TAIL) ? ship.slice(0, -SHIP_TAIL.length) : ship;
  return (
    <p className="gg-ship whitespace-nowrap" data-gift-ship="">
      {head.startsWith("Order ") ? <><span className="gg-ship-order">Order </span>{head.slice(6)}</> : head}
      {ship.endsWith(SHIP_TAIL) && <span className="hidden lg:inline">{SHIP_TAIL}</span>}
    </p>
  );
}

/** A banner for GuidesTop: its words, and the h1's id (default "gift-guide-title"). */
export type GuidesBanner = PageBanner & { titleId?: string; sub?: boolean };

/**
 * The ONE top of every Holiday gift guides page (owner 2026-11-22 #13: "gifts tags and all the other sections should
 * have the same top section as the guides and the deals"; her right example Small Business Saturday): the head row
 * (back arrow + "Holiday gift guides", the shipping pill, then search, My list heart and Share on the right), the
 * phone's chip row, then the big gingham banner (the small italic lead and the serif title in the cream arch, the page's
 * h1). The landing, the guides, the deals days and the wish lists (GiftGuides.tsx), every page in the guides frame
 * (FunPage.tsx: the printables, Swipe, the Secret Santa draw and reveal, the planner) and the Holiday Hub draw it from
 * here, so no page's top can drift again. Only the landing has no banner (its h1 is the head row's title).
 * `pillInRow` off: the pill and the icons go in `below` (a guide's count row under its banner on a phone).
 * Guard: src/test/giftGuidePages1122.test.tsx.
 */
export function GuidesTop({ backTo, banner, tools, nav, pillInRow = true, below }: {
  backTo: string;
  banner: GuidesBanner | null;
  tools?: ReactNode;
  nav: { active: CatalogGuide | null; myList?: boolean; page?: string };
  pillInRow?: boolean;
  below?: (pill: ReactNode) => ReactNode;
}) {
  const ship = shippingLine(new Date());
  const pill = ship ? <GuideShipPill ship={ship} /> : null;
  return (
    <>
      <GuidesHeadRow backTo={backTo} titleIsH1={!banner} ship={Boolean(ship)}>
        {pillInRow && pill}
        {pillInRow && tools}
      </GuidesHeadRow>
      {/* Owner 11-21 ("We need a way to organize this on the phones"): up to 767px a sticky chip row and a menu sheet
          replace the sidebar. */}
      <GiftGuidesPhoneNav active={nav.active} myList={nav.myList} page={nav.page} />
      {banner && <GiftGuidesWords lead={banner.lead} title={banner.title} titleId={banner.titleId ?? "gift-guide-title"} tint={banner.tint} sub={banner.sub ?? true} />}
      {below?.(pill)}
    </>
  );
}
