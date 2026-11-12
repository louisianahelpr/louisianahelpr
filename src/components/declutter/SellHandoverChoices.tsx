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
import { enListingParts } from "@/lib/i18n/enListingParts";
import { t } from "@/lib/i18n/language";

const HANDOVER_CHOICE: Record<SellerHandover, { title: string; words: string; icon: ComponentType<{ className?: string }> }> = {
  porch: { title: enListingParts["lp.way.porch"], words: enListingParts["lp.way.porch.words"], icon: DoorOpen },
  seller_delivery: { title: enListingParts["lp.way.seller_delivery"], words: enListingParts["lp.way.seller_delivery.words"], icon: Truck },
  meetup: { title: enListingParts["lp.way.meetup"], words: enListingParts["lp.way.meetup.words"], icon: Users },
  delivery: { title: enListingParts["lp.way.delivery"], words: enListingParts["lp.way.delivery.words"], icon: MapPin },
};

/**
 * The ways the seller chooses from. Helpr delivery is not one (owner 2026-10-29, DC-4): buyers can always choose
 * it for what they buy, so a tick for it did nothing a seller could rely on. An older listing may still have
 * 'delivery' stored; checkout ignores it (declutter_handover_refused, 20261030045905).
 */
export const SELLER_WAYS: SellerHandover[] = (Object.keys(HANDOVER_CHOICE) as SellerHandover[]).filter((w) => w !== "delivery");


/** The ways in a set, in the form's order, as words for the review step ("Porch pickup, Safe meeting spot"). */
export function handoverSummary(ways: SellerHandover[]): string {
  return SELLER_WAYS.filter((w) => ways.includes(w)).map((w) => wayTitle(w)).join(", ");
}

/** On Declutter settings the price and times open under this tile once it is ticked (LEAD-DELIVER-TWICE), so no pointer. */
const DELIVER_WORDS_ON_SETTINGS = () => t("lp.deliverOnSettings");

/** A way's name in the member's language (F260q); HANDOVER_CHOICE keeps the English. */
export const wayTitle = (w: SellerHandover): string => t(`lp.way.${w}`);

/**
 * The tick tiles themselves, shared by this step and the listing defaults in Declutter settings. `fixed`: ticked and
 * not changeable. `onSettingsPage`: the tiles are on Declutter settings.
 */
export function SellWayTiles({ shown, ways, setWays, fixed = false, onSettingsPage = false }: { shown: SellerHandover[]; ways: SellerHandover[]; setWays: (w: SellerHandover[]) => void; fixed?: boolean; onSettingsPage?: boolean }) {
  const toggle = (w: SellerHandover, on: boolean) => setWays(on ? [...new Set([...ways, w])] : ways.filter((x) => x !== w));
  return (
    // Q2582 (audit 1102a): three tiles in two columns left "Safe meeting spot" alone beside an empty half; two
    // columns only when the tiles pair up.
    <ul className={shown.length % 2 === 0 ? "grid gap-2 lg:grid-cols-2" : "grid gap-2"} data-way-tiles="">
      {shown.map((w) => {
        const c = HANDOVER_CHOICE[w];
        const on = fixed ? true : ways.includes(w);
        const Icon = c.icon;
        return (
          <li key={w}>
            <label htmlFor={`sell-way-${w}`} data-handover-tile={w} data-on={on ? "" : undefined}
              className={`flex h-full cursor-pointer items-start gap-3 rounded-[16px] border bg-card p-4 transition-colors focus-within:ring-2 focus-within:ring-ring ${on ? "!border-[hsl(var(--bark))]" : `border-border ${PLACE_CARD_EDGE}`}`}>
              <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full ${on ? "bg-[hsl(var(--bark)/0.12)] text-[hsl(var(--bark))] dark:text-foreground" : "bg-muted text-muted-foreground"}`} aria-hidden>
                <Icon className="h-5 w-5" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-ds-15 font-semibold text-foreground">{wayTitle(w)}</span>
                <span className="block text-ds-13 text-muted-foreground">{onSettingsPage && w === "seller_delivery" ? DELIVER_WORDS_ON_SETTINGS() : t(`lp.way.${w}.words`)}</span>
              </span>
              <Checkbox id={`sell-way-${w}`} className="mt-1" checked={on} disabled={fixed}
                onCheckedChange={(v) => toggle(w, v === true)} aria-label={wayTitle(w)} />
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
      <p id="sell-ways" className="text-ds-14 font-semibold text-foreground">{free ? t("lp.waysHeadFree") : t("lp.waysHead")}</p>
      <SellWayTiles shown={shown} ways={ways} setWays={setWays} fixed={free} />
      {free && <p className="text-ds-13 text-muted-foreground" data-free-ways="">{t("lp.freeWays")}</p>}
      {!free && <p className="text-ds-13 text-muted-foreground" data-helpr-delivery-always="">{t("lp.helprAlways")}</p>}
      {!free && sellerDeliveryOpen && <SellDeliveryOffNotice ticked={ways.includes("seller_delivery")} />}
      {(free || ways.includes("porch")) && <SellPorchDays pickupDays={pickupDays} />}
      {/* Not tied to the porch tick: declutter_start_checkout hands over at the buyer's pick for Helpr delivery too, and buyers can always choose that. */}
      <SellPorchPlaces free={free} helprOnly={!free && !ways.includes("porch")} />
    </div>
  );
}
