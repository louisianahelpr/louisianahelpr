import { useLocation, useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { WhatNextSheet, type WhatNextStep } from "@/components/whatNext/WhatNextSheet";
import { fetchMyCart, type CartLine } from "@/lib/declutter/api";
import { formatPrice } from "@/lib/declutter/distance";

/**
 * The one order a ?paid=1 return is about, or null when that is not certain. The checkout
 * return names no order, so the sheet only opens when exactly ONE paid order of this buyer
 * is still in its handover; with two or more it stays shut rather than guess (truth rule).
 */
export function justPaidOrder(lines: CartLine[]): CartLine[] | null {
  const mine = lines.filter((l) => l.my_side === "buyer" && l.status === "paid" && l.order_id && l.order_status === "paid");
  const ids = [...new Set(mine.map((l) => l.order_id))];
  return ids.length === 1 ? mine : null;
}

/**
 * Board 82, "What next" after buying, on the shared WhatNextSheet, opened on the Buying tab
 * when the checkout returns (?paid=1). The amount is the order's own frozen total; the
 * steps follow the order's handover (pickup at home, porch, or Helpr delivery). Shipping
 * does not exist yet, so the board's "ships it / tracking" steps are not shown.
 */
export function BoughtWhatNext() {
  const location = useLocation();
  const navigate = useNavigate();
  const params = new URLSearchParams(location.search);
  const paid = params.get("paid") === "1";
  const cart = useQuery({ queryKey: ["declutter", "my-cart"], queryFn: fetchMyCart, enabled: paid });
  const order = paid && cart.data ? justPaidOrder(cart.data) : null;
  if (!order) return null;
  const close = () => { params.delete("paid"); navigate({ pathname: location.pathname, search: params.toString() }, { replace: true }); };
  const first = order[0];
  const total = first.total_cents;
  const handoverStep: WhatNextStep =
    first.handover === "delivery" ? { key: "go", label: "A local Helpr brings it", detail: "You'll see when it's on the way", state: "now" }
      : first.handover === "porch" ? { key: "go", label: "Pick it up from the porch", detail: "The seller sets it out for you", state: "now" }
        : { key: "go", label: "Pick it up", detail: "Pick a time with the seller in Buying", state: "now" };
  return (
    <WhatNextSheet
      open
      onClose={close}
      title={order.length === 1 ? `You bought ${first.item_title}` : `You bought ${order.length} items`}
      lead={total ? <>You paid <span className="font-semibold tabular-nums text-[hsl(var(--accent-ink))]">{formatPrice(total)}</span>. The seller is paid once you have it.</> : "The seller is paid once you have it."}
      steps={[
        { key: "paid", label: "Paid", detail: "Today", state: "done" },
        handoverStep,
        { key: "got", label: "You confirm you got it", detail: "Then the seller is paid", state: "later" },
      ]}
      primary={{ label: "Got it", acknowledge: true }}
    />
  );
}
