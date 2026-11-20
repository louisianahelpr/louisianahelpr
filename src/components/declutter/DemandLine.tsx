/**
 * Declutter top 5 #3 (owner 11-19): the item page's "In demand" line ("3 offers this week · 8 people saved this · 12
 * views today"), real counts only, each part past its threshold (demandLines). Nothing shows below them, so a quiet
 * listing reads exactly as before. One small read after the page is up; it never holds the page.
 */
import { useQuery } from "@tanstack/react-query";
import { TrendingUp } from "lucide-react";
import { demandLines, fetchItemDemand } from "@/lib/declutter/demand";
import "@/lib/i18n/enItemPage";
import { t } from "@/lib/i18n/language";

export function DemandLine({ itemId }: { itemId: string }) {
  const demand = useQuery({ queryKey: ["declutter", "item-demand", itemId], queryFn: () => fetchItemDemand(itemId), staleTime: 60_000 });
  const lines = demandLines(demand.data ?? null);
  if (lines.length === 0) return null;
  const words = lines.map((l) => (l.key === "offers" ? t("ip.demand.offers", { n: l.n }) : l.key === "saves" ? t("ip.demand.saves", { n: l.n }) : t("ip.demand.views", { n: l.n })));
  return (
    <p data-item-demand="" className="flex items-start gap-1.5 text-ds-13 font-medium text-[hsl(var(--sienna-ink))]">
      <TrendingUp className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
      <span><span className="sr-only">{t("ip.demand.label")}: </span>{words.join(" · ")}</span>
    </p>
  );
}
