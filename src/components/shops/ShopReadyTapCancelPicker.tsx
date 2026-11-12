/**
 * What an early "ready" tap does to the buyer's free cancel (owner 2026-10-19:
 * "LET THE SHOPS DECIDE THIS."; Q2155). Shown under the cancel rule while the
 * shop uses "Free to cancel until your order is ready", the one preset a ready
 * tap affects. Its own file and query so it loads on its own.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { RadioCardList } from "@/components/ui/RadioCardList";
import { ErrorState } from "@/components/ui/ErrorState";
import { Skeleton } from "@/components/ui/skeleton";
import { READY_TAP_CANCELS, READY_TAP_CANCEL_TEXT, fetchReadyTapCancel, setReadyTapCancel, type ReadyTapCancel } from "@/lib/shops/orders";
import { shopsErrorMessage } from "@/lib/shops/errors";

export default function ReadyTapCancelPicker({ shopId }: { shopId: string }) {
  const qc = useQueryClient();
  const choice = useQuery({ queryKey: ["shops", "ready-tap-cancel", shopId], queryFn: () => fetchReadyTapCancel(shopId) });
  const save = useMutation({
    mutationFn: (c: ReadyTapCancel) => setReadyTapCancel(c),
    onSuccess: () => {
      toast.success("Saved. New orders use it.");
      void qc.invalidateQueries({ queryKey: ["shops", "ready-tap-cancel", shopId] });
    },
    onError: (err) => toast.error(shopsErrorMessage(err)),
  });
  return (
    <div className="space-y-2" aria-labelledby="shop-ready-tap-cancel">
      <h3 id="shop-ready-tap-cancel" className="text-sm font-semibold">If you mark an order ready early</h3>
      <p className="text-xs text-muted-foreground">What marking an order ready before its ready date does to the buyer's free cancel. Buyers read it before they pay.</p>
      {choice.isLoading ? (
        <Skeleton className="h-20 w-full rounded-2xl" />
      ) : choice.isError ? (
        <ErrorState variant="inline" title="We couldn't load this setting." body={shopsErrorMessage(choice.error)} onRetry={() => void choice.refetch()} />
      ) : (
        <RadioCardList
          label="If you mark an order ready early"
          options={READY_TAP_CANCELS.map((c) => ({ value: c, label: READY_TAP_CANCEL_TEXT[c].label, sub: READY_TAP_CANCEL_TEXT[c].hint }))}
          value={choice.data ?? ""}
          onChange={(c) => { if (c !== choice.data && !save.isPending) save.mutate(c as ReadyTapCancel); }}
        />
      )}
    </div>
  );
}
