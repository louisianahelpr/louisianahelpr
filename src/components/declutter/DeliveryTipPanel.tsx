/**
 * "Add a tip" on the buyer's delivery once it is done (Q2453; migration 20261028014848). The same
 * picker and the same "You pay" total as a job tip (TipPicker, TipCostBreakdown: board 180), from
 * the same function the server charges with (tipChargeBreakdown, _shared/tipFees.ts), so the
 * number shown is the number charged. The Helpr receives the whole tip; no fee line is shown
 * (owner 2026-10-25). Every rule (who, when, how much) is enforced in SQL and declutter-checkout.
 */
import { useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ErrorState } from "@/components/ui/ErrorState";
import { TipCostBreakdown, TipPicker, centsLabel } from "@/components/TipCostBreakdown";
import { declutterErrorMessage } from "@/lib/declutter/errors";
import { fetchMyPaidDeliveryTips, startDeliveryTip } from "@/lib/declutter/deliveryTip";
import { openExternalUrl } from "@/lib/openExternalUrl";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { tipsNotReadyLine } from "@/hooks/useHelprTakesTips";
import { TIP_MAX_CENTS, TIP_MIN_CENTS } from "../../../supabase/functions/_shared/tipFees";

/** declutter-checkout's tip_waits_on_identity, in the words errors.ts gives it. */
const DELIVERY_TIP_WAITS_ON_ID = "This Helpr can receive tips once verified. Nothing was charged.";

export function DeliveryTipPanel({ taskId, helprFirstName }: { taskId: string; helprFirstName: string | null }) {
  const qc = useQueryClient();
  const { user } = useCurrentUser();
  const userId = user?.id ?? "";
  const tips = useQuery({ queryKey: ["declutter", "delivery-tips", taskId, userId], queryFn: () => fetchMyPaidDeliveryTips(taskId, userId), enabled: !!userId });
  const [dollars, setDollars] = useState<number | undefined>(undefined);
  const [opening, setOpening] = useState(false);
  // Owner 2026-10-30: the server says this Helpr has not verified their ID; the picker gives way to the reason, no money taken.
  const [waitsOnId, setWaitsOnId] = useState(false);
  // One id per opening of the prompt (the job tip's rule, ME-007): a retry is one page, a new tip a new one.
  const attempt = useRef<string>(crypto.randomUUID());
  const who = helprFirstName ?? "your Helpr";
  const send = useMutation({
    mutationFn: (cents: number) => startDeliveryTip(taskId, cents, attempt.current),
    onSuccess: async (url) => {
      setOpening(true);
      await openExternalUrl(url, () => {
        setOpening(false);
        attempt.current = crypto.randomUUID();
        void qc.invalidateQueries({ queryKey: ["declutter", "delivery-tips", taskId] });
      });
    },
    onError: (err) => {
      if (declutterErrorMessage(err) === DELIVERY_TIP_WAITS_ON_ID) setWaitsOnId(true);
      else toast.error(declutterErrorMessage(err));
    },
  });
  if (tips.isError) {
    return <ErrorState variant="inline" title="We couldn't load your tip." body={declutterErrorMessage(tips.error)} onRetry={() => void tips.refetch()} />;
  }
  if (!userId || tips.isLoading) return null;
  const paid = tips.data ?? [];
  if (paid.length > 0) {
    return (
      <section className="space-y-1 border-t border-border pt-3" aria-label="Your tip">
        {paid.map((t) => <p key={t.id} className="text-ds-13">You tipped {who} {centsLabel(t.tip_cents)}. Thank you.</p>)}
      </section>
    );
  }
  if (waitsOnId) {
    return (
      <section className="border-t border-border pt-3" aria-label="Add a tip">
        <p className="text-ds-13 text-muted-foreground" data-testid="tips-not-ready">{tipsNotReadyLine(helprFirstName, true)}</p>
      </section>
    );
  }
  const cents = dollars === undefined ? 0 : Math.round(dollars * 100);
  const valid = cents >= TIP_MIN_CENTS && cents <= TIP_MAX_CENTS;
  const busy = send.isPending || opening;
  return (
    <section className="space-y-3 border-t border-border pt-3" aria-label="Add a tip">
      <div className="space-y-1">
        <h3 className="text-ds-15 font-semibold">Add a tip for {who}?</h3>
        <p className="text-ds-13 text-muted-foreground">Optional. {helprFirstName ?? "Your Helpr"} receives the whole tip.</p>
      </div>
      <TipPicker jobPriceDollars={null} valueDollars={dollars} onChange={setDollars} />
      {valid && <TipCostBreakdown tipDollars={dollars!} receiverName={helprFirstName ?? undefined} />}
      <button type="button" className="btn-grad-primary min-h-11 w-full rounded-full px-4 py-2 text-sm font-semibold"
        disabled={!valid || busy} onClick={() => send.mutate(cents)}>
        {busy ? "Opening payment…" : valid ? `Tip ${centsLabel(cents)}` : "Tip"}
      </button>
    </section>
  );
}
