/**
 * A paid seller-delivered order, for both sides (migration 20261027153244;
 * switch declutter_seller_delivery; docs/specs/declutter-seller-delivery.md).
 * Loaded on its own from the order card (Q178: off /posts' critical path).
 *
 * What each side sees and can do, all decided on the server:
 *   both    the booked time, the buyer's door choice, a new time (ask from the
 *           seller's open times, once per side; the other side accepts),
 *           Report a problem
 *   seller  the buyer's address (after payment only), "Delivered" (a photo
 *           when left at the door) / "Handed over"
 *   buyer   change the door choice, "I got it", "It wasn't delivered" (from
 *           15 minutes after the hour ends)
 * Neither side can cancel a paid order (owner 2026-10-29, Q2477: "once they pay it can only be
 * rescheduled once. never cancelled."; migration 20261030002630 makes both cancel RPCs refuse).
 */
import { PhotoPickButton } from "@/components/ui/PhotoPickButton";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ChoicePill } from "@/components/ui/ChoicePill";
import { confirmHandover, fetchMyHandover, handoverPhotoUrl, uploadHandoverPhoto } from "@/lib/declutter/handover";
import { markReviewPrompt } from "@/lib/declutter/reviewPrompt";
import {
  answerDeliveryTime,
  deliveryPhotoPosition,
  fetchDeliveryOpenTimes,
  fetchSellerDeliveryBooking,
  groupSlotsByDay,
  markDelivered,
  proposeDeliveryTime,
  reportNotDelivered,
  sameSlot,
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
import { FallbackImg } from "./FallbackImg";

// min-h-11: the 44px tap floor (they were 36px; Declutter audit 2026-10-28).
const btn = "min-h-11 rounded-full border border-border px-4 py-2 text-sm font-semibold";
const primary = "btn-grad-primary !text-[hsl(var(--parchment))] min-h-11 rounded-full px-4 py-2 text-sm font-semibold";

/** The Louisiana calendar day of an instant, "2026-11-01" (sorts as text). */
const LA_DAY = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Chicago", year: "numeric", month: "2-digit", day: "2-digit" });
const laDay = (ms: number) => LA_DAY.format(new Date(ms));
/** "Sat, Oct 25, 2:05 PM" in Louisiana time (when the delivery photo was taken). */
const LA_WHEN = new Intl.DateTimeFormat("en-US", { timeZone: "America/Chicago", weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

/** Which buttons a side gets right now (pure, so the rules are tested apart from the screen). */
export function sellerDeliveryActions(b: SellerDeliveryBooking, now: number = Date.now()) {
  const booked = b.status === "booked" && !!b.slot_start;
  const marked = !!b.delivered_at;
  const started = booked && now >= Date.parse(b.slot_start!);
  const open = b.order_status === "paid";
  const slotOver = booked && now >= Date.parse(b.slot_end ?? b.slot_start!);
  return {
    markDelivered: open && b.side === "seller" && started && !marked,
    // Deep audit 2026-10-28 B-7 (#7): "I got it" showed a day before the delivery and one tap finished the sale.
    // It now shows once the seller marked it delivered, or from the delivery day (Louisiana time); it still asks first.
    gotIt: open && b.side === "buyer" && (marked || (booked && laDay(now) >= laDay(Date.parse(b.slot_start!)))),
    notDelivered: open && b.side === "buyer" && booked && !marked && !!b.not_delivered_from && now >= Date.parse(b.not_delivered_from),
    // AUD31-38: door or hand is a choice for a delivery still to come; once its hour has passed it is not (the card is
    // late, and It wasn't delivered / a new time lead). The panel also hides it during the seller's 24 hours to answer.
    changeHandoff: open && b.side === "buyer" && !marked && (b.status === "needs_time" || (b.status === "booked" && !slotOver)),
    askNewTime: open && !marked && (b.status === "booked" || b.status === "needs_time") && b.proposals_left > 0 && !(b.proposed_by === b.side),
    answerProposal: open && !!b.proposed_start && b.proposed_by !== b.side,
    withdrawProposal: open && !!b.proposed_start && b.proposed_by === b.side,
  };
}

/** What each money moment says before it runs (the words window.confirm used to carry, plus "I got it", which had none). */
const ASK = {
  gotIt: { title: "Do you have it?", confirm: "I got it", cancel: "Not now", words: "Tapping I got it finishes the sale and the seller is paid. You can still ask for a refund within 24 hours if something is wrong." },
  notDelivered: { title: "It wasn't delivered?", confirm: "It wasn't delivered", cancel: "Not now", words: "We tell the seller now, and they have 24 hours to answer. If they don't, you get everything back, delivery included. If they say they delivered it, Louisiana Helpr looks at both sides." },
} as const;

/**
 * `problemOpen` (audit 1030 DB-2): a problem report is open on this order, so Louisiana Helpr decides before anyone is
 * paid. The panel then offers no "I got it" (the server refuses it: problem_open), no "Tap I got it ... 24 hours" line
 * and no second "Report a problem"; the card's own note says a problem is open.
 */
export function SellerDeliveryOrderPanel({ orderId, userId, onProblem, problemOpen = false }: { orderId: string; userId: string; onProblem: () => void; problemOpen?: boolean }) {
  const qc = useQueryClient();
  const key = ["declutter", "seller-delivery-booking", orderId] as const;
  const booking = useQuery({ queryKey: key, queryFn: () => fetchSellerDeliveryBooking(orderId) });
  // Review of 7496d29c8b #2: during "It wasn't delivered"'s 24 hours the time stands (the server refuses a move: no_show_waiting).
  const handoverRow = useQuery({ queryKey: ["declutter", "handover", orderId], queryFn: () => fetchMyHandover(orderId) });
  const noShowWaiting = !!handoverRow.data?.no_show_reported_at;
  const [moving, setMoving] = useState(false);
  const [photo, setPhoto] = useState<File | null>(null);
  // The money moments ask in the app, never window.confirm (lead 2026-10-28, DeclutterConfirmSheet).
  const [ask, setAsk] = useState<"gotIt" | "notDelivered" | null>(null);
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: key });
    void qc.invalidateQueries({ queryKey: ["declutter", "my-cart"] });
    void qc.invalidateQueries({ queryKey: ["declutter", "payouts"] });
    void qc.invalidateQueries({ queryKey: ["declutter", "handover", orderId] });
  };
  const act = <T, V = void>(fn: (v: V) => Promise<T>, done: string | ((r: T) => string)) =>
    ({ mutationFn: fn, onSuccess: (r: T) => { toast(typeof done === "string" ? done : done(r)); refresh(); },
       onError: (err: unknown) => toast.error(sellerDeliveryErrorMessage(err)) });
  const b = booking.data;
  // A photo is taken at the buyer's door (20261028235709): the position first, so a refusal uploads nothing.
  const delivered = useMutation(act(async () => {
    const where = photo ? await deliveryPhotoPosition() : null;
    return markDelivered(orderId, photo ? await uploadHandoverPhoto(userId, orderId, photo) : "", where);
  },
    // LEAD-DOOR-PAYLINE: "paid when the buyer confirms" was a day early (the buyer's 24 hours to ask for a refund follow).
    b?.handoff === "hand" ? "Marked handed over. We asked the buyer to confirm." : "Marked delivered. We asked the buyer to confirm."));
  const gotIt = useMutation(act(async () => { const r = await confirmHandover(orderId); markReviewPrompt(orderId); return r; }, "Handover done. Enjoy your item."));
  const notDelivered = useMutation(act(async () => { await reportNotDelivered(orderId); void qc.invalidateQueries({ queryKey: ["declutter", "handover", orderId] }); }, "We told the seller. They have 24 hours to answer."));
  const handoff = useMutation(act((h: DeliveryHandoff) => setDeliveryHandoff(orderId, h), "Saved. The seller is told."));
  const answer = useMutation(act((accept: boolean) => answerDeliveryTime(orderId, accept),
    (r) => (r === "moved" ? "Delivery time changed." : r === "slot_taken" ? "That time was just taken, so the delivery keeps its time." : "The delivery keeps its time.")));
  if (booking.isLoading) return <p className="text-sm text-muted-foreground" role="status">Loading the delivery…</p>;
  // A failed read is an error with a retry, like every Declutter list (audit 2026-10-28: it was a grey line with no way to try again).
  if (booking.isError || !b) {
    return <ErrorState variant="inline" title="We couldn't load this delivery." body={sellerDeliveryErrorMessage(booking.error)} onRetry={() => void booking.refetch()} />;
  }
  const can = sellerDeliveryActions(b);
  // AUD31-2: late = the buyer may say it wasn't delivered (past not_delivered_from, never marked delivered).
  const late = can.notDelivered && !noShowWaiting;
  const busy = delivered.isPending || gotIt.isPending || notDelivered.isPending || handoff.isPending || answer.isPending;
  const fileId = `sd-photo-${orderId}`;
  // A3-73: while the choice shows as chips, the summary line would say the same words a second time.
  const handoffChips = can.changeHandoff && !noShowWaiting;
  return (
    <div className="space-y-3" data-seller-delivery-order="">
      <div className="rounded-xl bg-muted/50 px-3 py-2 text-sm space-y-1">
        <p className="font-semibold">
          {b.status === "needs_time" ? "Pick a new delivery time"
            : b.slot_start ? `Delivery ${slotLabel(b.slot_start)}` : "Delivery"}
        </p>
        {!handoffChips && <p className="text-muted-foreground">{HANDOFF_WORDS[b.handoff].title}{b.side === "seller" ? " (the buyer's choice)" : ""}</p>}
        {b.side === "seller" && b.dropoff_address && <p>Deliver to: {b.dropoff_address}</p>}
        {b.side === "buyer" && !can.gotIt && !problemOpen && b.order_status === "paid" && b.status === "booked" && !b.delivered_at && (
          <p data-got-it-later="">You can confirm you got it from the delivery day.</p>
        )}
        {b.delivered_at && <p>{b.handoff === "hand" ? "Handed over" : "Left at the door"}.{problemOpen ? null : b.side === "buyer" ? " Tap \"I got it\". Something wrong? You have 24 hours to report a problem." : " We asked the buyer to confirm. If they say nothing, you're paid in about 48 hours."}</p>}
      </div>
      {b.delivered_at && b.delivered_photo_path && <DeliveredPhoto path={b.delivered_photo_path} hand={b.handoff === "hand"} at={b.delivered_at} mine={b.side === "seller"} />}
      {handoffChips && (
        <div role="radiogroup" aria-labelledby={`sd-handoff-${orderId}`} className="flex flex-wrap items-center gap-2">
          <p id={`sd-handoff-${orderId}`} className="w-full text-sm font-medium">When the seller arrives</p>
          {(["leave", "hand"] as const).map((h) => (
            <ChoicePill key={h} selected={b.handoff === h} disabled={busy} onClick={() => b.handoff !== h && handoff.mutate(h)}>{HANDOFF_WORDS[h].title}</ChoicePill>
          ))}
        </div>
      )}
      {b.proposed_start && (
        <div className="rounded-xl border border-border px-3 py-2 text-sm space-y-2" role="status">
          <p>{b.proposed_by === b.side ? `You asked to move it to ${slotLabel(b.proposed_start)}.` : `The ${b.proposed_by} asked to move it to ${slotLabel(b.proposed_start)}.`}</p>
          <div className="flex flex-wrap gap-2">
            {can.answerProposal && !noShowWaiting && <button type="button" className={primary} disabled={busy} onClick={() => answer.mutate(true)}>Accept the new time</button>}
            <button type="button" className={btn} disabled={busy} onClick={() => answer.mutate(false)}>{can.withdrawProposal ? "Take back my request" : "Keep the current time"}</button>
          </div>
        </div>
      )}
      {can.markDelivered && !noShowWaiting && (
        <div className="space-y-2">
          <label htmlFor={fileId} className="block text-xs font-medium">
            {b.handoff === "leave" ? "Photo of the items at the buyer's door (needed, taken there)" : "Photo of the handover (optional, taken at the buyer's address)"}
          </label>
          <PhotoPickButton id={fileId} picked={photo} disabled={busy} onPick={setPhoto} />
          <button type="button" className={primary} disabled={busy || (b.handoff === "leave" && !photo)} onClick={() => delivered.mutate(undefined)}>
            {b.handoff === "hand" ? "Handed over" : "Delivered"}
          </button>
        </div>
      )}
      <div className="flex flex-wrap gap-2" data-seller-delivery-actions="">
        {/* AUD31-2: past its window and never marked delivered, the delivery is late: "It wasn't delivered" leads (the
            main button) and "Ask for a new time" follows; "I got it" stays, after them, as an ordinary button. */}
        {late && <button type="button" className={primary} disabled={busy} onClick={() => setAsk("notDelivered")}>It wasn't delivered</button>}
        {can.gotIt && !problemOpen && !late && <button type="button" className={primary} disabled={busy} onClick={() => setAsk("gotIt")}>I got it</button>}
        {can.askNewTime && !noShowWaiting && <button type="button" className={btn} disabled={busy} onClick={() => setMoving((m) => !m)}>{b.status === "needs_time" && b.side === "buyer" ? "Pick a time" : "Ask for a new time"}</button>}
        {can.gotIt && !problemOpen && late && <button type="button" className={btn} disabled={busy} onClick={() => setAsk("gotIt")}>I got it</button>}
        {!problemOpen && <button type="button" className={btn} onClick={onProblem}>Report a problem</button>}
      </div>
      {ask && (
        <ConfirmSheet open title={ASK[ask].title} confirmLabel={ASK[ask].confirm} cancelLabel={ASK[ask].cancel} pending={busy} testId={`seller-delivery-${ask}`}
          onClose={() => setAsk(null)}
          onConfirm={() => ({ gotIt, notDelivered })[ask].mutate(undefined, { onSettled: () => setAsk(null) })}>
          {ASK[ask].words}
        </ConfirmSheet>
      )}
      {moving && can.askNewTime && <NewTimePicker orderId={orderId} current={b} onDone={() => { setMoving(false); refresh(); }} />}
    </div>
  );
}

/**
 * Audit 2026-10-30 DB-8: the notice told the buyer the seller took a photo, and no screen showed it. The photo the
 * seller took at the buyer's address (declutter_seller_delivery_booking's delivered_photo_path, the order's handover
 * photo), for both sides; the private bucket lets the two sides of the order read it (declutter_handover_photo_access).
 */
function DeliveredPhoto({ path, hand, at, mine }: { path: string; hand: boolean; at: string; mine: boolean }) {
  const url = useQuery({ queryKey: ["declutter", "handover-photo", path], queryFn: () => handoverPhotoUrl(path), staleTime: 5 * 60_000 });
  // AUD31-5: the seller's own card says "Your photo"; the buyer's names the seller.
  const label = mine
    ? hand ? "Your photo of the handover" : "Your photo of where you left it"
    : hand ? "The seller's photo of the handover" : "The seller's photo of where it was left";
  return (
    <figure className="space-y-1.5" data-delivered-photo="">
      <div className="aspect-[4/3] w-full overflow-hidden rounded-2xl bg-photo-empty">
        {url.data && <FallbackImg src={url.data} alt={label} className="h-full w-full object-cover" />}
      </div>
      {url.isSuccess && !url.data && <p className="text-xs" role="alert">The photo couldn't load. Try again in a minute.</p>}
      <figcaption className="text-ds-13 text-muted-foreground">{label}, taken {LA_WHEN.format(new Date(at))}</figcaption>
    </figure>
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
    onSuccess: (r) => { toast(r === "booked" ? "Delivery booked." : "Asked. The other side accepts or keeps the current time."); onDone(); },
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
