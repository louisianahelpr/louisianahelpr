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
 * this row. `children`: the row's right side (the shipping pill, the icons).
 * Guard: src/test/giftGuidesHeadRowEverywhere1122.test.tsx.
 */
export function GuidesHeadRow({ backTo, titleIsH1 = false, ship = false, children }: { backTo: string; titleIsH1?: boolean; ship?: boolean; children?: ReactNode }) {
  return (
    <div className={ship ? "gg-headrow" : "gg-headrow gg-headrow-noship"} data-gift-headrow="">
      <div className="gg-head-title" data-gift-head-title="">
        <span className="contents" data-gift-back-to={backTo}><BackButton to={backTo} /></span>
        {titleIsH1
          ? <h1 className="text-page-title leading-tight" data-gift-head-name="">{G.headerTitle}</h1>
          : <p className="text-page-title leading-tight" data-gift-head-name="">{G.headerTitle}</p>}
      </div>
      {children}
    </div>
  );
}
