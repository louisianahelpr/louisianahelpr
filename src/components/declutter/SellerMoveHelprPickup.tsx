/**
 * BUY-42 (buying audit 10-30 #42): the seller's one move of a booked Helpr's pickup (helpr_task_seller_move_pickup,
 * 20261031095846). The Helpr picks a time inside the seller's pickup times; a seller who then can't make it moves it
 * once, to another of their own times at least 2 hours away, and the Helpr and the buyer are told. The chips are the
 * buyer's booking chips over the same windows (PickupSlotPicker); the server re-checks every rule.
 */
import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { moveHelprPickup } from "@/lib/helprTasks/api";
import { declutterErrorMessage } from "@/lib/declutter/errors";
import { invalidateTasks } from "./useTaskSteps";
import { PickupSlotPicker } from "./DeclutterPickupWindows";

const btn = "rounded-full border border-border px-4 py-2 text-sm font-semibold";

export function SellerMoveHelprPickup({ taskId, orderId, who, current = null }: { taskId: string; orderId: string; who: string; current?: string | null }) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [pick, setPick] = useState<string | null>(null);
  const move = useMutation({
    mutationFn: (iso: string) => moveHelprPickup(taskId, iso),
    onSuccess: () => {
      toast(`Pickup moved. ${who} and the buyer are told.`);
      setOpen(false);
      setPick(null);
      invalidateTasks(qc);
    },
    onError: (err) => toast.error(declutterErrorMessage(err)),
  });
  if (!open) {
    return (
      <button type="button" className={btn} onClick={() => setOpen(true)} aria-expanded={false} data-move-helpr-pickup="">
        Move pickup time
      </button>
    );
  }
  return (
    <div className="space-y-2 rounded-xl border border-border p-3" data-move-helpr-pickup-panel="">
      <p className="text-ds-13">
        Can't make it? Pick another of your pickup times, at least 2 hours from now. You can move it once; {who} and the buyer are told.
      </p>
      <PickupSlotPicker orderId={orderId} value={pick} onPick={setPick} own current={current}
        fallback={<p className="text-sm text-muted-foreground">Message the Helpr to agree a new time.</p>} />
      <div className="flex flex-wrap gap-2">
        <button type="button" className="btn-grad-primary rounded-full px-4 py-2 text-sm font-semibold" disabled={!pick || move.isPending}
          onClick={() => { if (pick) move.mutate(pick); }}>
          Move to this time
        </button>
        <button type="button" className={btn} disabled={move.isPending} onClick={() => { setOpen(false); setPick(null); }}>
          Keep the time
        </button>
      </div>
    </div>
  );
}
