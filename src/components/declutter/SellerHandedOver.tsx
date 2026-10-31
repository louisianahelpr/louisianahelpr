/**
 * The seller's "Handed over" on a Helpr delivery (audit 2026-10-28, report 1c #1; helpr_task_handed_over,
 * 20261030012018): the seller says the item is in the assigned Helpr's hands, which lets that Helpr mark it picked
 * up before the 30-minute window. It changes no status and moves no money. Asked in the app, never window.confirm.
 */
import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { markHandedOver } from "@/lib/helprTasks/api";
import { declutterErrorMessage } from "@/lib/declutter/errors";
import { invalidateTasks } from "./useTaskSteps";
import { ConfirmSheet } from "./DeclutterConfirmSheet";
import { SellerMoveHelprPickup } from "./SellerMoveHelprPickup";

const btn = "rounded-full border border-border px-4 py-2 text-sm font-semibold";
const clock = (iso: string) => new Date(iso).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });

export function SellerHandedOver({ taskId, orderId, who, handedOverAt, pickupAt = null }: { taskId: string; orderId: string; who: string; handedOverAt: string | null | undefined; pickupAt?: string | null }) {
  const qc = useQueryClient();
  const [ask, setAsk] = useState(false);
  const handed = useMutation({
    mutationFn: () => markHandedOver(taskId),
    onSettled: () => setAsk(false),
    onSuccess: () => {
      toast("Thanks. The Helpr can mark it picked up now.");
      invalidateTasks(qc);
    },
    onError: (err) => toast.error(declutterErrorMessage(err)),
  });
  if (handedOverAt) return <p className="text-sm" data-handed-over="">You said you handed it over · {clock(handedOverAt)}</p>;
  return (
    <>
      <button type="button" className={btn} disabled={handed.isPending} onClick={() => setAsk(true)}>
        Handed over
      </button>
      {/* BUY-42: until it is handed over, the seller may move the Helpr's pickup once. */}
      <SellerMoveHelprPickup taskId={taskId} orderId={orderId} who={who} current={pickupAt} />
      <ConfirmSheet open={ask} title={`Did you hand it to ${who}?`} confirmLabel="Handed over" pending={handed.isPending}
        onConfirm={() => handed.mutate()} onClose={() => setAsk(false)} testId="delivery-handed-over">
        Tap this only once the item is in the Helpr's hands. They can then mark it picked up.
      </ConfirmSheet>
    </>
  );
}
