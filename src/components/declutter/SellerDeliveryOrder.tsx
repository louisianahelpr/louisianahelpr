/**
 * A paid seller-delivered order, for both sides (migration 20261027153244;
 * switch declutter_seller_delivery; docs/specs/declutter-seller-delivery.md).
 * Loaded on its own from the order card (Q178: off /posts' critical path).
 *
 * What each side sees and can do, all decided on the server:
 *   both    the booked time, the buyer's door choice, a new time (ask from the
 *           seller's open times; the other side accepts), Report a problem
 *   seller  the buyer's address (after payment only), "Delivered" (a photo
 *           when left at the door) / "Handed over", cancel (seller fault)
 *   buyer   change the door choice, "I got it", "It wasn't delivered" (from
 *           15 minutes after the hour ends), cancel until 24 hours before
 */
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ChoicePill } from "@/components/ui/ChoicePill";
import { confirmHandover, uploadHandoverPhoto } from "@/lib/declutter/handover";
import {
  SELLER_DELIVERY_RULES,
  answerDeliveryTime,
  buyerCancelDelivery,
  deliveryPhotoPosition,
  fetchDeliveryOpenTimes,
  fetchSellerDeliveryBooking,
  groupSlotsByDay,
  markDelivered,
  proposeDeliveryTime,
  reportNotDelivered,
  sameSlot,
  sellerCancelDelivery,
  setDeliveryHandoff,
  slotLabel,
  slotTimeLabel,
  type DeliveryHandoff,
  type SellerDeliveryBooking,
} from "@/lib/declutter/sellerDelivery";
import { sellerDeliveryErrorMessage } from "@/lib/declutter/sellerDeliveryErrors";
import { HANDOFF_WORDS } from "./SellerDeliveryChoice";
import { ErrorState } from "@/components/ui/ErrorState";
import { ConfirmSheet } from "./DeclutterConfirmSheet";

// min-h-11: the 44px tap floor (they were 36px; Declutter audit 2026-10-28).
const btn = "min-h-11 rounded-full border border-border px-4 py-2 text-sm font-semibold";
const primary = "btn-grad-primary !text-[hsl(var(--parchment))] min-h-11 rounded-full px-4 py-2 text-sm font-semibold";

/** The Louisiana calendar day of an instant, "2026-11-01" (sorts as text). */
const LA_DAY = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Chicago", year: "numeric", month: "2-digit", day: "2-digit" });
const laDay = (ms: number) => LA_DAY.format(new Date(ms));

/** Which buttons a side gets right now (pure, so the rules are tested apart from the screen). */
export function sellerDeliveryActions(b: SellerDeliveryBooking, now: number = Date.now()) {
  const booked = b.status === "booked" && !!b.slot_start;
  const marked = !!b.delivered_at;
  const started = booked && now >= Date.parse(b.slot_start!);
  const cancelBy = b.slot_start ? Date.parse(b.slot_start) - SELLER_DELIVERY_RULES.buyer_cancel_hours * 3_600_000 : null;
  const open = b.order_status === "paid";
  return {
    markDelivered: open && b.side === "seller" && started && !marked,
    // Deep audit 2026-10-28 B-7 (#7): "I got it" showed a day before the delivery and one tap finished the sale.
    // It now shows once the seller marked it delivered, or from the delivery day (Louisiana time); it still asks first.
    gotIt: open && b.side === "buyer" && (marked || (booked && laDay(now) >= laDay(Date.parse(b.slot_start!)))),
    notDelivered: open && b.side === "buyer" && booked && !marked && !!b.not_delivered_from && now >= Date.parse(b.not_delivered_from),
    buyerCancel: open && b.side === "buyer" && !marked && (cancelBy === null || now <= cancelBy),
    sellerCancel: open && b.side === "seller" && !marked && b.status !== "needs_time",
    changeHandoff: open && b.side === "buyer" && !marked && (b.status === "booked" || b.status === "needs_time"),
    askNewTime: open && !marked && (b.status === "booked" || b.status === "needs_time") && b.proposals_left > 0 && !(b.proposed_by === b.side),
    answerProposal: open && !!b.proposed_start && b.proposed_by !== b.side,
    withdrawProposal: open && !!b.proposed_start && b.proposed_by === b.side,
  };
}

/** What each money moment says before it runs (the words window.confirm used to carry, plus "I got it", which had none). */
const ASK = {
  gotIt: { title: "Do you have it?", confirm: "I got it", cancel: "Not now", words: "Tapping I got it finishes the sale and the seller is paid. You can still ask for a refund within 24 hours if something is wrong." },
  notDelivered: { title: "It wasn't delivered?", confirm: "It wasn't delivered", cancel: "Not now", words: "You get everything back, delivery included." },
  buyerCancel: { title: "Cancel this order?", confirm: "Cancel order", cancel: "Keep the order", words: "Most of what you paid comes back. You can cancel until 24 hours before the delivery." },
  sellerCancel: { title: "Cancel this delivery?", confirm: "Cancel delivery", cancel: "Keep the delivery", words: "The buyer gets everything back, you get a Declutter strike, and the cost of the refund comes out of your next payout." },
} as const;

export function SellerDeliveryOrderPanel({ orderId, userId, onProblem }: { orderId: string; userId: string; onProblem: () => void }) {
  const qc = useQueryClient();
  const key = ["declutter", "seller-delivery-booking", orderId] as const;
  const booking = useQuery({ queryKey: key, queryFn: () => fetchSellerDeliveryBooking(orderId) });
  const [moving, setMoving] = useState(false);
  const [photo, setPhoto] = useState<File | null>(null);
  // The money moments ask in the app, never window.confirm (lead 2026-10-28, DeclutterConfirmSheet).
  const [ask, setAsk] = useState<"gotIt" | "notDelivered" | "buyerCancel" | "sellerCancel" | null>(null);
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: key });
    void qc.invalidateQueries({ queryKey: ["declutter", "my-cart"] });
    void qc.invalidateQueries({ queryKey: ["declutter", "payouts"] });
    void qc.invalidateQueries({ queryKey: ["declutter", "handover", orderId] });
  };
  const act = <T, V = void>(fn: (v: V) => Promise<T>, done: string | ((r: T) => string)) =>
    ({ mutationFn: fn, onSuccess: (r: T) => { toast.success(typeof done === "string" ? done : done(r)); refresh(); },
       onError: (err: unknown) => toast.error(sellerDeliveryErrorMessage(err)) });
  const b = booking.data;
  // A photo is taken at the buyer's door (20261028235709): the position first, so a refusal uploads nothing.
  const delivered = useMutation(act(async () => {
    const where = photo ? await deliveryPhotoPosition() : null;
    return markDelivered(orderId, photo ? await uploadHandoverPhoto(userId, orderId, photo) : "", where);
  },
    b?.handoff === "hand" ? "Marked handed over. You're paid when the buyer confirms, or in 24 hours." : "Marked delivered. You're paid when the buyer confirms, or in 24 hours."));
  const gotIt = useMutation(act(() => confirmHandover(orderId), "Handover done. Enjoy your item."));
  const notDelivered = useMutation(act(() => reportNotDelivered(orderId), "Sorry it didn't come. Everything you paid is coming back to your card."));
  const buyerCancel = useMutation(act(() => buyerCancelDelivery(orderId), "Cancelled. Your refund is on its way."));
  const sellerCancel = useMutation(act(() => sellerCancelDelivery(orderId), "Delivery cancelled. The buyer gets everything back."));
  const handoff = useMutation(act((h: DeliveryHandoff) => setDeliveryHandoff(orderId, h), "Saved. The seller is told."));
  const answer = useMutation(act((accept: boolean) => answerDeliveryTime(orderId, accept),
    (r) => (r === "moved" ? "Delivery time changed." : r === "slot_taken" ? "That time was just taken, so the delivery keeps its time." : "The delivery keeps its time.")));
  if (booking.isLoading) return <p className="text-sm text-muted-foreground" role="status">Loading the delivery…</p>;
  // A failed read is an error with a retry, like every Declutter list (audit 2026-10-28: it was a grey line with no way to try again).
  if (booking.isError || !b) {
    return <ErrorState variant="inline" title="We couldn't load this delivery." body={sellerDeliveryErrorMessage(booking.error)} onRetry={() => void booking.refetch()} />;
  }
  const can = sellerDeliveryActions(b);
  const busy = delivered.isPending || gotIt.isPending || notDelivered.isPending || buyerCancel.isPending || sellerCancel.isPending || handoff.isPending || answer.isPending;
  const fileId = `sd-photo-${orderId}`;
  return (
    <div className="space-y-3" data-seller-delivery-order="">
      <div className="rounded-xl bg-muted/50 px-3 py-2 text-sm space-y-1">
        <p className="font-semibold">
          {b.status === "needs_time" ? "Pick a new delivery time"
            : b.slot_start ? `Delivery ${slotLabel(b.slot_start)}` : "Delivery"}
        </p>
        <p className="text-muted-foreground">{HANDOFF_WORDS[b.handoff].title}{b.side === "seller" ? " (the buyer's choice)" : ""}</p>
        {b.side === "seller" && b.dropoff_address && <p>Deliver to: {b.dropoff_address}</p>}
        {b.side === "buyer" && !can.gotIt && b.order_status === "paid" && b.status === "booked" && !b.delivered_at && (
          <p data-got-it-later="">You can confirm you got it from the delivery day.</p>
        )}
        {b.delivered_at && <p>{b.handoff === "hand" ? "Handed over" : "Left at the door"}. {b.side === "buyer" ? "Tap \"I got it\". Something wrong? You have 24 hours to report a problem." : "You're paid when the buyer confirms, or in 24 hours unless they report a problem."}</p>}
      </div>
      {can.changeHandoff && (
        <div role="radiogroup" aria-label="When the seller arrives" className="flex flex-wrap gap-2">
          {(["leave", "hand"] as const).map((h) => (
            <ChoicePill key={h} selected={b.handoff === h} disabled={busy} onClick={() => b.handoff !== h && handoff.mutate(h)}>{HANDOFF_WORDS[h].title}</ChoicePill>
          ))}
        </div>
      )}
      {b.proposed_start && (
        <div className="rounded-xl border border-border px-3 py-2 text-sm space-y-2" role="status">
          <p>{b.proposed_by === b.side ? `You asked to move it to ${slotLabel(b.proposed_start)}.` : `The ${b.proposed_by} asked to move it to ${slotLabel(b.proposed_start)}.`}</p>
          <div className="flex flex-wrap gap-2">
            {can.answerProposal && <button type="button" className={primary} disabled={busy} onClick={() => answer.mutate(true)}>Accept the new time</button>}
            <button type="button" className={btn} disabled={busy} onClick={() => answer.mutate(false)}>{can.withdrawProposal ? "Take back my request" : "Keep the current time"}</button>
          </div>
        </div>
      )}
      {can.markDelivered && (
        <div className="space-y-2">
          <label htmlFor={fileId} className="block text-xs font-medium">
            {b.handoff === "leave" ? "Photo of the items at the buyer's door (needed, taken there)" : "Photo of the handover (optional, taken at the buyer's address)"}
          </label>
          <input id={fileId} type="file" accept="image/*" capture="environment" disabled={busy} onChange={(e) => setPhoto(e.target.files?.[0] ?? null)} />
          <button type="button" className={primary} disabled={busy || (b.handoff === "leave" && !photo)} onClick={() => delivered.mutate(undefined)}>
            {b.handoff === "hand" ? "Handed over" : "Delivered"}
          </button>
        </div>
      )}
      <div className="flex flex-wrap gap-2">
        {can.gotIt && <button type="button" className={primary} disabled={busy} onClick={() => setAsk("gotIt")}>I got it</button>}
        {can.askNewTime && <button type="button" className={btn} disabled={busy} onClick={() => setMoving((m) => !m)}>{b.status === "needs_time" && b.side === "buyer" ? "Pick a time" : "Ask for a new time"}</button>}
        {can.notDelivered && (
          <button type="button" className={btn} disabled={busy}
            onClick={() => setAsk("notDelivered")}>
            It wasn't delivered
          </button>
        )}
        {can.buyerCancel && (
          <button type="button" className={btn} disabled={busy}
            onClick={() => setAsk("buyerCancel")}>
            Cancel order
          </button>
        )}
        {can.sellerCancel && (
          <button type="button" className={btn} disabled={busy}
            onClick={() => setAsk("sellerCancel")}>
            Cancel delivery
          </button>
        )}
        <button type="button" className={btn} onClick={onProblem}>Report a problem</button>
      </div>
      {ask && (
        <ConfirmSheet open title={ASK[ask].title} confirmLabel={ASK[ask].confirm} cancelLabel={ASK[ask].cancel} pending={busy} testId={`seller-delivery-${ask}`}
          onClose={() => setAsk(null)}
          onConfirm={() => ({ gotIt, notDelivered, buyerCancel, sellerCancel })[ask].mutate(undefined, { onSettled: () => setAsk(null) })}>
          {ASK[ask].words}
        </ConfirmSheet>
      )}
      {moving && can.askNewTime && <NewTimePicker orderId={orderId} current={b} onDone={() => { setMoving(false); refresh(); }} />}
    </div>
  );
}

function NewTimePicker({ orderId, current, onDone }: { orderId: string; current: SellerDeliveryBooking; onDone: () => void }) {
  const times = useQuery({ queryKey: ["declutter", "seller-delivery-times", orderId], queryFn: () => fetchDeliveryOpenTimes(orderId) });
  const [slot, setSlot] = useState<string | null>(null);
  const days = groupSlotsByDay((times.data?.slots ?? []).filter((s) => !sameSlot(s, current.slot_start)));
  const [day, setDay] = useState<string | null>(null);
  const shown = days.find((d) => d.day === day) ?? days[0];
  const propose = useMutation({
    mutationFn: () => proposeDeliveryTime(orderId, slot!),
    onSuccess: (r) => { toast.success(r === "booked" ? "Delivery booked." : "Asked. The other side accepts or keeps the current time."); onDone(); },
    onError: (err) => toast.error(sellerDeliveryErrorMessage(err)),
  });
  if (times.isLoading) return <p className="text-sm text-muted-foreground" role="status">Loading open times…</p>;
  if (times.isError) return <ErrorState variant="inline" title="We couldn't load the open times." body={sellerDeliveryErrorMessage(times.error)} onRetry={() => void times.refetch()} />;
  if (!shown) return <p className="text-sm text-muted-foreground" role="status">No other delivery times are open in the next two weeks.</p>;
  return (
    <div className="space-y-2 rounded-xl border border-border p-3">
      <div role="radiogroup" aria-label="New delivery day" className="flex flex-wrap gap-2">
        {days.map((d) => <ChoicePill key={d.day} selected={d.day === shown.day} onClick={() => { setDay(d.day); setSlot(null); }}>{d.label}</ChoicePill>)}
      </div>
      <div role="radiogroup" aria-label="New delivery time" className="flex flex-wrap gap-2">
        {shown.slots.map((s) => <ChoicePill key={s} selected={sameSlot(s, slot)} onClick={() => setSlot(s)}>{slotTimeLabel(s, times.data?.slot_minutes)}</ChoicePill>)}
      </div>
      <button type="button" className={primary} disabled={!slot || propose.isPending} onClick={() => propose.mutate()}>
        {current.status === "needs_time" && current.side === "buyer" ? "Book this time" : "Ask for this time"}
      </button>
    </div>
  );
}
