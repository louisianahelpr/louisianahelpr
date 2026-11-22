import type { ReactNode } from "react";
import BackButton from "@/components/BackButton";
import { giftGuides as G } from "@/content/giftGuides";

/**
 * The ONE head row of every Holiday gift guides page (owner 2026-11-22: "make the header consistent on EVERY Holiday gift
 * guides sub-page ... back arrow, then 'Holiday gift guides' to the right of the back button, and the page's own main
 * title BELOW that"). The landing, Her/Him/Kids, the deals days, My list and a shared list (GiftGuides.tsx), and every
 * page in GuidesFrame (the three free printables pages, Swipe, the Secret Santa draw and reveal, the planner, Shop Small)
 * draw it from here, so the words beside the arrow cannot drift from page to page again. `titleIsH1` only where the page
 * has no title of its own (the landing, My list, a shared list); every other page's own title is its h1, drawn under
 * this row. `children`: the row's right side from 768px up (the shipping pill, the icons).
 * Owner 2026-11-22 (phone): "Remove everything under the holiday gift guides on the phone view ... Only thing that will
 * stay is the 3 line with no circle around it and the heart. Both of those will go on the right of the holiday gift
 * guide. On the phone view change holiday gift guides to just gift guides bc it's too long the other way." Up to 767px
 * the row is ONE line: back arrow + "Gift guides" (the CSS hides "Holiday " and capitalises the "g"), then `phone` (the
 * heart and the three-line menu) on the right; the pill and the icons (`children`) are hidden there.
 * Guard: src/test/giftGuidesHeadRowEverywhere1122.test.tsx, src/test/giftGuidePhoneHead1122.test.tsx.
 */
const HOLIDAY = "Holiday ";
const name = G.headerTitle.startsWith(HOLIDAY)
  ? <><span className="gg-head-holiday">{HOLIDAY}</span>{G.headerTitle.slice(HOLIDAY.length)}</>
  : G.headerTitle;

export function GuidesHeadRow({ backTo, titleIsH1 = false, ship = false, phone, children }: { backTo: string; titleIsH1?: boolean; ship?: boolean; phone?: ReactNode; children?: ReactNode }) {
  return (
    <div className={ship ? "gg-headrow" : "gg-headrow gg-headrow-noship"} data-gift-headrow="">
      <div className="gg-head-title" data-gift-head-title="">
        <span className="contents" data-gift-back-to={backTo}><BackButton to={backTo} /></span>
        {titleIsH1
          ? <h1 className="text-page-title leading-tight" data-gift-head-name="">{name}</h1>
          : <p className="text-page-title leading-tight" data-gift-head-name="">{name}</p>}
      </div>
      {children}
      {phone && <div className="gg-head-phone" data-gift-head-phone="">{phone}</div>}
    </div>
  );
}
