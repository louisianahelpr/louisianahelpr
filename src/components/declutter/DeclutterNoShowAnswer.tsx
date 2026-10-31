/**
 * A buyer's no-show report on an order (owner 10-30, declutter_report_no_show / declutter_report_not_delivered): the seller
 * has 24 hours to answer, nothing is refunded and nobody gets a strike until then. Both cards say where it stands; the
 * seller's has the answer. An answer goes to Louisiana Helpr with the money held.
 */
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { declutterErrorMessage } from "@/lib/declutter/errors";
import { answerNoShow, fetchMyHandover, reportNoShow } from "@/lib/declutter/handover";
import { toast } from "sonner";
import { NoShowSheet } from "./DeclutterHandoverSheets";
import { invalidate, type PaidOrder } from "./paidOrders";

const btn = "rounded-full border border-border px-4 py-2 text-sm font-semibold";

const when = (iso: string) => new Date(iso).toLocaleString([], { weekday: "short", hour: "numeric", minute: "2-digit" });

export function NoShowAnswer({ orderId, side, delivery, free }: { orderId: string; side: "buyer" | "seller"; delivery: boolean; free: boolean }) {
  const qc = useQueryClient();
  const handover = useQuery({ queryKey: ["declutter", "handover", orderId], queryFn: () => fetchMyHandover(orderId) });
  const [note, setNote] = useState("");
  const [failed, setFailed] = useState<string | null>(null);
  const answer = useMutation({
    mutationFn: () => answerNoShow(orderId, note.trim()),
    onSuccess: () => {
      setFailed(null);
      void qc.invalidateQueries({ queryKey: ["declutter"] });
    },
    // On the card, beside the button: it is a deadline with a strike behind it.
    onError: (err) => setFailed(declutterErrorMessage(err)),
  });
  const by = handover.data?.no_show_answer_by;
  if (!by) return null;
  const what = delivery ? "it wasn't delivered" : "you didn't show";
  if (side === "buyer") {
    return (
      <p role="status" className="rounded-xl border border-border px-3 py-2 text-ds-13" data-no-show-told="">
        You told us {delivery ? "it wasn't delivered" : "the seller didn't show"}. The seller has until {when(by)} to answer.
        {" "}{free ? "If they don't, this pickup is cancelled and they get a strike." : "If they don't, you get everything back and they get a strike."}
        {" "}If they say otherwise, Louisiana Helpr decides.
      </p>
    );
  }
  const noteId = `no-show-answer-${orderId}`;
  return (
    <div className="space-y-2 rounded-xl border border-border px-3 py-2" data-no-show-answer="">
      <p className="text-ds-14 font-semibold">The buyer says {what}.</p>
      <p className="text-ds-13 text-muted-foreground">
        Answer by {when(by)}. {free ? "If you don't, this pickup is cancelled and you get a strike." : "If you don't, the buyer is refunded and you get a strike."}
        {" "}If you answer, Louisiana Helpr looks at both sides. {free ? "" : "The money stays held, and "}{free ? "N" : "n"}o one gets a strike until they decide.
      </p>
      <label htmlFor={noteId} className="block text-xs font-medium">What happened?</label>
      <textarea id={noteId} rows={3} maxLength={1000} value={note} onChange={(e) => setNote(e.target.value)} className="w-full rounded-2xl border border-input glass-field px-3 py-2 text-ds-15" />
      {failed && <p role="alert" className="text-sm text-destructive-ink">{failed}</p>}
      <Button type="button" className="rounded-full" disabled={answer.isPending || !note.trim()} onClick={() => answer.mutate()}>
        {delivery ? "I delivered it" : "I was there"}
      </Button>
    </div>
  );
}

export function NoShowButton({ order, slotStart, who }: { order: PaidOrder; slotStart: string; who: string }) {
  const qc = useQueryClient();
  const [asking, setAsking] = useState(false);
  const report = useMutation({
    mutationFn: () => reportNoShow(order.orderId),
    // Where it stands shows on the card (NoShowAnswer): toasts for a confirmation show nothing (toastPolicy).
    onSuccess: () => { setAsking(false); invalidate(qc, order.orderId); },
    onError: (err) => toast.error(declutterErrorMessage(err)),
  });
  const handover = useQuery({ queryKey: ["declutter", "handover", order.orderId], queryFn: () => fetchMyHandover(order.orderId) });
  // Row 94: from 15 minutes after the booked time. The server checks again.
  if (Date.now() < new Date(slotStart).getTime() + 15 * 60_000) return null;
  // One report at a time; after the seller's "Picked up" it is a problem report (seller_confirmed).
  if (handover.data?.no_show_reported_at || handover.data?.seller_confirmed_at) return null;
  return (
    <div>
      <button type="button" className={btn} disabled={report.isPending} onClick={() => setAsking(true)}>
        They didn't show
      </button>
      <NoShowSheet open={asking} onOpenChange={setAsking} side={order.side} who={who} free={order.lines.every((l) => l.price_cents === 0)} pending={report.isPending} onConfirm={() => report.mutate()} />
    </div>
  );
}
