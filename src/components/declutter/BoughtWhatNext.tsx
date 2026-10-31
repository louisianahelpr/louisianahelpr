import { useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { WhatNextSheet, type WhatNextStep } from "@/components/whatNext/WhatNextSheet";
import { fetchMyCart, type CartLine } from "@/lib/declutter/api";
import { formatPrice } from "@/lib/declutter/distance";
import { fetchMyBookings } from "@/lib/declutter/handover";
import { usePaySettling } from "./DeclutterPaySettling";
import { useMyPaidCents } from "./useMyPaidCents";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * The one order a ?paid=1 return is about, or null when that is not certain. The checkout return names the order
 * (?order=<id>, B48 live check 2026-10-29: with two paid orders the sheet never opened), so its lines are the order's.
 * A return without one (a page opened before that change) keeps the old rule: exactly ONE paid order of this buyer
 * still in its handover, else no sheet rather than a guess (truth rule).
 */
export function justPaidOrder(lines: CartLine[], orderId: string | null = null): CartLine[] | null {
  const mine = lines.filter((l) => l.my_side === "buyer" && l.status === "paid" && l.order_id && l.order_status === "paid");
  if (orderId && UUID.test(orderId)) {
    const named = mine.filter((l) => l.order_id === orderId);
    return named.length ? named : null;
  }
  const ids = [...new Set(mine.map((l) => l.order_id))];
  return ids.length === 1 ? mine : null;
}

/**
 * The steps between paying and "You confirm you got it", for the order's handover. `booked`: the pickup day or time is
 * booked (declutter_bookings.slot_start). Seller delivery's time lives in its own booking (declutter_seller_deliveries),
 * picked AT checkout: audit 1030 DB-7, the sheet said "Pick a delivery time · Now" while the card said it was booked.
 */
function buyerSteps(handover: CartLine["handover"], booked: boolean): WhatNextStep[] {
  const book = (label: string, detail: string): WhatNextStep => ({ key: "book", label, detail, state: "now" });
  const go = (label: string, detail: string, now: boolean): WhatNextStep => ({ key: "go", label, detail, state: now ? "now" : "later" });
  switch (handover) {
    case "delivery":
      return [go("A local Helpr brings it", "You'll see when it's on the way", true)];
    case "seller_delivery":
      return booked
        ? [go("The seller brings it", "At the time you picked", true)]
        : [book("Pick a new delivery time", "In Buying, from the seller's times"), go("The seller brings it", "At the time you picked", false)];
    case "porch":
      return booked
        ? [go("Pick it up from the porch", "At your pickup time, once the seller posts the porch photo", true)]
        : [book("Pick a pickup time", "In Buying, inside the pickup place's hours"), go("Pick it up from the porch", "Once the seller posts the porch photo", false)];
    case "meetup":
      return booked
        ? [go("Meet at the safe spot", "At the time you booked", true)]
        : [book("Book a time to meet", "In Buying, from the seller's times"), go("Meet at the safe spot", "At the time you booked", false)];
    default:
      return booked
        ? [go("Pick it up", "At the time you booked", true)]
        : [book("Book a pickup time", "In Buying, from the seller's times"), go("Pick it up", "At the time you booked", false)];
  }
}

/**
 * Board 82, "What next" after buying, on the shared WhatNextSheet, opened on the Buying tab
 * when the checkout returns (?paid=1). The amount is what the card was charged (useMyPaidCents); the
 * steps follow the order's handover (pickup at home, porch, or Helpr delivery). Shipping
 * does not exist yet, so the board's "ships it / tracking" steps are not shown.
 */
export function BoughtWhatNext() {
  const location = useLocation();
  const navigate = useNavigate();
  const params = new URLSearchParams(location.search);
  const paid = params.get("paid") === "1";
  const cart = useQuery({ queryKey: ["declutter", "my-cart"], queryFn: fetchMyCart, enabled: paid });
  // B-1: never from the saved cache or before the payment settles (it named an older order); when the checkout just
  // paid is known, only its seller's lines.
  const settling = usePaySettling();
  const [since] = useState(() => Date.now());
  const fresh = !!cart.data && cart.dataUpdatedAt >= since && !settling.settling;
  const lines = fresh ? cart.data.filter((l) => settling.sellerId === null || l.seller_id === settling.sellerId) : null;
  const order = paid && lines ? justPaidOrder(lines, params.get("order")) : null;
  // A1-B2: "You paid" is the card charge (the sale plus a first purchase's setup fee), never the sale's total_cents.
  const orderId = order?.[0]?.order_id ?? null;
  const paidCents = useMyPaidCents(orderId ? [orderId] : [], !!orderId);
  // The same key as the Buying card's booking read, so the card behind the sheet reads nothing again.
  const booking = useQuery({ queryKey: ["declutter", "bookings", orderId ?? ""], queryFn: () => fetchMyBookings([orderId as string]), enabled: !!orderId });
  // DB-7: a seller delivery's own booking, the key the Buying card's panel reads (its module loads only for one).
  const sellerDelivery = order?.[0]?.handover === "seller_delivery";
  const sdBooking = useQuery({
    queryKey: ["declutter", "seller-delivery-booking", orderId ?? ""],
    queryFn: async () => (await import("@/lib/declutter/sellerDelivery")).fetchSellerDeliveryBooking(orderId as string),
    enabled: !!orderId && sellerDelivery,
  });
  // Wait for the booking answer; a failed read counts as not booked (a just-paid order has no day or time yet).
  if (!order || booking.isLoading || (sellerDelivery && sdBooking.isLoading)) return null;
  const close = () => { params.delete("paid"); params.delete("order"); navigate({ pathname: location.pathname, search: params.toString() }, { replace: true }); };
  const first = order[0];
  const total = orderId ? paidCents?.get(orderId) ?? null : null;
  // Audit 1028 D1-3: the buyer's real next step comes first ("Pick a pickup day", "Book a time to meet"), never
  // "Pick it up · Now" before a day or time is booked.
  const handoverSteps = buyerSteps(first.handover, sellerDelivery
    ? sdBooking.data?.status === "booked" && !!sdBooking.data.slot_start
    : !!booking.data?.some((b) => b.order_id === orderId && b.slot_start));
  return (
    <WhatNextSheet
      open
      onClose={close}
      title={order.length === 1 ? `You bought ${first.item_title}` : `You bought ${order.length} items`}
      lead={total ? <>You paid <span className="font-semibold tabular-nums text-[hsl(var(--accent-ink))]">{formatPrice(total)}</span>. The seller is paid once you have it.</> : "The seller is paid once you have it."}
      steps={[
        { key: "paid", label: "Paid", detail: "Today", state: "done" },
        ...handoverSteps,
        { key: "got", label: "You confirm you got it", detail: "Then the seller is paid", state: "later" },
      ]}
      primary={{ label: "Got it", acknowledge: true }}
    />
  );
}
