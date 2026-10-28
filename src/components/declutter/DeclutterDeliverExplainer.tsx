/**
 * The Deliver tab's opening card (owner 2026-10-28: "it's still under declutter, not separate, just explain it
 * better"). What it is, what you need, and what a driver earns, in the driver's own pay: the example figures are
 * computed from the real rule (deliveryPriceCents, then helprTakeHomeCents: the delivery price, less the flat job fee,
 * rounded down to the dollar), never typed in, and no platform fee number is shown (members see no fee numbers).
 * Tips: the Helpr receives the whole tip (deliveryTip.ts, Q2453).
 */
import { Truck } from "lucide-react";
import { deliveryPriceCents, helprTakeHomeCents } from "@/lib/declutter/delivery";
import { formatPrice } from "@/lib/declutter/distance";

/** The example trip the card prices: 5 road miles. */
export const EXAMPLE_MILES = 5;

export function DeliverExplainer() {
  const small = helprTakeHomeCents(deliveryPriceCents(EXAMPLE_MILES, ["small"]));
  const large = helprTakeHomeCents(deliveryPriceCents(EXAMPLE_MILES, ["large"]));
  return (
    <section className="space-y-2 rounded-2xl border border-border/60 bg-card p-4" aria-labelledby="deliver-explainer-title" data-deliver-explainer="">
      <div className="flex items-start gap-2">
        <Truck className="mt-1 h-4 w-4 shrink-0 text-[hsl(var(--bark))]" aria-hidden />
        <h2 id="deliver-explainer-title" className="text-base font-semibold">Deliver Declutter items and get paid</h2>
      </div>
      <p className="text-sm text-muted-foreground">
        When a neighbor buys an item on Declutter and picks Helpr delivery, a nearby driver brings it. You pick it up at
        the seller's, take a photo there, and leave it at the buyer's door with a photo. You need a car, and a truck for
        large items.
      </p>
      <p className="text-sm text-foreground" data-deliver-pay="">
        A {EXAMPLE_MILES}-mile trip pays you <span className="font-semibold tabular-nums">{formatPrice(small)}</span>, or{" "}
        <span className="font-semibold tabular-nums">{formatPrice(large)}</span> for a large item. Every delivery shows
        your pay before you take it, and tips are all yours.
      </p>
    </section>
  );
}
