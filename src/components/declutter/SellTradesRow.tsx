/**
 * Owner decision 2026-11-08: one small "Open to trades?" switch on the posting screen, below Condition (a deliberate
 * exception to the 11-01 six-field posting design; not a new step). It starts from the seller's listing default
 * (Settings > Listing defaults; OFF unless set), is saved at Post (useSellFlowState -> tradesOnIfChosen) and becomes
 * next time's start. Hidden for a free listing: trades need a priced item on both sides.
 */
import { Switch } from "@/components/ui/switch";
import type { SellFlow } from "./useSellFlowState";
import "@/lib/i18n/enSellForm";
import { t } from "@/lib/i18n/language";

export function SellTradesRow({ s }: { s: Pick<SellFlow, "form" | "tradesWanted" | "setTradesWanted"> }) {
  const { form, tradesWanted, setTradesWanted } = s;
  if (form.free) return null;
  return (
    <li className="flex items-center gap-3 px-4 py-3.5" data-sell-trades={tradesWanted ? "on" : "off"}>
      <label htmlFor="sell-trades" className="min-w-0 flex-1">
        <span className="block text-ds-13 font-semibold text-muted-foreground">{t("sf.tradesTitle")}</span>
        <span className="block text-ds-14 text-foreground">{t("sf.tradesLine")}</span>
      </label>
      <Switch id="sell-trades" checked={tradesWanted} onCheckedChange={(v) => setTradesWanted(v === true)} />
    </li>
  );
}
