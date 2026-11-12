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
import { useEffect, useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { InlineTextButton } from "@/components/ui/InlineTextButton";
import { useMutation, useQuery } from "@tanstack/react-query";
import { MapPin } from "lucide-react";
import { parseLocalDate } from "@/lib/dateUtils";
import { buyerPaidCents, formatCents, orderCancelLine, orderStatusLabel, payOrderRest, setupFeeChargedCents, SHOP_SERVICE_FEE_INCLUDED, type ShopOrder } from "@/lib/shops/orders";
import { openExternalUrl } from "@/lib/openExternalUrl";
import { fetchOrderPickupAddress, fetchOrderServiceAddress } from "@/lib/shops/pickupAddress";
import { fetchOrderDeliveryAddress, fetchOrderHelprTask, formatDeliveryAddress, reportHelprNoShow } from "@/lib/shops/delivery";
import { fetchTaskView } from "@/lib/helprTasks/api";
import { toast } from "sonner";
import { shopsErrorMessage } from "@/lib/shops/errors";
import { ShopOrderMessageButton } from "./ShopTalk";
import { ShopOrderReview } from "./ShopReviews";
import ShopDigitalOrder from "./ShopDigitalOrder";

/** The order statuses in which the buyer may read the shop's pickup address (shops_order_pickup_address). */
/** S013: the statuses where the buyer can still cancel, so the card shows the cancel rule. */
const CANCEL_RULE_VISIBLE = new Set(["held", "accepted"]);
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

/**
 * Custom orders (50% deposit, slice 2b): half is charged when the shop accepts, the rest on the ready date to the card
 * saved at checkout. When that card did not take it (balance_failed_at), the buyer pays it here (shop-checkout
 * pay_balance); the shop waits, and the order cannot be handed over until it is paid.
 */
function DepositRest({ order, side }: { order: ShopOrder; side: "buyer" | "shop" }) {
  const [opening, setOpening] = useState(false);
  const rest = order.balance_cents ?? null;
  if (order.payment_plan !== "deposit_50" || rest === null || rest <= 0) return null;
  if (order.status !== "accepted" && order.status !== "handed_over") return null;
  const paid = !!order.balance_captured_at;
  const owedNow = !paid && !!order.balance_failed_at && order.status === "accepted";
  const pay = async () => {
    setOpening(true);
    try {
      const url = await payOrderRest(order.id);
      await openExternalUrl(url, () => setOpening(false));
    } catch (err) {
      toast.error(shopsErrorMessage(err));
      setOpening(false);
    }
  };
  // S037 (Shops audit 11-12, copy only): the shop read the BUYER's charged amounts (with the service fee and tax), which
  // never added up to its own price. The shop's box says the halves in words; its price is the card's own line.
  if (side === "shop") {
    return (
      <div className="space-y-2 rounded-xl bg-muted/60 p-3 text-sm" data-testid="shop-order-deposit">
        <p>
          Half was charged to the buyer&apos;s card when you accepted.{" "}
          {paid
            ? "The other half is paid."
            : owedNow
              ? "The other half didn't go through on the buyer's card. We asked them to pay it; hand over the order once it's paid."
              : "The other half is charged to the buyer's card on the ready date."}
        </p>
      </div>
    );
  }
  return (
    <div className="space-y-2 rounded-xl bg-muted/60 p-3 text-sm" data-testid="shop-order-deposit">
      <p>
        {side === "buyer" ? "Paid when the shop accepted" : "The buyer paid when you accepted"}: {formatCents(order.deposit_cents ?? 0)}.{" "}
        {paid
          ? `The rest, ${formatCents(rest)}, is paid.`
          : owedNow
            ? side === "buyer"
              ? `The rest, ${formatCents(rest)}, didn't go through on your card. Pay it to get your order.`
              : `The rest, ${formatCents(rest)}, didn't go through on the buyer's card. We asked them to pay it; hand over the order once it's paid.`
            : side === "buyer"
              ? `The rest, ${formatCents(rest)}, is charged to your card on the ready date.`
              : `The rest, ${formatCents(rest)}, is charged to the buyer's card on the ready date.`}
      </p>
      {side === "buyer" && owedNow && (
        <Button type="button" className="btn-grad-primary w-full" disabled={opening} onClick={() => void pay()}>
          {opening ? "Opening…" : `Pay the rest (${formatCents(rest)})`}
        </Button>
      )}
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
  // Helpr delivery (20261106194913): a Helpr picks up at the shop; if none took it, it became a pickup.
  const byHelpr = order.fulfillment === "helpr_delivers" && !order.helpr_unfilled_at;
  // Work done at the buyer's place never needs the shop's private pickup address (shops audit 11-08 #2; the server
  // read, shops_order_pickup_address, refuses it too).
  const atBuyer = order.shop_order_lines.some((l) => l.at_buyer);
  // The shop is paid its items and its own delivery fee (shop_complete_handover, 20261106180902); a Helpr
  // delivery's price is the Helpr's, never the shop's.
  const deliveryCents = order.delivery_cents ?? 0;
  const shopDeliveryCents = delivered ? deliveryCents : 0;
  const shopGets = order.items_cents + shopDeliveryCents;
  if (order.is_digital) return <DigitalOrderCard order={order} heading={heading} side={side} />;
  return (
    <li className="space-y-2 rounded-2xl border border-border bg-card p-4" data-testid="shop-order-card">
      <div className="flex items-start justify-between gap-2">
        <p className="min-w-0 font-semibold [overflow-wrap:anywhere]">{heading}</p>
        <p className="shrink-0 text-sm font-semibold">{formatCents(side === "buyer" ? buyerPaidCents(order) : shopGets)}</p>
      </div>
      <p className="text-xs text-muted-foreground">{orderStatusLabel(order, side)}</p>
      <p className="text-sm">{order.preorder_item_id ? "Preorder, ready by" : "Ready"} {readyDateText(order.ready_date)}</p>
      {order.preorder_item_id && order.preorder_moved_at && order.status === "accepted" && (
        <p className="text-xs font-semibold" data-testid="shop-preorder-moved">
          {side === "buyer" ? "The shop moved the date. If it doesn't work for you, cancel for a full refund." : "You moved this date. The buyer can cancel for a full refund."}
        </p>
      )}
      <ul className="text-sm text-muted-foreground">
        {order.shop_order_lines.map((l) => (
          <li key={l.id} className="[overflow-wrap:anywhere]">
            {l.quantity} × {l.title} ({formatCents(l.line_cents)})
          </li>
        ))}
      </ul>
      {order.note && <p className="text-sm whitespace-pre-line [overflow-wrap:anywhere]">Note: {order.note}</p>}
      {order.decline_reason && <p className="text-sm [overflow-wrap:anywhere]">Shop's reason: {order.decline_reason}</p>}
      {side === "buyer" && !delivered && !byHelpr && !atBuyer && PICKUP_VISIBLE.has(order.status) && <PickupAddress orderId={order.id} />}
      {order.shop_order_lines.some((l) => l.at_buyer) && (side === "buyer" || SERVICE_VISIBLE_TO_SHOP.has(order.status)) && (
        <ServiceAddress orderId={order.id} />
      )}
      {delivered && (side === "buyer" || order.status === "accepted") && <DeliveryAddress orderId={order.id} side={side} />}
      {byHelpr && side === "buyer" && <DeliveryAddress orderId={order.id} side={side} />}
      {side === "buyer" ? (
        <p className="text-xs text-muted-foreground">
          {/* S010: no fee name or number (10-25 rule); S036: the one-time setup fee the card carried is its own part. */}
          Items {formatCents(order.items_cents)}
          {delivered ? ` + delivery ${deliveryCents > 0 ? formatCents(deliveryCents) : "(free)"}` : ""}
          {byHelpr ? ` + Helpr delivery ${formatCents(deliveryCents)}` : ""}
          {order.tax_cents > 0 ? ` + tax ${formatCents(order.tax_cents)}` : ""}
          {setupFeeChargedCents(order) > 0 ? ` + one-time account setup fee ${formatCents(setupFeeChargedCents(order))}` : ""}.
          {` ${SHOP_SERVICE_FEE_INCLUDED}`}
          {/* S013 (Shops audit 11-12): the cancel rule only while the buyer can still cancel (waiting or accepted, not
              yet handed over); on a finished or closed order it read as if they still could. */}
          {/* S2-044: an accepted order whose window already closed says so (orderCancelLine). */}
          {CANCEL_RULE_VISIBLE.has(order.status) && !order.handed_over_at && orderCancelLine(order)
            ? ` ${orderCancelLine(order)}`
            : ""}
        </p>
      ) : (
        // S037 (Shops audit 11-12, copy only): "You get the item price in full" promised an amount that a card-cost debt
        // or the first-payout setup fee can lower. The line says the shop's own price; what is paid out (the payout's
        // own numbers, owner 11-11 F360b) needs the payout read on this card (money lane).
        <p className="text-xs text-muted-foreground" data-testid="shop-order-your-price">
          {delivered && deliveryCents > 0
            ? `Your price plus what the buyer paid for delivery: ${formatCents(shopGets)}. You deliver this order.`
            : delivered
              ? `Your price: ${formatCents(shopGets)}. You deliver this order.`
              : byHelpr
                ? `Your price: ${formatCents(shopGets)}. A Helpr picks it up at your pickup address.`
                : `Your price: ${formatCents(shopGets)}.`}
        </p>
      )}
      {side === "shop" && byHelpr && order.status === "accepted" && !order.handed_over_at && <HelprPickup orderId={order.id} />}
      <DepositRest order={order} side={side} />
      {/* Q1947: the chat with the other side, from the order (an order whose buyer deleted their account has none). */}
      {order.buyer_id && <ShopOrderMessageButton orderId={order.id} side={side} />}
      {/* Shops H9: after the handover, either side reviews the other once. */}
      <ShopOrderReview orderId={order.id} handedOver={!!order.handed_over_at} />
      {children}
    </li>
  );
}

/**
 * A digital download's card (20261108185110): no ready date, pickup, delivery or handover taps, and no cancel (a
 * download can only be refunded through a problem report an admin decides). The chat and the review stay.
 */
function DigitalOrderCard({ order, heading, side }: { order: ShopOrder; heading: string; side: "buyer" | "shop" }) {
  return (
    <li className="space-y-2 rounded-2xl border border-border bg-card p-4" data-testid="shop-order-card">
      <div className="flex items-start justify-between gap-2">
        <p className="min-w-0 font-semibold [overflow-wrap:anywhere]">{heading}</p>
        <p className="shrink-0 text-sm font-semibold">{formatCents(side === "buyer" ? buyerPaidCents(order) : order.items_cents)}</p>
      </div>
      <p className="text-xs text-muted-foreground">{orderStatusLabel(order, side)}</p>
      <ul className="text-sm text-muted-foreground">
        {order.shop_order_lines.map((l) => (
          <li key={l.id} className="[overflow-wrap:anywhere]">{l.title} (download, {formatCents(l.line_cents)})</li>
        ))}
      </ul>
      <ShopDigitalOrder order={order} side={side} />
      {order.buyer_id ? <ShopOrderMessageButton orderId={order.id} side={side} /> : null}
      <ShopOrderReview handedOver={!!order.handed_over_at} orderId={order.id} />
    </li>
  );
}

/** The server's "didn't come" opens 15 minutes after the booked pickup time (shop_report_helpr_no_show: too_early). */
const NO_SHOW_AFTER_MS = 15 * 60_000;
const pickupWhen = (iso: string) =>
  new Date(iso).toLocaleString([], { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

/**
 * The shop's view of the Helpr pickup (lead 11-07): who is booked and when (shops_order_helpr_task, 20261107164311,
 * then helpr_task_view as the task's pickup contact), and the "didn't come" button only from 15 minutes after the
 * booked time, while it is still booked, not handed over and no problem holds the order. Before that the server
 * answered too_early to a button that showed all along.
 */
function HelprPickup({ orderId }: { orderId: string }) {
  const task = useQuery({ queryKey: ["shops", "order-helpr-task", orderId], queryFn: () => fetchOrderHelprTask(orderId) });
  const taskId = task.data ?? null;
  const view = useQuery({
    queryKey: ["helpr-tasks", "view", taskId],
    queryFn: () => fetchTaskView(taskId as string),
    enabled: !!taskId,
    meta: { persist: false },
  });
  const slot = view.data?.status === "accepted" ? view.data.pickup_slot_start : null;
  const opensAt = slot ? new Date(slot).getTime() + NO_SHOW_AFTER_MS : null;
  // The button appears on its own when the time comes, without a reload.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (opensAt === null || opensAt <= now) return;
    const timer = window.setTimeout(() => setNow(Date.now()), Math.min(opensAt - now + 500, 2_147_000_000));
    return () => window.clearTimeout(timer);
  }, [opensAt, now]);
  if (task.isError || view.isError) {
    return (
      <p className="text-sm">
        We couldn't load the Helpr's pickup time.{" "}
        <InlineTextButton className="underline" onClick={() => { void task.refetch(); if (taskId) void view.refetch(); }}>Try again</InlineTextButton>
      </p>
    );
  }
  const v = view.data;
  if (!taskId || !v) return null;
  if (v.status === "open") return <p className="text-sm" data-testid="shop-helpr-pickup">No Helpr has taken this delivery yet.</p>;
  if (!slot) return null;
  const canReport = opensAt !== null && now >= opensAt && !v.problem_open && !v.handed_over_at;
  return (
    <>
      <p className="text-sm" data-testid="shop-helpr-pickup">{v.helpr_first_name ?? "Your Helpr"} picks it up {pickupWhen(slot)}.</p>
      {canReport && <HelprNoShowButton orderId={orderId} />}
    </>
  );
}

/**
 * The shop says the booked Helpr didn't come (shop_report_helpr_no_show, 20261106211136). Shown by HelprPickup from
 * 15 minutes after the booked pickup time; the server still checks the time and the booking and answers in words.
 * Two taps: the first asks, the second sends.
 */
function HelprNoShowButton({ orderId }: { orderId: string }) {
  const [asking, setAsking] = useState(false);
  const report = useMutation({
    mutationFn: () => reportHelprNoShow(orderId),
    onSuccess: () => {
      setAsking(false);
      toast("We told the Helpr. They have 24 hours to answer, and the money waits until this is sorted out.");
    },
    onError: (err) => toast.error(shopsErrorMessage(err)),
  });
  if (!asking) {
    return (
      <InlineTextButton onClick={() => setAsking(true)} data-testid="shop-helpr-no-show">
        The Helpr didn't come
      </InlineTextButton>
    );
  }
  return (
    <div className="space-y-2 rounded-xl bg-muted/60 p-3" role="group" aria-label="The Helpr didn't come">
      <p className="text-sm">Tell us the Helpr didn't come for the pickup? They get 24 hours to answer.</p>
      <div className="flex gap-2">
        <Button type="button" size="sm" variant="outline" disabled={report.isPending} onClick={() => report.mutate()}>
          {report.isPending ? "Sending…" : "Yes, tell them"}
        </Button>
        <Button type="button" size="sm" variant="ghost" disabled={report.isPending} onClick={() => setAsking(false)}>
          Not now
        </Button>
      </div>
    </div>
  );
}
