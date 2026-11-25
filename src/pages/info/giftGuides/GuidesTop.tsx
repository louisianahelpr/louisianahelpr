import type { ReactNode } from "react";
import type { CatalogGuide } from "@/content/giftGuideCatalog";
import type { PageBanner } from "@/content/giftGuides";
import { GuidesHeadRow } from "./GuidesHeadRow";
import { GuidesMenuButton } from "./GiftGuidesPhoneNav";
import { GiftGuidesWords } from "./GiftGuideCover";

/** A banner for GuidesTop: its words, and the h1's id (default "gift-guide-title"). */
export type GuidesBanner = PageBanner & { titleId?: string; sub?: boolean };

/**
 * The ONE top of every Holiday gift guides page (owner 2026-11-22 #13: "gifts tags and all the other sections should
 * have the same top section as the guides and the deals"; her right example Small Business Saturday): the head row
 * (back arrow + "Holiday gift guides", then search, My list heart and Share on the right; on a phone
 * only back arrow + "Gift guides" with the three-line menu on the right, owner 11-22), then the big gingham banner (the small italic lead and the serif title in the cream arch, the page's
 * h1). The landing, the guides, the deals days and the wish lists (GiftGuides.tsx), every page in the guides frame
 * (FunPage.tsx: the printables, Swipe, the Secret Santa draw and reveal, the planner) and the Holiday Hub draw it from
 * here, so no page's top can drift again. Only the landing has no banner (its h1 is the head row's title).
 * No shipping pill on any page: owner 2026-11-24 ~8:30 PM, "Remove by Dec 15 everywhere" (the "Order by Dec 15 for
 * Christmas delivery" pill, "By Dec 15" on a phone, came off the head row, the phone count row and every other page).
 * `toolsInRow` off: the icons go in `below` instead (a guide's count row under its banner on a phone, kept as it is on
 * 11-22; the 25 Days sponsors' at every width).
 * Guard: src/test/giftGuidePages1122.test.tsx.
 */
export function GuidesTop({ backTo, banner, tools, nav, toolsInRow = true, below }: {
  backTo: string;
  banner: GuidesBanner | null;
  tools?: ReactNode;
  nav: { active: CatalogGuide | null; myList?: boolean; page?: string };
  toolsInRow?: boolean;
  below?: ReactNode;
}) {
  return (
    <>
      {/* Owner 11-22 (phone): only the three-line menu stays, on the right of "Gift guides"; the head row's search,
          heart and Share and 11-21's chip row are gone up to 767px (the menu sheet holds every page the chips held, and My
          Wish List; "they can click the 3 line ... or they can go back"). Owner 11-22 later, on the heart showing twice:
          "I think by the search and icons filter. The 3 line dash stays up": the heart lives only in a page's own toolbar
          (a guide's count row under its banner); a page with no toolbar (deals days, printables, Holiday Hub) has none. */}
      <GuidesHeadRow backTo={backTo} titleIsH1={!banner}
        phone={<GuidesMenuButton active={nav.active} myList={nav.myList} page={nav.page} />}>
        {toolsInRow && tools}
      </GuidesHeadRow>
      {banner && <GiftGuidesWords lead={banner.lead} title={banner.title} titleId={banner.titleId ?? "gift-guide-title"} tint={banner.tint} sub={banner.sub ?? true} />}
      {below}
    </>
  );
}
