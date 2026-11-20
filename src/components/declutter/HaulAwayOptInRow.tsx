/**
 * "If it doesn't sell, offer me a haul-away" (owner 2026-11-20: "we shouldn't offer to haul away unless they pick
 * that"). Off by default for every listing. Only a listing with it on gets the 14-day "Haul-away is open" notice
 * (declutter_haul_away_sweep) and the haul-away card, line and tip on My listings. Server: migration 20261120152652
 * (declutter_set_haul_away_opt_in / declutter_haul_away_opt_in_state). Shown in Manage listing beside "make it free
 * after __ days" (the AutoFreeRow pattern). Hidden while haul-away is not open for the member (the state reads null)
 * and until the migration is on prod (PGRST202 -> "not_deployed").
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Switch } from "@/components/ui/switch";
import { ErrorState } from "@/components/ui/ErrorState";
import { declutterErrorMessage } from "@/lib/declutter/errors";
import { fetchHaulAwayOptIn, setHaulAwayOptIn } from "@/lib/declutter/api";
import "@/lib/i18n/enListingParts";
import { t } from "@/lib/i18n/language";

/** Manage listing's row: an <li> in its settings list. */
export function HaulAwayOptInRow({ itemId, rowClassName }: { itemId: string; rowClassName: string }) {
  const qc = useQueryClient();
  const key = ["declutter", "haul-away-opt-in", itemId];
  const state = useQuery({ queryKey: key, queryFn: () => fetchHaulAwayOptIn(itemId) });
  const flip = useMutation({
    mutationFn: (on: boolean) => setHaulAwayOptIn(itemId, on),
    onSuccess: (on) => {
      toast(on ? t("lp.haulOptToastOn") : t("lp.haulOptToastOff"));
      void qc.invalidateQueries({ queryKey: key });
      // My listings' haul-away card, line and tip follow the choice.
      void qc.invalidateQueries({ queryKey: ["declutter", "haul-away"] });
    },
    onError: (err) => toast.error(declutterErrorMessage(err)),
  });
  if (state.data === "not_deployed" || state.data === null) return null;
  if (state.isError) {
    return <li className={rowClassName}><ErrorState variant="inline" title={t("lp.loadFailed")} body={declutterErrorMessage(state.error)} onRetry={() => void state.refetch()} /></li>;
  }
  if (state.isLoading) return null;
  const on = flip.isPending ? flip.variables === true : state.data === true;
  return (
    <li className={rowClassName} data-haul-opt-in={on ? "on" : "off"}>
      <span className="flex-1 min-w-0">
        <span id={`haul-opt-in-${itemId}`} className="block text-ds-15 font-semibold">{t("lp.haulOptTitle")}</span>
        <span className="block text-ds-13 text-muted-foreground">{t("lp.haulOptExplainer")}</span>
      </span>
      <Switch aria-labelledby={`haul-opt-in-${itemId}`} checked={on} disabled={flip.isPending} onCheckedChange={(v) => flip.mutate(v)} />
    </li>
  );
}
