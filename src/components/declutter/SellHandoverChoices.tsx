/**
 * Step 4's "How can buyers get it?" (owner 2026-10-28: "pick up at my door. remove that. they need the option to
 * click which they will do, porch pick up, they deliver, safe meeting spot. whatever other options we have").
 *
 * The seller ticks the ways they offer; at least one. Pickup at the door is no longer offered. What is ticked is
 * stored per item (declutter_set_handovers) and checkout refuses any other way (declutter_start_checkout /
 * declutter_checkout_free: handover_not_offered); the buyer's checkout only shows what every item in it allows.
 * "I'll deliver" shows only while seller delivery is open to this member (its own switch). A free item is claimed
 * through the free checkout, which takes porch pickup only, so it is porch pickup, ticked and fixed.
 */
import { DoorOpen, MapPin, Truck, Users } from "lucide-react";
import type { ComponentType } from "react";
import { Checkbox } from "@/components/ui/checkbox";
import type { SellerHandover } from "@/lib/declutter/api";
import { SellDeliveryOffNotice } from "./SellDeliveryOffNotice";
import { SellPorchDays } from "./SellPorchDays";

export const HANDOVER_CHOICE: Record<SellerHandover, { title: string; words: string; icon: ComponentType<{ className?: string }> }> = {
  porch: { title: "Porch pickup", words: "You leave it out and the buyer picks it up. You don't have to meet.", icon: DoorOpen },
  seller_delivery: { title: "I'll deliver", words: "You bring it to the buyer for your delivery price, at a time they pick. Set your price and times under \"I can deliver\" on Selling.", icon: Truck },
  meetup: { title: "Safe meeting spot", words: "Meet at a public spot near you, like a police station lobby. Your address stays private.", icon: Users },
  delivery: { title: "Helpr delivery", words: "A local Helpr picks it up and brings it to the buyer, who pays for it.", icon: MapPin },
};

/** The ways in a set, in step 4's order, as words for the review step ("Porch pickup, Helpr delivery"). */
export function handoverSummary(ways: SellerHandover[]): string {
  return (Object.keys(HANDOVER_CHOICE) as SellerHandover[]).filter((w) => ways.includes(w)).map((w) => HANDOVER_CHOICE[w].title).join(", ");
}

export function SellHandoverChoices({ ways, setWays, free, sellerDeliveryOpen }: {
  ways: SellerHandover[];
  setWays: (w: SellerHandover[]) => void;
  free: boolean;
  sellerDeliveryOpen: boolean;
}) {
  const shown = (Object.keys(HANDOVER_CHOICE) as SellerHandover[]).filter((w) => (free ? w === "porch" : w !== "seller_delivery" || sellerDeliveryOpen));
  const toggle = (w: SellerHandover, on: boolean) => setWays(on ? [...new Set([...ways, w])] : ways.filter((x) => x !== w));
  return (
    <div className="space-y-2" role="group" aria-labelledby="sell-ways">
      <p id="sell-ways" className="text-ds-14 font-semibold text-foreground">Tick every way that works for you</p>
      <ul className="grid gap-2 lg:grid-cols-2">
        {shown.map((w) => {
          const c = HANDOVER_CHOICE[w];
          const on = free ? true : ways.includes(w);
          const Icon = c.icon;
          return (
            <li key={w}>
              <label htmlFor={`sell-way-${w}`} data-handover-tile={w} data-on={on ? "" : undefined}
                className={`flex h-full cursor-pointer items-start gap-3 rounded-[16px] border bg-card p-4 transition-colors focus-within:ring-2 focus-within:ring-ring ${on ? "border-[hsl(var(--bark))]" : "border-border"}`}>
                <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full ${on ? "bg-[hsl(var(--bark)/0.12)] text-[hsl(var(--bark))] dark:text-foreground" : "bg-muted text-muted-foreground"}`} aria-hidden>
                  <Icon className="h-5 w-5" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-ds-15 font-semibold text-foreground">{c.title}</span>
                  <span className="block text-ds-13 text-muted-foreground">{c.words}</span>
                </span>
                <Checkbox id={`sell-way-${w}`} className="mt-1" checked={on} disabled={free}
                  onCheckedChange={(v) => toggle(w, v === true)} aria-label={c.title} />
              </label>
            </li>
          );
        })}
      </ul>
      {free && <p className="text-ds-13 text-muted-foreground" data-free-ways="">A free item is picked up from your porch.</p>}
      {!free && sellerDeliveryOpen && <SellDeliveryOffNotice ticked={ways.includes("seller_delivery")} />}
      {(free || ways.includes("porch")) && <SellPorchDays />}
    </div>
  );
}
