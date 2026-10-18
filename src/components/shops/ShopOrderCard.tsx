/**
 * One Shops order, as both sides read it (Shops M1): its lines, ready date,
 * note, money and status in plain words. The actions (withdraw for the buyer,
 * accept / decline for the shop) are passed in by the screen.
 */
import type { ReactNode } from "react";
import { parseLocalDate } from "@/lib/dateUtils";
import { CANCEL_POLICY_TEXT, formatCents, orderStatusLabel, type ShopOrder } from "@/lib/shops/orders";

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
  const shopGets = order.items_cents;
  return (
    <li className="space-y-2 rounded-2xl border border-border bg-card p-4" data-testid="shop-order-card">
      <div className="flex items-start justify-between gap-2">
        <p className="min-w-0 font-semibold [overflow-wrap:anywhere]">{heading}</p>
        <p className="shrink-0 text-sm font-semibold">{formatCents(side === "buyer" ? order.total_cents : shopGets)}</p>
      </div>
      <p className="text-xs text-muted-foreground">{orderStatusLabel(order)}</p>
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
      {side === "buyer" ? (
        <p className="text-xs text-muted-foreground">
          Items {formatCents(order.items_cents)} + service fee {formatCents(order.premium_cents)}
          {order.tax_cents > 0 ? ` + tax ${formatCents(order.tax_cents)}` : ""}. {CANCEL_POLICY_TEXT[order.cancel_policy].label}.
        </p>
      ) : (
        <p className="text-xs text-muted-foreground">You get the item price in full: {formatCents(shopGets)}.</p>
      )}
      {children}
    </li>
  );
}
