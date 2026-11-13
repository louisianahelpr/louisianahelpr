/**
 * Selling's small parts (split out of DeclutterHomeView.tsx for componentSizeRatchet, owner train 2026-11-13): a listing
 * row's price, the in-place search over the seller's own rows (owner 11-13), and the one row to the seller's settings.
 */
import { Link } from "react-router-dom";
import { ChevronRight, Settings } from "lucide-react";
import type { DeclutterItem } from "@/lib/declutter/api";
import { itemPriceLabel } from "@/lib/declutter/distance";
import { t } from "@/lib/i18n/language";
import "@/lib/i18n/enDeclutter";

export const SOLD = new Set<DeclutterItem["status"]>(["sold", "completed"]);

/**
 * A listing row's price. A sold one shows what it sold for (deep audit SE-5: $40 listed, sold for $32), and nothing
 * while that is unknown, never the list price in its place.
 */
export function ListingPrice({ item, sold }: { item: DeclutterItem; sold: number | undefined }) {
  const cents = SOLD.has(item.status) ? sold : item.current_price_cents;
  if (cents === undefined) return null;
  return (
    <span className="shrink-0 text-ds-15 font-bold tabular-nums text-[hsl(var(--burnt-sienna))]" data-listing-price="">
      {itemPriceLabel(cents)}
    </span>
  );
}

/**
 * Owner 11-13 ("I'm trying to look in my items I'm selling"): Selling's search bar filters the seller's own rows in
 * place, by title and description, case and accents ignored. The whole list is already loaded (fetchMyItems reads
 * every listing), so this is a plain filter on the device, never a server round.
 */
const fold = (s: string) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
export function matchesListingSearch(item: Pick<DeclutterItem, "title" | "description">, q: string): boolean {
  const words = fold(q).split(/\s+/).filter(Boolean);
  if (words.length === 0) return true;
  const hay = fold(`${item.title ?? ""} ${item.description ?? ""}`);
  return words.every((w) => hay.includes(w));
}

/** Selling's one row to the seller's settings, in the same row look as "Deliver for pay" under it. */
export function SellingSettingsEntry() {
  return (
    <Link
      to={DECLUTTER_SETTINGS.path}
      data-selling-settings=""
      className="flex items-center gap-3 rounded-2xl border border-border bg-card px-4 py-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <Settings className="h-5 w-5 shrink-0" aria-hidden />
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-semibold">{t("decl.hv.settings")}</span>
        <span className="block text-xs text-muted-foreground">{t("decl.hv.settingsSub")}</span>
      </span>
      <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
    </Link>
  );
}

export const DECLUTTER_SETTINGS = { get label() { return t("decl.hv.settings"); }, path: "/declutter/settings" } as const;
