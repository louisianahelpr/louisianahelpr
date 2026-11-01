/**
 * Boards 71 (buyer: paid, porch pickup ready) and 72 (seller: sold, put it
 * out). Where a paid pickup stands, for both sides, read from
 * declutter_my_handover (never a code or QR, owner 2026-10-17/18). Started by
 * Builder 3b (wip/builder3b-porch 9a124b08ab), finished here.
 *   - One tracker (OrderSteps, owner 2026-10-28): porch Paid -> Day picked -> On the porch ->
 *     Picked up; door pickup Paid -> Time booked -> Picked up -> Done. Each step comes
 *     from the real row: set_out_at (the seller's porch photo), the booked
 *     slot, picked_up_at / confirmed_at, and the order's handed_over.
 *   - One line saying where it stands and what is next, by name of side.
 *   - One money note: what the buyer paid (the order's total), or what the
 *     seller is paid (the whole item price) and when, from the real rule.
 *   - The porch photo IS the handover (board 159): once the seller posts it,
 *     both sides see it (private bucket, a short signed link).
 *   - DC-16 (Declutter selling audit 2026-10-30): ONE sale card. Only porch and door-pickup sales drew this tracker,
 *     sentence and money note on the seller's side; a seller-delivers sale (and a meetup) opened straight into its
 *     booking panel with no steps and no "You get $X" note. Every pickup kind uses PickupStatus now, and a
 *     seller-delivers sale uses SellerDeliveryStatus: the same three parts, its steps read from the delivery booking.
 */
import { useQuery } from "@tanstack/react-query";
import { fetchMyHandover, handoverPhotoUrl } from "@/lib/declutter/handover";
import { fetchSellerDeliveryBooking, slotLabel } from "@/lib/declutter/sellerDelivery";
import { formatPrice } from "@/lib/declutter/distance";
import { OrderSteps, orderStepAt, type OrderFacts } from "./OrderSteps";
import { useMyPaidCents } from "./useMyPaidCents";
import { porchDayIsNow, porchDayWords } from "./DeclutterPorchDay";
import { PROBLEM_ON_HOLD } from "./DeclutterProblemOpen";
import { GOOD_NEWS_NOTE } from "./goodNews";
import { REFUNDED_IN_FULL } from "@/lib/declutter/refundRequests";
import { sellerPayoutRule, type SellerPayoutKind } from "@/lib/declutter/sellerPayoutRule";

type Pickup = "porch" | "pickup_home" | "meetup";

const time = (iso: string) => new Date(iso).toLocaleString([], { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

function useMyHandover(orderId: string) {
  return useQuery({ queryKey: ["declutter", "handover", orderId], queryFn: () => fetchMyHandover(orderId) });
}

/**
 * The words for where it stands, per side and step (OrderSteps: porch Paid -> Day picked -> On the porch ->
 * Picked up; door Paid -> Time booked -> Picked up -> Done). Names the other side only by role (no pronouns).
 * Plain sentences, never dot-joined fragments (lead 2026-10-28). A porch DAY (owner 2026-10-28): until the
 * seller's photo the buyer is told NOT to go; once it is in, "Pick it up today". `day` is null for a porch
 * pickup booked for a time before days existed.
 */
/** "today", "tomorrow", "on Thu, Oct 30". */
export function onDay(day: string): string {
  const w = porchDayWords(day);
  return w === "Today" || w === "Tomorrow" ? w.toLowerCase() : `on ${w}`;
}

function standing(handover: Pickup, side: "buyer" | "seller", at: number, day: string | null, free = false): string {
  // #6: a free claim was never paid; its first step says Claimed.
  if (free && at === 0) return standing(handover, side, at, day).replace(/^Paid\./, "Claimed.");
  // The booked day or time is the booking panel's line, right below; it is not repeated here.
  if (handover === "porch") {
    // LEAD-PLACE-TIMES: a porch pickup is booked for a time inside the place's hours (a day booked before stays a day).
    if (at === 0) return side === "buyer" ? "Paid. Pick a time to collect it from the porch." : "Paid. The buyer picks a pickup time.";
    if (at === 1) {
      if (side === "seller") return day ? `Put it out ${onDay(day)} and post the porch photo.` : "Paid. Put it out and take one photo where the buyer will find it.";
      return "Not out yet. We'll tell you when it's on the porch. Don't go before then.";
    }
    if (at === 2) {
      if (side === "seller") return "It's out. The buyer is told and sees your photo.";
      if (!day) return "It's out. Pick it up at your pickup time.";
      return porchDayIsNow(day) ? "It's out. Pick it up today." : `It's out. Pick it up ${onDay(day)}.`;
    }
    return "Picked up.";
  }
  if (handover === "meetup") {
    if (at === 0) return side === "buyer" ? "Paid. Book a time to meet." : "Paid. The buyer books a time to meet.";
    if (at === 1) return "Booked. The time and place are below.";
    return at === 2 ? "Met." : "Handed over.";
  }
  if (at === 0) return side === "buyer" ? "Paid. Book a pickup time." : "Paid. The buyer books a pickup time.";
  if (at === 1) return "Booked. The pickup time is below.";
  return at === 2 ? "Picked up." : "Handed over.";
}

/** DC-16: a seller-delivers sale, in the same words (OrderSteps: Paid -> Time booked -> Delivered -> Done). */
function deliveryStanding(side: "buyer" | "seller", at: number, free: boolean): string {
  if (at === 0) return `${free ? "Claimed" : "Paid"}. ${side === "buyer" ? "Pick a delivery time." : "The buyer picks a delivery time."}`;
  if (at === 1) return "Booked. The delivery time is below.";
  if (at === 2) return side === "buyer" ? "Delivered. Tap I got it once you have it." : "Delivered. The buyer says when they have it.";
  return "Handed over.";
}

export function PickupStatus({
  orderId,
  handover,
  side,
  slot,
  day = null,
  itemsCents,
  problemOpen = false,
  refunded = false,
}: {
  orderId: string;
  handover: Pickup;
  side: "buyer" | "seller";
  /** The booked pickup time, when there is one. */
  slot: string | null;
  /** The porch pickup DAY (yyyy-mm-dd), when one is booked. */
  day?: string | null;
  /** The items' price: what the seller keeps. */
  itemsCents: number;
  /** Audit 1b D2-2: a problem is open, so the order is on hold and the money is held until Louisiana Helpr decides. */
  problemOpen?: boolean;
  /** NIGHT-SELL-soldstates-7: the sale was refunded in full after the handover (refundedInFull). */
  refunded?: boolean;
}) {
  const h = useMyHandover(orderId);
  // #6 / A2-9: a free claim reads Claimed, never "You paid $0" or "You get $0": no money line at all.
  const free = itemsCents === 0;
  // A1-B2: the buyer's "You paid" is the card charge (the sale plus a first purchase's setup fee), read for the buyer
  // only; until it is in, no figure.
  const totalCents = useMyPaidCents([orderId], side === "buyer" && !free)?.get(orderId) ?? null;
  if (h.isError) return null;
  // The one Declutter order tracker (OrderSteps), from the real rows: the booking, the porch photo, the pickup.
  const facts: OrderFacts = {
    handover, side, free, booked: !!slot,
    out: !!h.data?.set_out_at,
    pickedUp: !!(h.data?.picked_up_at || h.data?.confirmed_at),
    done: h.data?.status === "handed_over",
  };
  const at = orderStepAt(facts);
  const done = facts.done || at === 3;
  return (
    <div className="space-y-2" data-pickup-status={at}>
      <OrderSteps facts={facts} />
      <p className="text-ds-14">{refunded && done ? REFUNDED_IN_FULL[side] : problemOpen && !done ? PROBLEM_ON_HOLD : standing(handover, side, at, day, free)}</p>
      <MoneyNote side={side} kind={handover} free={free} done={done} problemOpen={problemOpen} itemsCents={itemsCents} totalCents={totalCents} after="pick it up" />
    </div>
  );
}

/** The one money note on a sale card: what the buyer paid, or what the seller gets and when (DC-16: every kind). */
function MoneyNote({ side, kind, free, done, problemOpen, itemsCents, totalCents, after, deliveryCents = 0 }: {
  side: "buyer" | "seller"; kind: SellerPayoutKind; free: boolean; done: boolean; problemOpen: boolean; itemsCents: number; totalCents: number | null; after: string;
  /** AUD31-1: a seller who delivers is paid this on top of the items (declutter_complete_handover's v_rate). */
  deliveryCents?: number;
}) {
  const sellerCents = itemsCents + Math.max(0, deliveryCents);
  const parts = deliveryCents > 0 ? ` (${formatPrice(itemsCents)} for the sale and ${formatPrice(deliveryCents)} for delivering it)` : "";
  const money = free ? null
    : side === "buyer"
      // NIGHT-BUYINGopenpr-8 (buyer's held card): while a problem is open the note says "Nobody is paid until they
      // decide.", so the money line no longer says the seller is paid after the pickup right above it.
      ? totalCents != null ? <>You paid <strong className="tabular-nums">{formatPrice(totalCents)}</strong>{done || problemOpen ? "." : `. The seller is paid after you ${after}.`}</> : null
      : done
        ? null
        : problemOpen
          ? <>Your <strong className="tabular-nums">{formatPrice(sellerCents)}</strong> is held while Louisiana Helpr looks at the problem.</>
        // Deep audit #31: one payout rule, the live one. LEAD-DOOR-PAYLINE: said per handover kind from the owner's
        // 10-30 rule and the server it describes (sellerPayoutRule): "I got it" pays 24 hours later; the seller's own
        // step plus the buyer's silence about 48 hours; nobody speaks, the money stays held.
        : <>You get <strong className="tabular-nums">{formatPrice(sellerCents)}</strong>{parts}. {sellerPayoutRule(kind)}</>;
  // The seller's "You get $X once the sale is final" is good news: the sage tint, not the rust one a held payout
  // keeps (audit 1030 DC-13).
  const goodNews = side === "seller" && !problemOpen;
  if (!money) return null;
  return goodNews ? (
    <p className={GOOD_NEWS_NOTE} data-money-note="" data-tone="good">{money}</p>
  ) : (
    // Rust on the amount only (lead, board 65 note): the sentence is ink on the money tint.
    <p className="rounded-xl px-3 py-2 text-ds-13 text-foreground [&_strong]:text-[hsl(var(--sienna-ink))]" style={{ background: "hsl(var(--burnt-sienna) / 0.08)" }} data-money-note="">
      {money}
    </p>
  );
}

/**
 * DC-16: a seller-delivers sale's tracker, sentence and money note, the same three parts as PickupStatus. The steps
 * come from the delivery booking (the same row and query key SellerDeliveryOrderPanel reads): booked with a time,
 * delivered_at, and the order's handed_over.
 */
export function SellerDeliveryStatus({ orderId, side, itemsCents, problemOpen = false, refunded = false }: {
  orderId: string; side: "buyer" | "seller"; itemsCents: number; problemOpen?: boolean; refunded?: boolean;
}) {
  const b = useQuery({ queryKey: ["declutter", "seller-delivery-booking", orderId], queryFn: () => fetchSellerDeliveryBooking(orderId) });
  const free = itemsCents === 0;
  const totalCents = useMyPaidCents([orderId], side === "buyer" && !free)?.get(orderId) ?? null;
  if (b.isError || !b.data) return null;
  const facts: OrderFacts = {
    handover: "seller_delivery", side, free,
    booked: b.data.status === "booked" && !!b.data.slot_start,
    delivered: !!b.data.delivered_at,
    done: b.data.order_status === "handed_over",
  };
  const at = orderStepAt(facts);
  const done = facts.done || at === 3;
  // AUD31-3 (the other side): a move the OTHER party asked for waits on this viewer's answer; the sentence says so
  // instead of "Booked" (the panel below has Accept the new time / Keep the current time).
  const p = b.data;
  const moveAskedOfMe = !done && !facts.delivered && p.proposed_start && p.proposed_by && p.proposed_by !== side
    ? `The ${p.proposed_by} asked to move it to ${slotLabel(p.proposed_start)}. Accept the new time or keep it, below.`
    : null;
  return (
    <div className="space-y-2" data-pickup-status={at} data-delivery-status="">
      <OrderSteps facts={facts} />
      <p className="text-ds-14">{refunded && done ? REFUNDED_IN_FULL[side] : problemOpen && !done ? PROBLEM_ON_HOLD : moveAskedOfMe ?? deliveryStanding(side, at, free)}</p>
      <MoneyNote side={side} kind="seller_delivery" free={free} done={done} problemOpen={problemOpen} itemsCents={itemsCents} totalCents={totalCents} after="have it"
        deliveryCents={b.data.delivery_cents ?? 0} />
    </div>
  );
}

/**
 * NIGHT-SELL-soldstates-7: a finished Helpr delivery on the seller's card had no tracker, only "Handed over." (the
 * delivery panel with its tracker leaves the card once the sale is done). The one tracker at its end, and one line.
 */
export function DeliveryDoneStatus({ free, refunded = false }: { free: boolean; refunded?: boolean }) {
  const facts: OrderFacts = { handover: "delivery", side: "seller", free, booked: true, pickedUp: true, delivered: true, done: true };
  return (
    <div className="space-y-2" data-pickup-status={orderStepAt(facts)} data-delivery-done="">
      <OrderSteps facts={facts} />
      <p className="text-ds-14">{refunded ? REFUNDED_IN_FULL.seller : "Handed over."}</p>
    </div>
  );
}

/**
 * NIGHT-SELL-soldstates-7: a Helpr delivery's seller card said nothing of the money until the drop-off (every other
 * kind's card shows "You get $X" from the start). The amount, in the same good-news note; the delivery panel's own
 * line gives the payout rule once the Helpr has left it.
 */
export function SellerDeliveryMoney({ itemsCents, problemOpen = false }: { itemsCents: number; problemOpen?: boolean }) {
  if (itemsCents === 0) return null;
  return problemOpen ? (
    <p className="rounded-xl px-3 py-2 text-ds-13 text-foreground [&_strong]:text-[hsl(var(--sienna-ink))]" style={{ background: "hsl(var(--burnt-sienna) / 0.08)" }} data-money-note="">
      Your <strong className="tabular-nums">{formatPrice(itemsCents)}</strong> is held while Louisiana Helpr looks at the problem.
    </p>
  ) : (
    <p className={GOOD_NEWS_NOTE} data-money-note="" data-tone="good">
      You get <strong className="tabular-nums">{formatPrice(itemsCents)}</strong> once the buyer has it.
    </p>
  );
}

/** Board 159: the seller's porch photo, for both sides, once it's out. */
export function PorchOutPhoto({ orderId, side }: { orderId: string; side: "buyer" | "seller" }) {
  const h = useMyHandover(orderId);
  const path = h.data?.set_out_photo_path ?? null;
  const url = useQuery({
    queryKey: ["declutter", "handover-photo", path],
    queryFn: () => handoverPhotoUrl(path!),
    enabled: !!path,
    staleTime: 5 * 60_000,
  });
  if (!h.data?.set_out_at || !path) return null;
  return (
    <figure className="space-y-1.5" data-porch-photo="">
      <p className="text-sm font-semibold">
        {side === "buyer" ? "It's out" : "You put it out"} · {time(h.data.set_out_at)}
      </p>
      <div className="aspect-[4/3] w-full max-w-[320px] overflow-hidden rounded-2xl bg-photo-empty">
        {url.data && <img src={url.data} alt="Where the item was left" className="h-full w-full object-cover" />}
      </div>
      {/* Q2266: the seller's "Where exactly?" note, under the photo for both sides. */}
      {h.data.set_out_note && <p className="text-ds-14 [overflow-wrap:anywhere]" data-porch-note="">"{h.data.set_out_note}"</p>}
      <figcaption className="text-ds-13 text-muted-foreground">
        {side === "buyer"
          ? "This photo shows where it is. Something wrong? Report it before you take your pickup photo."
          : "The buyer sees this photo."}
      </figcaption>
    </figure>
  );
}
