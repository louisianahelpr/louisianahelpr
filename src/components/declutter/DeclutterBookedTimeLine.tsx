/**
 * A3-63 (lead 1:14 PM: a porch pickup is a 2-hour window the seller leaves it out for): a porch booking at the
 * checkout window says the window from the order row (pickup_slot_start / _end, the same read the buyer's card uses),
 * never "(30 minutes)". Door and meetup keep their exact 30-minute time. Moved out of DeclutterHandoverViews.tsx
 * (BookingPanel) to keep that file under its size ratchet.
 */
import { useQuery } from "@tanstack/react-query";
import { fetchOrderPickupTimes, orderPickupTimesKey, orderTimeWords } from "@/lib/declutter/orderPickupTimes";
import { when, type PaidOrder } from "./paidOrders";

export function usePorchWindowWords(order: PaidOrder, booked: string | null | undefined): string | null {
  const porch = order.handover === "porch";
  const times = useQuery({
    queryKey: orderPickupTimesKey([order.orderId]),
    queryFn: () => fetchOrderPickupTimes([order.orderId]),
    enabled: !!booked && porch,
  });
  const windowWords = porch && booked
    ? orderTimeWords(times.data?.find((t) => t.id === order.orderId), order.handover, booked).chosen
    : null;
  return windowWords;
}

export function BookedTimeLine({ order, booked, label, windowWords }: { order: PaidOrder; booked: string; label: string; windowWords: string | null }) {
  return windowWords
    ? <p className="text-sm" data-testid="declutter-porch-window">{order.side === "seller" ? "Leave it out" : "Pickup"}: <span className="font-medium">{windowWords}</span></p>
    : <p className="text-sm">{label}: <span className="font-medium">{when(booked)}</span> (30 minutes)</p>;
}
