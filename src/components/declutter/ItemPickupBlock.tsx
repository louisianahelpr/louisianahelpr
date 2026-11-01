/**
 * The item page's ONE pickup block (owner mockup 11-01, Mockups 1 and 2: "Pickup: one block, no repeats"):
 *   Porch pickup · New Iberia or Delcambre
 *   Every day, 7 AM – 9 PM · exact address after you pay
 * Line 1 names every way the seller ticked (checkout's words, HANDOVER_TITLE) and the cities (the pickup places'
 * cities, else the item's area). Line 2 says the hours once: places with identical hours show them once; places with
 * different hours each get "City: hours". The usual times show only as Meetup times (or an older item's pickup times),
 * by the same plan as before (itemTimesPlan). No "You can get it by:" list, no repeated "Pickup in <town>".
 * The reads and their cache keys are the ones ItemPickupWays / ItemHandoverTimes / ItemPickupDisplay use.
 */
import { useQuery } from "@tanstack/react-query";
import { ErrorState } from "@/components/ui/ErrorState";
import { fetchItemHandovers, type SellerHandover } from "@/lib/declutter/api";
import { declutterErrorMessage } from "@/lib/declutter/errors";
import { fetchItemPickupWindows } from "@/lib/declutter/handover";
import { windowsSummary } from "@/lib/declutter/pickupSlots";
import { fetchItemPickupPlaces } from "@/lib/declutter/porchPlaces";
import { noDeliveryWay } from "@/lib/declutter/pickupWords";
import { HANDOVER_TITLE } from "./handoverCopy";
import { placeHoursLine } from "./DeclutterPickupTimes";
import { itemTimesPlan } from "./ItemHandoverTimes";

const ORDER: SellerHandover[] = ["porch", "meetup", "seller_delivery", "delivery"];

/** When the exact pickup address is shared, said to whoever is reading (audit DC-7: the seller is not the one paying). */
function addressNote(free: boolean, isSeller: boolean): string {
  if (isSeller) return free ? "buyers see your exact address only once they're picked" : "buyers see your exact address only after they pay";
  return free ? "exact address if the giver picks you" : "exact address after you pay";
}

/** "A or B" / "A, B or C". */
function orList(xs: string[]): string {
  if (xs.length <= 1) return xs[0] ?? "";
  return `${xs.slice(0, -1).join(", ")} or ${xs[xs.length - 1]}`;
}

export function ItemPickupBlock({ itemId, porchOk, areaLabel, free, isSeller, showAddressNote, readTimes }: {
  itemId: string; porchOk: boolean; areaLabel: string; free: boolean; isSeller: boolean;
  /** DA-6: the member who already bought or claimed it gets no "after you pay" words. */
  showAddressNote: boolean;
  /** Times and places are read only for a signed-in member while the item is for sale (the server answers nothing else). */
  readTimes: boolean;
}) {
  const ways = useQuery({ queryKey: ["declutter", "item-handovers", itemId], queryFn: () => fetchItemHandovers(itemId) });
  const places = useQuery({ queryKey: ["declutter", "item-pickup-places", itemId], queryFn: () => fetchItemPickupPlaces(itemId), enabled: readTimes, retryOnMount: false });
  const hasPlaces = !readTimes ? false : places.isPending ? null : Array.isArray(places.data) && places.data.length > 0;
  const plan = itemTimesPlan(ways.data, hasPlaces);
  const usual = useQuery({
    queryKey: ["declutter", "item-pickup-windows", itemId],
    queryFn: () => fetchItemPickupWindows(itemId),
    enabled: readTimes && !!plan.usual,
  });
  const way = noDeliveryWay(ways.data);
  const heading = way === "none" ? "Delivery" : way === "meetup" ? "Meetup" : "Pickup";

  // Line 1: how, and where.
  const ticked = Array.isArray(ways.data) ? ORDER.filter((w) => ways.data!.includes(w)) : null;
  const how = ticked === null ? [porchOk ? "Porch pickup" : "Meet at the seller's home"] : ticked.map((w) => HANDOVER_TITLE[w]);
  const placeList = plan.places && Array.isArray(places.data) ? places.data : [];
  const cities = placeList.length > 0 ? [...new Set(placeList.map((p) => p.area).filter(Boolean))] : [areaLabel];

  // Line 2: the hours, identical ones once.
  const hourLines = placeList.map((p) => ({ area: p.area, hours: placeHoursLine(p.windows, p.weekdays) })).filter((h) => h.hours);
  const distinct = [...new Set(hourLines.map((h) => h.hours))];
  const placeHours = distinct.length === 1 ? distinct[0] : hourLines.map((h) => `${h.area}: ${h.hours}`).join("; ");
  const usualLine = usual.data ? windowsSummary(usual.data) : "";
  const note = showAddressNote ? addressNote(free, isSeller) : "";
  const second = [placeHours, plan.usual === "Meetup times" && placeHours ? "" : usualLine, note].filter(Boolean);
  const meetupLine = plan.usual === "Meetup times" && placeHours && usualLine ? `Meetup times: ${usualLine}` : "";

  return (
    <section className="space-y-0.5" aria-labelledby="declutter-pickup" data-item-pickup-block="">
      <h2 id="declutter-pickup" className="text-base font-semibold">{heading}</h2>
      {ticked !== null && ticked.length === 0 ? (
        <p className="text-sm" data-pickup-ways="">The seller hasn't said how buyers can get it yet.</p>
      ) : (
        <p className="text-ds-15 [overflow-wrap:anywhere]" data-pickup-ways="">
          {how.join(" or ")} · {orList(cities)}
        </p>
      )}
      {second.length > 0 && (
        <p className="text-sm text-muted-foreground [overflow-wrap:anywhere]" data-item-pickup-hours="">
          {second.join(" · ").replace(/^./, (c) => c.toUpperCase())}
        </p>
      )}
      {meetupLine && <p className="text-sm text-muted-foreground" data-item-meetup-times="">{meetupLine}</p>}
      {readTimes && places.isError && (
        <ErrorState variant="inline" title="We couldn't load the pickup places." body={declutterErrorMessage(places.error)} onRetry={() => void places.refetch()} />
      )}
      {readTimes && usual.isError && (
        <ErrorState variant="inline" title="We couldn't load the pickup times." body={declutterErrorMessage(usual.error)} onRetry={() => void usual.refetch()} />
      )}
    </section>
  );
}
