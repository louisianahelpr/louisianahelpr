/**
 * The screens of Declutter slice 4 (docs/specs/declutter-auctions.md rows 14-15,
 * 18-19, 25-28, 45, 52, 93-99; B49-B58): what happens after the buyer paid.
 * One card per paid order, for both sides:
 *   - the exact pickup address (the paid buyer, row 98),
 *   - book / move the 30-minute pickup (buyer books first; each side may move
 *     it once; 7-day deadline),
 *   - pickup at home: the buyer's 4-digit handover code and "I got it"; the
 *     seller types the code (rows 25, 28, 93),
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
 * NOT BUILT (needs a dependency decision first, see the handoff): drawing the
 * QR and scanning it with the camera. The 4-digit code does the same job.
 */
import { useState } from "react";
import { useMutation, useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ErrorState } from "@/components/ui/ErrorState";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import type { CartLine } from "@/lib/declutter/api";
import {
  bookPickup,
  confirmHandover,
  fetchItemAddress,
  fetchMyBookings,
  fetchMyHandover,
  fetchMyPayouts,
  leaveReview,
  porchPhoto,
  reportNoShow,
  reportProblem,
  setPorchTime,
  uploadHandoverPhoto,
  type MyBooking,
  type MyPayout,
  type ProblemReason,
} from "@/lib/declutter/handover";
import { declutterErrorMessage } from "@/lib/declutter/errors";
import { formatPrice } from "@/lib/declutter/distance";
import { isNativePlatform } from "@/lib/nativeInit";

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
}

/** Group the cart's paid lines into orders. */
function paidOrdersFromCart(cart: CartLine[]): PaidOrder[] {
  const byOrder = new Map<string, PaidOrder>();
  for (const l of cart) {
    if (l.status !== "paid" || !l.order_id) continue;
    const o = byOrder.get(l.order_id) ?? { orderId: l.order_id, side: l.my_side, handover: l.handover, status: l.order_status, lines: [] };
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

async function currentPosition(): Promise<{ lat: number; lng: number }> {
  if (isNativePlatform) {
    const { Geolocation } = await import("@capacitor/geolocation");
    const pos = await Geolocation.getCurrentPosition({ enableHighAccuracy: true, timeout: 12_000 });
    return { lat: pos.coords.latitude, lng: pos.coords.longitude };
  }
  return new Promise((resolve, reject) => {
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
      () => reject(new Error("location_required")),
      { enableHighAccuracy: true, timeout: 12_000 },
    );
  });
}

/** Every paid order the member is on, buyer or seller (the cart's paid lines). */
export function PaidOrdersSection({ cart }: { cart: CartLine[] }) {
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
    <section className="space-y-3" aria-label="Paid sales">
      <h2 className="text-base font-semibold">Paid: pickup and handover</h2>
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
  pending: "Your payout is on its way.",
  failed: "Your payout didn't go through yet. We'll keep trying. Check that your payout account is set up.",
  succeeded: "Paid to your payout account. Banks usually show it in 2 business days.",
  nothing_due: "Nothing to pay out: this sale covered a card fee you owed.",
};

function OrderCard({ order, userId, booking, payout }: { order: PaidOrder; userId: string; booking: MyBooking | null; payout: MyPayout | null }) {
  const title = order.lines.map((l) => l.item_title).join(", ");
  const items = order.lines.reduce((sum, l) => sum + l.price_cents, 0);
  const done = order.status === "handed_over";
  return (
    <article className="rounded-2xl border border-border bg-card p-4 space-y-3">
      <p className="font-semibold">{title} · {formatPrice(items)}</p>
      <p className="text-sm text-muted-foreground">
        {order.handover === "porch" ? "Porch pickup" : "Pickup at the seller's home"} · you are the {order.side}
      </p>
      {done ? (
        <>
          <p className="text-sm font-medium">Handed over. The sale is final.</p>
          {order.side === "seller" && payout && (
            <p className="text-sm">
              {formatPrice(payout.amount_cents)}
              {payout.debt_cents > 0 ? ` (${formatPrice(payout.items_cents)} minus ${formatPrice(payout.debt_cents)} you owed)` : ""}. {PAYOUT_WORDS[payout.status]}
            </p>
          )}
          <ReviewForm orderId={order.orderId} side={order.side} />
        </>
      ) : (
        <>
          {order.side === "buyer" && <PickupAddresses lines={order.lines} />}
          <BookingPanel order={order} booking={booking} />
          {booking?.slot_start && (order.handover === "porch"
            ? <PorchPanel order={order} userId={userId} booking={booking} />
            : <HandoverPanel order={order} />)}
          {booking?.slot_start && <NoShowButton order={order} slotStart={booking.slot_start} />}
          <ProblemForm orderId={order.orderId} />
        </>
      )}
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
    queries: lines.map((l) => ({ queryKey: ["declutter", "address", l.item_id], queryFn: () => fetchItemAddress(l.item_id) })),
  });
  const failed = results.find((r) => r.isError);
  if (failed) return <p className="text-sm" role="alert">{declutterErrorMessage(failed.error)}</p>;
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
      <label htmlFor={id} className="block text-xs font-medium">{booked ? "Move it (once each)" : "Pick a pickup time"}</label>
      <div className="flex gap-2">
        <input id={id} type="datetime-local" className={`${input} min-w-0`} value={value} onChange={(e) => setValue(e.target.value)} />
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

function HandoverPanel({ order }: { order: PaidOrder }) {
  const qc = useQueryClient();
  const [code, setCode] = useState("");
  const card = useQuery({ queryKey: ["declutter", "handover", order.orderId], queryFn: () => fetchMyHandover(order.orderId) });
  const confirm = useMutation({
    mutationFn: (v: { method: "code" | "buyer"; code: string | null }) => confirmHandover(order.orderId, v.method, v.code),
    onSuccess: (r) => {
      if (r.result === "wrong_code") toast.error(`That code isn't right. ${r.attempts_left} ${r.attempts_left === 1 ? "try" : "tries"} left.`);
      else if (r.result === "code_locked") toast.error("Too many wrong codes. The buyer can tap \"I got it\" instead.");
      else toast.success(order.side === "seller" ? "Handover done. You're being paid." : "Handover done. Enjoy your item.");
      setCode("");
      invalidate(qc, order.orderId);
    },
    onError: (err) => toast.error(declutterErrorMessage(err)),
  });
  if (card.isError) return <p className="text-sm" role="alert">{declutterErrorMessage(card.error)}</p>;
  if (order.side === "buyer") {
    return (
      <div className="space-y-2">
        {card.data?.code && (
          <p className="text-sm">
            Your handover code: <span className="font-mono text-2xl font-bold tracking-widest" aria-hidden="true">{card.data.code}</span><span className="sr-only">{card.data.code.split("").join(" ")}</span>
            <span className="block text-xs text-muted-foreground">Show it to the seller when you have the item. Never share it before.</span>
          </p>
        )}
        <button
          type="button"
          className={primary}
          disabled={confirm.isPending}
          onClick={() => {
            if (window.confirm("Do you have the item? Tapping \"I got it\" pays the seller and makes the sale final.")) confirm.mutate({ method: "buyer", code: null });
          }}
        >
          I got it
        </button>
      </div>
    );
  }
  const id = `dcl-code-${order.orderId}`;
  return (
    <div className="space-y-2">
      <label htmlFor={id} className="block text-xs font-medium">The buyer's 4-digit code (when you hand it over)</label>
      {card.data?.code_locked ? (
        <p className="text-sm">Too many wrong codes. The buyer can tap "I got it" instead.</p>
      ) : (
        <div className="flex gap-2">
          <input id={id} inputMode="numeric" autoComplete="off" maxLength={4} className={input} value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 4))} />
          <button type="button" className={primary} disabled={confirm.isPending || code.length !== 4}
            onClick={() => confirm.mutate({ method: "code", code })}>
            Confirm
          </button>
        </div>
      )}
    </div>
  );
}

function PorchPanel({ order, userId, booking }: { order: PaidOrder; userId: string; booking: MyBooking }) {
  const qc = useQueryClient();
  const [until, setUntil] = useState("");
  const timing = useMutation({
    mutationFn: (v: { mode: "all_day" | "until"; iso: string | null }) => setPorchTime(order.orderId, v.mode, v.iso),
    onSuccess: () => { toast.success("Saved."); invalidate(qc, order.orderId); },
    onError: (err) => toast.error(declutterErrorMessage(err)),
  });
  const photo = useMutation({
    mutationFn: async (file: File) => {
      const path = await uploadHandoverPhoto(userId, order.orderId, file);
      const where = order.side === "buyer" ? await currentPosition() : null;
      return porchPhoto(order.orderId, path, where);
    },
    onSuccess: (r) => {
      if (r.result === "set_out") toast.success("Set out. The buyer is told.");
      else if (r.paid === false) toast.success("Picked up. A problem report is open, so Louisiana Helpr decides before anyone is paid.");
      else toast.success("Picked up. The seller is paid and the sale is final.");
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
          <div className="flex flex-wrap gap-2">
            <button type="button" className={btn} disabled={timing.isPending} onClick={() => timing.mutate({ mode: "all_day", iso: null })}>Out all day</button>
            <input aria-label="Out until" type="datetime-local" className={`${input} min-w-0`} value={until} onChange={(e) => setUntil(e.target.value)} />
            <button type="button" className={btn} disabled={timing.isPending || !localInputToIso(until)}
              onClick={() => timing.mutate({ mode: "until", iso: localInputToIso(until) })}>Out until then</button>
          </div>
        </>
      )}
      <label htmlFor={fileId} className="block text-xs font-medium">
        {order.side === "seller" ? "Photo of the item on your porch (\"Set out\")" : "Photo when you pick it up, taken at the address (\"Picked up\": this pays the seller)"}
      </label>
      <input id={fileId} type="file" accept="image/*" capture="environment" disabled={photo.isPending}
        onChange={(e) => { const f = e.target.files?.[0]; if (f) photo.mutate(f); e.target.value = ""; }} />
    </div>
  );
}

function NoShowButton({ order, slotStart }: { order: PaidOrder; slotStart: string }) {
  const qc = useQueryClient();
  const report = useMutation({
    mutationFn: () => reportNoShow(order.orderId),
    onSuccess: () => { toast.success("Reported. We'll tell the other side and sort out the money."); invalidate(qc, order.orderId); },
    onError: (err) => toast.error(declutterErrorMessage(err)),
  });
  // Row 94: from 15 minutes after the booked time. The server checks again.
  if (Date.now() < new Date(slotStart).getTime() + 15 * 60_000) return null;
  return (
    <button type="button" className={btn} disabled={report.isPending}
      onClick={() => { if (window.confirm("Report that the other side didn't show?")) report.mutate(); }}>
      They didn't show
    </button>
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

function ProblemForm({ orderId }: { orderId: string }) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
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
    <div className="space-y-2 rounded-xl border border-border p-3">
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

function ReviewForm({ orderId, side }: { orderId: string; side: "buyer" | "seller" }) {
  const qc = useQueryClient();
  const [stars, setStars] = useState(0);
  const [comment, setComment] = useState("");
  const [sent, setSent] = useState(false);
  const send = useMutation({
    mutationFn: () => leaveReview(orderId, stars, comment.trim() || null),
    onSuccess: () => { setSent(true); toast.success("Thanks. Your review shows once both of you review, or after 14 days."); void qc.invalidateQueries({ queryKey: ["declutter"] }); },
    onError: (err) => toast.error(declutterErrorMessage(err)),
  });
  if (sent) return <p className="text-sm text-muted-foreground">Review sent.</p>;
  return (
    <div className="space-y-2">
      <p className="text-sm font-medium">Review the {side === "buyer" ? "seller" : "buyer"}</p>
      <div role="radiogroup" aria-label="Stars" className="flex gap-1">
        {[1, 2, 3, 4, 5].map((n) => (
          <button key={n} type="button" role="radio" aria-checked={stars === n} aria-label={`${n} star${n === 1 ? "" : "s"}`}
            className={`h-11 w-11 rounded-full border border-border text-lg ${n <= stars ? "text-amber-500" : "text-muted-foreground"}`}
            onClick={() => setStars(n)}>
            ★
          </button>
        ))}
      </div>
      <textarea aria-label="Review (optional)" className={input} maxLength={1000} rows={2} value={comment} onChange={(e) => setComment(e.target.value)} />
      <button type="button" className={primary} disabled={send.isPending || stars === 0} onClick={() => send.mutate()}>Send review</button>
    </div>
  );
}
