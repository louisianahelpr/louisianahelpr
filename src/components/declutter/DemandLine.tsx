/**
 * Declutter top 5 #3 (owner 11-19): the item page's "In demand" line ("3 offers this week · 8 people saved this · 12
 * views today"), real counts only, each part past its threshold (demandLines). Nothing shows below them, so a quiet
 * listing reads exactly as before. One small read after the page is up; it never holds the page.
 * #4: the same read says when the listing is in the seller's shop-wide sale ("Shop sale: 20% off until Sun, Nov 23"),
 * only while its price is the sale price (the struck-through listed price is already beside the price).
 */
import { useQuery } from "@tanstack/react-query";
import { Tag, TrendingUp } from "lucide-react";
import { demandLines, fetchItemDemand } from "@/lib/declutter/demand";
import "@/lib/i18n/enItemPage";
import { getLang, t } from "@/lib/i18n/language";

function saleDay(iso: string): string {
  return new Date(iso).toLocaleDateString(getLang() === "es" ? "es-US" : "en-US", { weekday: "short", month: "short", day: "numeric" });
}

export function DemandLine({ itemId }: { itemId: string }) {
  const demand = useQuery({ queryKey: ["declutter", "item-demand", itemId], queryFn: () => fetchItemDemand(itemId), staleTime: 60_000 });
  const d = demand.data ?? null;
  const lines = demandLines(d);
  const sale = d?.sale_pct && d.sale_ends_at ? { pct: d.sale_pct, when: saleDay(d.sale_ends_at) } : null;
  if (lines.length === 0 && !sale) return null;
  const words = lines.map((l) => (l.key === "offers" ? t("ip.demand.offers", { n: l.n }) : l.key === "saves" ? t("ip.demand.saves", { n: l.n }) : t("ip.demand.views", { n: l.n })));
  return (
    <>
      {sale && (
        <p data-item-sale="" className="flex items-start gap-1.5 text-ds-13 font-semibold text-[hsl(var(--sienna-ink))]">
          <Tag className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
          <span>{t("ip.sale", sale)}</span>
        </p>
      )}
      {lines.length > 0 && (
        <p data-item-demand="" className="flex items-start gap-1.5 text-ds-13 font-medium text-[hsl(var(--sienna-ink))]">
          <TrendingUp className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
          <span><span className="sr-only">{t("ip.demand.label")}: </span>{words.join(" · ")}</span>
        </p>
      )}
    </>
  );
}
