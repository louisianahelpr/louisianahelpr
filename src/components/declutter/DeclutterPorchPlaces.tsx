/**
 * Porch pickup places, the buyer's side and the paid order (D-NEW14, owner-approved design 2026-10-29). Before paying
 * the buyer sees only each place's name, area and days, never an address, and picks one (mirrors MeetupSpotPicker).
 * The pick is required by the server for porch pickup and Helpr delivery from a seller with places
 * (porch_place_needed), and frozen on the order at checkout. Afterwards the order shows the frozen place.
 */
import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ErrorState } from "@/components/ui/ErrorState";
import { declutterErrorMessage } from "@/lib/declutter/errors";
import {
  chooseSellerPorchPlace, fetchOrderPorchPlace, fetchSellerPorchPlaces, PORCH_PLACES_NOT_DEPLOYED, type SellerPorchPlace,
} from "@/lib/declutter/porchPlaces";
import { shortDays } from "./DeclutterPickupTimes";

const placesKey = (sellerId: string, cartKey: number) => ["declutter", "seller-porch-places", sellerId, cartKey] as const;

/**
 * How long a first read of the places may hold Pay. The app's requests have no timeout of their own and a read that
 * fails is tried once more, so without this a stalled read held Pay for as long as the connection hung.
 */
export const PORCH_PLACES_WAIT_MS = 3000;

/**
 * The seller's places for this cart, and whether a checkout that needs a place can go ahead. A failed read, or one
 * still going after PORCH_PLACES_WAIT_MS, does not hold the Pay button: most sellers have no places, and the server
 * still refuses a missing pick (porch_place_needed). If the read then brings places, Pay waits for the pick again.
 */
export function useSellerPorchPlaces(sellerId: string, cartKey: number) {
  const q = useQuery({ queryKey: placesKey(sellerId, cartKey), queryFn: () => fetchSellerPorchPlaces(sellerId) });
  const [waitedOut, setWaitedOut] = useState(false);
  useEffect(() => {
    setWaitedOut(false);
    if (!q.isLoading) return undefined;
    const timer = setTimeout(() => setWaitedOut(true), PORCH_PLACES_WAIT_MS);
    return () => clearTimeout(timer);
  }, [q.isLoading, sellerId, cartKey]);
  const places: SellerPorchPlace[] = q.data && q.data !== PORCH_PLACES_NOT_DEPLOYED ? q.data : [];
  return { query: q, places, ready: (!q.isLoading || waitedOut) && (places.length === 0 || places.some((p) => p.chosen)) };
}

export function PorchPlacePicker({ sellerId, cartKey, places, loadError, onRetry, onChosen }: {
  sellerId: string;
  cartKey: number;
  places: SellerPorchPlace[];
  loadError: unknown;
  onRetry: () => void;
  /** After a new pick lands: a Helpr delivery quote for the old place no longer holds. */
  onChosen?: () => void;
}) {
  const qc = useQueryClient();
  const choose = useMutation({
    mutationFn: (placeId: string) => chooseSellerPorchPlace(sellerId, placeId),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: placesKey(sellerId, cartKey) });
      onChosen?.();
    },
    onError: (err) => toast.error(declutterErrorMessage(err)),
  });
  if (loadError) return <ErrorState variant="inline" title="We couldn't load the pickup places." body={declutterErrorMessage(loadError)} onRetry={onRetry} />;
  if (places.length === 0) return null;
  return (
    <fieldset className="space-y-2 rounded-xl border border-border p-3" data-porch-place-picker="">
      <legend className="px-1 text-xs font-medium">Pick a pickup place</legend>
      <p className="text-xs text-muted-foreground">You get the exact address after you pay.</p>
      {places.map((p) => (
        <label key={p.id} className={`flex min-h-11 cursor-pointer items-start gap-3 rounded-xl border px-3 py-2.5 ${p.chosen ? "border-2 border-primary" : "border-border"}`}>
          <input
            type="radio"
            className="mt-1 h-4 w-4 min-h-0 min-w-0 shrink-0"
            name={`porch-place-${sellerId}`}
            checked={p.chosen}
            disabled={choose.isPending}
            onChange={() => choose.mutate(p.id)}
            style={{ accentColor: "hsl(var(--primary))" }}
          />
          <span className="min-w-0 flex-1">
            <span className="block text-ds-14 font-semibold [overflow-wrap:anywhere]">{p.label}</span>
            <span className="block text-ds-13 text-muted-foreground [overflow-wrap:anywhere]">{p.area} · {shortDays(p.weekdays)}</span>
          </span>
        </label>
      ))}
    </fieldset>
  );
}

/**
 * On the paid order: the place frozen on it. The seller always sees the address, because that is where to put the
 * item out. The buyer's address line is PickupAddresses (declutter_item_address answers with this same frozen place),
 * so here they get the place's name. An order with no place shows nothing.
 */
export function OrderPorchPlace({ orderId, side }: { orderId: string; side: "buyer" | "seller" }) {
  const q = useQuery({ queryKey: ["declutter", "order-porch-place", orderId], queryFn: () => fetchOrderPorchPlace(orderId) });
  if (q.isError) return <ErrorState variant="inline" title="We couldn't load the pickup place." body={declutterErrorMessage(q.error)} onRetry={() => void q.refetch()} />;
  const place = q.data;
  if (!place || place === PORCH_PLACES_NOT_DEPLOYED || !place.label) return null;
  return (
    <p className="text-sm [overflow-wrap:anywhere]" data-order-porch-place="">
      Pickup place: <span className="font-medium">{place.label}</span>
      {side === "seller" && place.address ? <> ({place.address})</> : null}
    </p>
  );
}
