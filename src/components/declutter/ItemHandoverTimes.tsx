/**
 * The item page's times (review of LEAD-PLACE-TIMES, lead's product call 2026-10-31): pickup places govern porch
 * pickup, door pickup and Helpr pickup; the seller's usual times stay ONLY for meetups ("Meetup times"). So the
 * item shows the places block for a porch, pickup or delivery item and never for a meetup-only one, and never both
 * lists for the same way of getting it. A seller with no places keeps the usual times for pickup, as the server does
 * (declutter_order_pickup_windows falls back to them).
 */
import { useQuery } from "@tanstack/react-query";
import type { SellerHandover } from "@/lib/declutter/api";
import { fetchItemPickupPlaces } from "@/lib/declutter/porchPlaces";
import { ItemPickupPlaces, ItemPickupTimes } from "./ItemPickupDisplay";

export type ItemTimesPlan = { places: boolean; usual: null | "Meetup times" | "Pickup times" | "Pickup and meetup times" };

/**
 * Which lists the item shows. `handovers` null: an older item, picked up at the porch or the door. `hasPlaces` null:
 * the places read has not answered yet (nothing for pickup is shown, so the usual times never flash in first).
 */
export function itemTimesPlan(handovers: readonly SellerHandover[] | null | undefined, hasPlaces: boolean | null): ItemTimesPlan {
  const ways = Array.isArray(handovers) ? handovers : null;
  const meetup = !!ways?.includes("meetup");
  // The buyer comes for it: porch, or an older item (no ticks: the porch or the door).
  const pickup = ways === null || ways.includes("porch");
  // A Helpr delivery is picked up at the place too.
  const placeWay = pickup || !!ways?.includes("delivery");
  if (hasPlaces === null) return { places: false, usual: meetup && !pickup ? "Meetup times" : null };
  const places = hasPlaces && placeWay;
  // No meetup: the usual times show only as an older item's pickup times with no place saved. BUY-18: porch with no
  // place is picked up on a porch DAY, so the usual hours are not its times.
  if (!meetup) return { places, usual: !hasPlaces && ways === null ? "Pickup times" : null };
  return { places, usual: !hasPlaces && pickup ? "Pickup and meetup times" : "Meetup times" };
}

export function ItemHandoverTimes({ itemId, handovers }: { itemId: string; handovers: SellerHandover[] | null | undefined }) {
  const read = useQuery({ queryKey: ["declutter", "item-pickup-places", itemId], queryFn: () => fetchItemPickupPlaces(itemId) });
  // A failed read or a server without places: ItemPickupPlaces says so / shows nothing; the usual times then apply.
  const hasPlaces = read.isPending ? null : Array.isArray(read.data) && read.data.length > 0;
  const plan = itemTimesPlan(handovers, hasPlaces);
  return (<>
    {plan.usual && <ItemPickupTimes itemId={itemId} label={plan.usual} />}
    {(plan.places || read.isError) && <ItemPickupPlaces itemId={itemId} />}
  </>);
}
