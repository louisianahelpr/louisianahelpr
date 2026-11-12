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

export default function CancelPolicyPicker({ shopId }: { shopId: string }) {
  const qc = useQueryClient();
  const policy = useQuery({ queryKey: ["shops", "cancel-policy", shopId], queryFn: () => fetchCancelPolicy(shopId) });
  const save = useMutation({
    mutationFn: (p: CancelPolicy) => setCancelPolicy(p),
    onSuccess: () => {
      toast.success("Cancel rule saved. New orders use it.");
      void qc.invalidateQueries({ queryKey: ["shops", "cancel-policy", shopId] });
    },
    onError: (err) => toast.error(shopsErrorMessage(err)),
  });
  return (
    <section className="space-y-2" aria-labelledby="shop-cancel-rule">
      <h2 id="shop-cancel-rule" className="text-ds-13 font-semibold">Your cancel rule</h2>
      <p className="text-ds-11 text-muted-foreground">Buyers read it before they pay. Orders already placed keep the rule they were placed under.</p>
      {policy.isLoading ? (
        <Skeleton className="h-24 w-full rounded-2xl" />
      ) : policy.isError ? (
        <ErrorState variant="inline" title="We couldn't load your cancel rule." body={shopsErrorMessage(policy.error)} onRetry={() => void policy.refetch()} />
      ) : (
        <RadioCardList
          label="Cancel rule"
          options={CANCEL_POLICIES.map((p) => ({ value: p, label: CANCEL_POLICY_TEXT[p].shop.label, sub: CANCEL_POLICY_TEXT[p].shop.hint }))}
          value={policy.data ?? ""}
          onChange={(p) => { if (p !== policy.data && !save.isPending) save.mutate(p as CancelPolicy); }}
        />
      )}
      {policy.data === "until_handover" && <ReadyTapCancelPicker shopId={shopId} />}
    </section>
  );
}
