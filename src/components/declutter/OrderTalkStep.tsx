/**
 * A3-27 (audit 11-01): the Declutter order chat had no step line, while the job chat's DealCard has one. The top of the
 * chat now shows the SAME next-step value the order card shows, from the same reads (same query keys, so an open card
 * costs nothing more), and the card's one button, which opens that order's card (?order=, BUY-30's link) where the
 * step is done. Loaded only when the chat opens (DeclutterOrderTalk lazy-loads it), so Messages' chunk does not grow.
 *
 * - Buyer: useBuyingTracker's view (buyerNextStep and buyerNextAction, BuyingOrders.tsx).
 * - Seller: the card's own words (standing / deliveryStanding, DeclutterPorchHandover.tsx) for a pickup, porch, meetup
 *   or seller-delivery sale. A Helpr delivery's line lives in its delivery panel, so none is drawn here.
 * Guard: src/components/declutter/declutterNextStepLows.test.tsx.
 */
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { NextStep, type NextStepValue } from "@/components/ui/NextStep";
import { fetchMyCart } from "@/lib/declutter/api";
import { fetchMyBookings } from "@/lib/declutter/handover";
import { fetchSellerDeliveryBooking } from "@/lib/declutter/sellerDelivery";
import { useBuyingTracker } from "./BuyingOrders";
import { deliveryStanding, standing, useMyHandover } from "./DeclutterPorchHandover";
import { PROBLEM_ON_HOLD } from "./DeclutterProblemOpen";
import { orderStepAt, type OrderFacts } from "./OrderSteps";
import { paidOrdersFromCart } from "./paidOrders";
import { useOpenProblems } from "./useOpenProblems";

type Side = "buyer" | "seller";

/** The order card this chat is about: Buying or Selling, opened at the order (useLinkedOrder). */
function orderCardHref(orderId: string, side: Side): string {
  return `/declutter?tab=${side === "buyer" ? "buying" : "selling"}&order=${orderId}`;
}

function BuyerStep({ orderId }: { orderId: string }) {
  const view = useBuyingTracker().views.get(orderId);
  if (!view) return null;
  return <StepLine orderId={orderId} side="buyer" step={view.next} action={view.action} />;
}

function SellerStep({ orderId }: { orderId: string }) {
  const cart = useQuery({ queryKey: ["declutter", "my-cart"], queryFn: fetchMyCart });
  const order = paidOrdersFromCart(cart.data ?? []).find((o) => o.orderId === orderId && o.side === "seller") ?? null;
  const pickup = order?.handover === "porch" || order?.handover === "pickup_home" || order?.handover === "meetup";
  const delivers = order?.handover === "seller_delivery";
  const problems = useOpenProblems(order ? [orderId] : [], !!order);
  const bookings = useQuery({ queryKey: ["declutter", "bookings", orderId], queryFn: () => fetchMyBookings([orderId]), enabled: pickup });
  const handover = useMyHandover(orderId);
  const sd = useQuery({ queryKey: ["declutter", "seller-delivery-booking", orderId], queryFn: () => fetchSellerDeliveryBooking(orderId), enabled: delivers });
  if (!order || (!pickup && !delivers)) return null;
  const free = order.lines.reduce((sum, l) => sum + l.price_cents, 0) === 0;
  const done = order.status === "handed_over";
  let step: NextStepValue | null = null;
  if (problems.has(orderId) && !done) step = { who: "info", text: PROBLEM_ON_HOLD };
  else if (pickup && bookings.data && handover.data !== undefined) {
    const b = bookings.data.find((x) => x.order_id === orderId) ?? null;
    const kind = order.handover as "porch" | "pickup_home" | "meetup";
    const facts: OrderFacts = {
      handover: kind, side: "seller", free, booked: !!b?.slot_start,
      out: !!handover.data?.set_out_at,
      pickedUp: !!(handover.data?.picked_up_at || handover.data?.confirmed_at),
      done: done || handover.data?.status === "handed_over",
    };
    step = standing(kind, "seller", orderStepAt(facts), b?.pickup_day ?? null, free);
  } else if (delivers && sd.data) {
    const facts: OrderFacts = {
      handover: "seller_delivery", side: "seller", free,
      booked: sd.data.status === "booked" && !!sd.data.slot_start,
      delivered: !!sd.data.delivered_at,
      done: sd.data.order_status === "handed_over",
    };
    step = deliveryStanding("seller", orderStepAt(facts), free);
  }
  if (!step) return null;
  return <StepLine orderId={orderId} side="seller" step={step} action={step.who === "you" ? "See the order" : null} />;
}

function StepLine({ orderId, side, step, action }: { orderId: string; side: Side; step: NextStepValue; action: string | null }) {
  const navigate = useNavigate();
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-border bg-card px-3 py-2" data-order-talk-step={step.who}>
      <NextStep value={step} className="!text-ds-14 min-w-0" />
      {action && (
        <Button type="button" variant="outline" size="sm" className="rounded-full shrink-0" onClick={() => navigate(orderCardHref(orderId, side))}>
          {action}
        </Button>
      )}
    </div>
  );
}

export default function OrderTalkStep({ orderId, side }: { orderId: string; side: Side }) {
  return side === "buyer" ? <BuyerStep orderId={orderId} /> : <SellerStep orderId={orderId} />;
}
