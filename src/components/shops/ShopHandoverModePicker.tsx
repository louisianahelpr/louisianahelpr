/**
 * How the shop's orders are handed over (Shops M2, owner pop-up 2026-10-18:
 * the shop's choice, in person by default, NO codes). Its own file so the
 * dashboard keeps one loading gate (oneLoadingGatePerScreen): this section
 * loads on its own, as the cancel rule does.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { RadioCardList } from "@/components/ui/RadioCardList";
import { ErrorState } from "@/components/ui/ErrorState";
import { Skeleton } from "@/components/ui/skeleton";
import { fetchHandoverMode, HANDOVER_MODES, HANDOVER_MODE_TEXT, setHandoverMode, type HandoverMode } from "@/lib/shops/handover";
import { shopsErrorMessage } from "@/lib/shops/errors";
import { ShopSettingSaved } from "./shopSettingsUi";
import { useLanguage } from "@/lib/i18n/language";
import "@/lib/i18n/enShopsBrowse";

export default function HandoverModePicker({ shopId }: { shopId: string }) {
  const { t } = useLanguage();
  const qc = useQueryClient();
  const mode = useQuery({ queryKey: ["shops", "handover-mode", shopId], queryFn: () => fetchHandoverMode(shopId) });
  const save = useMutation({
    mutationFn: (m: HandoverMode) => setHandoverMode(m),
    // Area 07 M5: the shared inline "Saved" line (ShopSettingSaved), as every shop setting shows; no toast.
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["shops", "handover-mode", shopId] });
    },
    onError: (err) => toast.error(shopsErrorMessage(err)),
  });
  return (
    <section className="space-y-2" aria-labelledby="shop-handover-mode">
      <h3 id="shop-handover-mode" className="text-ds-13 font-semibold">{t("shb.set.howTitle")}</h3>
      <p className="text-ds-11 text-muted-foreground">{t("shb.set.howSub")}</p>
      {mode.isLoading ? (
        <Skeleton className="h-24 w-full rounded-2xl" />
      ) : mode.isError ? (
        <ErrorState variant="inline" title={t("shb.set.loadFailed")} body={shopsErrorMessage(mode.error)} onRetry={() => void mode.refetch()} />
      ) : (
        <RadioCardList
          label={t("shb.set.howTitle")}
          options={HANDOVER_MODES.map((m) => ({ value: m, label: HANDOVER_MODE_TEXT[m].label, sub: HANDOVER_MODE_TEXT[m].detail }))}
          value={mode.data ?? ""}
          onChange={(m) => { if (m !== mode.data && !save.isPending) save.mutate(m as HandoverMode); }}
        />
      )}
      <ShopSettingSaved show={save.isSuccess} />
    </section>
  );
}

/** What a buyer reads before paying: how this shop hands orders over. Nothing until it has loaded. */
export function HandoverModeNote({ shopId }: { shopId: string }) {
  const mode = useQuery({ queryKey: ["shops", "handover-mode", shopId], queryFn: () => fetchHandoverMode(shopId) });
  if (!mode.data) return null;
  const t = HANDOVER_MODE_TEXT[mode.data];
  return (
    <div className="space-y-1 rounded-xl bg-muted/60 p-3" data-testid="shop-order-handover-mode">
      <p className="text-ds-13 font-semibold">{t.label}</p>
      <p className="text-ds-11 text-muted-foreground">
        {mode.data === "porch"
          ? "The shop leaves your order out with a photo. Tap \"I got it\" when you have it. If you didn't get it, tell us within 48 hours of the photo, or of the start of the ready day if that is later; after that the shop is paid."
          : "You pick your order up from the shop. Tap \"I got it\" when you have it. If the shop says it handed it over and you didn't get it, tell us within 48 hours; after that the shop is paid."}
      </p>
    </div>
  );
}
