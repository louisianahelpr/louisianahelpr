/**
 * Board 141, Declutter side (mockup "141 - Refund request (Jobs + Declutter)", panels 3 and 4): after the
 * handover, the buyer asks the seller for a refund within 24 hours; the seller refunds it all, offers part,
 * or says no; the buyer takes an offer or asks Louisiana Helpr to decide. One panel on the paid order card,
 * for both sides. Every amount and every rule is the server's (migration 20261023120630,
 * declutter_refund_request_view); this panel only shows them and sends the choices.
 */
import { useState, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ErrorState } from "@/components/ui/ErrorState";
import { declutterErrorMessage } from "@/lib/declutter/errors";
import {
  answerRefund,
  answerRefundOffer,
  askRefund,
  fetchRefundRequestView,
  offerCentsFromInput,
  refundDollars,
  withdrawRefund,
  type RefundReason,
  type RefundRequestView,
} from "@/lib/declutter/refundRequests";

const btn = "rounded-full border border-border px-4 py-2 text-sm font-semibold";
const primary = "btn-grad-primary rounded-full px-4 py-2 text-sm font-semibold";
const input = "w-full rounded-lg border border-input bg-background px-3 py-2 text-sm";

export const REFUND_REASON_WORDS: Record<RefundReason, string> = {
  not_as_described: "Not as described",
  damaged: "Damaged",
  not_received: "Never got it",
};

/** "the seller" at the start of a sentence. */
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

const at = (iso: string) => new Date(iso).toLocaleString([], { weekday: "short", hour: "numeric", minute: "2-digit" });

export function RefundRequestPanel({ orderId, who, problemForm }: {
  orderId: string;
  /** The other person by first name, or "the buyer" / "the seller". */
  who: string;
  /** "Report a problem", shown to the buyer after the seller says no. */
  problemForm: ReactNode;
}) {
  const view = useQuery({ queryKey: ["declutter", "refund-request", orderId], queryFn: () => fetchRefundRequestView(orderId) });
  if (view.isPending) return null;
  if (view.isError) {
    return <ErrorState variant="inline" title="We couldn't load the refund details." body={declutterErrorMessage(view.error)} onRetry={() => void view.refetch()} />;
  }
  const v = view.data;
  if (!v.handed_over) return null;
  return (
    <div className="space-y-2" data-refund-request="">
      {v.side === "buyer" ? <BuyerSide v={v} who={who} problemForm={problemForm} /> : <SellerSide v={v} who={who} />}
    </div>
  );
}

function useRefresh(orderId: string) {
  const qc = useQueryClient();
  return () => {
    void qc.invalidateQueries({ queryKey: ["declutter", "refund-request", orderId] });
    void qc.invalidateQueries({ queryKey: ["declutter", "payouts"] });
    void qc.invalidateQueries({ queryKey: ["declutter", "my-cart"] });
  };
}

function SettledLine({ v }: { v: RefundRequestView }) {
  const r = v.request;
  if (!r || r.refund_cents == null) return null;
  const sent = r.refund_status === "succeeded";
  return (
    <p className="text-sm">
      {v.side === "buyer"
        ? `${refundDollars(r.refund_cents)} ${sent ? "was refunded to your card" : "is coming back to your card"}.`
        : `The buyer got ${refundDollars(r.refund_cents)} back.`}
    </p>
  );
}

function BuyerSide({ v, who, problemForm }: { v: RefundRequestView; who: string; problemForm: ReactNode }) {
  const refresh = useRefresh(v.order_id);
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState<RefundReason>("not_as_described");
  const [note, setNote] = useState("");
  const ask = useMutation({
    mutationFn: () => askRefund(v.order_id, reason, note.trim()),
    onSuccess: () => { toast.success(`Sent. ${cap(who)} answers within 24 hours.`); setOpen(false); setNote(""); refresh(); },
    onError: (err) => toast.error(declutterErrorMessage(err)),
  });
  const offer = useMutation({
    mutationFn: (accept: boolean) => answerRefundOffer(v.request?.id ?? "", accept),
    onSuccess: (r) => { toast.success(r.result === "refunded" ? "Done. Your refund is on its way." : "Sent to Louisiana Helpr to decide."); refresh(); },
    onError: (err) => toast.error(declutterErrorMessage(err)),
  });
  const withdraw = useMutation({
    mutationFn: () => withdrawRefund(v.request?.id ?? ""),
    onSuccess: () => { toast.success("Refund request taken back."); refresh(); },
    onError: (err) => toast.error(declutterErrorMessage(err)),
  });
  const r = v.request;
  if (!r) {
    if (!v.can_ask) return null;
    if (!open) {
      return (
        <div className="space-y-1">
          <button type="button" className={btn} onClick={() => setOpen(true)}>Ask for a refund</button>
          {v.window_ends_at && <p className="text-ds-12 text-muted-foreground">Something wrong with it? You can ask until {at(v.window_ends_at)}.</p>}
        </div>
      );
    }
    const id = `dcl-refund-${v.order_id}`;
    return (
      <fieldset className="space-y-2 rounded-xl border border-border p-3" data-refund-ask="">
        <legend className="px-1 text-sm font-semibold">Ask for a refund</legend>
        {(Object.keys(REFUND_REASON_WORDS) as RefundReason[]).map((k) => (
          <label key={k} className="flex min-h-11 items-center gap-2 text-sm">
            <input type="radio" name={`${id}-reason`} value={k} checked={reason === k} onChange={() => setReason(k)} />
            {REFUND_REASON_WORDS[k]}
          </label>
        ))}
        <label htmlFor={`${id}-note`} className="block text-xs font-medium">Tell them more</label>
        <textarea id={`${id}-note`} className={input} maxLength={1000} rows={3} value={note} onChange={(e) => setNote(e.target.value)} />
        <p className="text-ds-12 text-muted-foreground">
          {cap(who)} can refund it all, offer part, or say no. A full refund is {refundDollars(v.full_refund_cents)}: everything back except the card fee
          {v.delivery_kept_cents > 0 ? ", and the delivery fee, which paid the Helpr for the trip" : ""}. If you get it all back, give the item back.
        </p>
        <div className="flex flex-wrap gap-2">
          <button type="button" className={primary} disabled={ask.isPending || !note.trim()} onClick={() => ask.mutate()}>Send to the seller</button>
          <button type="button" className={btn} disabled={ask.isPending} onClick={() => setOpen(false)}>Not now</button>
        </div>
      </fieldset>
    );
  }
  switch (r.status) {
    case "open":
      return (
        <div className="space-y-2">
          <p className="text-sm">You asked for a refund. {cap(who)} answers by {at(r.answer_by)}, or Louisiana Helpr decides.</p>
          <button type="button" className={btn} disabled={withdraw.isPending} onClick={() => withdraw.mutate()}>Take it back</button>
        </div>
      );
    case "offered":
      return (
        <div className="space-y-2" data-refund-offer="">
          <p className="text-sm">{cap(who)} offered {refundDollars(r.offer_cents ?? 0)} back. You keep the item.</p>
          <div className="flex flex-wrap gap-2">
            <button type="button" className={primary} disabled={offer.isPending} onClick={() => offer.mutate(true)}>
              Take {refundDollars(r.offer_cents ?? 0)}
            </button>
            <button type="button" className={btn} disabled={offer.isPending} onClick={() => offer.mutate(false)}>Ask Louisiana Helpr to decide</button>
          </div>
          {r.offer_answer_by && <p className="text-ds-12 text-muted-foreground">Answer by {at(r.offer_answer_by)}, or Louisiana Helpr decides.</p>}
        </div>
      );
    case "agreed":
      return <SettledLine v={v} />;
    case "declined":
      return (
        <div className="space-y-2">
          <p className="text-sm">
            {cap(who)} said no to a refund.{v.can_report && r.report_until ? ` If you still think something is wrong, report a problem by ${at(r.report_until)} and Louisiana Helpr decides.` : ""}
          </p>
          {v.can_report && problemForm}
        </div>
      );
    case "to_admin":
      return <p className="text-sm">Louisiana Helpr is looking at your refund request. We decide and tell you both.</p>;
    case "withdrawn":
      return <p className="text-sm text-muted-foreground">You took back your refund request.</p>;
  }
}

type Answer = "full" | "part" | "decline";

function SellerSide({ v, who }: { v: RefundRequestView; who: string }) {
  const refresh = useRefresh(v.order_id);
  const [choice, setChoice] = useState<Answer>("full");
  // Owner 2026-10-21: the amount starts EMPTY.
  const [amount, setAmount] = useState("");
  const offerCents = offerCentsFromInput(amount);
  const send = useMutation({
    mutationFn: () => answerRefund(v.request?.id ?? "", choice, choice === "part" ? offerCents : null),
    onSuccess: (r) => {
      toast.success(r.result === "refunded" ? "Refunded. The buyer is told." : r.result === "offered" ? "Offer sent." : "Answer sent.");
      refresh();
    },
    onError: (err) => toast.error(declutterErrorMessage(err)),
  });
  const r = v.request;
  if (!r) return null;
  if (r.status === "agreed") return <SettledLine v={v} />;
  if (r.status === "offered") return <p className="text-sm">You offered {refundDollars(r.offer_cents ?? 0)}. Waiting for {who} to answer.</p>;
  if (r.status === "declined") return <p className="text-sm">You said no to the refund. {cap(who)} can still ask Louisiana Helpr to decide.</p>;
  if (r.status === "to_admin") return <p className="text-sm">Louisiana Helpr is looking at this refund request. Your payout waits until we decide.</p>;
  if (r.status === "withdrawn") return <p className="text-sm text-muted-foreground">{cap(who)} took back their refund request.</p>;
  const id = `dcl-answer-${r.id}`;
  return (
    <fieldset className="space-y-2 rounded-xl border border-border p-3" data-refund-answer="">
      <legend className="px-1 text-sm font-semibold">Refund request</legend>
      <p className="text-sm">
        <span className="font-medium">{REFUND_REASON_WORDS[r.reason]}.</span> {cap(who)} says: "{r.note}"
      </p>
      <label className="flex min-h-11 items-start gap-2 text-sm">
        <input type="radio" name={id} checked={choice === "full"} onChange={() => setChoice("full")} className="mt-1" />
        <span>
          <span className="font-medium">Refund in full</span>
          <span className="block text-ds-12 text-muted-foreground">
            {cap(who)} gets {refundDollars(v.full_refund_cents)} back, including the buyer fee, and gives the item back. You get no payout for this sale.
          </span>
        </span>
      </label>
      <label className="flex min-h-11 items-start gap-2 text-sm">
        <input type="radio" name={id} checked={choice === "part"} onChange={() => setChoice("part")} className="mt-1" />
        <span>
          <span className="font-medium">Offer part of it</span>
          <span className="block text-ds-12 text-muted-foreground">{cap(who)} keeps the item; the amount comes out of your payout.</span>
        </span>
      </label>
      {choice === "part" && (
        <div className="pl-6">
          <label htmlFor={`${id}-amount`} className="block text-xs font-medium">How much back? (less than {refundDollars(v.items_cents)})</label>
          <input id={`${id}-amount`} className={input} inputMode="decimal" value={amount} placeholder="$" onChange={(e) => setAmount(e.target.value)} />
        </div>
      )}
      <label className="flex min-h-11 items-start gap-2 text-sm">
        <input type="radio" name={id} checked={choice === "decline"} onChange={() => setChoice("decline")} className="mt-1" />
        <span>
          <span className="font-medium">I don't agree</span>
          <span className="block text-ds-12 text-muted-foreground">{cap(who)} can ask Louisiana Helpr to decide.</span>
        </span>
      </label>
      <button type="button" className={primary} disabled={send.isPending || (choice === "part" && offerCents === null)} onClick={() => send.mutate()}>
        Send answer
      </button>
      <p className="text-ds-12 text-muted-foreground">Answer by {at(r.answer_by)} or Louisiana Helpr decides. Your payout waits until then.</p>
    </fieldset>
  );
}
