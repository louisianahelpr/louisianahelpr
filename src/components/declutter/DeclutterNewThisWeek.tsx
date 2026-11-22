/**
 * Declutter selling boost (owner 11-20): Browse's "New this week" row, the newest listings of the last 7 days
 * (newThisWeek.ts), as a sideways row above the grid. Its own chunk (lazy from DeclutterBrowseView), so the Browse first
 * screen downloads none of it; it reads the list Browse already loaded, so it asks the server nothing. Browse renders it
 * only when the row has something to show.
 *
 * Owner 11-21 ("its listed twice"): each card is the grid's own card, drawn by Browse's `card` (heart, photo tag, price
 * and "incl. fee"), at the grid's column width (DECLUTTER_ROW[_FULL]); and the row's listings leave the grid below.
 *
 * Guards: src/test/declutterSellingBoost.test.tsx, src/test/declutterNewThisWeekNoDupe.test.tsx.
 */
import type { ReactNode } from "react";
import type { DeclutterItem } from "@/lib/declutter/api";
import { useLanguage } from "@/lib/i18n/language";
import "@/lib/i18n/enDeclutter";
import "@/lib/i18n/enDeclBrowse";
import { DECLUTTER_ROW, DECLUTTER_ROW_FULL } from "./DeclutterSkeletons";

export default function DeclutterNewThisWeek({ items, card, full }: {
  items: DeclutterItem[];
  /** Browse's grid card for this item at slot `n` (the row is the page's first row of cards). */
  card: (item: DeclutterItem, n: number) => ReactNode;
  /** The grid spans the whole panel (desktop, map hidden): DECLUTTER_GRID_FULL's columns. */
  full: boolean;
}) {
  const { t } = useLanguage();
  if (items.length === 0) return null;
  const title = t("decl.newThisWeek");
  return (
    <section data-new-this-week="" className="space-y-2" aria-label={title}>
      <h2 className="text-base font-semibold">{title}</h2>
      <ul className={full ? DECLUTTER_ROW_FULL : DECLUTTER_ROW} data-new-this-week-scroller="">
        {items.map((it, n) => (
          <li key={it.id} className="min-w-0 snap-start">
            {card(it, n)}
          </li>
        ))}
      </ul>
    </section>
  );
}
