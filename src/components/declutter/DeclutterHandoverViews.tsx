/**
 * The screens of Declutter slice 4 (docs/specs/declutter-auctions.md rows 14-15, 18-19, 25-28, 45, 52, 93-99;
 * B49-B58): what happens after the buyer paid. One card per paid order, for both sides:
 *   - the exact pickup address (the paid buyer, row 98),
 *   - book / move the 30-minute pickup (buyer books first; each side may move it once; 7-day deadline),
 *   - the buyer's "I got it" (both pickups), which pays the seller; at the door (big items), the seller's "Picked up"
 *     (photo optional) does too; with neither, the 24 h auto-pay, which on a porch pickup needs the "Left on porch"
 *     photo (rows 25, 28, 93; owner 2026-10-18),
 *   - at the door: short safety tips for both sides, and "Add a Helpr" to carry it,
 *   - porch: the seller's "out all day / out until" and "Set out" photo; the buyer's "Picked up" photo, taken at the
 *     address, which pays the seller right away (rows 26, 97, 99),
 *   - "They didn't show" from 15 minutes after the booked time (row 94),
 *   - "Report a problem" once the booked pickup is over or the item is handed over, until the seller is paid
 *     (rows 15, 67, 96; owner 2026-10-29: never while the order waits for pickup),
 *   - the seller's payout status (row 93) and, after handover, a review both ways (row 45).
 * Every rule is enforced by the server (20261015042253); these screens only explain it. Plain words come from
 * declutterErrorMessage.
 *
 * No QR code and no 4-digit code (owner 2026-10-17 + 2026-10-18: porch pickup, buyer and seller never meet): the
 * "Set out" photo, "I got it", the "Picked up" photo and the 24 h auto-pay are the whole handover (20261018183715).
 */
import { PhotoPickButton } from "@/components/ui/PhotoPickButton";
import { Button } from "@/components/ui/button";
import { lazy, Suspense, useState, type ReactNode, useEffect, useRef } from "react";
import { HelprSpinner } from "@/components/ui/HelprSpinner";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ErrorState } from "@/components/ui/ErrorState";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { OrderTalkButton } from "@/components/declutter/DeclutterOrderTalk";
import { useFeature } from "@/hooks/useFeature";
import { FailedPayoutLink } from "./FailedPayoutLink";
import type { CartLine } from "@/lib/declutter/api";
import { invalidate, isTradeOrder, liveSalesFirst, paidOrdersFromCart, when, type PaidOrder } from "./paidOrders";
import { OrderCardHead } from "./OrderCardHead";
import {
  confirmHandover,
  fetchMyBookings,
  fetchMyHandover,
  fetchMyPayouts,
  fetchOrderProblem,
  porchNote,
  porchPhoto,
  sellerPickedUp,
  setPorchTime,
  uploadHandoverPhoto,
  type MyBooking,
  type MyPayout,
  type OpenProblem,
} from "@/lib/declutter/handover";
import { buyerOnWayToday } from "@/lib/declutter/pickupDay";
import { ProblemOpenNote } from "./DeclutterProblemOpen";
import { OrderGetHelpNow } from "@/components/jobs/GetHelpNow";
import { payoutLine, setupFeeAheadByOrder, setupFeeAheadFromServer, setupFeeUnsureOrders } from "./declutterPayoutWords";
import { payoutAccountReady } from "@/lib/payoutAccountReady";
import { usePayoutSetupPaused } from "@/hooks/usePayoutSetupPaused";
import { ManagerSaleShareGate } from "./ManagerSaleShareGate";
import { useOpenProblemsRead } from "./useOpenProblems";
import { useSellerSetupFee } from "./useSellerSetupFee";
import { DeclutterReviewForm } from "./DeclutterReviewForm";
import { BuyerCheckWindow } from "./BuyerCheckWindow";
import { CancelledOrderNote } from "./CancelledOrderNote";
import { markReviewPrompt } from "@/lib/declutter/reviewPrompt";
import { GotItSheet, GotItWaitsForPorchPhoto, PickedUpPhotoSheet, PickedUpSheet, PutItOutSheet } from "./DeclutterHandoverSheets";
import { MeetupPanel } from "./DeclutterMeetup";
import { noShowFrom, pickupTimeOver, porchDayIsNow, PorchDayPanel, porchPhotoDay } from "./DeclutterPorchDay";
import { OrderPorchPlace } from "./DeclutterPorchPlaces";
import { useOrderOtherPerson } from "./useOrderOtherPerson";
import { BuyerOrderHead, byBucket, refundStanding, type BuyerOrderView } from "./BuyingOrders";
import { fetchRefundRequestView, refundedInFull, refundHoldsTheItem, refundTookItBack } from "@/lib/declutter/refundRequests";
import { declutterErrorMessage } from "@/lib/declutter/errors";
import { orderWhen } from "@/lib/declutter/timeLeft";
import { DoorPickupTips, PickupAddresses, SellerAfterActions } from "./DeclutterOrderBits";
import { currentPosition } from "@/lib/declutter/position";
import { useLinkedOrder, useScrollToLinkedOrder } from "./useLinkedOrder";
// The delivery screens load on their own (Q178, 2026-10-17): imported statically from two Declutter screens, the shared
// Helpr task module rode in signed-in-shared and put /posts over its critical-path budget.
import { DeliveryDoneStatus, onDay, PickupStatus, PorchOutPhoto, SellerDeliveryMoney, SellerDeliveryStatus } from "./DeclutterPorchHandover";
import { gotItOpen, gotItOpensAt, refundIsOpen } from "./OrderSteps";
import { FoldedTimePicker } from "./DeclutterFoldedTime";
import { ProblemForm } from "./DeclutterProblemForm";
import { BookingPanel } from "./DeclutterBookingPanel";
import { DeclutterProblemDecided, DeclutterProblemSides, DeclutterRefundPanel, OrderDeliveryPanel, ReturnLabelPanel, SellerDeliveryOrderPanel, ShipOrderPanel } from "./handoverLazyPanels";
// Seller delivery (20261027153244) loads with its own orders only (Q178).
import { NoShowAnswer, NoShowButton } from "./DeclutterNoShowAnswer";
import { NoHelprChoice } from "./DeclutterNoHelpr";
import { HiddenFileInput } from "@/components/ui/HiddenFileInput";
const AddHelprPanel = lazy(() => import("./DeclutterAddHelpr").then((m) => ({ default: m.AddHelprPanel }))); // Add a Helpr: the buyer's card only (Q178).

/** Every paid order in `cart` (the cart's paid lines). The Buying and Selling tabs pass one side's lines and their own heading (PaidOrders in DeclutterTradeViews). */
export function PaidOrdersSection({ cart, heading, label, views, show }: {
  cart: CartLine[]; heading?: ReactNode; label?: string;
  /** Buying's tracker (BuyingOrders.tsx): each buyer order's steps, chip and one next action. */
  views?: Map<string, BuyerOrderView>;
  /** Which orders the chosen chip shows (all when absent). */
  show?: (orderId: string) => boolean;
}) {
  const { user, profile } = useCurrentUser();
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
  // F360b: the one-time setup fee comes out of a first payout at its send while the ID check is on (never an admin's;
  // declutter_setup_fee_from_payout_cents), so the card's "You get" is the row's amount less it. Read only when it can
  // apply: the seller has not paid it (profiles.onboarding_fee_paid, the SQL's own test) and a payout is still unsent.
  // Read only when a row could take it: a payout still unsent. Unknown inputs (switch, admin check, fee read) hide the
  // unsent rows' figure rather than show one too high by the fee (lh-money-escrow reviews 11-11).
  const setupFee = useSellerSetupFee((payouts.data ?? []).some((p) => p.status === "pending" || p.status === "failed"));
  const feeUnknown = setupFee.unknown;
  const payoutReady = payoutAccountReady(profile);
  const setupPaused = usePayoutSetupPaused();
  // Audit 1b D2-2: an open problem shows on both cards and hides booking and a second report.
  const { problems, settled: problemsSettled } = useOpenProblemsRead(ids);
  // BUY-30: the order a notice opened shows whatever the chip.
  const linked = useLinkedOrder();
  const chosen = show ? orders.filter((o) => show(o.orderId) || o.orderId === linked) : orders;
  // DB-6: on Buying, what needs the buyer comes first and history (Done, Cancelled) last; on Selling (soldstates-2),
  // the sales still to hand over, then handed over, then refunded.
  const shown = views ? byBucket(chosen, views) : liveSalesFirst(chosen);
  if (shown.length === 0 || !userId) return null;
  // Owner 11-11 ~3:25 PM: the server names the one sale the fee comes out of (declutter_my_setup_fee); before it is
  // deployed, the client's own reading (one row only, else no figure).
  const feeAhead = setupFee.server ? setupFeeAheadFromServer(payouts.data ?? [], setupFee.cents, setupFee.orderId)
    : setupFeeAheadByOrder(payouts.data ?? [], setupFee.cents);
  const feeUnsure = setupFee.server ? new Set<string>() : setupFeeUnsureOrders(payouts.data ?? [], setupFee.cents);
  const waitingOnReads = bookings.isLoading || payouts.isLoading;
  if (bookings.isError) {
    return <ErrorState variant="inline" title="We couldn't load your pickups." body={declutterErrorMessage(bookings.error)} onRetry={() => void bookings.refetch()} />;
  }
  return (
    // Audit 11-10 F407: at 1440 each card stretched ~1,590px, the price stranded far from its title; capped like a reading column.
    // F409 (whole-app audit 11-10, measured B3g 11-12): the cards drew before their pickup bookings and payouts
    // answered, then each grew by its booking or payout block (a seeded seller's "Sold" cards went 337 -> 674 px and
    // pushed Offers off screen: Selling CLS 0.42-0.78 at 375). Until both reads answer, the section holds a card's
    // height (16rem, as PaidOrdersLoading's boxes) for each of its first 4 cards, so the cards grow into kept space.
    // Guard: paidOrdersWaitForBookings.
    <section className="max-w-3xl space-y-3" aria-label={label ?? "Paid sales"} data-paid-orders-reserve={waitingOnReads ? "" : undefined}
      style={waitingOnReads ? { minHeight: `${Math.min(4, shown.length) * 16.75 + 2}rem` } : undefined}>
      {heading ?? <h2 className="text-base font-semibold">Paid: pickup and handover</h2>}
      {shown.map((o) => (
        <OrderCard
          key={o.orderId}
          order={o}
          view={views?.get(o.orderId)}
          userId={userId}
          booking={(bookings.data ?? []).find((b) => b.order_id === o.orderId) ?? null}
          payout={(payouts.data ?? []).find((p) => p.order_id === o.orderId) ?? null}
          setupFeeAhead={feeAhead.get(o.orderId) ?? 0}
          holdUnknown={feeUnknown || !problemsSettled || feeUnsure.has(o.orderId)}
          payoutReady={payoutReady}
          setupPaused={setupPaused}
          problem={problems.get(o.orderId) ?? null}
          linked={o.orderId === linked}
        />
      ))}
    </section>
  );
}

function OrderCard({ order, userId, booking, payout, setupFeeAhead = 0, holdUnknown = false, payoutReady = true, setupPaused = true, view, problem, linked }: { order: PaidOrder; userId: string; booking: MyBooking | null; payout: MyPayout | null; setupFeeAhead?: number; holdUnknown?: boolean; payoutReady?: boolean; setupPaused?: boolean; view?: BuyerOrderView; problem: OpenProblem | null; linked: boolean }) {
  const title = order.lines.map((l) => l.item_title).join(", ");
  const items = order.lines.reduce((sum, l) => sum + l.price_cents, 0);
  const done = order.status === "handed_over";
  const cancelled = order.status === "refunded" && order.handover !== "ship" && order.handover !== "delivery"; // F377 (CancelledOrderNote)
  // Lead 11-08: an order from a trade is worded as a trade ("Trade", "Your trade: <item>", "Message about the trade").
  const trade = isTradeOrder(order);
  // Boards 159/160: the other person by first name in the handover sheets; the problem form opens from "Something's not right".
  const { who } = useOrderOtherPerson(order.orderId, userId, order.side);
  // The same row and key HandoverPanel, NoShowButton and NoShowAnswer read: a buyer's no-show report and its 24 hours.
  // F156 (lab 11-09): only a PAID order is asked. declutter_my_handover answers paid and handed-over orders only, so a
  // refunded order's card (enabled: !done) got item_not_found and logged a QueryCache error on every Buying load.
  const handoverRow = useQuery({ queryKey: ["declutter", "handover", order.orderId], queryFn: () => fetchMyHandover(order.orderId),
    // F360b: a seller's handed-over card reads it too, for the payout day (24 hours after confirmed_at).
    enabled: order.status === "paid" || (order.status === "handed_over" && order.side === "seller" && !!payout) });
  const noShowWaiting = !!handoverRow.data?.no_show_reported_at;
  const porchSeller = order.handover === "porch" && order.side === "seller"; // Q2627: its no-show and Report a problem wait for the porch window's end (noShowFrom).
  const [problemOpen, setProblemOpen] = useState(false);
  const [atHandover, setAtHandover] = useState(false); // opened from the "I got it" sheet (D2-11)
  // Board 141 (Declutter side, 20261026155251): ask for / answer a refund in the 24 hours after the handover.
  const refundRequests = useFeature("declutter_refund_requests");
  // Audit BUY-31: the buyer's head line is always on screen, so it reads the refund panel's own query (same key).
  // NIGHT-SELL-soldstates-7: the seller's card too, for a sale refunded in full (the panel reads it anyway).
  const refund = useQuery({
    queryKey: ["declutter", "refund-request", order.orderId],
    queryFn: () => fetchRefundRequestView(order.orderId),
    enabled: done && refundRequests && items > 0,
  });
  const refundStatus = refund.data?.request?.status;
  const fullRefund = refundedInFull(refund.data);
  // F360b loose end (lead 11-11): the sale is final at once when Louisiana Helpr decided a problem or confirmed the
  // handover itself (declutter_sale_decided), so an unsent payout goes in the next run, not 24 hours after the handover.
  // The same read and key as DeclutterProblemDecided. A failed read keeps the 24-hour day (later, never earlier).
  const lastProblem = useQuery({ queryKey: ["declutter", "problem", order.orderId], queryFn: () => fetchOrderProblem(order.orderId),
    enabled: done && order.side === "seller" && !!payout && items > 0 && !problem });
  const saleDecided = lastProblem.data?.status === "decided" || handoverRow.data?.confirmed_by === "admin";
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
  // NIGHT-SELL-soldstates-3 (B18's order): the seller's open pickup sale leads with what to do next. Tracker and line,
  // the pickup and Move, When will it be out, Take the porch photo; THEN the money note and Message the buyer.
  const sellerNextFirst = !view && order.side === "seller" && !done && !cancelled
    && (order.handover === "porch" || order.handover === "pickup_home" || order.handover === "meetup");
  const cardRef = useRef<HTMLElement>(null);
  useScrollToLinkedOrder(cardRef, linked, () => setOpen(true));
  return (
    <article ref={cardRef} tabIndex={linked ? -1 : undefined} data-linked-order={linked ? "" : undefined} className="scroll-mt-3 rounded-[20px] border border-border bg-card p-4 space-y-3">
      <OrderCardHead order={order} userId={userId} />
      {/* Boards 71/72: one tracker, where it stands and the money note, from the real handover row
          (delivery has its own, in OrderDeliveryPanel). */}
      {view && <BuyerOrderHead view={view} standing={problem ? null : refundStanding(refundStatus, fullRefund, refund.data?.request)} refundOpen={refundIsOpen(refundStatus)} open={open} onOpen={() => setOpen(true)} onClose={() => { setOpen(false); setAskGot(false); }}
        onAction={() => { setOpen(true); setAskGot(order.handover === "delivery" && view.action === "I got it"); }} />}
      {problem && view && <ProblemOpenNote problem={problem} side={order.side} answered={!!handoverRow.data?.no_show_reported_at} delivery={order.handover === "seller_delivery"} />}
      {done && !problem && <Suspense fallback={null}><DeclutterProblemDecided orderId={order.orderId} side={order.side} /></Suspense>}
      {/* Outside the folded body: the buyer's notice says "Print it from your order". */}
      {order.side === "buyer" && order.handover === "ship" && (order.status === "handed_over" || order.status === "refunded") && <Suspense fallback={null}><ReturnLabelPanel orderId={order.orderId} /></Suspense>}
      {done && order.side === "buyer" && order.handover === "delivery" && order.deliveryTaskId && <Suspense fallback={null}><OrderDeliveryPanel taskId={order.deliveryTaskId} side="buyer" orderId={order.orderId} tipOnly /></Suspense>}
      {body && <div ref={bodyRef} className="space-y-3" data-order-body="">
      {/* DC-16: ONE sale card: every handover kind shows the tracker, where it stands and the money note (Helpr delivery's is in OrderDeliveryPanel). */}
      {!view && !cancelled && order.handover === "seller_delivery" && <SellerDeliveryStatus orderId={order.orderId} side={order.side} itemsCents={items} problemOpen={!!problem} refunded={fullRefund} />}
      {!view && !cancelled && (order.handover === "porch" || order.handover === "pickup_home" || order.handover === "meetup") && (
        <PickupStatus
          orderId={order.orderId}
          handover={order.handover}
          side={order.side}
          slot={booking?.slot_start ?? null}
          day={booking?.pickup_day ?? null}
          itemsCents={items}
          problemOpen={!!problem}
          refunded={fullRefund}
          part={sellerNextFirst ? "status" : "all"}
          payoutShown={order.side === "seller" && !!payout && items > 0}
        />
      )}
      {/* NIGHT-BUYINGopenpr-8: the same order as the buyer's card: the tracker, then the problem note, then each side. */}
      {problem && !view && <ProblemOpenNote problem={problem} side={order.side} answered={!!handoverRow.data?.no_show_reported_at} delivery={order.handover === "seller_delivery"} />}
      <Suspense fallback={null}><DeclutterProblemSides orderId={order.orderId} side={order.side} /></Suspense>
      {done ? (
        <>
          {/* BUY-31: said once (the buyer's head line; SellerDeliveryStatus to the seller). NIGHT-SELL-soldstates-7: a finished delivery shows the tracker at its end too. */}
          {order.handover === "delivery" && !view && <DeliveryDoneStatus free={items === 0} refunded={fullRefund} />}
          {order.side === "seller" && items > 0 && <ManagerSaleShareGate orderId={order.orderId} itemsCents={items} itemCount={order.lines.length} />}
          {/* An unsent payout's day waits on every hold read: the fee inputs, the open problems, and the refund request
              (declutter_payouts_due holds on an open problem or a running request; a declined one moves the day). */}
          {order.side === "seller" && payout && items > 0 && !((holdUnknown || (refundRequests && !refund.isSuccess) || lastProblem.isLoading) && (payout.status === "pending" || payout.status === "failed")) && <p className="text-sm">{payoutLine(payout, !!problem, {
            handedOverAt: handoverRow.data?.confirmed_at ?? null, refundOpen: refundIsOpen(refundStatus), setupFeeAhead, payoutReady, setupPaused,
            declinedAt: refundStatus === "declined" ? refund.data?.request?.declined_at ?? null : null,
            refundAgreed: refundStatus === "agreed" ? refund.data?.request?.refund_status ?? "unknown" : null, saleDecided, })}
            {payout.status === "failed" && <FailedPayoutLink />}</p>}
          {refundRequests && items > 0 && (
            <Suspense fallback={null}>
              <DeclutterRefundPanel orderId={order.orderId} who={who} problemForm={problem ? null : <ProblemForm orderId={order.orderId} side={order.side} stage="handover" triggerLabel="Ask Louisiana Helpr to look" />} />
            </Suspense>
          )}
          {order.side === "buyer" && !refundRequests && !problem && <BuyerCheckWindow orderId={order.orderId} />}
          <DeclutterReviewForm orderId={order.orderId} side={order.side} userId={userId} refundPanel={!!refundRequests && items > 0} problemOpen={!!problem} />
        </>
      ) : cancelled ? (
        <CancelledOrderNote side={order.side} userId={userId} itemIds={order.lines.map((l) => l.item_id)} />
      ) : order.handover === "seller_delivery" ? (
        <>
          {/* 20261027153244: the seller brings it at the time the buyer picked. */}
          <Suspense fallback={<HelprSpinner />}>
            <SellerDeliveryOrderPanel orderId={order.orderId} userId={userId} trade={trade} onProblem={() => setProblemOpen(true)} problemOpen={!!problem && problem.reporter_side !== "system"} />
          </Suspense>
          {!problem && <NoShowAnswer orderId={order.orderId} side={order.side} delivery free={order.lines.every((l) => l.price_cents === 0)} />}
          {!problem && <ProblemForm orderId={order.orderId} side={order.side} stage="delivery" open={problemOpen} onOpenChange={setProblemOpen} trigger={false} />}
        </>
      ) : order.handover === "ship" ? (
        // B134: a shipped order has no pickup to book; the seller prints, packs and drops it off, the buyer tracks it.
        <Suspense fallback={<HelprSpinner />}><ShipOrderPanel orderId={order.orderId} side={order.side} /></Suspense>
      ) : order.handover === "delivery" ? (
        <>
          {/* Slice 5: a Helpr picks it up and brings it; the task shows its progress. D-NEW14: where, for the seller. */}
          {order.side === "seller" && <OrderPorchPlace orderId={order.orderId} side="seller" />}
          {order.side === "seller" && <SellerDeliveryMoney itemsCents={items} problemOpen={!!problem} />}
          {order.deliveryTaskId
            ? <Suspense fallback={<HelprSpinner />}><OrderDeliveryPanel taskId={order.deliveryTaskId} side={order.side} orderId={order.orderId} askGot={askGot} problemForm={!problem} /></Suspense>
            : <p className="text-sm text-muted-foreground">Finding a Helpr for this delivery.</p>}
          {/* BUY-22 / D2-9: the panel holds "Report a problem" until a Helpr has it or their pickup time is over
              (deliveryProblemTimeCame); still finding a Helpr, none. */}
        </>
      ) : (
        <>
          {/* D-NEW11: the seller's side of "I'm on my way". The notice can be missed; the card says it too. */}
          {order.side === "seller" && !problem && buyerOnWayToday(booking) && (
            <p className="text-sm font-semibold text-[hsl(var(--sage-ink))]" role="status" data-buyer-on-way="">Your buyer is on the way.</p>
          )}
          {/* Q2425: a safe-spot meetup shows the public place, never the seller's home address. */}
          {order.side === "buyer" && order.handover !== "meetup" && <PickupAddresses lines={order.lines} />}
          {order.handover === "porch" && <OrderPorchPlace orderId={order.orderId} side={order.side} />}
          {/* LEAD-PLACE-TIMES (owner 2026-10-31): porch day+time inside the checkout place's frozen hours (BookingPanel,
              declutter_order_pickup_windows / declutter_book_pickup); a porch DAY booked under the 10-28 design keeps its card. */}
          {/* D2-2: no booking while a problem is open (the server refuses it: problem_open). */}
          {/* T9: while the seller has their 24 hours the time stands (the server refuses a move: no_show_waiting). */}
          {/* BUY-2 (owner 10-31): no Helpr took the delivery; the buyer may cancel instead (the buyer bears the card fee). A
              pickup order with a delivery fee is one (CartLine.delivery_cents is kept after the no-Helpr fallback). */}
          {order.side === "buyer" && order.handover === "pickup_home" && order.lines.some((l) => (l.delivery_cents ?? 0) > 0) && !booking?.slot_start && !problem && <NoHelprChoice orderId={order.orderId} />}
          {problem ? null : noShowWaiting ? <BookingPanel order={order} booking={booking} frozen /> : order.handover === "porch" && booking?.pickup_day
            ? <PorchDayPanel orderId={order.orderId} side={order.side} booking={booking} fallback={<BookingPanel order={order} booking={booking} />}
                noDays={<ProblemForm orderId={order.orderId} side={order.side} stage="waiting" />} />
            : <BookingPanel order={order} booking={booking}
                noTimes={order.handover === "porch" && order.side === "buyer" ? <ProblemForm orderId={order.orderId} side={order.side} stage="waiting" /> : null} />}
          {order.handover === "meetup" && <MeetupPanel orderId={order.orderId} side={order.side} slotStart={booking?.slot_start ?? null} />}
          {/* NIGHT-BUYINGopenpr-7: door tips only for a pickup still to come; a held order says what happens instead. */}
          {order.handover === "pickup_home" && !problem && !noShowWaiting && <DoorPickupTips side={order.side} />}
          {/* F378: the buyer's "Report it before you take your pickup photo" has its button; it opens the card's form below. */}
          {order.handover === "porch" && <PorchOutPhoto orderId={order.orderId} side={order.side} onProblem={problem ? undefined : () => { setAtHandover(true); setProblemOpen(true); }} />}
          {booking?.slot_start && order.handover === "porch" && <PorchPanel order={order} userId={userId} booking={booking} who={who} held={!!problem} />}
          {booking?.slot_start && <HandoverPanel order={order} userId={userId} slotStart={booking.slot_start} anyProblem={!!problem} who={who} problemOpen={!!problem && problem.reporter_side !== "system"} onProblem={() => { setAtHandover(true); setProblemOpen(true); }} />}
          {booking?.slot_start && !problem && <NoShowButton order={order} slotStart={noShowFrom(booking, porchSeller) ?? booking.slot_start} who={who} />}
          {booking?.slot_start && !problem && <NoShowAnswer orderId={order.orderId} side={order.side} delivery={false} free={order.lines.every((l) => l.price_cents === 0)} />}
          {sellerNextFirst && <SellerAfterActions order={order} booking={booking} itemsCents={items} problemOpen={!!problem} refunded={fullRefund} />}
          {/* D2-9 (owner 2026-10-29): no "Report a problem" button until the booked pickup is over (pickupTimeOver). D2-2: none while a problem is open. */}
          {!problem && <ProblemForm orderId={order.orderId} side={order.side} stage={atHandover ? "handover" : "waiting"} open={problemOpen}
            onOpenChange={(o) => { setProblemOpen(o); if (!o) setAtHandover(false); }} trigger={pickupTimeOver(booking, Date.now(), porchSeller)} />}
        </>
      )}
      {order.side === "buyer" && order.handover !== "ship" && <Suspense fallback={null}><AddHelprPanel orderId={order.orderId} handedOver={done} bookedOnly={!!problem || refundHoldsTheItem(refundStatus) || refundTookItBack(refund.data?.request) || fullRefund} /></Suspense>}
      {/* D2-1: the paid order's chat (DeclutterOrderTalk, ?order_talk=). F397 (audit 1110): "Message the buyer" jumped around
          by stage; it is now the body's LAST control on every card (openpr-8); the open pickup sale keeps it in SellerAfterActions. */}
      {!sellerNextFirst && !(cancelled && order.side === "seller") && <div data-order-talk-row=""><OrderTalkButton orderId={order.orderId} side={order.side} trade={trade} /></div>}
      </div>}
      {/* CMP-3: outside Details, so it is one tap from the card; BUY-22: only on an order with a problem open. */}
      <OrderGetHelpNow order={{ orderId: order.orderId, title, status: order.status }} problemOpen={!!problem} />
    </article>
  );
}

function HandoverPanel({ order, userId, slotStart, anyProblem, who, problemOpen, onProblem }: { order: PaidOrder; userId: string; slotStart: string; anyProblem: boolean; who: string; problemOpen: boolean; onProblem: () => void }) {
  const qc = useQueryClient();
  // BUY-17 (owner 11-03): a porch buyer's "I got it" waits for the porch photo (set_out_at) whatever the day; see
  // GotItWaitsForPorchPhoto. The same handover row and key PorchOutPhoto reads, so nothing is read twice.
  const porchBuyer = order.side === "buyer" && order.handover === "porch";
  const doorSeller = order.side === "seller" && (order.handover === "pickup_home" || order.handover === "meetup");
  const handoverRow = useQuery({ queryKey: ["declutter", "handover", order.orderId], queryFn: () => fetchMyHandover(order.orderId), enabled: porchBuyer || doorSeller });
  const porchReady = !porchBuyer || !!handoverRow.data?.set_out_at;
  // #6: a free claim has no payment, payout or refund to speak of.
  const free = order.lines.every((l) => l.price_cents === 0);
  // LEAD-DOOR-PAYLINE: when the seller is paid is said once, in the sale card's money note (sellerPayoutRule, owner
  // 10-30 "Declutter handover money"). This line said it again and read as "paid 24 hours after Picked up". A free
  // claim has no money note, so it says what finishes the handover.
  const rule = (how: string) => free ? <p className="text-sm text-muted-foreground">The handover is when {how}.</p> : null;
  const [photo, setPhoto] = useState<File | null>(null);
  const [asking, setAsking] = useState(false);
  const confirm = useMutation({
    mutationFn: () => confirmHandover(order.orderId),
    onSuccess: () => {
      markReviewPrompt(order.orderId);
      toast("Handover done. Enjoy your item.");
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
      setPhoto(null);
      setAsking(false);
      invalidate(qc, order.orderId);
    },
    onError: (err) => toast.error(declutterErrorMessage(err)),
  });
  if (order.side === "seller") {
    // NIGHT-BUYINGopenpr-4: nothing about when the seller is paid while a problem holds the money (the card's note says so).
    // T9: any open problem, the 60-day one too: the server refuses "Picked up" then (problem_open).
    if (anyProblem) return null;
    // Q2425: at a safe meeting spot the seller hands it over as at the door ("Picked up").
    if (order.handover !== "pickup_home" && order.handover !== "meetup") {
      return rule('the buyer taps "I got it" or takes their pickup photo, or 24 hours after the later of the pickup time and your porch photo, if no problem is reported');
    }
    const fileId = `dcl-door-${order.orderId}`;
    // Q2632 (audit 1102c R7): at a safe meeting spot the seller hands it over: "Handed over", "from the meeting time".
    const meet = order.handover === "meetup";
    const done = meet ? "Handed over" : "Picked up";
    const from = meet ? "the meeting time" : "the pickup time";
    // A buyer's no-show report: the card's answer is the seller's way forward (the server refuses Picked up: no_show_reported).
    if (handoverRow.data?.no_show_reported_at) return null;
    // Owner 10-30: the seller's word waits for the buyer. Said once; toasts for a confirmation show nothing (toastPolicy).
    if (handoverRow.data?.seller_confirmed_at && !free) {
      return <p role="status" className="text-sm text-foreground" data-seller-confirmed="">{`You said it was ${meet ? "handed over" : "picked up"}. We asked the buyer to confirm. If they don't say anything, you're paid in about 48 hours. If they report a problem, Louisiana Helpr decides.`}</p>;
    }
    // From the booked time only (the server checks again: before_pickup_time).
    if (Date.now() < new Date(slotStart).getTime()) {
      return free ? rule(`the buyer taps "I got it" or you tap "${done}", from ${from}`)
        : <p className="text-sm text-muted-foreground">{`You can tap "${done}" from ${from}.`}</p>;
    }
    return (
      <div className="space-y-2">
        {rule(`the buyer taps "I got it" or you tap "${done}"`)}
        <label htmlFor={fileId} className="block text-xs font-medium">Photo of the handover (optional, taken where you hand it over)</label>
        <PhotoPickButton id={fileId} picked={photo} disabled={pickedUp.isPending} onPick={setPhoto} />
        <Button type="button" variant="primary" size="sm" disabled={pickedUp.isPending} onClick={() => setAsking(true)}>
          {done}
        </Button>
        <PickedUpSheet open={asking} onOpenChange={setAsking} who={who} free={free} pending={pickedUp.isPending} onConfirm={() => pickedUp.mutate()} label={done} />
      </div>
    );
  }
  // Audit 1030 DB-2: no "I got it" while a problem is open (the server refuses it: problem_open); the card's note says why.
  if (problemOpen) return null;
  if (!porchReady) {
    return <GotItWaitsForPorchPhoto orderId={order.orderId} />;
  }
  // Audit 1030 DB-3: at a safe meeting spot or a door pickup "I got it" opens an hour before the booked time, as
  // "I'm here" does (the server refuses it before then: got_it_too_early, 20261030061753; declutter_meetup_rules()
  // here_from_minutes_before).
  if ((order.handover === "meetup" || order.handover === "pickup_home") && !gotItOpen(slotStart)) {
    // Audit 11-10 F384: say WHEN the button appears, not only "an hour before".
    return <p className="text-sm text-muted-foreground" data-got-it-wait="">The "I got it" button appears {orderWhen(gotItOpensAt(slotStart))}, an hour before the {order.handover === "meetup" ? "meeting" : "pickup"} time.</p>;
  }
  // Audit 1028 D1-12: its own block, so "I got it" never sits edge to edge with "Report a problem" below it.
  return (
    <div>
      <Button type="button" variant="primary" size="sm" disabled={confirm.isPending} onClick={() => setAsking(true)}>
        I got it
      </Button>
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

function PorchPanel({ order, userId, booking, who, held }: { order: PaidOrder; userId: string; booking: MyBooking; who: string; held: boolean }) {
  const qc = useQueryClient();
  const free = order.lines.every((l) => l.price_cents === 0); // #6: no pay words on a free claim
  // LEAD-PORCH-SR: while a problem holds the money, the photo pays nobody; its label and hint stop saying it does.
  const payWords = !free && !held;
  // Board 159: the seller checks the porch photo in "Put it out" before sending it.
  const [preview, setPreview] = useState<File | null>(null);
  // Audit 1028 D1-5: once the seller's porch photo is in, the card stops asking for it (a retake stays possible).
  // D1-4: before the booked day the server refuses the photo (porch_day_not_yet), so the card says the day instead.
  // The same handover row and key PorchOutPhoto reads.
  const seller = order.side === "seller";
  // BUY-5: the buyer's side reads it too (HandoverPanel already does, same key): the pickup photo waits like "I got it".
  const handoverRow = useQuery({ queryKey: ["declutter", "handover", order.orderId], queryFn: () => fetchMyHandover(order.orderId) });
  const posted = seller && !!handoverRow.data?.set_out_at;
  // Q2626: a porch TIME counts too: its day is the slot's (porchPhotoDay, the server's rule).
  const photoDay = porchPhotoDay(booking);
  const notYet = seller && !posted && !!photoDay && !porchDayIsNow(photoDay);
  // BUY-5/BUY-17: the buyer's pickup photo finishes the sale like "I got it", so it waits for the porch photo whatever
  // the day, the same rule as HandoverPanel's porchReady (porch_photo_not_in on the server, 20261103202118).
  const buyerWaits = !seller && !handoverRow.data?.set_out_at;
  const [shot, setShot] = useState<File | null>(null);
  const timing = useMutation({
    mutationFn: (v: { mode: "all_day" | "until"; iso: string | null }) => setPorchTime(order.orderId, v.mode, v.iso),
    onSuccess: () => { toast("Saved."); invalidate(qc, order.orderId); },
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
      setShot(null);
      if (r.result === "set_out") toast(r.noteProblem ? `Left on porch. The buyer is told. ${r.noteProblem}` : "Left on porch. The buyer is told.");
      else if (free) toast("Picked up. Enjoy it.");
      else if (r.paid === false) toast("Picked up. A problem report is open, so Louisiana Helpr decides before anyone is paid.");
      else toast("Picked up. If something is wrong, you can ask for a refund within 24 hours.");
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
            <Button type="button" variant="outline" size="sm" disabled={timing.isPending} onClick={() => timing.mutate({ mode: "all_day", iso: null })}>Out all day</Button>
            <FoldedTimePicker id={`dcl-out-${order.orderId}`} openLabel="Out until a time…" title="Out until" fieldLabel="Out until"
              confirmLabel="Out until then" pending={timing.isPending} onConfirm={(iso) => timing.mutate({ mode: "until", iso })} />
          </div>
        </>
      )}
      {buyerWaits ? null : notYet ? (
        // Night audit sold states #3: the card's status line already says "Put it out <day> and post the porch photo";
        // this one says only what is not there yet.
        <p className="text-sm" data-porch-not-yet="">You can take the porch photo {onDay(photoDay as string)}.</p>
      ) : (<>
      <label htmlFor={fileId} className="sr-only">
        {order.side === "seller" ? `Photo of the item on your porch ("Left on porch"${payWords ? ": needed before you can be paid automatically)" : ")"}` : `Photo when you pick it up, taken at the address ("Picked up"${payWords ? ": this pays the seller 24 hours later)" : ")"}`}
      </label>
      {/* The shops' handover pattern (ShopHandoverActions): a hidden camera input opened by a real button. */}
      <HiddenFileInput id={fileId} accept="image/*" capture="environment" tabIndex={-1} disabled={photo.isPending}
        onChange={(e) => { const f = e.target.files?.[0]; if (f) { if (order.side === "seller") setPreview(f); else setShot(f); } e.target.value = ""; }} />
      <Button type="button" variant={order.side === "seller" && !posted ? "primary" : "outline"} size="sm" disabled={photo.isPending}
        onClick={() => document.getElementById(fileId)?.click()}>
        {photo.isPending ? "Saving…" : order.side === "seller" ? (posted ? "Retake the porch photo" : "Take the porch photo") : "Take your pickup photo"}
      </Button>
      {!posted && (
        <p className="text-ds-12 text-muted-foreground">
          {order.side === "seller" ? `One photo where the buyer will find it, taken at your address.${payWords ? " You need it before you can be paid automatically." : ""}` : `Taken at the address. It tells the seller you have it${payWords ? "; they're paid 24 hours later." : "."}`}
        </p>
      )}
      {!seller && (
        <PickedUpPhotoSheet file={shot} who={who} free={free} pending={photo.isPending}
          onSend={(f) => photo.mutate({ file: f })} onRetake={() => document.getElementById(fileId)?.click()} onClose={() => setShot(null)} />
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
