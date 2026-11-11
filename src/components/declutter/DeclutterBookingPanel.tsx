/**
 * The paid order's pickup booking (Declutter slice 4, rows 14-15): book or move the pickup time, once per side, with
 * the no-show rule. Split out of DeclutterHandoverViews.tsx (componentSizeRatchet, 600-line threshold); unchanged.
 * Every rule is enforced by the server (bookPickup -> declutter RPCs); this only explains it.
 */
import { useState, type ReactNode } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { DateTimeField } from "@/components/DateTimeField";
import { bookPickup, type MyBooking } from "@/lib/declutter/handover";
import { declutterErrorMessage } from "@/lib/declutter/errors";
import { BookedTimeLine, usePorchWindowWords } from "./DeclutterBookedTimeLine";
import { FoldedTimePicker } from "./DeclutterFoldedTime";
import { PickupSlotPicker } from "./DeclutterPickupWindows";
import { invalidate, localInputToIso, type PaidOrder } from "./paidOrders";

export function BookingPanel({ order, booking, frozen = false, noTimes = null }: { order: PaidOrder; booking: MyBooking | null; frozen?: boolean; noTimes?: ReactNode }) {
  const qc = useQueryClient();
  const [value, setValue] = useState("");
  // Deep audit #2: the buyer picks from the seller's own times (day + time chips); the seller's one move stays free.
  const [slot, setSlot] = useState<string | null>(null);
  const [moving, setMoving] = useState(false);
  const book = useMutation({
    mutationFn: (iso: string) => bookPickup(order.orderId, iso),
    onSuccess: (r) => {
      toast(r.result === "booked" ? "Pickup booked." : "Pickup time changed.");
      setValue("");
      setSlot(null);
      setMoving(false);
      invalidate(qc, order.orderId);
    },
    onError: (err) => toast.error(declutterErrorMessage(err)),
  });
  const booked = booking?.slot_start;
  const movedAlready = !!booked && ((order.side === "buyer" ? booking?.buyer_reschedules : booking?.seller_reschedules) ?? 0) >= 1;
  // A3-63 (lead 1:14 PM: a porch pickup is a 2-hour window the seller leaves it out for): a porch booking at the
  // checkout window says the window from the order row (pickup_slot_start / _end, the same read the buyer's card
  // uses), never "(30 minutes)". Door and meetup keep their exact 30-minute time.
  const porch = order.handover === "porch";
  const windowWords = usePorchWindowWords(order, booked);
  // Q2632 (audit 1102c R7): a safe-spot meeting is a meeting in its buttons too, as its tracker and time line say.
  const what = order.handover === "meetup" ? "meeting" : "pickup";
  const timeLine = (label: string) => <BookedTimeLine order={order} booked={booked!} label={label} windowWords={windowWords} />;
  // A3-49: the seller's wait is said once, by the card's next-step line ("Waiting on Ann to pick a pickup time · by …").
  if (!booked && order.side === "seller") return null;
  const id = `dcl-slot-${order.orderId}`;
  if (frozen) return booked ? timeLine("Pickup") : null;
  // Q2432: the no-show rule (declutter_report_no_show) where the buyer books, plus the reminder. Q2635 (audit 1102c
  // R10): before a time is booked the picker comes first, and the rule follows it once a time is chosen.
  const noShowRule = order.side === "buyer" && <p className="text-xs text-muted-foreground" data-testid="declutter-no-show-warning">
    We'll remind you 1 hour before. If you miss it, the seller can report a no-show: you get one new time, and a second miss cancels the sale with a strike.</p>;
  return (
    <div className="space-y-2">
      {booked && timeLine(order.handover === "meetup" ? "Meeting" : "Pickup")}
      {booked && noShowRule}
      {/* Each side moves a booked time once (deep audit #25: "Move it" was still offered after the move was used). */}
      {movedAlready ? (
        <p className="text-xs text-muted-foreground" data-testid="declutter-move-used">{`You've already moved this ${what} once. Message the other side if the time doesn't work.`}</p>
      ) : booked && order.side === "seller" ? (
        // Night audit sold states #3: once the booked time has started the seller's next step is "Picked up" or
        // "They didn't show", so "Move the pickup" goes.
        // Deep audit #32: folded behind one button, so a booked card is not two full pickers deep at 390.
        Date.now() >= new Date(booked).getTime() ? null : <FoldedTimePicker id={id} openLabel={`Move the ${what}`} title="Move it (you can do this once)" fieldLabel={`New ${what} time`}
          confirmLabel="Move" pending={book.isPending} onConfirm={(iso) => book.mutate(iso)} />
      ) : booked && !moving ? (
        // The buyer's move folds the same way (#32), and opens the seller's own times (#2).
        <Button type="button" variant="outline" size="sm" aria-expanded={false} disabled={book.isPending} onClick={() => setMoving(true)}>{`Move the ${what}`}</Button>
      ) : (
      <>
      <label htmlFor={id} className="block text-xs font-medium">{booked ? "Move it (you can do this once)" : "Pick a pickup time"}</label>
      <div className="space-y-2">
        <PickupSlotPicker orderId={order.orderId} value={slot} onPick={setSlot} noTimes={booked ? null : noTimes} porch={porch}
          fallback={<DateTimeField id={id} label={booked ? "New pickup time" : "Pickup time"} value={value} onChange={setValue} />} />
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant={booked ? "outline" : "primary"} size="sm" disabled={book.isPending || !(slot ?? localInputToIso(value))}
            onClick={() => { const iso = slot ?? localInputToIso(value); if (iso) book.mutate(iso); }}>{booked ? "Move" : "Book"}</Button>
          {booked && <Button type="button" variant="outline" size="sm" onClick={() => { setMoving(false); setSlot(null); }}>Cancel</Button>}
        </div>
        {!booked && !!(slot ?? localInputToIso(value)) && noShowRule}
      </div>
      </>
      )}
    </div>
  );
}
