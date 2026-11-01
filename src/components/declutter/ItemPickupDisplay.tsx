/**
 * What the item page shows of the seller's pickup times and places (read only). Split out of the sell-flow editors
 * (DeclutterPickupWindows' slot picker, SellPorchPlaces' place forms and address field) so a buyer's cold item page
 * does not download them (B67, DECL-ITEM-SPEED).
 */
import { useQuery } from "@tanstack/react-query";
import { ErrorState } from "@/components/ui/ErrorState";
import { fetchItemPickupWindows } from "@/lib/declutter/handover";
import { declutterErrorMessage } from "@/lib/declutter/errors";
import { windowsSummary } from "@/lib/declutter/pickupSlots";
import { fetchItemPickupPlaces, type PickupPlaceHours } from "@/lib/declutter/porchPlaces";
import { placeHoursLine } from "./DeclutterPickupTimes";

export function ItemPickupTimes({ itemId, label = "Pickup times" }: { itemId: string; label?: string }) {
  const q = useQuery({ queryKey: ["declutter", "item-pickup-windows", itemId], queryFn: () => fetchItemPickupWindows(itemId) });
  if (q.isError) return <ErrorState variant="inline" title="We couldn't load the pickup times." body={declutterErrorMessage(q.error)} onRetry={() => void q.refetch()} />;
  const line = q.data ? windowsSummary(q.data) : "";
  if (!line) return null;
  return <p className="text-sm" data-testid="declutter-pickup-times">{label}: <span className="font-medium">{line}</span></p>;
}

/** Each place on its own line with its own days and hours (LEAD-POST-PLACES, owner 2026-10-31: "both must show"). No address. */
/** `cityOnly`: the item page (LEAD-ITEM-PAGE-LAYOUT, owner 2026-10-31): buyers see the city, never the place's own label. */
export function PickupPlacesHoursList({ places, cityOnly = false }: { places: PickupPlaceHours[]; cityOnly?: boolean }) {
  if (places.length === 0) return null;
  return (
    <ul className="space-y-1" data-pickup-places-hours="">
      {places.map((p, i) => (
        <li key={`${p.label}-${i}`} className="text-ds-13 [overflow-wrap:anywhere]" data-pickup-place-hours="">
          <span className="font-semibold text-foreground">{cityOnly ? p.area : [p.label, p.area].filter(Boolean).join(" · ")}</span>
          <span className="block text-muted-foreground">{placeHoursLine(p.windows, p.weekdays)}</span>
        </li>
      ))}
    </ul>
  );
}

/** The item page's places (declutter_item_pickup_places): label, area, days and hours; nothing before it is on the server. */
export function ItemPickupPlaces({ itemId }: { itemId: string }) {
  // retryOnMount false: ItemHandoverTimes mounts this BECAUSE the shared read failed. Refetching on mount put the query
  // back to pending (no data yet), which unmounted this, and the next failure mounted it again: an endless request loop
  // (#3889, 44,033 requests in one test). Retry is the button's.
  const read = useQuery({ queryKey: ["declutter", "item-pickup-places", itemId], queryFn: () => fetchItemPickupPlaces(itemId), retryOnMount: false });
  // Review 2026-10-31: a failed read says so, with a retry, instead of dropping the places silently.
  if (read.isError) {
    return <ErrorState variant="inline" title="We couldn't load the pickup places." body={declutterErrorMessage(read.error)} onRetry={() => void read.refetch()} />;
  }
  if (!Array.isArray(read.data) || read.data.length === 0) return null;
  return (
    <div className="space-y-1 pt-1" data-item-pickup-places="">
      <p className="text-sm font-semibold">{read.data.length === 1 ? "Pickup place" : "Pickup places"}</p>
      <PickupPlacesHoursList places={read.data} cityOnly />
    </div>
  );
}
