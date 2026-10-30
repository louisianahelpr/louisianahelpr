/**
 * The screens of Declutter slice 4 (docs/specs/declutter-auctions.md rows 14-15,
 * 18-19, 25-28, 45, 52, 93-99; B49-B58): what happens after the buyer paid.
 * One card per paid order, for both sides:
 *   - the exact pickup address (the paid buyer, row 98),
 *   - book / move the 30-minute pickup (buyer books first; each side may move
 *     it once; 7-day deadline),
 *   - the buyer's "I got it" (both pickups), which pays the seller; at the
 *     door (big items), the seller's "Picked up" (photo optional) does too;
 *     with neither, the 24 h auto-pay, which on a porch pickup needs the
 *     "Left on porch" photo (rows 25, 28, 93; owner 2026-10-18),
 *   - at the door: short safety tips for both sides, and "Add a Helpr" to carry it,
 *   - porch: the seller's "out all day / out until" and "Set out" photo; the
 *     buyer's "Picked up" photo, taken at the address, which pays the seller
 *     right away (rows 26, 97, 99),
 *   - "They didn't show" from 15 minutes after the booked time (row 94),
 *   - "Report a problem" once the booked pickup is over or the item is handed over, until the seller is paid
 *     (rows 15, 67, 96; owner 2026-10-29: never while the order waits for pickup),
 *   - the seller's payout status (row 93) and, after handover, a review both
 *     ways (row 45).
 * Every rule is enforced by the server (20261015042253); these screens only
 * explain it. Plain words come from declutterErrorMessage.
 *
 * No QR code and no 4-digit code (owner 2026-10-17 + 2026-10-18: porch pickup,
 * buyer and seller never meet): the "Set out" photo, "I got it", the "Picked up"
 * photo and the 24 h auto-pay are the whole handover (20261018183715).
 */
import { lazy, Suspense, useState, type ReactNode, useEffect, useRef } from "react";
import { HelprSpinner } from "@/components/ui/HelprSpinner";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ErrorState } from "@/components/ui/ErrorState";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { OrderTalkButton } from "@/components/declutter/DeclutterOrderTalk";
import { useFeature } from "@/hooks/useFeature";
import type { CartLine } from "@/lib/declutter/api";
import { invalidate, localInputToIso, paidOrdersFromCart, when, type PaidOrder } from "./paidOrders";
import {
  bookPickup,
  confirmHandover,
  fetchMyBookings,
  fetchMyHandover,
  fetchMyPayouts,
  porchNote,
  porchPhoto,
  reportNoShow,
  sellerPickedUp,
  reportProblem,
  setPorchTime,
  uploadHandoverPhoto,
  type MyBooking,
  type MyPayout,
  type OpenProblem,
  type ProblemReason,
} from "@/lib/declutter/handover";
import { ProblemOpenNote } from "./DeclutterProblemOpen";
import { payoutLine } from "./declutterPayoutWords";
import { ProblemPhotoPicker, uploadProblemPhotos } from "./DeclutterProblemPhotos";
import { PROBLEM_FORM_PHOTOS_READY } from "@/lib/declutter/problemPhotos";
import { useOpenProblems } from "./useOpenProblems";
import { DeclutterReviewForm } from "./DeclutterReviewForm";
import { markReviewPrompt } from "@/lib/declutter/reviewPrompt";
import { GotItSheet, NoShowSheet, PickedUpSheet, PutItOutSheet } from "./DeclutterHandoverSheets";
import { MeetupPanel } from "./DeclutterMeetup";
import { noShowFrom, pickupTimeOver, porchDayIsNow, PorchDayPanel } from "./DeclutterPorchDay";
import { useOrderOtherPerson } from "./useOrderOtherPerson";
import { PROBLEM_REASONS, type ProblemStage } from "./problemReasons";
import { BuyerOrderHead, byBucket, type BuyerOrderView } from "./BuyingOrders";
import { declutterErrorMessage } from "@/lib/declutter/errors";
import { DoorPickupTips, PickupAddresses } from "./DeclutterOrderBits";
import { itemPriceLabel } from "@/lib/declutter/distance";
import { currentPosition } from "@/lib/declutter/position";
// The delivery screens load on their own (Q178, 2026-10-17): imported statically
// from two Declutter screens, the shared Helpr task module rode in
// signed-in-shared and put /posts over its critical-path budget.
import { onDay, PickupStatus, PorchOutPhoto, SellerDeliveryStatus } from "./DeclutterPorchHandover";
import { DateTimeField } from "@/components/DateTimeField";
import { FoldedTimePicker } from "./DeclutterFoldedTime";
import { PickupSlotPicker } from "./DeclutterPickupWindows";
const OrderDeliveryPanel = lazy(() => import("./DeclutterDeliveryViews").then((m) => ({ default: m.OrderDeliveryPanel })));
// Seller delivery (20261027153244) loads with its own orders only (Q178).
const SellerDeliveryOrderPanel = lazy(() => import("./SellerDeliveryOrder").then((m) => ({ default: m.SellerDeliveryOrderPanel })));
// Add a Helpr loads with the buyer's order card only (Q178: off /posts' critical path).
const AddHelprPanel = lazy(() => import("./DeclutterAddHelpr").then((m) => ({ default: m.AddHelprPanel })));
// Board 141 (Declutter side): the refund request after the handover loads with a handed-over order only.
const DeclutterRefundPanel = lazy(() => import("./DeclutterRefundRequest").then((m) => ({ default: m.DeclutterRefundPanel })));
// D2-3: both sides of a reported problem (the reason, words and photos; the other side adds theirs).
const DeclutterProblemSides = lazy(() => import("./DeclutterProblemSides").then((m) => ({ default: m.DeclutterProblemSides })));

const btn = "rounded-full border border-border px-4 py-2 text-sm font-semibold";
const primary = "btn-grad-primary rounded-full px-4 py-2 text-sm font-semibold";
const input = "w-full rounded-lg border border-input bg-background px-3 py-2 text-sm";

/**
 * Every paid order in `cart` (the cart's paid lines). The Buying and Selling
 * tabs pass one side's lines and their own heading (PaidOrders in DeclutterTradeViews).
 */
export function PaidOrdersSection({ cart, heading, label, views, show }: {
  cart: CartLine[]; heading?: ReactNode; label?: string;
  /** Buying's tracker (BuyingOrders.tsx): each buyer order's steps, chip and one next action. */
  views?: Map<string, BuyerOrderView>;
  /** Which orders the chosen chip shows (all when absent). */
  show?: (orderId: string) => boolean;
}) {
  const { user } = useCurrentUser();
  const userId = user?.id ?? "";
  const orders = paidOrdersFromCart(cart);
  const ids = orders.map((o) => o.orderId);
  const bookings = useQuery({
    queryKey: ["declutter", "bookings", ids.join(",")],
    queryFn: () => fetchMyBookings(ids),
    enabled: ids.length > 0,
  });
  const payouts = useQuery({
    queryKey: ["declutter", "payouts", userId],
    queryFn: () => fetchMyPayouts(userId),
    enabled: !!userId && orders.some((o) => o.side === "seller"),
  });
  // Audit 1b D2-2: an open problem shows on both cards and hides booking and a second report.
  const problems = useOpenProblems(ids);
  const chosen = show ? orders.filter((o) => show(o.orderId)) : orders;
  // DB-6: on Buying, what needs the buyer comes first and history (Done, Cancelled) last.
  const shown = views ? byBucket(chosen, views) : chosen;
  if (shown.length === 0 || !userId) return null;
  if (bookings.isError) {
    return <ErrorState variant="inline" title="We couldn't load your pickups." body={declutterErrorMessage(bookings.error)} onRetry={() => void bookings.refetch()} />;
  }
  return (
    <section className="space-y-3" aria-label={label ?? "Paid sales"}>
      {heading ?? <h2 className="text-base font-semibold">Paid: pickup and handover</h2>}
      {shown.map((o) => (
        <OrderCard
          key={o.orderId}
          order={o}
          view={views?.get(o.orderId)}
          userId={userId}
          booking={(bookings.data ?? []).find((b) => b.order_id === o.orderId) ?? null}
          payout={(payouts.data ?? []).find((p) => p.order_id === o.orderId) ?? null}
          problem={problems.get(o.orderId) ?? null}
        />
      ))}
    </section>
  );
}

function OrderCard({ order, userId, booking, payout, view, problem }: { order: PaidOrder; userId: string; booking: MyBooking | null; payout: MyPayout | null; view?: BuyerOrderView; problem: OpenProblem | null }) {
  const title = order.lines.map((l) => l.item_title).join(", ");
  const items = order.lines.reduce((sum, l) => sum + l.price_cents, 0);
  const done = order.status === "handed_over";
  // Boards 159/160: the other person by first name in the handover sheets; the problem form opens from "Something's not right".
  const { who } = useOrderOtherPerson(order.orderId, userId, order.side);
  const [problemOpen, setProblemOpen] = useState(false);
  const [atHandover, setAtHandover] = useState(false); // opened from the "I got it" sheet (D2-11)
  // Board 141 (Declutter side, 20261026155251): ask for / answer a refund in the 24 hours after the handover.
  const refundRequests = useFeature("declutter_refund_requests");
  // Buying's tracker: the card shows its steps and ONE next action; the rest opens under Details, at that action.
  const [open, setOpen] = useState(false);
  // Audit 1c D3-7: a Helpr delivery's "I got it" opened Details only; it now opens the "Do you have it?" sheet too.
  const [askGot, setAskGot] = useState(false);
  const bodyRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open || !view) return;
    const go = bodyRef.current?.querySelector<HTMLElement>(".btn-grad-primary:not([disabled]), input, select");
    go?.scrollIntoView?.({ block: "center" });
    go?.focus({ preventScroll: true });
  }, [open, view]);
  const body = !view || open;
  return (
    <article className="rounded-[20px] border border-border bg-card p-4 space-y-3">
      {/* Board 47 / 26 mine card: title, the price in money ink, ONE line saying how it's coming. The buyer's card no
          longer says "You're buying" (lead 2026-10-28: every card on the Buying tab repeated it). */}
      <div className="flex items-start justify-between gap-3 min-w-0" data-order-head="">
        <div className="min-w-0">
          <p className="truncate text-ds-15 font-semibold" title={title}>{title}</p>
          <p className="text-ds-13 text-muted-foreground">
            {order.handover === "porch" ? "Porch pickup" : order.handover === "delivery" ? "Helpr delivery" : order.handover === "seller_delivery" ? "Seller delivers" : order.handover === "meetup" ? "Meet at a safe spot" : "Pickup at the seller's home"}{order.side === "seller" ? (items === 0 ? " · You're giving" : " · You're selling") : ""}
          </p>
        </div>
        <span className="shrink-0 text-ds-15 font-bold tabular-nums text-[hsl(var(--burnt-sienna))]">{itemPriceLabel(items)}</span>
      </div>
      {/* Boards 71/72: one tracker, where it stands and the money note, from the real handover row
          (delivery has its own, in OrderDeliveryPanel). */}
      {view && <BuyerOrderHead view={view} open={open} onOpen={() => setOpen(true)} onClose={() => { setOpen(false); setAskGot(false); }}
        onAction={() => { setOpen(true); setAskGot(order.handover === "delivery" && view.action === "I got it"); }} />}
      {problem && <ProblemOpenNote problem={problem} side={order.side} />}
      {done && order.side === "buyer" && order.handover === "delivery" && order.deliveryTaskId && <Suspense fallback={null}><OrderDeliveryPanel taskId={order.deliveryTaskId} side="buyer" orderId={order.orderId} tipOnly /></Suspense>}
      {body && <div ref={bodyRef} className="space-y-3" data-order-body="">
      <Suspense fallback={null}><DeclutterProblemSides orderId={order.orderId} side={order.side} /></Suspense>
      {/* D2-1: the paid order's chat with the other side (DeclutterOrderTalk, ?order_talk=). */}
      <OrderTalkButton orderId={order.orderId} side={order.side} />
      {/* DC-16: ONE sale card: every handover kind shows the tracker, where it stands and the money note (Helpr delivery's is in OrderDeliveryPanel). */}
      {!view && order.handover === "seller_delivery" && <SellerDeliveryStatus orderId={order.orderId} side={order.side} itemsCents={items} problemOpen={!!problem} />}
      {!view && (order.handover === "porch" || order.handover === "pickup_home" || order.handover === "meetup") && (
        <PickupStatus
          orderId={order.orderId}
          handover={order.handover}
          side={order.side}
          slot={booking?.slot_start ?? null}
          day={booking?.pickup_day ?? null}
          itemsCents={items}
          problemOpen={!!problem}
        />
      )}
      {done ? (
        <>
          {(order.handover === "delivery" || (order.handover === "seller_delivery" && !!view)) && <p className="text-sm font-medium">Handed over.</p>}
          {order.side === "seller" && payout && items > 0 && <p className="text-sm">{payoutLine(payout, !!problem)}</p>}
          {refundRequests && items > 0 && (
            <Suspense fallback={null}>
              <DeclutterRefundPanel orderId={order.orderId} who={who} problemForm={problem ? null : <ProblemForm orderId={order.orderId} side={order.side} stage="handover" />} />
            </Suspense>
          )}
          <DeclutterReviewForm orderId={order.orderId} side={order.side} userId={userId} refundPanel={!!refundRequests && items > 0} />
        </>
      ) : order.handover === "seller_delivery" ? (
        <>
          {/* 20261027153244: the seller brings it at the time the buyer picked. */}
          <Suspense fallback={<HelprSpinner />}>
            <SellerDeliveryOrderPanel orderId={order.orderId} userId={userId} onProblem={() => setProblemOpen(true)} problemOpen={!!problem} />
          </Suspense>
          {!problem && <ProblemForm orderId={order.orderId} side={order.side} stage="delivery" open={problemOpen} onOpenChange={setProblemOpen} trigger={false} />}
        </>
      ) : order.handover === "delivery" ? (
        <>
          {/* Slice 5: a Helpr picks it up and brings it; the task shows its progress. */}
          {order.deliveryTaskId
            ? <Suspense fallback={<HelprSpinner />}><OrderDeliveryPanel taskId={order.deliveryTaskId} side={order.side} orderId={order.orderId} askGot={askGot} /></Suspense>
            : <p className="text-sm text-muted-foreground">Finding a Helpr for this delivery.</p>}
          {!problem && <ProblemForm orderId={order.orderId} side={order.side} stage="delivery" />}
        </>
      ) : (
        <>
          {/* Q2425: a safe-spot meetup shows the public place, never the seller's home address. */}
          {order.side === "buyer" && order.handover !== "meetup" && <PickupAddresses lines={order.lines} />}
          {/* Owner 2026-10-28: a porch pickup is a DAY (the time picker stays for a time already booked). */}
          {/* D2-2: no booking while a problem is open (the server refuses it: problem_open). */}
          {problem ? null : order.handover === "porch"
            ? <PorchDayPanel orderId={order.orderId} side={order.side} booking={booking} fallback={<BookingPanel order={order} booking={booking} />}
                noDays={<ProblemForm orderId={order.orderId} side={order.side} stage="waiting" />} />
            : <BookingPanel order={order} booking={booking} />}
          {order.handover === "meetup" && <MeetupPanel orderId={order.orderId} side={order.side} slotStart={booking?.slot_start ?? null} />}
          {order.handover === "pickup_home" && <DoorPickupTips side={order.side} />}
          {order.handover === "porch" && <PorchOutPhoto orderId={order.orderId} side={order.side} />}
          {booking?.slot_start && order.handover === "porch" && <PorchPanel order={order} userId={userId} booking={booking} who={who} />}
          {booking?.slot_start && <HandoverPanel order={order} userId={userId} slotStart={booking.slot_start} pickupDay={booking.pickup_day ?? null} who={who} problemOpen={!!problem} onProblem={() => { setAtHandover(true); setProblemOpen(true); }} />}
          {booking?.slot_start && !problem && <NoShowButton order={order} slotStart={noShowFrom(booking) ?? booking.slot_start} who={who} />}
          {/* D2-9 (owner 2026-10-29): no "Report a problem" button until the booked pickup is over (pickupTimeOver). D2-2: none while a problem is open. */}
          {!problem && <ProblemForm orderId={order.orderId} side={order.side} stage={atHandover ? "handover" : "waiting"} open={problemOpen}
            onOpenChange={(o) => { setProblemOpen(o); if (!o) setAtHandover(false); }} trigger={pickupTimeOver(booking)} />}
        </>
      )}
      {order.side === "buyer" && <Suspense fallback={null}><AddHelprPanel orderId={order.orderId} /></Suspense>}
      </div>}
    </article>
  );
}

function BookingPanel({ order, booking }: { order: PaidOrder; booking: MyBooking | null }) {
  const qc = useQueryClient();
  const [value, setValue] = useState("");
  // Deep audit #2: the buyer picks from the seller's own times (day + time chips); the seller's one move stays free.
  const [slot, setSlot] = useState<string | null>(null);
  const [moving, setMoving] = useState(false);
  const book = useMutation({
    mutationFn: (iso: string) => bookPickup(order.orderId, iso),
    onSuccess: (r) => {
      toast.success(r.result === "booked" ? "Pickup booked." : "Pickup time changed.");
      setValue("");
      setSlot(null);
      setMoving(false);
      invalidate(qc, order.orderId);
    },
    onError: (err) => toast.error(declutterErrorMessage(err)),
  });
  const booked = booking?.slot_start;
  const movedAlready = !!booked && ((order.side === "buyer" ? booking?.buyer_reschedules : booking?.seller_reschedules) ?? 0) >= 1;
  if (!booked && order.side === "seller") {
    return <p className="text-sm text-muted-foreground">Waiting for the buyer to book {order.handover === "meetup" ? "a time to meet" : "a pickup time"} (within 7 days of paying).</p>;
  }
  const id = `dcl-slot-${order.orderId}`;
  return (
    <div className="space-y-2">
      {booked && <p className="text-sm">Pickup: <span className="font-medium">{when(booked)}</span> (30 minutes)</p>}
      {/* Q2432: the existing no-show rule (declutter_report_no_show), stated where the buyer books, plus the reminder. */}
      {order.side === "buyer" && (
        <p className="text-xs text-muted-foreground" data-testid="declutter-no-show-warning">
          We'll remind you 1 hour before. If you miss it, the seller can report a no-show: you get one new time, and a second miss cancels the sale with a strike.
        </p>
      )}
      {/* Each side moves a booked time once (deep audit #25: "Move it" was still offered after the move was used). */}
      {movedAlready ? (
        <p className="text-xs text-muted-foreground" data-testid="declutter-move-used">You've already moved this pickup once. Message the other side if the time doesn't work.</p>
      ) : booked && order.side === "seller" ? (
        // Deep audit #32: folded behind one button, so a booked card is not two full pickers deep at 390.
        <FoldedTimePicker id={id} openLabel="Move the pickup" title="Move it (you can do this once)" fieldLabel="New pickup time"
          confirmLabel="Move" pending={book.isPending} onConfirm={(iso) => book.mutate(iso)} />
      ) : booked && !moving ? (
        // The buyer's move folds the same way (#32), and opens the seller's own times (#2).
        <button type="button" className={btn} aria-expanded={false} disabled={book.isPending} onClick={() => setMoving(true)}>Move the pickup</button>
      ) : (
      <>
      <label htmlFor={id} className="block text-xs font-medium">{booked ? "Move it (you can do this once)" : "Pick a pickup time"}</label>
      <div className="space-y-2">
        <PickupSlotPicker orderId={order.orderId} value={slot} onPick={setSlot}
          fallback={<DateTimeField id={id} label={booked ? "New pickup time" : "Pickup time"} value={value} onChange={setValue} />} />
        <div className="flex flex-wrap gap-2">
          <button type="button" className={booked ? btn : primary} disabled={book.isPending || !(slot ?? localInputToIso(value))}
            onClick={() => { const iso = slot ?? localInputToIso(value); if (iso) book.mutate(iso); }}>{booked ? "Move" : "Book"}</button>
          {booked && <button type="button" className={btn} onClick={() => { setMoving(false); setSlot(null); }}>Cancel</button>}
        </div>
      </div>
      </>
      )}
    </div>
  );
}

function HandoverPanel({ order, userId, slotStart, pickupDay, who, problemOpen, onProblem }: { order: PaidOrder; userId: string; slotStart: string; pickupDay: string | null; who: string; problemOpen: boolean; onProblem: () => void }) {
  const qc = useQueryClient();
  // A1-C2: the buyer's "I got it" on a porch pickup waits for the porch photo (set_out_at) or the pickup day
  // (the same handover row and key PorchOutPhoto reads, so nothing is read twice).
  const porchBuyer = order.side === "buyer" && order.handover === "porch";
  const handoverRow = useQuery({ queryKey: ["declutter", "handover", order.orderId], queryFn: () => fetchMyHandover(order.orderId), enabled: porchBuyer });
  const porchReady = !porchBuyer || !!handoverRow.data?.set_out_at || (pickupDay ? porchDayIsNow(pickupDay) : Date.now() >= new Date(slotStart).getTime());
  // #6: a free claim has no payment, payout or refund to speak of.
  const free = order.lines.every((l) => l.price_cents === 0);
  const rule = (how: string) => <p className="text-sm text-muted-foreground">{free ? "" : "You're paid 24 hours after the handover, unless the buyer asks for a refund. "}The handover is when {how}.</p>;
  const [photo, setPhoto] = useState<File | null>(null);
  const [asking, setAsking] = useState(false);
  const confirm = useMutation({
    mutationFn: () => confirmHandover(order.orderId),
    onSuccess: () => {
      markReviewPrompt(order.orderId);
      toast.success("Handover done. Enjoy your item.");
      setAsking(false);
      invalidate(qc, order.orderId);
    },
    onError: (err) => toast.error(declutterErrorMessage(err)),
  });
  const pickedUp = useMutation({
    // A photo is taken where the handover is (20261028235709): the position first, so a refusal uploads nothing.
    mutationFn: async () => {
      const where = photo ? await currentPosition() : null;
      return sellerPickedUp(order.orderId, photo ? await uploadHandoverPhoto(userId, order.orderId, photo) : null, where);
    },
    onSuccess: () => {
      toast.success(free ? "Picked up." : "Picked up. You're paid in 24 hours, unless the buyer asks for a refund.");
      setPhoto(null);
      setAsking(false);
      invalidate(qc, order.orderId);
    },
    onError: (err) => toast.error(declutterErrorMessage(err)),
  });
  if (order.side === "seller") {
    // Q2425: at a safe meeting spot the seller hands it over as at the door ("Picked up").
    if (order.handover !== "pickup_home" && order.handover !== "meetup") {
      return rule('the buyer taps "I got it" or takes their pickup photo, or 24 hours after the pickup time if you posted the porch photo and no problem is reported');
    }
    const fileId = `dcl-door-${order.orderId}`;
    // From the booked time only (the server checks again: before_pickup_time).
    if (Date.now() < new Date(slotStart).getTime()) {
      return rule('the buyer taps "I got it", or you tap "Picked up" from the pickup time, or 24 hours after the pickup time unless a problem is reported');
    }
    return (
      <div className="space-y-2">
        {rule('the buyer taps "I got it" or you tap "Picked up", or 24 hours after the pickup time unless a problem is reported')}
        <label htmlFor={fileId} className="block text-xs font-medium">Photo of the handover (optional, taken where you hand it over)</label>
        <input id={fileId} type="file" accept="image/*" capture="environment" disabled={pickedUp.isPending}
          onChange={(e) => setPhoto(e.target.files?.[0] ?? null)} />
        <button type="button" className={primary} disabled={pickedUp.isPending} onClick={() => setAsking(true)}>
          Picked up
        </button>
        <PickedUpSheet open={asking} onOpenChange={setAsking} who={who} free={free} pending={pickedUp.isPending} onConfirm={() => pickedUp.mutate()} />
      </div>
    );
  }
  // Audit 1030 DB-2: no "I got it" while a problem is open (the server refuses it: problem_open); the card's note says why.
  // The seller's "Picked up" above stays: it records the handover and the payout stays held.
  if (problemOpen) return null;
  if (!porchReady) {
    return <p className="text-sm text-muted-foreground" data-got-it-wait="">You can tap "I got it" once the seller puts it out, or on your pickup day.</p>;
  }
  // Audit 1030 DB-3: at a safe meeting spot or a door pickup "I got it" opens an hour before the booked time, as
  // "I'm here" does (the server refuses it before then: got_it_too_early, 20261030061753; declutter_meetup_rules()
  // here_from_minutes_before).
  if ((order.handover === "meetup" || order.handover === "pickup_home") && Date.now() < new Date(slotStart).getTime() - 60 * 60_000) {
    return <p className="text-sm text-muted-foreground" data-got-it-wait="">You can tap "I got it" from an hour before the {order.handover === "meetup" ? "meeting" : "pickup"} time.</p>;
  }
  // Audit 1028 D1-12: its own block, so "I got it" never sits edge to edge with "Report a problem" below it.
  return (
    <div>
      <button type="button" className={primary} disabled={confirm.isPending} onClick={() => setAsking(true)}>
        I got it
      </button>
      <GotItSheet
        open={asking}
        onOpenChange={setAsking}
        orderId={order.orderId}
        porch={order.handover === "porch"} free={free}
        who={who}
        pending={confirm.isPending}
        onConfirm={() => confirm.mutate()}
        onProblem={() => { setAsking(false); onProblem(); }}
      />
    </div>
  );
}

function PorchPanel({ order, userId, booking, who }: { order: PaidOrder; userId: string; booking: MyBooking; who: string }) {
  const qc = useQueryClient();
  const free = order.lines.every((l) => l.price_cents === 0); // #6: no pay words on a free claim
  // Board 159: the seller checks the porch photo in "Put it out" before sending it.
  const [preview, setPreview] = useState<File | null>(null);
  // Audit 1028 D1-5: once the seller's porch photo is in, the card stops asking for it (a retake stays possible).
  // D1-4: before the booked day the server refuses the photo (porch_day_not_yet), so the card says the day instead.
  // The same handover row and key PorchOutPhoto reads.
  const seller = order.side === "seller";
  const handoverRow = useQuery({ queryKey: ["declutter", "handover", order.orderId], queryFn: () => fetchMyHandover(order.orderId), enabled: seller });
  const posted = seller && !!handoverRow.data?.set_out_at;
  const notYet = seller && !posted && !!booking.pickup_day && !porchDayIsNow(booking.pickup_day);
  const timing = useMutation({
    mutationFn: (v: { mode: "all_day" | "until"; iso: string | null }) => setPorchTime(order.orderId, v.mode, v.iso),
    onSuccess: () => { toast.success("Saved."); invalidate(qc, order.orderId); },
    onError: (err) => toast.error(declutterErrorMessage(err)),
  });
  const photo = useMutation({
    mutationFn: async ({ file, note }: { file: File; note?: string }) => {
      // Both sides' porch photos are taken at the address (the seller's since 20261028235709).
      const where = await currentPosition();
      const path = await uploadHandoverPhoto(userId, order.orderId, file);
      const r = await porchPhoto(order.orderId, path, where);
      // Q2266: the note follows the photo; a note that cannot be saved never undoes the photo.
      // Always sent with a seller's photo, even empty: a retake must never leave the old note under the new photo
      // (lh-authz-rls review of Q2266 #1; an empty note clears it on the server).
      let noteProblem: string | null = null;
      if (r.result === "set_out" && order.side === "seller") {
        try {
          if ((await porchNote(order.orderId, note ?? "")) === "not_deployed" && note) noteProblem = "Your note couldn't be saved yet.";
        } catch (err) {
          // The photo is in and the buyer is told; only the note failed. Say why, and keep the error in the logs.
          console.warn("[declutter] porch note not saved", err);
          noteProblem = `Your note wasn't saved: ${declutterErrorMessage(err)}`;
        }
      }
      return { ...r, noteProblem };
    },
    onSuccess: (r) => {
      setPreview(null);
      if (r.result === "set_out") toast.success(r.noteProblem ? `Left on porch. The buyer is told. ${r.noteProblem}` : "Left on porch. The buyer is told.");
      else if (free) toast.success("Picked up. Enjoy it.");
      else if (r.paid === false) toast.success("Picked up. A problem report is open, so Louisiana Helpr decides before anyone is paid.");
      else toast.success("Picked up. If something is wrong, you can ask for a refund within 24 hours.");
      invalidate(qc, order.orderId);
    },
    onError: (err) => toast.error(declutterErrorMessage(err)),
  });
  const fileId = `dcl-porch-${order.orderId}`;
  return (
    <div className="space-y-2">
      {/* A porch DAY is out all that day: no "out until" (owner 2026-10-28). A time booked before keeps it. */}
      {order.side === "seller" && !booking.pickup_day && (
        <>
          <p className="text-sm">
            {booking.porch_mode === "all_day" ? "You said it's out all day." : booking.porch_until ? `You said it's out until ${when(booking.porch_until)}.` : "When will it be out?"}
          </p>
          <div className="flex flex-wrap gap-2">
            <button type="button" className={btn} disabled={timing.isPending} onClick={() => timing.mutate({ mode: "all_day", iso: null })}>Out all day</button>
            <FoldedTimePicker id={`dcl-out-${order.orderId}`} openLabel="Out until a time…" title="Out until" fieldLabel="Out until"
              confirmLabel="Out until then" pending={timing.isPending} onConfirm={(iso) => timing.mutate({ mode: "until", iso })} />
          </div>
        </>
      )}
      {notYet ? (
        <p className="text-sm" data-porch-not-yet="">Put it out {onDay(booking.pickup_day as string)}.</p>
      ) : (<>
      <label htmlFor={fileId} className="sr-only">
        {order.side === "seller" ? `Photo of the item on your porch ("Left on porch"${free ? ")" : ": needed before you can be paid automatically)"}` : `Photo when you pick it up, taken at the address ("Picked up"${free ? ")" : ": this pays the seller 24 hours later)"}`}
      </label>
      {/* The shops' handover pattern (ShopHandoverActions): a hidden camera input opened by a real button. */}
      <input id={fileId} type="file" accept="image/*" capture="environment" className="sr-only" tabIndex={-1} disabled={photo.isPending}
        onChange={(e) => { const f = e.target.files?.[0]; if (f) { if (order.side === "seller") setPreview(f); else photo.mutate({ file: f }); } e.target.value = ""; }} />
      <button type="button" className={order.side === "seller" && !posted ? primary : btn} disabled={photo.isPending}
        onClick={() => document.getElementById(fileId)?.click()}>
        {photo.isPending ? "Saving…" : order.side === "seller" ? (posted ? "Retake the porch photo" : "Take the porch photo") : "Take your pickup photo"}
      </button>
      {!posted && (
        <p className="text-ds-12 text-muted-foreground">
          {order.side === "seller" ? `One photo where the buyer will find it, taken at your address.${free ? "" : " You need it before you can be paid automatically."}` : `Taken at the address. It tells the seller you have it${free ? "." : "; they're paid 24 hours later."}`}
        </p>
      )}
      {order.side === "seller" && (
        <PutItOutSheet
          file={preview}
          who={who}
          pending={photo.isPending}
          onSend={(f, note) => photo.mutate({ file: f, note })}
          onRetake={() => document.getElementById(fileId)?.click()}
          onClose={() => setPreview(null)}
        />
      )}
      </>)}
    </div>
  );
}

function NoShowButton({ order, slotStart, who }: { order: PaidOrder; slotStart: string; who: string }) {
  const qc = useQueryClient();
  const [asking, setAsking] = useState(false);
  const report = useMutation({
    mutationFn: () => reportNoShow(order.orderId),
    onSuccess: () => { setAsking(false); toast.success("Reported. We'll tell the other side and sort out the money."); invalidate(qc, order.orderId); },
    onError: (err) => toast.error(declutterErrorMessage(err)),
  });
  // Row 94: from 15 minutes after the booked time. The server checks again.
  if (Date.now() < new Date(slotStart).getTime() + 15 * 60_000) return null;
  return (
    <div>
      <button type="button" className={btn} disabled={report.isPending} onClick={() => setAsking(true)}>
        They didn't show
      </button>
      <NoShowSheet open={asking} onOpenChange={setAsking} side={order.side} who={who} free={order.lines.every((l) => l.price_cents === 0)} pending={report.isPending} onConfirm={() => report.mutate()} />
    </div>
  );
}


/** `trigger={false}`: the caller has its own "Report a problem" button (seller delivery), so this one shows only the open form (#51). */
function ProblemForm({ orderId, side, stage, open: openProp, onOpenChange, trigger = true }: { orderId: string; side: "buyer" | "seller"; stage: ProblemStage; open?: boolean; onOpenChange?: (open: boolean) => void; trigger?: boolean }) {
  const qc = useQueryClient();
  const [openState, setOpenState] = useState(false);
  // Controlled from the order card when "Something's not right" opens it (board 159).
  const open = openProp ?? openState;
  const setOpen = onOpenChange ?? setOpenState;
  const formRef = useRef<HTMLDivElement>(null);
  useEffect(() => { if (open && openProp) formRef.current?.scrollIntoView?.({ block: "center" }); }, [open, openProp]);
  const reasons = PROBLEM_REASONS[side][stage];
  const [picked, setReason] = useState<ProblemReason | null>(null);
  const reason = picked && reasons.some(([r]) => r === picked) ? picked : reasons[0][0];
  const [note, setNote] = useState("");
  const [photos, setPhotos] = useState<File[]>([]); // D2-7: up to 3, uploaded on Send (once the server takes them)
  const send = useMutation({
    mutationFn: async () => reportProblem(orderId, reason, note.trim(), PROBLEM_FORM_PHOTOS_READY && photos.length ? await uploadProblemPhotos(orderId, photos) : []),
    onSuccess: () => {
      toast.success("Reported. Nobody is paid until Louisiana Helpr decides.");
      setOpen(false);
      setNote("");
      setPhotos([]);
      invalidate(qc, orderId);
    },
    onError: (err) => toast.error(declutterErrorMessage(err)),
  });
  if (!open) return trigger ? <button type="button" className={btn} onClick={() => setOpen(true)}>Report a problem</button> : null;
  return (
    <div ref={formRef} className="space-y-2 rounded-xl border border-border p-3">
      <label htmlFor={`dcl-reason-${orderId}`} className="block text-xs font-medium">What went wrong?</label>
      <select id={`dcl-reason-${orderId}`} className={input} value={reason} onChange={(e) => setReason(e.target.value as ProblemReason)}>
        {reasons.map(([r, words]) => <option key={r} value={r}>{words}</option>)}
      </select>
      <label htmlFor={`dcl-note-${orderId}`} className="block text-xs font-medium">Tell us what happened</label>
      <textarea id={`dcl-note-${orderId}`} className={input} maxLength={1000} rows={3} value={note} onChange={(e) => setNote(e.target.value)} />
      {PROBLEM_FORM_PHOTOS_READY && <ProblemPhotoPicker files={photos} onChange={setPhotos} disabled={send.isPending} />}
      <div className="flex gap-2">
        <button type="button" className={primary} disabled={send.isPending || !note.trim()} onClick={() => send.mutate()}>Send</button>
        <button type="button" className={btn} onClick={() => setOpen(false)}>Not now</button>
      </div>
    </div>
  );
}
