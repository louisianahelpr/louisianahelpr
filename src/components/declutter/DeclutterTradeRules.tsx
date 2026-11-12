/**
 * Declutter trades (owner 10-31): a listing's own "Open to trades" switch in Manage listing, the same row shape as
 * "Accept offers" beside it. On: buyers can offer one of their own live listings in trade (declutter_offer_swap);
 * off closes the open trade offers on it (declutter_set_trade_rules, 20261106163703). A free listing is claimed,
 * never traded, so it has no switch.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Switch } from "@/components/ui/switch";
import { declutterErrorMessage } from "@/lib/declutter/errors";
import { fetchAcceptsTrades, setTradeRules } from "@/lib/declutter/trades";
import "@/lib/i18n/enListingParts";
import { t } from "@/lib/i18n/language";

const tradesKey = (itemId: string) => ["declutter", "accepts-trades", itemId] as const;

export function DeclutterTradeRules({ itemId, rowClassName }: { itemId: string; rowClassName: string }) {
  const qc = useQueryClient();
  const state = useQuery({ queryKey: tradesKey(itemId), queryFn: () => fetchAcceptsTrades(itemId) });
  const on = state.data === true;
  const rules = useMutation({
    mutationFn: (v: boolean) => setTradeRules(itemId, v),
    onSuccess: (_d, v) => {
      toast(v ? t("lp.tr.on") : t("lp.tr.off"));
      qc.setQueryData(tradesKey(itemId), v);
      void qc.invalidateQueries({ queryKey: ["declutter"] });
    },
    onError: (err) => toast.error(declutterErrorMessage(err)),
  });
  return (
    <li className={rowClassName} data-trade-rules="">
      <span className="flex-1 min-w-0">
        <span id={`trades-on-${itemId}`} className="block text-ds-15 font-semibold">{t("lp.ld.tradesTitle")}</span>
        <span className="block text-ds-13 text-muted-foreground">{on ? t("lp.ld.tradesOn") : t("lp.ld.tradesOff")}</span>
      </span>
      <Switch aria-labelledby={`trades-on-${itemId}`} checked={on} disabled={!state.isSuccess || rules.isPending} onCheckedChange={(v) => rules.mutate(v === true)} />
    </li>
  );
}
