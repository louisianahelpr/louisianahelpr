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

const btn = "rounded-full border border-border px-4 py-2 text-sm font-semibold";
const primary = "btn-grad-primary !text-[hsl(var(--parchment))] rounded-full px-4 py-2 text-sm font-semibold";

/** Which buttons a side gets right now (pure, so the rules are tested apart from the screen). */
export function sellerDeliveryActions(b: SellerDeliveryBooking, now: number = Date.now()) {
  const booked = b.status === "booked" && !!b.slot_start;
  const marked = !!b.delivered_at;
  const started = booked && now >= Date.parse(b.slot_start!);
  const cancelBy = b.slot_start ? Date.parse(b.slot_start) - SELLER_DELIVERY_RULES.buyer_cancel_hours * 3_600_000 : null;
  const open = b.order_status === "paid";
  return {
    markDelivered: open && b.side === "seller" && started && !marked,
    gotIt: open && b.side === "buyer",
    notDelivered: open && b.side === "buyer" && booked && !marked && !!b.not_delivered_from && now >= Date.parse(b.not_delivered_from),
    buyerCancel: open && b.side === "buyer" && !marked && (cancelBy === null || now <= cancelBy),
    sellerCancel: open && b.side === "seller" && !marked && b.status !== "needs_time",
    changeHandoff: open && b.side === "buyer" && !marked && (b.status === "booked" || b.status === "needs_time"),
    askNewTime: open && !marked && (b.status === "booked" || b.status === "needs_time") && b.proposals_left > 0 && !(b.proposed_by === b.side),
    answerProposal: open && !!b.proposed_start && b.proposed_by !== b.side,
    withdrawProposal: open && !!b.proposed_start && b.proposed_by === b.side,
  };
}

export function SellerDeliveryOrderPanel({ orderId, userId, onProblem }: { orderId: string; userId: string; onProblem: () => void }) {
  const qc = useQueryClient();
  const key = ["declutter", "seller-delivery-booking", orderId] as const;
  const booking = useQuery({ queryKey: key, queryFn: () => fetchSellerDeliveryBooking(orderId) });
  const [moving, setMoving] = useState(false);
  const [photo, setPhoto] = useState<File | null>(null);
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
  const delivered = useMutation(act(async () => markDelivered(orderId, photo ? await uploadHandoverPhoto(userId, orderId, photo) : ""),
    b?.handoff === "hand" ? "Marked handed over. You're paid when the buyer confirms, or in 24 hours." : "Marked delivered. You're paid when the buyer confirms, or in 24 hours."));
  const gotIt = useMutation(act(() => confirmHandover(orderId), "Handover done. Enjoy your item."));
  const notDelivered = useMutation(act(() => reportNotDelivered(orderId), "Sorry it didn't come. Everything you paid is coming back to your card."));
  const buyerCancel = useMutation(act(() => buyerCancelDelivery(orderId), "Cancelled. Your refund is on its way, less the card fee."));
  const sellerCancel = useMutation(act(() => sellerCancelDelivery(orderId), "Delivery cancelled. The buyer gets everything back."));
  const handoff = useMutation(act((h: DeliveryHandoff) => setDeliveryHandoff(orderId, h), "Saved. The seller is told."));
  const answer = useMutation(act((accept: boolean) => answerDeliveryTime(orderId, accept),
    (r) => (r === "moved" ? "Delivery time changed." : r === "slot_taken" ? "That time was just taken, so the delivery keeps its time." : "The delivery keeps its time.")));
  if (booking.isLoading) return <p className="text-sm text-muted-foreground" role="status">Loading the delivery…</p>;
  if (booking.isError || !b) return <p className="text-sm text-muted-foreground" role="status">{sellerDeliveryErrorMessage(booking.error)}</p>;
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
        {b.delivered_at && <p>{b.handoff === "hand" ? "Handed over" : "Left at the door"}. {b.side === "buyer" ? "Tap \"I got it\", or report a problem within 24 hours." : "You're paid when the buyer confirms, or in 24 hours unless they report a problem."}</p>}
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
            {b.handoff === "leave" ? "Photo of the items at the door (needed)" : "Photo of the handover (optional)"}
          </label>
          <input id={fileId} type="file" accept="image/*" capture="environment" disabled={busy} onChange={(e) => setPhoto(e.target.files?.[0] ?? null)} />
          <button type="button" className={primary} disabled={busy || (b.handoff === "leave" && !photo)} onClick={() => delivered.mutate(undefined)}>
            {b.handoff === "hand" ? "Handed over" : "Delivered"}
          </button>
        </div>
      )}
      <div className="flex flex-wrap gap-2">
        {can.gotIt && <button type="button" className={primary} disabled={busy} onClick={() => gotIt.mutate(undefined)}>I got it</button>}
        {can.askNewTime && <button type="button" className={btn} disabled={busy} onClick={() => setMoving((m) => !m)}>{b.status === "needs_time" && b.side === "buyer" ? "Pick a time" : "Ask for a new time"}</button>}
        {can.notDelivered && (
          <button type="button" className={btn} disabled={busy}
            onClick={() => { if (window.confirm("It wasn't delivered? You get everything back, delivery included.")) notDelivered.mutate(undefined); }}>
            It wasn't delivered
          </button>
        )}
        {can.buyerCancel && (
          <button type="button" className={btn} disabled={busy}
            onClick={() => { if (window.confirm("Cancel this order? You get everything back except the card fee. You can cancel until 24 hours before the delivery.")) buyerCancel.mutate(undefined); }}>
            Cancel order
          </button>
        )}
        {can.sellerCancel && (
          <button type="button" className={btn} disabled={busy}
            onClick={() => { if (window.confirm("Cancel this delivery? The buyer gets everything back, you get a Declutter strike, and the card fee comes out of your next payout.")) sellerCancel.mutate(undefined); }}>
            Cancel delivery
          </button>
        )}
        <button type="button" className={btn} onClick={onProblem}>Report a problem</button>
      </div>
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
  if (times.isError) return <p className="text-sm text-muted-foreground" role="status">{sellerDeliveryErrorMessage(times.error)}</p>;
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
