/**
 * Porch pickup places, the buyer's side and the paid order (D-NEW14, owner-approved design 2026-10-29). Before paying
 * the buyer sees only each place's name, area and days, never an address, and picks one (mirrors MeetupSpotPicker).
 * The pick is required by the server for porch pickup and Helpr delivery from a seller with places
 * (porch_place_needed), and frozen on the order at checkout. Afterwards the order shows the frozen place.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ErrorState } from "@/components/ui/ErrorState";
import { declutterErrorMessage } from "@/lib/declutter/errors";
import { shouldRetryQuery } from "@/lib/queryRetry";
import { raceVisibleDeadlineAbortable } from "@/lib/visibleDeadline";
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
 * How long one read may take at all. React Query joins a refetch to a fetch still running when the query has no data
 * yet, so an unbounded read that hung made the re-read after a refused checkout wait on that same hung request.
 */
export const PORCH_PLACES_READ_MS = 8000;
const PORCH_PLACES_SLOW = "porch_places_slow";
const PLACE_NEEDED = "porch_place_needed";

/**
 * The seller's places for this cart, and whether a checkout that needs a place can go ahead. A failed read, or one
 * still going after PORCH_PLACES_WAIT_MS, does not hold the Pay button: most sellers have no places, and the server
 * still refuses a missing pick (porch_place_needed). If the read then brings places, Pay waits for the pick again.
 * `reread`, after a refused checkout or a Try again: drops any read still out and starts a new one. A porch_place_needed
 * refusal holds Pay until the buyer picks, or the new read finds the seller has no places after all.
 *
 * A seller with exactly one place (every first-timer: setup saves their address as "Home") has nothing to choose, so
 * that place is picked for the buyer and Pay is not held. The server still gets the pick as usual, once a place is
 * `needed`; `whenPicked` lets Pay wait for that call so a fast tap never meets porch_place_needed.
 */
export function useSellerPorchPlaces(sellerId: string, cartKey: number, needed = true) {
  const qc = useQueryClient();
  const key = placesKey(sellerId, cartKey);
  const q = useQuery({
    queryKey: key,
    queryFn: ({ signal }) => raceVisibleDeadlineAbortable((s) => fetchSellerPorchPlaces(sellerId, s), PORCH_PLACES_READ_MS, PORCH_PLACES_SLOW, signal),
    // A read that ran out of time is said at once, with Try again, rather than hung on for a second full wait.
    retry: (count, err) => (err as Error | null)?.message !== PORCH_PLACES_SLOW && shouldRetryQuery(count, err),
    meta: { warnOnMessage: PORCH_PLACES_SLOW },
  });
  const [waitedOut, setWaitedOut] = useState(false);
  const [refused, setRefused] = useState(false);
  useEffect(() => { setRefused(false); }, [sellerId, cartKey]);
  useEffect(() => {
    setWaitedOut(false);
    if (!q.isLoading) return undefined;
    const timer = setTimeout(() => setWaitedOut(true), PORCH_PLACES_WAIT_MS);
    return () => clearTimeout(timer);
  }, [q.isLoading, sellerId, cartKey]);
  const read: SellerPorchPlace[] = q.data && q.data !== PORCH_PLACES_NOT_DEPLOYED ? q.data : [];
  const only = read.length === 1 ? read[0] : null;
  const picking = useRef<Promise<void> | null>(null);
  const sent = useRef<string | null>(null);
  useEffect(() => {
    if (!needed || !only || only.chosen || sent.current === only.id) return;
    sent.current = only.id;
    picking.current = chooseSellerPorchPlace(sellerId, only.id)
      .then(() => qc.invalidateQueries({ queryKey: placesKey(sellerId, cartKey) }))
      .catch((err: unknown) => {
        // Said, and sent again on the next read (a refused checkout reads the places again).
        sent.current = null;
        toast.error(declutterErrorMessage(err));
      });
  }, [needed, only, sellerId, cartKey, qc, q.dataUpdatedAt]);
  const whenPicked = useCallback(() => picking.current ?? Promise.resolve(), []);
  const places = only ? [{ ...only, chosen: true }] : read;
  const reread = async (err?: unknown) => {
    if ((err as { message?: string } | null | undefined)?.message === PLACE_NEEDED) {
      setRefused(true);
      // The server has no pick for this cart: the one place is sent again.
      sent.current = null;
    }
    await qc.cancelQueries({ queryKey: key, exact: true });
    const r = await q.refetch();
    if (r.isSuccess && (r.data === PORCH_PLACES_NOT_DEPLOYED || r.data.length === 0)) setRefused(false);
  };
  return { query: q, places, refused, reread, whenPicked, ready: (!q.isLoading || waitedOut) && (places.length > 0 ? places.some((p) => p.chosen) : !refused) };
}

export function PorchPlacePicker({ sellerId, cartKey, places, loadError, onRetry, onChosen, free = false, refused = false, forDelivery = false }: {
  sellerId: string;
  cartKey: number;
  places: SellerPorchPlace[];
  loadError: unknown;
  onRetry: () => void;
  /** After a new pick lands: a Helpr delivery quote for the old place no longer holds. */
  onChosen?: () => void;
  /** A free claim: nobody pays, and the address opens once the claim is confirmed (declutter_checkout_free, DA-5). */
  free?: boolean;
  /** The server just refused for want of a pick: say why, in place, for as long as it takes to answer it. */
  refused?: boolean;
  /** A3-55: under Helpr delivery the buyer never goes there: "Where the Helpr picks it up", no address line, no days. */
  forDelivery?: boolean;
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
  const refusal = declutterErrorMessage({ message: PLACE_NEEDED });
  if (places.length === 0) return refused ? <p role="status" className="text-sm font-semibold" data-porch-place-rereading="">{refusal} Loading them…</p> : null;
  // One place: nothing to choose (useSellerPorchPlaces has picked it). Only its city and days: buyers never see the
  // place's own label (owner 2026-10-31; the server sends none, 20261101054401).
  if (places.length === 1) {
    const p = places[0];
    return (
      <div className="space-y-1 rounded-xl border border-border p-3" data-porch-place-one="">
        <p className="text-xs font-medium">{forDelivery ? "Where the Helpr picks it up" : "Pickup place"}</p>
        <p className="text-ds-14 font-semibold [overflow-wrap:anywhere]">{p.area}</p>
        {!forDelivery && <p className="text-ds-13 text-muted-foreground [overflow-wrap:anywhere]">{shortDays(p.weekdays)}</p>}
        {!forDelivery && <p className="text-xs text-muted-foreground">You get the exact address after you pay.</p>}
      </div>
    );
  }
  return (
    <fieldset className="space-y-2 rounded-xl border border-border p-3" data-porch-place-picker="">
      <legend className="px-1 text-xs font-medium">{forDelivery ? "Where the Helpr picks it up" : "Pick a pickup place"}</legend>
      {!forDelivery && <p className="text-xs text-muted-foreground">{free ? "You get the exact address once you confirm." : "You get the exact address after you pay."}</p>}
      {refused && !places.some((p) => p.chosen) && <p role="alert" className="text-sm font-semibold">{refusal}</p>}
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
            <span className="block text-ds-14 font-semibold [overflow-wrap:anywhere]">{p.area}</span>
            {!forDelivery && <span className="block text-ds-13 text-muted-foreground [overflow-wrap:anywhere]">{shortDays(p.weekdays)}</span>}
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
  // The buyer gets the city only (label null from the server, 20261101054401); the seller their own label.
  if (!place || place === PORCH_PLACES_NOT_DEPLOYED) return null;
  const name = side === "seller" ? place.label ?? place.area : place.area;
  if (!name) return null;
  return (
    <p className="text-sm [overflow-wrap:anywhere]" data-order-porch-place="">
      Pickup place: <span className="font-medium">{name}</span>
      {side === "seller" && place.address ? <> ({place.address})</> : null}
    </p>
  );
}
