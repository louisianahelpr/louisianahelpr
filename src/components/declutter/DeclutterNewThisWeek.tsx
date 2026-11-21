/**
 * Declutter selling boost (owner 11-20): Browse's "New this week" row, the newest listings of the last 7 days
 * (newThisWeek.ts), as a sideways row of Browse's own card above the grid. Its own chunk (lazy from
 * DeclutterBrowseView), so the Browse first screen downloads none of it; it reads the list Browse already loaded, so
 * it asks the server nothing. Browse renders it only when the row has something to show.
 *
 * Guard: src/test/declutterSellingBoost.test.tsx.
 */
import type { DeclutterItem } from "@/lib/declutter/api";
import { useLanguage } from "@/lib/i18n/language";
import "@/lib/i18n/enDeclutter";
import "@/lib/i18n/enDeclBrowse";
import { Row } from "./DeclutterItemRows";

export default function DeclutterNewThisWeek({ items, cover, from }: {
  items: DeclutterItem[];
  cover: Map<string, string>;
  from: { lat: number; lng: number; approximate: boolean } | null;
}) {
  const { t } = useLanguage();
  if (items.length === 0) return null;
  return (
    <div data-new-this-week="">
      <Row title={t("decl.newThisWeek")} items={items} cover={cover} from={from} />
    </div>
  );
}
