/**
 * "Keep it up until it sells" (owner 2026-10-29, pop-up answer: a seller switch, off by default). With it on, the
 * hourly listing-rounds sweep renews the listing every 30 days with no cap and sends no "ends soon" or "back up"
 * notices; off, the normal rule (LISTING_LIFETIME) runs. Server: migration 20261029154323 (declutter_set_keep_up /
 * declutter_keep_up_state). Shown in Manage listing (next to "make it free after __ days") and on the sell flow's last step,
 * where the listing is already a saved draft. Hidden until the migration is on prod (PGRST202 -> "not_deployed").
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Switch } from "@/components/ui/switch";
import { ErrorState } from "@/components/ui/ErrorState";
import { declutterErrorMessage } from "@/lib/declutter/errors";
import { fetchKeepUp, setKeepUp } from "@/lib/declutter/api";
import { enListingParts } from "@/lib/i18n/enListingParts";
import { t } from "@/lib/i18n/language";

/** The English words (enListingParts, F260q); the screen says t("lp.keepUp…") so Spanish readers get Spanish. */
export const KEEP_UP_TITLE = enListingParts["lp.keepUpTitle"];
export const KEEP_UP_EXPLAINER = enListingParts["lp.keepUpExplainer"];

/**
 * The new-listing form's ONE line under the switch, for the setting it is on now (lead 2026-10-30, shot
 * ~/.lh-shots/b69-free-tab/after2-sell-375.png). It showed KEEP_UP_EXPLAINER ("renews every 30 days until someone
 * buys it") AND, under it, the off rule ("goes back up by itself up to 3 more times (about 4 months)"): two lines
 * that contradict each other. Same "Off. …" shape as the "Lower the price if it doesn't sell?" card above it.
 * Off = the listing-rounds rule (30 days, relisted up to 3 more times, a reminder before each round ends; migration
 * 20261029154323's sweep); on = no cap and no reminders.
 */
export function keepUpSettingLine(on: boolean): string {
  return on ? t("lp.keepUpOn") : t("lp.keepUpOff");
}

/** The switch's saved state and its flip, shared by the sell flow's review row and the switch itself. */
export function useKeepUp(itemId: string | null) {
  const qc = useQueryClient();
  const key = ["declutter", "keep-up", itemId];
  const state = useQuery({ queryKey: key, queryFn: () => fetchKeepUp(itemId!), enabled: !!itemId });
  const flip = useMutation({
    mutationFn: (on: boolean) => setKeepUp(itemId!, on),
    onSuccess: (on) => {
      toast(on ? t("lp.keepUpToastOn") : t("lp.keepUpToastOff"));
      void qc.invalidateQueries({ queryKey: key });
    },
    onError: (err) => toast.error(declutterErrorMessage(err)),
  });
  return { itemId, state, flip, on: state.data === true };
}

export type KeepUp = ReturnType<typeof useKeepUp>;

/** The row itself: an <li> in Manage listing's list, or a card on the sell flow's last step. */
export function KeepUpSwitch({ keep, rowClassName, as = "li" }: { keep: KeepUp; rowClassName: string; as?: "li" | "div" }) {
  const { itemId, state, flip, on } = keep;
  const Row = as;
  if (!itemId || state.data === "not_deployed") return null;
  if (state.isError) return <Row className={rowClassName}><ErrorState variant="inline" title={t("lp.loadFailed")} body={declutterErrorMessage(state.error)} onRetry={() => void state.refetch()} /></Row>;
  return (
    <Row className={rowClassName} data-keep-up={on ? "on" : "off"}>
      <span className="flex-1 min-w-0">
        <span id={`keep-up-${itemId}`} className="block text-ds-15 font-semibold">{t("lp.keepUpTitle")}</span>
        <span className="block text-ds-13 text-muted-foreground">{t("lp.keepUpExplainer")}</span>
      </span>
      <Switch aria-labelledby={`keep-up-${itemId}`} checked={on} disabled={state.isLoading || flip.isPending} onCheckedChange={(v) => flip.mutate(v)} />
    </Row>
  );
}

/** Manage listing's row. */
export function KeepUpRow({ itemId, rowClassName }: { itemId: string; rowClassName: string }) {
  const keep = useKeepUp(itemId);
  return <KeepUpSwitch keep={keep} rowClassName={rowClassName} />;
}
