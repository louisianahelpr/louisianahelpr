/**
 * BUY-2 (owner 10-31): no Helpr took the delivery, so the sale became a pickup at the seller's home. The buyer chooses:
 * book a pickup (the panel below), or cancel for a refund in which the BUYER bears the card fee. The sums are the
 * server's (declutter_no_helpr_choice, the same ones the refund records).
 *
 * soldstates-5 (owner 10-31): the seller's "The Helpr didn't come" on a Helpr delivery, and the Helpr's answer. The
 * buyer's money stays held; the Helpr has 24 hours to answer, or gets a strike and the delivery goes to another Helpr.
 */
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { declutterErrorMessage } from "@/lib/declutter/errors";
import { formatPrice } from "@/lib/declutter/distance";
import { answerHelprNoShow, cancelAfterNoHelpr, fetchHelprNoShowReport, fetchNoHelprChoice, reportHelprNoShow } from "@/lib/declutter/noHelpr";
import { ConfirmSheet } from "./DeclutterConfirmSheet";

const btn = "rounded-full border border-border px-4 py-2 text-sm font-semibold";
const primary = "btn-grad-primary rounded-full px-4 py-2 text-sm font-semibold";
const when = (iso: string) => new Date(iso).toLocaleString([], { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

/** The buyer's choice after no Helpr took the delivery. Nothing for any other order. */
export function NoHelprChoice({ orderId }: { orderId: string }) {
  const qc = useQueryClient();
  const choice = useQuery({ queryKey: ["declutter", "no-helpr", orderId], queryFn: () => fetchNoHelprChoice(orderId) });
  const [asking, setAsking] = useState(false);
  const cancel = useMutation({
    mutationFn: () => cancelAfterNoHelpr(orderId),
    onSettled: () => setAsking(false),
    onSuccess: () => {
      toast("Sale cancelled. Your refund is on its way.");
      void qc.invalidateQueries({ queryKey: ["declutter"] });
    },
    onError: (err) => toast.error(declutterErrorMessage(err)),
  });
  const c = choice.data;
  if (!c) return null;
  return (
    <div className="space-y-2 rounded-xl border border-border px-3 py-2" data-no-helpr-choice="">
      <p className="text-ds-14 font-semibold">No Helpr took your delivery.</p>
      <p className="text-ds-13">
        The {formatPrice(c.delivery_refunded_cents)} you paid for delivery is coming back to your card. Pick it up at the seller's home
        by {when(c.pickup_by)}, or cancel the sale.
      </p>
      <button type="button" className={btn} disabled={cancel.isPending} onClick={() => setAsking(true)}>
        Cancel and get a refund
      </button>
      <ConfirmSheet open={asking} title="Cancel this sale?" confirmLabel="Cancel the sale" cancelLabel="Keep it" pending={cancel.isPending}
        onConfirm={() => cancel.mutate()} onClose={() => setAsking(false)} testId="no-helpr-cancel">
        You get {formatPrice(c.refund_cents)} back.
        {" "}The item goes back on sale.
      </ConfirmSheet>
    </div>
  );
}

/** The seller's "The Helpr didn't come", 15 minutes after the booked pickup time, and where it stands after. */
export function HelprNoShowReportButton({ orderId, taskId, slotStart, who }: { orderId: string; taskId: string; slotStart: string; who: string }) {
  const qc = useQueryClient();
  const report = useQuery({ queryKey: ["helpr-tasks", "no-show", taskId], queryFn: () => fetchHelprNoShowReport(taskId) });
  const [asking, setAsking] = useState(false);
  const send = useMutation({
    mutationFn: () => reportHelprNoShow(orderId),
    onSettled: () => setAsking(false),
    // Where it stands shows on the card: toasts for a confirmation show nothing (toastPolicy).
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ["helpr-tasks"] }); },
    onError: (err) => toast.error(declutterErrorMessage(err)),
  });
  const r = report.data;
  if (r) {
    return (
      <p role="status" className="rounded-xl border border-border px-3 py-2 text-ds-13" data-helpr-no-show-told="">
        {r.answered_at
          ? `${who} answered your report. Louisiana Helpr looks at both sides. The buyer's money stays held until then.`
          : r.settled_at
            ? `${who} didn't answer, so they got a strike and the delivery went back up for another Helpr.`
            : `You told us ${who} didn't come. They have until ${when(r.answer_by)} to answer. If they don't, they get a strike and another Helpr can take it. The buyer's money stays held.`}
      </p>
    );
  }
  if (Date.now() < new Date(slotStart).getTime() + 15 * 60_000) return null;
  return (
    <div>
      <button type="button" className={btn} disabled={send.isPending} onClick={() => setAsking(true)}>
        The Helpr didn't come
      </button>
      <ConfirmSheet open={asking} title="The Helpr didn't come?" confirmLabel="Tell them" pending={send.isPending}
        onConfirm={() => send.mutate()} onClose={() => setAsking(false)} testId="helpr-no-show-report">
        We tell {who} now. They have 24 hours to answer. If they don't, they get a strike and another Helpr can take it.
        {" "}The buyer's money stays held.
      </ConfirmSheet>
    </div>
  );
}

/** The Helpr's side: the seller's report and the 24 hours to answer. */
export function HelprNoShowAnswer({ taskId }: { taskId: string }) {
  const qc = useQueryClient();
  const report = useQuery({ queryKey: ["helpr-tasks", "no-show", taskId], queryFn: () => fetchHelprNoShowReport(taskId) });
  const [note, setNote] = useState("");
  const [failed, setFailed] = useState<string | null>(null);
  const answer = useMutation({
    mutationFn: () => answerHelprNoShow(taskId, note.trim()),
    onSuccess: () => { setFailed(null); void qc.invalidateQueries({ queryKey: ["helpr-tasks"] }); },
    // On the card, beside the button: it is a deadline with a strike behind it.
    onError: (err) => setFailed(declutterErrorMessage(err)),
  });
  const r = report.data;
  if (!r || r.settled_at) return null;
  if (r.answered_at) {
    return <p role="status" className="text-sm" data-helpr-no-show-answered="">You answered. Louisiana Helpr looks at both sides and tells you what it decides.</p>;
  }
  const noteId = `helpr-no-show-answer-${taskId}`;
  return (
    <div className="space-y-2 rounded-xl border border-border px-3 py-2" data-helpr-no-show-answer="">
      <p className="text-ds-14 font-semibold">The seller says you didn't come.</p>
      <p className="text-ds-13 text-muted-foreground">
        Answer by {when(r.answer_by)}. If you don't, you get a strike and the delivery goes to another Helpr. If you answer,
        Louisiana Helpr looks at both sides, and no one gets a strike until they decide.
      </p>
      <label htmlFor={noteId} className="block text-xs font-medium">What happened? Say when you got there.</label>
      <textarea id={noteId} rows={3} maxLength={1000} value={note} onChange={(e) => setNote(e.target.value)} className="w-full rounded-2xl border border-input glass-field px-3 py-2 text-ds-15" />
      {failed && <p role="alert" className="text-sm text-destructive-ink">{failed}</p>}
      <button type="button" className={primary} disabled={answer.isPending || !note.trim()} onClick={() => answer.mutate()}>
        I was there
      </button>
    </div>
  );
}
