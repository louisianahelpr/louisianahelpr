/**
 * Step 4's "How can buyers get it?" (owner 2026-10-28: "pick up at my door. remove that. they need the option to
 * click which they will do, porch pick up, they deliver, safe meeting spot. whatever other options we have").
 *
 * The seller ticks the ways they offer; at least one. Pickup at the door is no longer offered. What is ticked is
 * stored per item (declutter_set_handovers) and checkout refuses any other way (declutter_start_checkout /
 * declutter_checkout_free: handover_not_offered); the buyer's checkout only shows what every item in it allows,
 * plus Helpr delivery, which buyers can always choose for what they buy (owner 2026-10-29, DC-4): it is said
 * plainly under the ticks, never offered as one.
 * "I'll deliver" shows only while seller delivery is open to this member (its own switch). A free item is claimed
 * through the free checkout, which takes porch pickup only, so it is porch pickup, ticked and fixed.
 */
import { DoorOpen, MapPin, Truck, Users } from "lucide-react";
import type { ComponentType } from "react";
import { Checkbox } from "@/components/ui/checkbox";
import type { SellerHandover } from "@/lib/declutter/api";
import { SellDeliveryOffNotice } from "./SellDeliveryOffNotice";
import { SellPorchDays } from "./SellPorchDays";
import { PLACE_CARD_EDGE, SellPorchPlaces } from "./SellPorchPlaces";

export const HANDOVER_CHOICE: Record<SellerHandover, { title: string; words: string; icon: ComponentType<{ className?: string }> }> = {
  porch: { title: "Porch pickup", words: "You leave it out and the buyer picks it up. You don't have to meet.", icon: DoorOpen },
  seller_delivery: { title: "I'll deliver", words: "You bring it to the buyer for your delivery price, at a time they pick. Set your price and times under it in Declutter settings.", icon: Truck },
  meetup: { title: "Safe meeting spot", words: "Meet at a public spot near you, like a police station lobby. Your address stays private.", icon: Users },
  delivery: { title: "Helpr delivery", words: "A local Helpr picks it up and brings it to the buyer, who pays for it.", icon: MapPin },
};

/**
 * The ways the seller chooses from. Helpr delivery is not one (owner 2026-10-29, DC-4): buyers can always choose
 * it for what they buy, so a tick for it did nothing a seller could rely on. An older listing may still have
 * 'delivery' stored; checkout ignores it (declutter_handover_refused, 20261030045905).
 */
export const SELLER_WAYS: SellerHandover[] = (Object.keys(HANDOVER_CHOICE) as SellerHandover[]).filter((w) => w !== "delivery");

/** Said once under the ways, plainly, instead of a tick. */
const HELPR_DELIVERY_ALWAYS = "Buyers can also choose Helpr delivery: a local Helpr picks it up from you and brings it to them, and the buyer pays for it.";

/** The ways in a set, in the form's order, as words for the review step ("Porch pickup, Safe meeting spot"). */
export function handoverSummary(ways: SellerHandover[]): string {
  return SELLER_WAYS.filter((w) => ways.includes(w)).map((w) => HANDOVER_CHOICE[w].title).join(", ");
}

/** On Declutter settings the price and times open under this tile once it is ticked (LEAD-DELIVER-TWICE), so no pointer. */
const DELIVER_WORDS_ON_SETTINGS = "You bring it to the buyer for your delivery price, at a time they pick.";

/**
 * The tick tiles themselves, shared by this step and the listing defaults in Declutter settings. `fixed`: ticked and
 * not changeable. `onSettingsPage`: the tiles are on Declutter settings.
 */
export function SellWayTiles({ shown, ways, setWays, fixed = false, onSettingsPage = false }: { shown: SellerHandover[]; ways: SellerHandover[]; setWays: (w: SellerHandover[]) => void; fixed?: boolean; onSettingsPage?: boolean }) {
  const toggle = (w: SellerHandover, on: boolean) => setWays(on ? [...new Set([...ways, w])] : ways.filter((x) => x !== w));
  return (
    <ul className="grid gap-2 lg:grid-cols-2">
      {shown.map((w) => {
        const c = HANDOVER_CHOICE[w];
        const on = fixed ? true : ways.includes(w);
        const Icon = c.icon;
        return (
          <li key={w}>
            <label htmlFor={`sell-way-${w}`} data-handover-tile={w} data-on={on ? "" : undefined}
              className={`flex h-full cursor-pointer items-start gap-3 rounded-[16px] border bg-card p-4 transition-colors focus-within:ring-2 focus-within:ring-ring ${on ? "border-[hsl(var(--bark))] dark:!border-[hsl(var(--bark))]" : `border-border ${PLACE_CARD_EDGE}`}`}>
              <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full ${on ? "bg-[hsl(var(--bark)/0.12)] text-[hsl(var(--bark))] dark:text-foreground" : "bg-muted text-muted-foreground"}`} aria-hidden>
                <Icon className="h-5 w-5" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-ds-15 font-semibold text-foreground">{c.title}</span>
                <span className="block text-ds-13 text-muted-foreground">{onSettingsPage && w === "seller_delivery" ? DELIVER_WORDS_ON_SETTINGS : c.words}</span>
              </span>
              <Checkbox id={`sell-way-${w}`} className="mt-1" checked={on} disabled={fixed}
                onCheckedChange={(v) => toggle(w, v === true)} aria-label={c.title} />
            </label>
          </li>
        );
      })}
    </ul>
  );
}

export function SellHandoverChoices({ ways, setWays, free, sellerDeliveryOpen, pickupDays }: {
  ways: SellerHandover[];
  setWays: (w: SellerHandover[]) => void;
  free: boolean;
  sellerDeliveryOpen: boolean;
  /** The weekdays of the pickup times being edited beside this (porch days are offered only from these). */
  pickupDays?: number[];
}) {
  const shown = SELLER_WAYS.filter((w) => (free ? w === "porch" : w !== "seller_delivery" || sellerDeliveryOpen));
  return (
    <div className="space-y-2" role="group" aria-labelledby="sell-ways">
      <p id="sell-ways" className="text-ds-14 font-semibold text-foreground">{free ? "How it's picked up" : "Tick every way that works for you"}</p>
      <SellWayTiles shown={shown} ways={ways} setWays={setWays} fixed={free} />
      {free && <p className="text-ds-13 text-muted-foreground" data-free-ways="">A free item is picked up from your porch.</p>}
      {!free && <p className="text-ds-13 text-muted-foreground" data-helpr-delivery-always="">{HELPR_DELIVERY_ALWAYS}</p>}
      {!free && sellerDeliveryOpen && <SellDeliveryOffNotice ticked={ways.includes("seller_delivery")} />}
      {(free || ways.includes("porch")) && <SellPorchDays pickupDays={pickupDays} />}
      {/* Not tied to the porch tick: declutter_start_checkout hands over at the buyer's pick for Helpr delivery too, and buyers can always choose that. */}
      <SellPorchPlaces free={free} helprOnly={!free && !ways.includes("porch")} />
    </div>
  );
}
