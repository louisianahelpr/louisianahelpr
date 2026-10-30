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
import { fetchSellerDeliveryBooking } from "@/lib/declutter/sellerDelivery";
import { formatPrice } from "@/lib/declutter/distance";
import { OrderSteps, orderStepAt, type OrderFacts } from "./OrderSteps";
import { useMyPaidCents } from "./useMyPaidCents";
import { porchDayIsNow, porchDayWords } from "./DeclutterPorchDay";
import { PROBLEM_ON_HOLD } from "./DeclutterProblemOpen";

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
    if (at === 0) return side === "buyer" ? "Paid. Pick a day to collect it from the porch." : "Paid. The buyer picks a pickup day.";
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
      <p className="text-ds-14">{problemOpen && !done ? PROBLEM_ON_HOLD : standing(handover, side, at, day, free)}</p>
      <MoneyNote side={side} free={free} done={done} problemOpen={problemOpen} itemsCents={itemsCents} totalCents={totalCents} after="pick it up" />
    </div>
  );
}

/** The one money note on a sale card: what the buyer paid, or what the seller gets and when (DC-16: every kind). */
function MoneyNote({ side, free, done, problemOpen, itemsCents, totalCents, after }: {
  side: "buyer" | "seller"; free: boolean; done: boolean; problemOpen: boolean; itemsCents: number; totalCents: number | null; after: string;
}) {
  const money = free ? null
    : side === "buyer"
      ? totalCents != null ? <>You paid <strong className="tabular-nums">{formatPrice(totalCents)}</strong>{done ? "." : `. The seller is paid after you ${after}.`}</> : null
      : done
        ? null
        : problemOpen
          ? <>Your <strong className="tabular-nums">{formatPrice(itemsCents)}</strong> is held while Louisiana Helpr looks at the problem.</>
        // Deep audit #31: one payout rule, the live one (declutter_payouts_due waits for declutter_sale_final: 24 hours
        // after the handover, with no refund request open; 20261026155251). It holds for every handover kind.
        : <>You get <strong className="tabular-nums">{formatPrice(itemsCents)}</strong> once the sale is final: 24 hours after the handover, unless the buyer asks for a refund.</>;
  if (!money) return null;
  return (
    // Rust on the amount only (lead, board 65 note): the sentence is ink on the money tint.
    <p className="rounded-xl px-3 py-2 text-ds-13 text-foreground [&_strong]:text-[hsl(var(--sienna-ink))]" style={{ background: "hsl(var(--burnt-sienna) / 0.08)" }}>
      {money}
    </p>
  );
}

/**
 * DC-16: a seller-delivers sale's tracker, sentence and money note, the same three parts as PickupStatus. The steps
 * come from the delivery booking (the same row and query key SellerDeliveryOrderPanel reads): booked with a time,
 * delivered_at, and the order's handed_over.
 */
export function SellerDeliveryStatus({ orderId, side, itemsCents, problemOpen = false }: {
  orderId: string; side: "buyer" | "seller"; itemsCents: number; problemOpen?: boolean;
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
  return (
    <div className="space-y-2" data-pickup-status={at} data-delivery-status="">
      <OrderSteps facts={facts} />
      <p className="text-ds-14">{problemOpen && !done ? PROBLEM_ON_HOLD : deliveryStanding(side, at, free)}</p>
      <MoneyNote side={side} free={free} done={done} problemOpen={problemOpen} itemsCents={itemsCents} totalCents={totalCents} after="have it" />
    </div>
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
