/**
 * The item page's ONE pickup block (owner mockup 11-01, Mockups 1 and 2: "Pickup: one block, no repeats"; A3-47):
 *   Porch pickup · New Iberia or Delcambre
 *   Every day 7 AM–9 PM
 *   Meet at a safe spot
 *   Sat 9 AM–12 PM, Sun 1–5 PM · you pick the spot at checkout
 *   Helpr delivery
 *   Exact address after you pay
 * One line per way the seller ticked (checkout's words, HANDOVER_TITLE), its hours under it in one time format
 * (weekHoursLine: days in week order from today). The porch line names the pickup places' cities (else the item's
 * area) and their hours (identical ones once, else "City: hours"); the usual times go under the way they belong to
 * (itemTimesPlan). The address note is said once, last, and only when a way goes to the seller's place (A3-55).
 * The reads and their cache keys are the ones ItemPickupWays / ItemHandoverTimes / ItemPickupDisplay use.
 */
import { useQuery } from "@tanstack/react-query";
import { ErrorState } from "@/components/ui/ErrorState";
import { fetchItemHandovers, type SellerHandover } from "@/lib/declutter/api";
import { declutterErrorMessage } from "@/lib/declutter/errors";
import { fetchItemPickupWindows } from "@/lib/declutter/handover";
import { weekHoursLine } from "@/lib/declutter/pickupSlots";
import { fetchItemPickupPlaces } from "@/lib/declutter/porchPlaces";
import { noDeliveryWay } from "@/lib/declutter/pickupWords";
import { HANDOVER_TITLE } from "./handoverCopy";
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

  // A3-47 (owner mockup 11-01): one line per way, its hours under it, the address note once at the end.
  const ticked = Array.isArray(ways.data) ? ORDER.filter((w) => ways.data!.includes(w)) : null;
  const placeList = plan.places && Array.isArray(places.data) ? places.data : [];
  const cities = placeList.length > 0 ? [...new Set(placeList.map((p) => p.area).filter(Boolean))] : [areaLabel];
  const usualLine = usual.data ? weekHoursLine(usual.data) : "";
  // The porch places' hours: identical ones once, otherwise "City: hours" each.
  const hourLines = placeList.map((p) => ({ area: p.area, hours: weekHoursLine(p.windows, p.weekdays) })).filter((h) => h.hours);
  const distinct = [...new Set(hourLines.map((h) => h.hours))];
  const placeHours = distinct.length === 1 ? distinct[0] : hourLines.map((h) => `${h.area}: ${h.hours}`).join("; ");
  const pickupUsual = plan.usual === "Pickup times" || plan.usual === "Pickup and meetup times" ? usualLine : "";
  const rows: { way: string; title: string; hours: string }[] = [];
  const porch = ticked === null ? porchOk : ticked.includes("porch");
  if (porch) rows.push({ way: "porch", title: `${HANDOVER_TITLE.porch} · ${orList(cities)}`, hours: placeHours || pickupUsual });
  if (ticked === null && !porchOk) rows.push({ way: "pickup_home", title: `${HANDOVER_TITLE.pickup_home} · ${orList(cities)}`, hours: pickupUsual });
  if (ticked?.includes("meetup")) {
    const meetHours = plan.usual === "Meetup times" || plan.usual === "Pickup and meetup times" ? usualLine : "";
    rows.push({ way: "meetup", title: HANDOVER_TITLE.meetup, hours: [meetHours, "you pick the spot at checkout"].filter(Boolean).join(" · ") });
  }
  for (const w of ["seller_delivery", "delivery"] as const) if (ticked?.includes(w)) rows.push({ way: w, title: HANDOVER_TITLE[w], hours: "" });
  // Said once, last, and only for a way that goes to the seller's place (never under delivery: A3-55).
  const note = showAddressNote && rows.some((r) => r.way === "porch" || r.way === "pickup_home") ? addressNote(free, isSeller) : "";
  const cap = (t: string) => t.replace(/^./, (c) => c.toUpperCase());

  return (
    <section className="space-y-0.5" aria-labelledby="declutter-pickup" data-item-pickup-block="">
      <h2 id="declutter-pickup" className="text-base font-semibold">{heading}</h2>
      {ticked !== null && ticked.length === 0 ? (
        <p className="text-sm" data-pickup-ways="">The seller hasn't said how buyers can get it yet.</p>
      ) : (
        <ul className="space-y-1.5" data-pickup-ways="">
          {rows.map((r) => (
            <li key={r.way} data-pickup-way={r.way}>
              <p className="text-ds-15 [overflow-wrap:anywhere]">{r.title}</p>
              {r.hours && <p className="text-sm text-muted-foreground [overflow-wrap:anywhere]" data-item-pickup-hours={r.way}>{cap(r.hours)}</p>}
            </li>
          ))}
        </ul>
      )}
      {note && <p className="pt-1 text-sm text-muted-foreground" data-item-address-note="">{cap(note)}</p>}
      {readTimes && places.isError && (
        <ErrorState variant="inline" title="We couldn't load the pickup places." body={declutterErrorMessage(places.error)} onRetry={() => void places.refetch()} />
      )}
      {readTimes && usual.isError && (
        <ErrorState variant="inline" title="We couldn't load the pickup times." body={declutterErrorMessage(usual.error)} onRetry={() => void usual.refetch()} />
      )}
    </section>
  );
}
