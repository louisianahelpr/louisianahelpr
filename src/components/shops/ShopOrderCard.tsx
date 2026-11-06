/**
 * One Shops order, as both sides read it (Shops M1): its lines, ready date,
 * note, money and status in plain words. The actions (withdraw for the buyer,
 * accept / decline for the shop) are passed in by the screen. Once the shop
 * accepts, the buyer also sees where to pick up (M1b part 2: the address is
 * private until then, and the server returns nothing earlier).
 * Delivery (20261106180902): a delivered order shows the drop-off address
 * instead, to the buyer always and to the shop once it has accepted (the
 * server returns nothing to the shop earlier or after the handover).
 */
import type { ReactNode } from "react";
import { InlineTextButton } from "@/components/ui/InlineTextButton";
import { useQuery } from "@tanstack/react-query";
import { MapPin } from "lucide-react";
import { parseLocalDate } from "@/lib/dateUtils";
import { cancelPolicyText, formatCents, orderStatusLabel, type ShopOrder } from "@/lib/shops/orders";
import { fetchOrderPickupAddress, fetchOrderServiceAddress } from "@/lib/shops/pickupAddress";
import { fetchOrderDeliveryAddress, formatDeliveryAddress } from "@/lib/shops/delivery";
import { ShopOrderMessageButton } from "./ShopTalk";
import { ShopOrderReview } from "./ShopReviews";

/** The order statuses in which the buyer may read the shop's pickup address (shops_order_pickup_address). */
const PICKUP_VISIBLE = new Set(["accepted"]);

function PickupAddress({ orderId }: { orderId: string }) {
  const q = useQuery({
    queryKey: ["shops", "order-pickup", orderId],
    queryFn: () => fetchOrderPickupAddress(orderId),
    staleTime: 5 * 60_000,
  });
  if (q.isLoading) return <p className="text-sm text-muted-foreground">Loading the pickup address…</p>;
  if (q.isError) {
    return (
      <p className="text-sm">
        We couldn't load the pickup address.{" "}
        <InlineTextButton className="underline" onClick={() => void q.refetch()}>Try again</InlineTextButton>
      </p>
    );
  }
  const a = q.data;
  if (!a) return <p className="text-sm text-muted-foreground">The pickup address isn't available right now. Refresh the page in a minute.</p>;
  return (
    <div className="flex items-start gap-2 rounded-xl bg-muted/60 p-3 text-sm" data-testid="shop-order-pickup-address">
      <MapPin className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
      <p className="min-w-0 [overflow-wrap:anywhere]">
        <span className="font-semibold">Pick up at</span>
        <br />
        {a.line1}
        {a.line2 ? `, ${a.line2}` : ""}
        <br />
        {a.city}, {a.state} {a.postal_code}
      </p>
    </div>
  );
}

/** H8 (b): the statuses in which the SHOP may read an at-home cleaning's address (shops_order_service_address). */
const SERVICE_VISIBLE_TO_SHOP = new Set(["accepted", "handed_over"]);

function ServiceAddress({ orderId }: { orderId: string }) {
  const q = useQuery({
    queryKey: ["shops", "order-service-address", orderId],
    queryFn: () => fetchOrderServiceAddress(orderId),
    staleTime: 5 * 60_000,
  });
  if (q.isLoading) return <p className="text-sm text-muted-foreground">Loading the work address…</p>;
  if (q.isError) {
    return (
      <p className="text-sm">
        We couldn't load the work address.{" "}
        <InlineTextButton className="underline" onClick={() => void q.refetch()}>Try again</InlineTextButton>
      </p>
    );
  }
  const a = q.data;
  if (!a) return null;
  return (
    <div className="flex items-start gap-2 rounded-xl bg-muted/60 p-3 text-sm" data-testid="shop-order-service-address">
      <MapPin className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
      <p className="min-w-0 [overflow-wrap:anywhere]">
        <span className="font-semibold">Work done at</span>
        <br />
        {a.line1}
        <br />
        {a.city}, {a.state} {a.postal_code}
      </p>
    </div>
  );
}

function DeliveryAddress({ orderId, side }: { orderId: string; side: "buyer" | "shop" }) {
  const q = useQuery({
    queryKey: ["shops", "order-delivery", orderId],
    queryFn: () => fetchOrderDeliveryAddress(orderId),
    staleTime: 5 * 60_000,
  });
  if (q.isLoading) return <p className="text-sm text-muted-foreground">Loading the delivery address…</p>;
  if (q.isError) {
    return (
      <p className="text-sm">
        We couldn't load the delivery address.{" "}
        <InlineTextButton onClick={() => void q.refetch()} className="underline">Try again</InlineTextButton>
      </p>
    );
  }
  if (!q.data) return null;
  return (
    <div className="flex items-start gap-2 rounded-xl bg-muted/60 p-3 text-sm" data-testid="shop-order-delivery-address">
      <MapPin className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
      <p className="min-w-0 [overflow-wrap:anywhere]">
        <span className="font-semibold">{side === "shop" ? "Deliver to" : "Delivering to"}</span>
        <br />
        {formatDeliveryAddress(q.data)}
      </p>
    </div>
  );
}

function readyDateText(iso: string): string {
  return parseLocalDate(iso).toLocaleDateString(undefined, { weekday: "short", month: "long", day: "numeric" });
}

export function ShopOrderCard({
  order,
  heading,
  side,
  children,
}: {
  order: ShopOrder;
  heading: string;
  side: "buyer" | "shop";
  children?: ReactNode;
}) {
  const delivered = order.fulfillment === "shop_delivers";
  // The shop is paid its items and its own delivery fee (shop_complete_handover, 20261106180902).
  const deliveryCents = order.delivery_cents ?? 0;
  const shopGets = order.items_cents + deliveryCents;
  return (
    <li className="space-y-2 rounded-2xl border border-border bg-card p-4" data-testid="shop-order-card">
      <div className="flex items-start justify-between gap-2">
        <p className="min-w-0 font-semibold [overflow-wrap:anywhere]">{heading}</p>
        <p className="shrink-0 text-sm font-semibold">{formatCents(side === "buyer" ? order.total_cents : shopGets)}</p>
      </div>
      <p className="text-xs text-muted-foreground">{orderStatusLabel(order, side)}</p>
      <p className="text-sm">Ready {readyDateText(order.ready_date)}</p>
      <ul className="text-sm text-muted-foreground">
        {order.shop_order_lines.map((l) => (
          <li key={l.id} className="[overflow-wrap:anywhere]">
            {l.quantity} × {l.title} ({formatCents(l.line_cents)})
          </li>
        ))}
      </ul>
      {order.note && <p className="text-sm whitespace-pre-line [overflow-wrap:anywhere]">Note: {order.note}</p>}
      {order.decline_reason && <p className="text-sm [overflow-wrap:anywhere]">Shop's reason: {order.decline_reason}</p>}
      {side === "buyer" && !delivered && PICKUP_VISIBLE.has(order.status) && <PickupAddress orderId={order.id} />}
      {order.shop_order_lines.some((l) => l.at_buyer) && (side === "buyer" || SERVICE_VISIBLE_TO_SHOP.has(order.status)) && (
        <ServiceAddress orderId={order.id} />
      )}
      {delivered && (side === "buyer" || order.status === "accepted") && <DeliveryAddress orderId={order.id} side={side} />}
      {side === "buyer" ? (
        <p className="text-xs text-muted-foreground">
          Items {formatCents(order.items_cents)} + service fee {formatCents(order.premium_cents)}
          {delivered ? ` + delivery ${deliveryCents > 0 ? formatCents(deliveryCents) : "(free)"}` : ""}
          {order.tax_cents > 0 ? ` + tax ${formatCents(order.tax_cents)}` : ""}. {cancelPolicyText(order.cancel_policy, order.ready_tap_cancel).label}.
        </p>
      ) : (
        <p className="text-xs text-muted-foreground">
          {delivered && deliveryCents > 0
            ? `You get the item price in full plus your delivery fee: ${formatCents(shopGets)}. You deliver this order.`
            : delivered
              ? `You get the item price in full: ${formatCents(shopGets)}. You deliver this order.`
              : `You get the item price in full: ${formatCents(shopGets)}.`}
        </p>
      )}
      {/* Q1947: the chat with the other side, from the order (an order whose buyer deleted their account has none). */}
      {order.buyer_id && <ShopOrderMessageButton orderId={order.id} side={side} />}
      {/* Shops H9: after the handover, either side reviews the other once. */}
      <ShopOrderReview orderId={order.id} handedOver={!!order.handed_over_at} />
      {children}
    </li>
  );
}
