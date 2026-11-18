/**
 * The Deliver tab's opening card (owner 2026-10-28: "it's still under declutter, not separate, just explain it
 * better"). What it is, what you need, and what a driver earns, in the driver's own pay: the example figures are
 * computed from the real rule (deliveryPriceCents, then helprTakeHomeCents: the delivery price, less the flat job fee,
 * rounded down to the dollar), never typed in, and no platform fee number is shown (members see no fee numbers).
 * Tips: the Helpr receives the whole tip (deliveryTip.ts, Q2453).
 */
import { useState } from "react";
import { ChevronDown, Truck } from "lucide-react";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { deliveryPriceCents, helprTakeHomeCents } from "@/lib/declutter/delivery";
import { formatPrice } from "@/lib/declutter/distance";

/** The example trip the card prices: 5 road miles. */
export const EXAMPLE_MILES = 5;

/**
 * `collapsed` (audit DD D1): once the Helpr has a car saved, the card folds to its title, a button that opens it again.
 */
export function DeliverExplainer({ collapsed = false }: { collapsed?: boolean }) {
  const [opened, setOpened] = useState<boolean | null>(null);
  const open = opened ?? !collapsed;
  const title = "Deliver Declutter items and get paid";
  const small = helprTakeHomeCents(deliveryPriceCents(EXAMPLE_MILES, ["small"]));
  const large = helprTakeHomeCents(deliveryPriceCents(EXAMPLE_MILES, ["large"]));
  return (
    <Collapsible open={open} onOpenChange={setOpened} asChild>
    <section className="space-y-2 rounded-2xl border border-border/60 bg-card p-4" aria-labelledby="deliver-explainer-title" data-deliver-explainer="">
      {/* Folded, the title is a 44px button: centre the icon on it (B75 1440 shot: it sat above the title line). */}
      <div className={`flex gap-2 ${collapsed ? "items-center" : "items-start"}`}>
        <Truck className={`h-4 w-4 shrink-0 text-[hsl(var(--bark))] ${collapsed ? "" : "mt-1"}`} aria-hidden />
        <h2 id="deliver-explainer-title" className="text-base font-semibold min-w-0 flex-1">
          {collapsed ? (
            <CollapsibleTrigger className="flex min-h-11 w-full items-center justify-between gap-2 text-left" data-deliver-explainer-toggle="">
              {title}
              <ChevronDown className={`h-4 w-4 shrink-0 transition-transform ${open ? "rotate-180" : ""}`} aria-hidden />
            </CollapsibleTrigger>
          ) : title}
        </h2>
      </div>
      <CollapsibleContent className="space-y-2">
      {/* Design audit 11-17 #18: three dense paragraphs (~110 words) opened the tab. Two short lines now; the steps and
          the rules sit behind "How deliveries work". */}
      <p className="text-sm text-muted-foreground" data-deliver-what="">Pick up from a neighbor, drop at the buyer&apos;s door.</p>
      <p className="text-sm text-foreground" data-deliver-pay="">
        A {EXAMPLE_MILES}-mile trip pays you <span className="font-semibold tabular-nums">{formatPrice(small)}</span>, or{" "}
        <span className="font-semibold tabular-nums">{formatPrice(large)}</span> for a large item. Tips are all yours.
      </p>
      <details className="group" data-deliver-how="">
        <summary className="flex min-h-11 cursor-pointer list-none items-center gap-1 text-sm font-semibold text-[hsl(var(--olivewood))] [&::-webkit-details-marker]:hidden">
          How deliveries work
          <ChevronDown className="h-4 w-4 shrink-0 transition-transform group-open:rotate-180" aria-hidden />
        </summary>
        <div className="space-y-2 pb-1">
          <p className="text-sm text-muted-foreground">
            When a neighbor buys an item and picks Helpr delivery, a nearby driver brings it. You pick it up at the
            seller&apos;s, take a photo there, and leave it at the buyer&apos;s door with a photo. You need a car, and a
            truck for large items. Every delivery shows your pay before you take it.
          </p>
          {/* BUY-45: the rules helpr_task_accept and helpr_task_sweep apply (20261031102758, 20261031014011). */}
          <p className="text-sm text-muted-foreground" data-deliver-rules="">
            You can have 2 deliveries taken and not yet picked up at a time. If you don&apos;t pick it up within 2 hours of the
            pickup time, it goes to another Helpr and you get a delivery strike.
          </p>
        </div>
      </details>
      </CollapsibleContent>
    </section>
    </Collapsible>
  );
}
