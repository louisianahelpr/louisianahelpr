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
 *   - "Report a problem" until the seller is paid (rows 15, 67, 96),
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
import { useMutation, useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ErrorState } from "@/components/ui/ErrorState";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { useFeature } from "@/hooks/useFeature";
import type { CartLine } from "@/lib/declutter/api";
import {
  bookPickup,
  confirmHandover,
  fetchItemAddress,
  fetchMyBookings,
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
  type ProblemReason,
} from "@/lib/declutter/handover";
import { DeclutterReviewForm } from "./DeclutterReviewForm";
import { GotItSheet, NoShowSheet, PickedUpSheet, PutItOutSheet } from "./DeclutterHandoverSheets";
import { MeetupPanel } from "./DeclutterMeetup";
import { useOrderOtherPerson } from "./useOrderOtherPerson";
import { declutterErrorMessage } from "@/lib/declutter/errors";
import { formatPrice } from "@/lib/declutter/distance";
import { currentPosition } from "@/lib/declutter/position";
// The delivery screens load on their own (Q178, 2026-10-17): imported statically
// from two Declutter screens, the shared Helpr task module rode in
// signed-in-shared and put /posts over its critical-path budget.
import { PickupStatus, PorchOutPhoto } from "./DeclutterPorchHandover";
import { DateTimeField } from "@/components/DateTimeField";
const OrderDeliveryPanel = lazy(() => import("./DeclutterDeliveryViews").then((m) => ({ default: m.OrderDeliveryPanel })));
// Seller delivery (20261027153244) loads with its own orders only (Q178).
const SellerDeliveryOrderPanel = lazy(() => import("./SellerDeliveryOrder").then((m) => ({ default: m.SellerDeliveryOrderPanel })));
// Add a Helpr loads with the buyer's order card only (Q178: off /posts' critical path).
const AddHelprPanel = lazy(() => import("./DeclutterAddHelpr").then((m) => ({ default: m.AddHelprPanel })));
// Board 141 (Declutter side): the refund request after the handover loads with a handed-over order only.
const DeclutterRefundPanel = lazy(() => import("./DeclutterRefundRequest").then((m) => ({ default: m.DeclutterRefundPanel })));

const btn = "rounded-full border border-border px-4 py-2 text-sm font-semibold";
const primary = "btn-grad-primary rounded-full px-4 py-2 text-sm font-semibold";
const input = "w-full rounded-lg border border-input bg-background px-3 py-2 text-sm";

/** One paid order as the cart lists it (its lines share order_id). */
interface PaidOrder {
  orderId: string;
  side: "buyer" | "seller";
  handover: string | null;
  status: string | null;
  lines: CartLine[];
  /** Slice 5: the Helpr task of a delivery order. */
  deliveryTaskId: string | null;
}

/** Group the cart's paid lines into orders. */
function paidOrdersFromCart(cart: CartLine[]): PaidOrder[] {
  const byOrder = new Map<string, PaidOrder>();
  for (const l of cart) {
    if (l.status !== "paid" || !l.order_id) continue;
    const o = byOrder.get(l.order_id) ?? {
      orderId: l.order_id, side: l.my_side, handover: l.handover, status: l.order_status, lines: [], deliveryTaskId: l.delivery_task_id ?? null,
    };
    o.lines.push(l);
    byOrder.set(l.order_id, o);
  }
  return [...byOrder.values()];
}

const when = (iso: string) => new Date(iso).toLocaleString([], { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

/** `<input type="datetime-local">` value -> ISO (the device's own time zone). */
function localInputToIso(v: string): string | null {
  if (!v) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

function invalidate(qc: ReturnType<typeof useQueryClient>, orderId: string) {
  void qc.invalidateQueries({ queryKey: ["declutter", "my-cart"] });
  void qc.invalidateQueries({ queryKey: ["declutter", "bookings"] });
  void qc.invalidateQueries({ queryKey: ["declutter", "handover", orderId] });
  void qc.invalidateQueries({ queryKey: ["declutter", "payouts"] });
}

/**
 * Every paid order in `cart` (the cart's paid lines). The Buying and Selling
 * tabs pass one side's lines and their own heading (PaidOrders in DeclutterTradeViews).
 */
export function PaidOrdersSection({ cart, heading, label }: { cart: CartLine[]; heading?: ReactNode; label?: string }) {
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
  if (orders.length === 0 || !userId) return null;
  if (bookings.isError) {
    return <ErrorState variant="inline" title="We couldn't load your pickups." body={declutterErrorMessage(bookings.error)} onRetry={() => void bookings.refetch()} />;
  }
  return (
    <section className="space-y-3" aria-label={label ?? "Paid sales"}>
      {heading ?? <h2 className="text-base font-semibold">Paid: pickup and handover</h2>}
      {orders.map((o) => (
        <OrderCard
          key={o.orderId}
          order={o}
          userId={userId}
          booking={(bookings.data ?? []).find((b) => b.order_id === o.orderId) ?? null}
          payout={(payouts.data ?? []).find((p) => p.order_id === o.orderId) ?? null}
        />
      ))}
    </section>
  );
}

const PAYOUT_WORDS: Record<MyPayout["status"], string> = {
  // 141d: the payout waits until the sale is final (20261026155251).
  pending: "We send it once the sale is final: 24 hours after the handover, unless the buyer asks for a refund.",
  failed: "Your payout didn't go through yet. We'll keep trying. Check that your payout account is set up.",
  succeeded: "Paid to your payout account. Banks usually show it in 2 business days.",
  nothing_due: "Nothing to pay out: this sale covered an amount you owed from an earlier refund.",
};

/**
 * What the payout is made of: "after the buyer's refund" (board 141d), or
 * "($30.00 + $15.00 delivery minus $1.50 you owed)". A seller delivery's rate is
 * paid with the items (20261027153244), so the payout is items + rate - refunded - debt,
 * each read from the row's own columns. A free delivery adds no delivery part.
 */
function payoutBreakdown(p: Pick<MyPayout, "items_cents" | "delivery_cents" | "refunded_cents" | "debt_cents">): string {
  if ((p.refunded_cents ?? 0) > 0) return " after the buyer's refund";
  const rate = p.delivery_cents ?? 0;
  if (rate <= 0 && p.debt_cents <= 0) return "";
  const parts = rate > 0 ? `${formatPrice(p.items_cents)} + ${formatPrice(rate)} delivery` : formatPrice(p.items_cents);
  return p.debt_cents > 0 ? ` (${parts} minus ${formatPrice(p.debt_cents)} you owed)` : ` (${parts})`;
}

function OrderCard({ order, userId, booking, payout }: { order: PaidOrder; userId: string; booking: MyBooking | null; payout: MyPayout | null }) {
  const title = order.lines.map((l) => l.item_title).join(", ");
  const items = order.lines.reduce((sum, l) => sum + l.price_cents, 0);
  const done = order.status === "handed_over";
  // Boards 159/160: the other person by first name in the handover sheets; the problem form opens from "Something's not right".
  const { who } = useOrderOtherPerson(order.orderId, userId, order.side);
  const [problemOpen, setProblemOpen] = useState(false);
  // Board 141 (Declutter side, 20261026155251): ask for / answer a refund in the 24 hours after the handover.
  const refundRequests = useFeature("declutter_refund_requests");
  return (
    <article className="rounded-[20px] border border-border bg-card p-4 space-y-3">
      {/* Board 47 / 26 mine card: title, the price in money ink, ONE line saying how it's coming and which side you are. */}
      <div className="flex items-start justify-between gap-3 min-w-0" data-order-head="">
        <div className="min-w-0">
          <p className="truncate text-ds-15 font-semibold" title={title}>{title}</p>
          <p className="text-ds-13 text-muted-foreground">
            {order.handover === "porch" ? "Porch pickup" : order.handover === "delivery" ? "Helpr delivery" : order.handover === "seller_delivery" ? "Seller delivers" : order.handover === "meetup" ? "Meet at a safe spot" : "Pickup at the seller's home"} · {order.side === "buyer" ? "You're buying" : "You're selling"}
          </p>
        </div>
        <span className="shrink-0 text-ds-15 font-bold tabular-nums text-[hsl(var(--burnt-sienna))]">{formatPrice(items)}</span>
      </div>
      {/* Boards 71/72: one tracker, where it stands and the money note, from the real handover row
          (delivery has its own, in OrderDeliveryPanel). */}
      {(order.handover === "porch" || order.handover === "pickup_home") && (
        <PickupStatus
          orderId={order.orderId}
          handover={order.handover}
          side={order.side}
          slot={booking?.slot_start ?? null}
          itemsCents={items}
          totalCents={order.lines[0]?.total_cents ?? null}
        />
      )}
      {done ? (
        <>
          {(order.handover === "delivery" || order.handover === "seller_delivery") && <p className="text-sm font-medium">Handed over.</p>}
          {order.side === "seller" && payout && (
            <p className="text-sm">
              {formatPrice(payout.amount_cents)}
              {payoutBreakdown(payout)}. {PAYOUT_WORDS[payout.status]}
            </p>
          )}
          {refundRequests && (
            <Suspense fallback={null}>
              <DeclutterRefundPanel orderId={order.orderId} who={who} problemForm={<ProblemForm orderId={order.orderId} />} />
            </Suspense>
          )}
          <DeclutterReviewForm orderId={order.orderId} side={order.side} userId={userId} />
        </>
      ) : order.handover === "seller_delivery" ? (
        <>
          {/* 20261027153244: the seller brings it at the time the buyer picked. */}
          <Suspense fallback={<HelprSpinner />}>
            <SellerDeliveryOrderPanel orderId={order.orderId} userId={userId} onProblem={() => setProblemOpen(true)} />
          </Suspense>
          <ProblemForm orderId={order.orderId} open={problemOpen} onOpenChange={setProblemOpen} />
        </>
      ) : order.handover === "delivery" ? (
        <>
          {/* Slice 5: a Helpr picks it up and brings it; the task shows its progress. */}
          {order.deliveryTaskId
            ? <Suspense fallback={<HelprSpinner />}><OrderDeliveryPanel taskId={order.deliveryTaskId} side={order.side} orderId={order.orderId} /></Suspense>
            : <p className="text-sm text-muted-foreground">Finding a Helpr for this delivery.</p>}
          <ProblemForm orderId={order.orderId} />
        </>
      ) : (
        <>
          {/* Q2425: a safe-spot meetup shows the public place, never the seller's home address. */}
          {order.side === "buyer" && order.handover !== "meetup" && <PickupAddresses lines={order.lines} />}
          <BookingPanel order={order} booking={booking} />
          {order.handover === "meetup" && <MeetupPanel orderId={order.orderId} side={order.side} slotStart={booking?.slot_start ?? null} />}
          {order.handover === "pickup_home" && <DoorPickupTips side={order.side} />}
          {order.handover === "porch" && <PorchOutPhoto orderId={order.orderId} side={order.side} />}
          {booking?.slot_start && order.handover === "porch" && <PorchPanel order={order} userId={userId} booking={booking} who={who} />}
          {booking?.slot_start && <HandoverPanel order={order} userId={userId} slotStart={booking.slot_start} who={who} onProblem={() => setProblemOpen(true)} />}
          {booking?.slot_start && <NoShowButton order={order} slotStart={booking.slot_start} who={who} />}
          <ProblemForm orderId={order.orderId} open={problemOpen} onOpenChange={setProblemOpen} />
        </>
      )}
      {order.side === "buyer" && <Suspense fallback={null}><AddHelprPanel orderId={order.orderId} /></Suspense>}
    </article>
  );
}

/**
 * The exact address is stored per ITEM, so a multi-item order can have more
 * than one (authz review 2.7): every line's address is read, and each distinct
 * address is listed with the items picked up there.
 */
function PickupAddresses({ lines }: { lines: CartLine[] }) {
  const results = useQueries({
    // A line whose listing is gone (its seller deleted their account, Q2307) has no address to read.
    queries: lines.map((l) => ({ queryKey: ["declutter", "address", l.item_id], queryFn: () => (l.item_id ? fetchItemAddress(l.item_id) : Promise.resolve(null)) })),
  });
  const failed = results.find((r) => r.isError);
  // An error with a retry (audit 2026-10-28: the pickup address failing was one line with no way to try again).
  if (failed) return <ErrorState variant="inline" title="We couldn't load the pickup address." body={declutterErrorMessage(failed.error)} onRetry={() => void failed.refetch()} />;
  const byAddress = new Map<string, string[]>();
  results.forEach((r, i) => {
    const a = r.data?.pickup_address;
    if (a) byAddress.set(a, [...(byAddress.get(a) ?? []), lines[i].item_title]);
  });
  if (byAddress.size === 0) return null;
  if (byAddress.size === 1) {
    const [only] = byAddress.keys();
    return <p className="text-sm">Pickup address: <span className="font-medium">{only}</span></p>;
  }
  return (
    <div className="text-sm">
      <p>These items are picked up at different addresses:</p>
      <ul className="mt-1 list-disc space-y-1 pl-5">
        {[...byAddress.entries()].map(([a, titles]) => (
          <li key={a}><span className="font-medium">{a}</span> ({titles.join(", ")})</li>
        ))}
      </ul>
    </div>
  );
}

function BookingPanel({ order, booking }: { order: PaidOrder; booking: MyBooking | null }) {
  const qc = useQueryClient();
  const [value, setValue] = useState("");
  const book = useMutation({
    mutationFn: (iso: string) => bookPickup(order.orderId, iso),
    onSuccess: (r) => {
      toast.success(r.result === "booked" ? "Pickup booked." : "Pickup time changed.");
      setValue("");
      invalidate(qc, order.orderId);
    },
    onError: (err) => toast.error(declutterErrorMessage(err)),
  });
  const booked = booking?.slot_start;
  if (!booked && order.side === "seller") {
    return <p className="text-sm text-muted-foreground">Waiting for the buyer to book a pickup time (within 7 days of paying).</p>;
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
      <label htmlFor={id} className="block text-xs font-medium">{booked ? "Move it (once each)" : "Pick a pickup time"}</label>
      <div className="space-y-2">
        <DateTimeField id={id} label={booked ? "New pickup time" : "Pickup time"} value={value} onChange={setValue} />
        <button
          type="button"
          className={booked ? btn : primary}
          disabled={book.isPending || !localInputToIso(value)}
          onClick={() => { const iso = localInputToIso(value); if (iso) book.mutate(iso); }}
        >
          {booked ? "Move" : "Book"}
        </button>
      </div>
    </div>
  );
}

/** A pickup at the door (big items): short safety tips for both sides (owner 2026-10-18). */
function DoorPickupTips({ side }: { side: "buyer" | "seller" }) {
  return (
    <div className="rounded-xl border border-border p-3 text-xs text-muted-foreground">
      <p className="font-medium text-foreground">Pickup at the door</p>
      <ul className="mt-1 list-disc space-y-0.5 pl-4">
        <li>Pick a daytime slot.</li>
        <li>Bring someone with you{side === "seller" ? ", or have someone home" : ""}.</li>
        <li>Meet at the door; nobody needs to go inside.</li>
        {side === "buyer" && <li>Too big to carry? Add a Helpr below.</li>}
      </ul>
    </div>
  );
}

function HandoverPanel({ order, userId, slotStart, who, onProblem }: { order: PaidOrder; userId: string; slotStart: string; who: string; onProblem: () => void }) {
  const qc = useQueryClient();
  const [photo, setPhoto] = useState<File | null>(null);
  const [asking, setAsking] = useState(false);
  const confirm = useMutation({
    mutationFn: () => confirmHandover(order.orderId),
    onSuccess: () => {
      toast.success("Handover done. Enjoy your item.");
      setAsking(false);
      invalidate(qc, order.orderId);
    },
    onError: (err) => toast.error(declutterErrorMessage(err)),
  });
  const pickedUp = useMutation({
    mutationFn: async () => sellerPickedUp(order.orderId, photo ? await uploadHandoverPhoto(userId, order.orderId, photo) : null),
    onSuccess: () => {
      toast.success("Picked up. You're paid in 24 hours, unless the buyer asks for a refund.");
      setPhoto(null);
      setAsking(false);
      invalidate(qc, order.orderId);
    },
    onError: (err) => toast.error(declutterErrorMessage(err)),
  });
  if (order.side === "seller") {
    // Q2425: at a safe meeting spot the seller hands it over as at the door ("Picked up").
    if (order.handover !== "pickup_home" && order.handover !== "meetup") {
      return (
        <p className="text-sm text-muted-foreground">
          You're paid 24 hours after the handover, unless the buyer asks for a refund. The handover is when the buyer taps "I got it" or takes their pickup photo, or 24 hours after the pickup time if you posted the porch photo and no problem is reported.
        </p>
      );
    }
    const fileId = `dcl-door-${order.orderId}`;
    // From the booked time only (the server checks again: before_pickup_time).
    if (Date.now() < new Date(slotStart).getTime()) {
      return (
        <p className="text-sm text-muted-foreground">
          You're paid 24 hours after the handover, unless the buyer asks for a refund. The handover is when the buyer taps "I got it", or you tap "Picked up" from the pickup time, or 24 hours after the pickup time unless a problem is reported.
        </p>
      );
    }
    return (
      <div className="space-y-2">
        <p className="text-sm text-muted-foreground">
          You're paid 24 hours after the handover, unless the buyer asks for a refund. The handover is when the buyer taps "I got it" or you tap "Picked up", or 24 hours after the pickup time unless a problem is reported.
        </p>
        <label htmlFor={fileId} className="block text-xs font-medium">Photo of the handover (optional)</label>
        <input id={fileId} type="file" accept="image/*" capture="environment" disabled={pickedUp.isPending}
          onChange={(e) => setPhoto(e.target.files?.[0] ?? null)} />
        <button type="button" className={primary} disabled={pickedUp.isPending} onClick={() => setAsking(true)}>
          Picked up
        </button>
        <PickedUpSheet open={asking} onOpenChange={setAsking} who={who} pending={pickedUp.isPending} onConfirm={() => pickedUp.mutate()} />
      </div>
    );
  }
  return (
    <>
      <button type="button" className={primary} disabled={confirm.isPending} onClick={() => setAsking(true)}>
        I got it
      </button>
      <GotItSheet
        open={asking}
        onOpenChange={setAsking}
        orderId={order.orderId}
        porch={order.handover === "porch"}
        who={who}
        pending={confirm.isPending}
        onConfirm={() => confirm.mutate()}
        onProblem={() => { setAsking(false); onProblem(); }}
      />
    </>
  );
}

function PorchPanel({ order, userId, booking, who }: { order: PaidOrder; userId: string; booking: MyBooking; who: string }) {
  const qc = useQueryClient();
  const [until, setUntil] = useState("");
  // Board 159: the seller checks the porch photo in "Put it out" before sending it.
  const [preview, setPreview] = useState<File | null>(null);
  const timing = useMutation({
    mutationFn: (v: { mode: "all_day" | "until"; iso: string | null }) => setPorchTime(order.orderId, v.mode, v.iso),
    onSuccess: () => { toast.success("Saved."); invalidate(qc, order.orderId); },
    onError: (err) => toast.error(declutterErrorMessage(err)),
  });
  const photo = useMutation({
    mutationFn: async ({ file, note }: { file: File; note?: string }) => {
      const path = await uploadHandoverPhoto(userId, order.orderId, file);
      const where = order.side === "buyer" ? await currentPosition() : null;
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
      else if (r.paid === false) toast.success("Picked up. A problem report is open, so Louisiana Helpr decides before anyone is paid.");
      else toast.success("Picked up. If something is wrong, you can ask for a refund within 24 hours.");
      invalidate(qc, order.orderId);
    },
    onError: (err) => toast.error(declutterErrorMessage(err)),
  });
  const fileId = `dcl-porch-${order.orderId}`;
  return (
    <div className="space-y-2">
      {order.side === "seller" && (
        <>
          <p className="text-sm">
            {booking.porch_mode === "all_day" ? "You said it's out all day." : booking.porch_until ? `You said it's out until ${when(booking.porch_until)}.` : "When will it be out?"}
          </p>
          <div className="space-y-2">
            <button type="button" className={btn} disabled={timing.isPending} onClick={() => timing.mutate({ mode: "all_day", iso: null })}>Out all day</button>
            <p className="text-ds-12 text-muted-foreground">Or until a time:</p>
            <DateTimeField id={`dcl-out-${order.orderId}`} label="Out until" value={until} onChange={setUntil} />
            <button type="button" className={btn} disabled={timing.isPending || !localInputToIso(until)}
              onClick={() => timing.mutate({ mode: "until", iso: localInputToIso(until) })}>Out until then</button>
          </div>
        </>
      )}
      <label htmlFor={fileId} className="sr-only">
        {order.side === "seller" ? "Photo of the item on your porch (\"Left on porch\": needed before you can be paid automatically)" : "Photo when you pick it up, taken at the address (\"Picked up\": this pays the seller 24 hours later)"}
      </label>
      {/* The shops' handover pattern (ShopHandoverActions): a hidden camera input opened by a real button. */}
      <input id={fileId} type="file" accept="image/*" capture="environment" className="sr-only" tabIndex={-1} disabled={photo.isPending}
        onChange={(e) => { const f = e.target.files?.[0]; if (f) { if (order.side === "seller") setPreview(f); else photo.mutate({ file: f }); } e.target.value = ""; }} />
      <button type="button" className={order.side === "seller" ? primary : btn} disabled={photo.isPending}
        onClick={() => document.getElementById(fileId)?.click()}>
        {photo.isPending ? "Saving…" : order.side === "seller" ? "Take the porch photo" : "Take your pickup photo"}
      </button>
      <p className="text-ds-12 text-muted-foreground">
        {order.side === "seller" ? "One photo where the buyer will find it. You need it before you can be paid automatically." : "Taken at the address. It tells the seller you have it; they're paid 24 hours later."}
      </p>
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
    <>
      <button type="button" className={btn} disabled={report.isPending} onClick={() => setAsking(true)}>
        They didn't show
      </button>
      <NoShowSheet open={asking} onOpenChange={setAsking} side={order.side} who={who} pending={report.isPending} onConfirm={() => report.mutate()} />
    </>
  );
}

const PROBLEM_WORDS: Record<ProblemReason, string> = {
  not_as_described: "It isn't as described",
  damaged: "It's damaged",
  not_received: "I didn't get it",
  no_show: "Someone didn't show",
  safety: "I felt unsafe",
  other: "Something else",
};

function ProblemForm({ orderId, open: openProp, onOpenChange }: { orderId: string; open?: boolean; onOpenChange?: (open: boolean) => void }) {
  const qc = useQueryClient();
  const [openState, setOpenState] = useState(false);
  // Controlled from the order card when "Something's not right" opens it (board 159).
  const open = openProp ?? openState;
  const setOpen = onOpenChange ?? setOpenState;
  const formRef = useRef<HTMLDivElement>(null);
  useEffect(() => { if (open && openProp) formRef.current?.scrollIntoView?.({ block: "center" }); }, [open, openProp]);
  const [reason, setReason] = useState<ProblemReason>("not_as_described");
  const [note, setNote] = useState("");
  const send = useMutation({
    mutationFn: () => reportProblem(orderId, reason, note.trim(), []),
    onSuccess: () => {
      toast.success("Reported. Nobody is paid until Louisiana Helpr decides.");
      setOpen(false);
      setNote("");
      invalidate(qc, orderId);
    },
    onError: (err) => toast.error(declutterErrorMessage(err)),
  });
  if (!open) return <button type="button" className={btn} onClick={() => setOpen(true)}>Report a problem</button>;
  return (
    <div ref={formRef} className="space-y-2 rounded-xl border border-border p-3">
      <label htmlFor={`dcl-reason-${orderId}`} className="block text-xs font-medium">What went wrong?</label>
      <select id={`dcl-reason-${orderId}`} className={input} value={reason} onChange={(e) => setReason(e.target.value as ProblemReason)}>
        {(Object.keys(PROBLEM_WORDS) as ProblemReason[]).map((r) => <option key={r} value={r}>{PROBLEM_WORDS[r]}</option>)}
      </select>
      <label htmlFor={`dcl-note-${orderId}`} className="block text-xs font-medium">Tell us what happened</label>
      <textarea id={`dcl-note-${orderId}`} className={input} maxLength={1000} rows={3} value={note} onChange={(e) => setNote(e.target.value)} />
      <div className="flex gap-2">
        <button type="button" className={primary} disabled={send.isPending || !note.trim()} onClick={() => send.mutate()}>Send</button>
        <button type="button" className={btn} onClick={() => setOpen(false)}>Not now</button>
      </div>
    </div>
  );
}
