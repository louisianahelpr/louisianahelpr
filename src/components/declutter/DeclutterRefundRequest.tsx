/**
 * Board 141, Declutter side (mockup "141 - Refund request (Jobs + Declutter)", panels 3 and 4): after the
 * handover, the buyer asks the seller for a refund within 24 hours; the seller refunds it all, offers part,
 * or says no; the buyer takes an offer or asks Louisiana Helpr to decide. One panel on the paid order card,
 * for both sides. Every amount and every rule is the server's (migration 20261026155251,
 * declutter_refund_request_view); this panel only shows them and sends the choices.
 * A full refund the seller agreed waits for the item (owner 2026-10-23, #3558 answer 2): the buyer gives it
 * back, the seller taps "I got it back", and only then is the refund sent.
 */
import { useState, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { fetchMyHandover } from "@/lib/declutter/handover";
import { toast } from "sonner";
import { ErrorState } from "@/components/ui/ErrorState";
import { declutterErrorMessage } from "@/lib/declutter/errors";
import {
  answerRefund,
  answerRefundOffer,
  askRefund,
  confirmItemReturned,
  fetchRefundRequestView,
  offerCentsFromInput,
  refundDollars,
  withdrawRefund,
  type RefundReason,
  type RefundRequestView,
} from "@/lib/declutter/refundRequests";
import { acceptRefundWithReturn } from "@/lib/declutter/refundReturns";
import { useAuthReady } from "@/hooks/useAuthReady";
import { ConfirmSheet } from "./DeclutterConfirmSheet";
import { NextStep, type NextStepValue } from "@/components/ui/NextStep";
import { ProblemPhotoPicker, uploadProblemPhotos } from "./DeclutterProblemPhotos";
import { ProblemPhotos } from "./DeclutterProblemSides";
import { REFUND_FORM_PHOTOS_READY } from "@/lib/declutter/problemPhotos";
import { RadioCardList } from "@/components/ui/RadioCardList";
import { hapticLight } from "@/lib/haptics";
import {
  cap,
  DeclutterReturnBuyer,
  DeclutterReturnPhotoPick,
  DeclutterReturnSellerInfo,
  DeclutterReturnWayPicker,
  emptyReturnPick,
  returnPickArgs,
  sellerReturnPhotoPath,
} from "./DeclutterRefundReturn";

const btn = "rounded-full border border-border px-4 py-2 text-sm font-semibold";
const primary = "btn-grad-primary rounded-full px-4 py-2 text-sm font-semibold";
const input = "w-full rounded-lg border border-input bg-background px-3 py-2 text-sm";
/** Audit 1028 part 2, D2-15: the amount is a few digits; a full-width box read as a text field. */
const amountInput = `${input} max-w-[12rem]`;

export const REFUND_REASON_WORDS: Record<RefundReason, string> = {
  not_as_described: "Not as described",
  damaged: "Damaged",
  not_received: "Never got it",
};

/**
 * Deep audit 2026-10-28 B-5 (#5): a "full refund" of $33.01 on a $34.30 payment, never explained. The server's full
 * refund (declutter_full_refund_cents) is the payment less what the card network kept for it (Stripe does not return
 * it), and less a delivery a Helpr already made. Members never see a fee name or number (owner 2026-10-25), so the
 * gap is said in plain words, with no figure, wherever the full-refund amount is shown to the buyer.
 */
const FULL_REFUND_WHY = "That's all you paid, less the small part the card network kept for the payment, which it doesn't give back.";
/**
 * AUD31-37: on a Helpr-delivery order the delivery a Helpr made stays paid, so the full refund is not "all you paid":
 * it is what was paid for the item. Said the same way, still with no fee name or figure.
 */
const FULL_REFUND_WHY_ITEM = "That's what you paid for the item, less the small part the card network kept for the payment, which it doesn't give back.";
const fullRefundWhy = (deliveryKeptCents: number) => (deliveryKeptCents > 0 ? FULL_REFUND_WHY_ITEM : FULL_REFUND_WHY);

const at = (iso: string) => new Date(iso).toLocaleString([], { weekday: "short", hour: "numeric", minute: "2-digit" });

export function DeclutterRefundPanel({ orderId, who, problemForm }: {
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
      {v.side === "buyer" ? <DeclutterRefundBuyer v={v} who={who} problemForm={problemForm} /> : <DeclutterRefundSeller v={v} who={who} />}
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

function DeclutterRefundSettled({ v }: { v: RefundRequestView }) {
  const r = v.request;
  if (!r || r.refund_cents == null) return null;
  const sent = r.refund_status === "succeeded";
  return (
    <p className="text-sm" data-refund-settled="">
      {r.admin_decided && "Louisiana Helpr decided to refund the buyer. "}
      {v.side === "buyer"
        ? `${refundDollars(r.refund_cents)} ${sent ? "was refunded to your card" : "is coming back to your card"}.`
        : `The buyer got ${refundDollars(r.refund_cents)} back.`}
    </p>
  );
}

function DeclutterRefundBuyer({ v, who, problemForm }: { v: RefundRequestView; who: string; problemForm: ReactNode }) {
  const refresh = useRefresh(v.order_id);
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState<RefundReason>("not_as_described");
  const [note, setNote] = useState("");
  // Audit 1028 part 2, D2-11: no "Never got it" once the buyer said they have it ("I got it", or their pickup photo).
  // The same handover row and key the order card reads.
  const handover = useQuery({ queryKey: ["declutter", "handover", v.order_id], queryFn: () => fetchMyHandover(v.order_id) });
  const buyerHasIt = handover.data?.confirmed_by === "buyer" || !!handover.data?.picked_up_at;
  const reasons = (Object.keys(REFUND_REASON_WORDS) as RefundReason[]).filter((k) => !(buyerHasIt && k === "not_received"));
  // D2-7: up to 3 photos, uploaded when the request is sent (only once the server takes them: REFUND_FORM_PHOTOS_READY).
  const [photos, setPhotos] = useState<File[]>([]);
  const ask = useMutation({
    mutationFn: async () => {
      const paths = REFUND_FORM_PHOTOS_READY && photos.length ? await uploadProblemPhotos(v.order_id, photos) : [];
      return askRefund(v.order_id, reason, note.trim(), paths);
    },
    onSuccess: () => { toast(`Sent. ${cap(who)} answers within 24 hours.`); setOpen(false); setNote(""); setPhotos([]); refresh(); },
    onError: (err) => toast.error(declutterErrorMessage(err)),
  });
  const offer = useMutation({
    mutationFn: (accept: boolean) => answerRefundOffer(v.request?.id ?? "", accept),
    onSuccess: (r) => { toast(r.result === "refunded" ? "Done. Your refund is on its way." : "Sent to Louisiana Helpr to decide."); refresh(); },
    onError: (err) => toast.error(declutterErrorMessage(err)),
  });
  const withdraw = useMutation({
    mutationFn: () => withdrawRefund(v.request?.id ?? ""),
    onSuccess: () => { toast("Refund request taken back."); refresh(); },
    onError: (err) => toast.error(declutterErrorMessage(err)),
  });
  // Audit 2026-10-30 DB-11: "Take it back" ended the request in one tap. It asks first, in Declutter's one confirm
  // style, and says what follows: declutter_ask_refund refuses a second request on the same sale (measured live).
  const [confirmWithdraw, setConfirmWithdraw] = useState(false);
  // BUY-10 (buying audit 10-30 #10): taking a part refund, or turning it down for Louisiana Helpr to decide, was one
  // tap and final. Each asks first and says what ends.
  const [answering, setAnswering] = useState<null | "take" | "ask">(null);
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
        {/* D2-15: the app's one "pick one reason" list, not browser radios. */}
        <RadioCardList
          label="What's wrong?"
          required
          options={reasons.map((k) => ({ value: k, label: REFUND_REASON_WORDS[k] }))}
          value={reason}
          onChange={(k, via) => { if (via === "click") hapticLight(); setReason(k as RefundReason); }}
        />
        <label htmlFor={`${id}-note`} className="block text-xs font-medium">Tell them more</label>
        <textarea id={`${id}-note`} className={input} maxLength={1000} rows={3} value={note} onChange={(e) => setNote(e.target.value)} />
        {REFUND_FORM_PHOTOS_READY && <ProblemPhotoPicker files={photos} onChange={setPhotos} disabled={ask.isPending} />}
        <p className="text-ds-12 text-muted-foreground">
          {cap(who)} can refund it all, offer part, or say no. A full refund is {refundDollars(reason === "not_received" ? v.never_got_it_refund_cents ?? v.full_refund_cents : v.full_refund_cents)} back to your card
          {v.delivery_kept_cents > 0 ? " (the delivery stays paid: the Helpr made the trip)" : ""}.{reason === "not_received" ? "" : <> <span data-full-refund-why="">{fullRefundWhy(v.delivery_kept_cents)}</span></>}{" "}
          {reason === "not_received" ? `Since you never got it, there's nothing to give back: if ${who} agrees, it is sent right away.` : `For a full refund you give the item back first; it is sent once ${who} confirms they have it.`}
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
          {/* A3-20: the shared next-step line, deadline after the dot; what happens after it stays in words. */}
          <NextStep value={{ who: "them", text: `Waiting on ${who} to answer your refund request`, by: at(r.answer_by) }} />
          <p className="text-ds-12 text-muted-foreground">If {who} doesn't answer by then, Louisiana Helpr decides.</p>
          <button type="button" className={btn} disabled={withdraw.isPending} onClick={() => setConfirmWithdraw(true)}>Take it back</button>
          <ConfirmSheet
            open={confirmWithdraw}
            pending={withdraw.isPending}
            title="Take back your refund request?"
            confirmLabel={withdraw.isPending ? "Taking it back…" : "Take it back"}
            cancelLabel="Keep my request"
            onConfirm={() => withdraw.mutate(undefined, { onSettled: () => setConfirmWithdraw(false) })}
            onClose={() => setConfirmWithdraw(false)}
            testId="refund-withdraw"
          >
            {`${cap(who)} is told, and is paid once the sale is final. You can't ask for a refund on this sale again.`}
          </ConfirmSheet>
        </div>
      );
    case "offered":
      return (
        <div className="space-y-2" data-refund-offer="">
          <NextStep value={{ who: "you", text: "Take the offer or ask Louisiana Helpr to decide", by: r.offer_answer_by ? at(r.offer_answer_by) : null }} />
          <p className="text-sm">{cap(who)} offered {refundDollars(r.offer_cents ?? 0)} back. You keep the item.</p>
          <div className="flex flex-wrap gap-2">
            <button type="button" className={primary} disabled={offer.isPending} onClick={() => setAnswering("take")}>
              Take {refundDollars(r.offer_cents ?? 0)}
            </button>
            <button type="button" className={btn} disabled={offer.isPending} onClick={() => setAnswering("ask")}>Ask Louisiana Helpr to decide</button>
          </div>
          <ConfirmSheet
            open={answering !== null}
            pending={offer.isPending}
            title={answering === "ask" ? "Ask Louisiana Helpr to decide?" : `Take ${refundDollars(r.offer_cents ?? 0)} back?`}
            confirmLabel={answering === "ask" ? "Ask Louisiana Helpr" : `Take ${refundDollars(r.offer_cents ?? 0)}`}
            cancelLabel="Not now"
            onConfirm={() => offer.mutate(answering === "take", { onSettled: () => setAnswering(null) })}
            onClose={() => setAnswering(null)}
            testId="refund-offer-answer"
          >
            {answering === "ask"
              ? `${cap(who)}'s offer of ${refundDollars(r.offer_cents ?? 0)} ends, and Louisiana Helpr decides what, if anything, comes back to you.`
              : `${refundDollars(r.offer_cents ?? 0)} comes back to your card and you keep the item. This ends your refund request.`}
          </ConfirmSheet>
          {r.offer_answer_by && <p className="text-ds-12 text-muted-foreground">If you don't answer by then, Louisiana Helpr decides.</p>}
        </div>
      );
    case "returning":
      return (
        <div className="space-y-2" data-refund-returning="">
          <NextStep value={returnStep(r, who)} />
          <p className="text-sm">
            {cap(who)} agreed to refund you {refundDollars(v.full_refund_cents)}. <span data-full-refund-why="">{fullRefundWhy(v.delivery_kept_cents)}</span>
            {r.return_way ? "" : ` Give the item back; message ${who} from your order.`} Your refund is sent as soon as {who} confirms they have it.
          </p>
          <DeclutterReturnBuyer v={v} who={who} />
          {(r.return_deadline ?? r.return_by) && <p className="text-ds-12 text-muted-foreground">If {who} hasn't confirmed by {at(r.return_deadline ?? r.return_by ?? "")}, Louisiana Helpr decides.</p>}
        </div>
      );
    case "agreed":
      return <DeclutterRefundSettled v={v} />;
    case "declined":
      // D2-5: Louisiana Helpr decided for the seller; the seller never said no.
      if (r.admin_decided) return <p className="text-sm" data-refund-admin-decided="">Louisiana Helpr decided: {who} keeps the payment, and the sale is final.</p>;
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

/**
 * A3-79: the buyer's step while an agreed full refund waits for the item: bring it back by the time Louisiana Helpr
 * takes over (return_deadline), or, once it is dropped off or the seller comes for it, who we are waiting on.
 */
export function returnStep(r: NonNullable<RefundRequestView["request"]>, who: string): NextStepValue | null {
  const by = r.return_deadline ?? r.return_by;
  const byWords = by ? at(by) : null;
  if (r.return_way === "collect") return { who: "them", text: `Waiting on ${who} to come for it`, by: r.return_at ? at(r.return_at) : null };
  if (r.return_way === "drop_off" && r.return_dropped_off_at) return { who: "them", text: `Waiting on ${who} to confirm they have it`, by: byWords };
  return { who: "you", text: "Bring the item back", by: byWords };
}

type Answer = "full" | "part" | "decline";

function DeclutterRefundSeller({ v, who }: { v: RefundRequestView; who: string }) {
  const refresh = useRefresh(v.order_id);
  // BUY-26: nothing is picked for the seller, and sending asks once, naming the money.
  const [choice, setChoice] = useState<Answer | null>(null);
  const [askingSend, setAskingSend] = useState(false);
  const neverGotIt = v.request?.reason === "not_received";
  const neverGotItCents = v.never_got_it_refund_cents ?? v.full_refund_cents;
  const canDropOff = v.can_drop_off !== false;
  // Owner 2026-10-21: the amount starts EMPTY.
  const [amount, setAmount] = useState("");
  const offerCents = offerCentsFromInput(amount);
  // Declutter returns: the way back is picked with "Refund in full" and sent in the same call.
  const [pick, setPick] = useState(() => emptyReturnPick(canDropOff));
  const pickArgs = returnPickArgs(pick);
  const send = useMutation({
    mutationFn: (): Promise<{ result: string }> => {
      const r = v.request;
      // BUY-25: on "never got it" there is no way back to pick, and the refund goes at once.
      if (r && choice === "full" && pickArgs && !neverGotIt) return acceptRefundWithReturn(r.id, pick.way, pickArgs.day, pickArgs.atIso);
      return answerRefund(r?.id ?? "", choice ?? "decline", choice === "part" ? offerCents : null);
    },
    onSuccess: (r) => {
      toast(r.result === "returning" ? "Agreed. Tap I got it back once you have the item." : r.result === "refunded" ? "Refund sent. The buyer is told." : r.result === "offered" ? "Offer sent." : "Answer sent.");
      setAskingSend(false);
      refresh();
    },
    onError: (err) => toast.error(declutterErrorMessage(err)),
  });
  const [confirmBack, setConfirmBack] = useState(false);
  const [backPhoto, setBackPhoto] = useState<File | null>(null);
  const { user } = useAuthReady();
  const back = useMutation({
    mutationFn: async () => confirmItemReturned(v.request?.id ?? "", await sellerReturnPhotoPath(user?.id, v.order_id, backPhoto)),
    onSuccess: () => { toast("Refund sent. The buyer is told."); refresh(); },
    onError: (err) => toast.error(declutterErrorMessage(err)),
  });
  const r = v.request;
  if (!r) return null;
  if (r.status === "agreed") return <DeclutterRefundSettled v={v} />;
  if (r.status === "returning") {
    return (
      <div className="space-y-2" data-refund-returning="">
        <p className="text-sm">You agreed to a full refund. Once {who} gives the item back, tap I got it back and the refund is sent.</p>
        <DeclutterReturnSellerInfo v={v} who={who} />
        {r.return_way && <DeclutterReturnPhotoPick orderId={v.order_id} file={backPhoto} onFile={setBackPhoto} />}
        <button type="button" className={primary} disabled={back.isPending} onClick={() => setConfirmBack(true)}>I got it back</button>
        {/* Money review 2026-10-27: sending the refund can't be undone, so the tap asks once. Deep audit 2026-10-28 #59:
            in Declutter's one confirm style (ConfirmSheet), like every other "I got it". */}
        <ConfirmSheet
          open={confirmBack}
          pending={back.isPending}
          title="You have the item back?"
          confirmLabel={back.isPending ? "Sending…" : "Yes, send the refund"}
          cancelLabel="Not yet"
          onConfirm={() => back.mutate(undefined, { onSettled: () => setConfirmBack(false) })}
          onClose={() => setConfirmBack(false)}
          testId="refund-item-back"
        >
          {`This sends ${refundDollars(v.full_refund_cents)} back to ${who} now, and you get no payout for this sale. It can't be undone.`}
        </ConfirmSheet>
        {(r.return_deadline ?? r.return_by) && <p className="text-ds-12 text-muted-foreground">Tap it by {at(r.return_deadline ?? r.return_by ?? "")}, or Louisiana Helpr decides. Your payout waits until then.</p>}
      </div>
    );
  }
  if (r.status === "offered") return <p className="text-sm">You offered {refundDollars(r.offer_cents ?? 0)}. Waiting for {who} to answer.</p>;
  if (r.status === "declined" && r.admin_decided) return <p className="text-sm" data-refund-admin-decided="">Louisiana Helpr decided: you keep the payment, and the sale is final.</p>;
  if (r.status === "declined") return <p className="text-sm">You said no to the refund. {cap(who)} can still ask Louisiana Helpr to decide.</p>;
  if (r.status === "to_admin") return <p className="text-sm">Louisiana Helpr is looking at this refund request. Your payout waits until we decide.</p>;
  if (r.status === "withdrawn") return <p className="text-sm text-muted-foreground">{cap(who)} took back their refund request.</p>;
  const id = `dcl-answer-${r.id}`;
  return (
    <fieldset className="space-y-2 rounded-xl border border-border p-3" data-refund-answer="">
      <legend className="px-1 text-sm font-semibold">Refund request</legend>
      <NextStep value={{ who: "you", text: "Answer the refund request", by: at(r.answer_by) }} />
      <p className="text-sm">
        <span className="font-medium">{REFUND_REASON_WORDS[r.reason]}.</span> {cap(who)} says: "{r.note}"
      </p>
      <ProblemPhotos paths={r.photo_paths ?? []} />
      {/* D2-15: the app's one "pick one" list, not browser radios. */}
      <RadioCardList
        label="Your answer"
        required
        options={[
          {
            value: "full",
            label: "Refund in full",
            sub: neverGotIt
              ? `${cap(who)} gets ${refundDollars(neverGotItCents)} back now. There's nothing to bring back. You get no payout for this sale, and what the card network kept for the payment comes out of your next sale's payout.`
              : `${cap(who)} gives the item back, then gets ${refundDollars(v.full_refund_cents)} back once you confirm you have it. You get no payout for this sale.`,
          },
          { value: "part", label: "Offer part of it", sub: `${cap(who)} keeps the item; the amount comes out of your payout.` },
          { value: "decline", label: "I don't agree", sub: `${cap(who)} can ask Louisiana Helpr to decide.` },
        ]}
        value={choice ?? ""}
        onChange={(c, via) => { if (via === "click") hapticLight(); setChoice(c as Answer); }}
      />
      {choice === "full" && !neverGotIt && <DeclutterReturnWayPicker id={id} who={who} canDropOff={canDropOff} value={pick} onChange={setPick} />}
      {choice === "part" && (
        <div>
          <label htmlFor={`${id}-amount`} className="block text-xs font-medium">How much back? (less than {refundDollars(v.items_cents)})</label>
          <input id={`${id}-amount`} className={amountInput} inputMode="decimal" value={amount} placeholder="$" onChange={(e) => setAmount(e.target.value)} />
        </div>
      )}
      <button type="button" className={primary} disabled={send.isPending || !choice || (choice === "part" && offerCents === null) || (choice === "full" && !neverGotIt && !pickArgs)} onClick={() => setAskingSend(true)}>
        Send answer
      </button>
      <ConfirmSheet
        open={askingSend}
        pending={send.isPending}
        title={choice === "full" ? "Refund in full?" : choice === "part" ? "Send this offer?" : "Say no to the refund?"}
        confirmLabel={send.isPending ? "Sending…" : "Send answer"}
        cancelLabel="Not yet"
        onConfirm={() => send.mutate(undefined, { onSettled: () => setAskingSend(false) })}
        onClose={() => setAskingSend(false)}
        testId="refund-answer"
      >
        {choice === "full"
          ? (neverGotIt ? `This sends ${refundDollars(neverGotItCents)} back to ${who} now, and you get no payout for this sale. What the card network kept for the payment comes out of your next sale's payout. It can't be undone.` : `Once you have the item back, ${who} gets ${refundDollars(v.full_refund_cents)} and you get no payout for this sale.`)
          : choice === "part" ? `${cap(who)} can take ${refundDollars(offerCents ?? 0)}, which comes out of your payout, or ask Louisiana Helpr to decide.`
          : `${cap(who)} can still ask Louisiana Helpr to decide. Your payout waits until then.`}
      </ConfirmSheet>
      <p className="text-ds-12 text-muted-foreground">If you don't answer by then, Louisiana Helpr decides. Your payout waits until then.</p>
    </fieldset>
  );
}
