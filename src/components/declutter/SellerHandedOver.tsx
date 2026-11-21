/**
 * The seller's "Handed over" on a Helpr delivery (audit 2026-10-28, report 1c #1; helpr_task_handed_over,
 * 20261030012018): the seller says the item is in the assigned Helpr's hands, which lets that Helpr mark it picked
 * up before the 30-minute window. It changes no status and moves no money. Asked in the app, never window.confirm.
 */
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { markHandedOver } from "@/lib/helprTasks/api";
import { declutterErrorMessage } from "@/lib/declutter/errors";
import { invalidateTasks } from "./useTaskSteps";
import { ConfirmSheet } from "./DeclutterConfirmSheet";
import { SellerMoveHelprPickup } from "./SellerMoveHelprPickup";
import "@/lib/i18n/enDeclutter";
import { t } from "@/lib/i18n/language";

const clock = (iso: string) => new Date(iso).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });

export function SellerHandedOver({ taskId, orderId, who, handedOverAt, pickupAt = null }: { taskId: string; orderId: string; who: string; handedOverAt: string | null | undefined; pickupAt?: string | null }) {
  const qc = useQueryClient();
  const [ask, setAsk] = useState(false);
  const handed = useMutation({
    mutationFn: () => markHandedOver(taskId),
    onSettled: () => setAsk(false),
    onSuccess: () => {
      toast(t("dsl.ho.thanks"));
      invalidateTasks(qc);
    },
    onError: (err) => toast.error(declutterErrorMessage(err)),
  });
  if (handedOverAt) return <p className="text-sm" data-handed-over="">{t("dsl.ho.said", { time: clock(handedOverAt) })}</p>;
  return (
    <>
      <Button type="button" variant="outline" size="sm" className="text-sm font-semibold" disabled={handed.isPending} onClick={() => setAsk(true)}>
        {t("dsl.ho.button")}
      </Button>
      {/* BUY-42: until it is handed over, the seller may move the Helpr's pickup once. */}
      <SellerMoveHelprPickup taskId={taskId} orderId={orderId} who={who} current={pickupAt} />
      <ConfirmSheet open={ask} title={t("dsl.ho.ask", { who })} confirmLabel={t("dsl.ho.button")} pending={handed.isPending}
        onConfirm={() => handed.mutate()} onClose={() => setAsk(false)} testId="delivery-handed-over">
        {t("dsl.ho.body")}
      </ConfirmSheet>
    </>
  );
}
