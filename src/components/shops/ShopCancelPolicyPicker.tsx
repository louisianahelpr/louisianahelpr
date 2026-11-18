/**
 * The shop's cancel rule (Shops M1, O2: three presets the maker picks; buyers
 * read it before they pay). Its own file so the dashboard screen keeps one
 * loading gate (oneLoadingGatePerScreen): this section loads on its own.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { RadioCardList } from "@/components/ui/RadioCardList";
import { ErrorState } from "@/components/ui/ErrorState";
import { Skeleton } from "@/components/ui/skeleton";
import { CANCEL_POLICIES, CANCEL_POLICY_TEXT, fetchCancelPolicy, setCancelPolicy, type CancelPolicy } from "@/lib/shops/orders";
import { shopsErrorMessage } from "@/lib/shops/errors";
import ReadyTapCancelPicker from "./ShopReadyTapCancelPicker";
import { ShopSettingSaved } from "./shopSettingsUi";
import { useLanguage } from "@/lib/i18n/language";
import "@/lib/i18n/enShopsBrowse";

const policyOptions = () => CANCEL_POLICIES.map((p) => ({ value: p, label: CANCEL_POLICY_TEXT[p].shop.label, sub: CANCEL_POLICY_TEXT[p].shop.hint }));

export default function CancelPolicyPicker({ shopId }: { shopId: string }) {
  const { t } = useLanguage();
  const qc = useQueryClient();
  const policy = useQuery({ queryKey: ["shops", "cancel-policy", shopId], queryFn: () => fetchCancelPolicy(shopId) });
  const save = useMutation({
    mutationFn: (p: CancelPolicy) => setCancelPolicy(p),
    // Area 07 M5: the shared inline "Saved" line (ShopSettingSaved), as every shop setting shows; no toast.
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["shops", "cancel-policy", shopId] });
    },
    onError: (err) => toast.error(shopsErrorMessage(err)),
  });
  return (
    <section className="space-y-2" aria-labelledby="shop-cancel-rule">
      <h3 id="shop-cancel-rule" className="text-ds-13 font-semibold">{t("shb.set.cancelTitle")}</h3>
      <p className="text-ds-11 text-muted-foreground">{t("shb.set.cancelSub")}</p>
      {policy.isLoading ? (
        // Q1816 (prod-audit run 43691657529, /shops/dashboard at 375, page-settle 0.051): a 96px bone stood in for the
        // ~290px list, so the section under it moved down 195px when the rule arrived. The placeholder IS the list,
        // invisible under one bone (the dashboard's own pattern, Q2558), so it is the list's height at every width.
        <div className="relative" data-cancel-rule-loading="">
          <div className="invisible" aria-hidden>
            <RadioCardList label={t("shb.set.cancelLabel")} options={policyOptions()} value="" onChange={() => {}} />
          </div>
          <Skeleton className="absolute inset-0 rounded-2xl" />
        </div>
      ) : policy.isError ? (
        <ErrorState variant="inline" title={t("shb.set.cancelLoadFailed")} body={shopsErrorMessage(policy.error)} onRetry={() => void policy.refetch()} />
      ) : (
        <RadioCardList
          label={t("shb.set.cancelLabel")}
          options={policyOptions()}
          value={policy.data ?? ""}
          onChange={(p) => { if (p !== policy.data && !save.isPending) save.mutate(p as CancelPolicy); }}
        />
      )}
      <ShopSettingSaved show={save.isSuccess} />
      {policy.data === "until_handover" && <ReadyTapCancelPicker shopId={shopId} />}
    </section>
  );
}
