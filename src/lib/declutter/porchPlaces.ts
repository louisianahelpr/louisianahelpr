/**
 * Porch pickup places (D-NEW14, migration 20261030164712; owner-approved design 2026-10-29): a seller saves up to 5
 * places, each with its own weekdays; the buyer picks one before checkout (porch pickup and Helpr delivery); the
 * place is frozen on the order; only the chosen address is shared, and only after paying. The server keeps every
 * rule (declutter_save_porch_place, declutter_set_porch_place, checkout's porch_place_needed, declutter_order_place).
 */
import { supabase } from "@/integrations/supabase/client";
import { rpcErrorMessage } from "@/lib/lifecycleErrors";
import { rpcData, type PickupWindow } from "@/lib/declutter/api";
import { isMissingRpcNamed } from "@/lib/missingRpc";

/** Not on the server yet (PGRST202): the place UI stays hidden and the item address applies, as before. */
export const PORCH_PLACES_NOT_DEPLOYED = "not_deployed" as const;

export const MAX_PORCH_PLACES = 5;

/** The seller's own places: the editor and SellPorchDays (which steps aside once there is one) share this read. */
export const MY_PORCH_PLACES_KEY = ["declutter", "my-porch-places"] as const;

export type MyPorchPlace = {
  id: string;
  position: number;
  label: string;
  address: string;
  area: string;
  lat: number;
  lng: number;
  weekdays: number[];
  /** The place's own days and hours (20261031145652, LEAD-PLACE-TIMES); null before that is on the server, or when the
   * seller has no hours anywhere. Places saved before got the seller's usual times copied on. */
  windows?: PickupWindow[] | null;
};

/** What a buyer sees before paying: never an address or a point. */
export type SellerPorchPlace = { id: string; label: string; area: string; weekdays: number[]; chosen: boolean; windows?: PickupWindow[] | null };

/** A place as the item page and the posting summary show it (LEAD-POST-PLACES): no address. */
export type PickupPlaceHours = { label: string; area: string; weekdays: number[]; windows?: PickupWindow[] | null };

/** The place frozen on an order; address and point are null for a buyer who has not paid. */
export type OrderPorchPlace = {
  label: string | null;
  area: string | null;
  address: string | null;
  lat: number | null;
  lng: number | null;
  weekdays: number[];
};

export async function fetchMyPorchPlaces(): Promise<MyPorchPlace[] | typeof PORCH_PLACES_NOT_DEPLOYED> {
  const r = await supabase.rpc("declutter_my_porch_places");
  if (r.error && isMissingRpcNamed(r.error, "declutter_my_porch_places")) return PORCH_PLACES_NOT_DEPLOYED;
  return (rpcData(r, (e) => rpcErrorMessage("declutter_my_porch_places", e)) ?? []) as MyPorchPlace[];
}

/**
 * Adds a place (id null) or edits one of the caller's own. Returns the place id, and whether its hours were saved:
 * false only when the server is older than 20261031145652 and took the days alone (the seller is told, review 2026-10-31).
 */
export async function saveMyPorchPlace(place: {
  id: string | null;
  label: string;
  address: string;
  area: string;
  lat: number;
  lng: number;
  weekdays: number[];
  /** The place's days and hours; the server takes the days from them. */
  windows?: PickupWindow[];
}): Promise<{ id: string; hoursSaved: boolean }> {
  const args = {
    // A new place has no id yet: the RPC takes NULL for "add".
    p_place_id: place.id as string,
    p_label: place.label,
    p_address: place.address,
    p_area: place.area,
    p_lat: place.lat,
    p_lng: place.lng,
    p_weekdays: place.weekdays,
  };
  const first = await supabase.rpc("declutter_save_porch_place", place.windows ? { ...args, p_windows: place.windows } : args);
  // Before 20261031145652 is on the server the 8-argument call has no match (PGRST202): save the days alone, as before.
  if (first.error?.code === "PGRST202" && place.windows) {
    const id = rpcData(await supabase.rpc("declutter_save_porch_place", args), (e) => rpcErrorMessage("declutter_save_porch_place", e)) as string;
    return { id, hoursSaved: false };
  }
  return { id: rpcData(first, (e) => rpcErrorMessage("declutter_save_porch_place", e)) as string, hoursSaved: !!place.windows };
}

/** Said when an older server saved a place's days but not its hours. */
export const PLACE_HOURS_NOT_SAVED = "Place saved, but not its hours. Update the app, then set its hours again.";

export async function deleteMyPorchPlace(id: string): Promise<string> {
  const r = await supabase.rpc("declutter_delete_porch_place", { p_place_id: id });
  return rpcData(r, (e) => rpcErrorMessage("declutter_delete_porch_place", e)) as string;
}

/** The seller's places for the caller's cart with that seller (empty: the seller has none, or no cart). */
export async function fetchSellerPorchPlaces(sellerId: string, signal: AbortSignal): Promise<SellerPorchPlace[] | typeof PORCH_PLACES_NOT_DEPLOYED> {
  const r = await supabase.rpc("declutter_seller_porch_places", { p_seller_id: sellerId }).abortSignal(signal);
  if (r.error && isMissingRpcNamed(r.error, "declutter_seller_porch_places")) return PORCH_PLACES_NOT_DEPLOYED;
  return (rpcData(r, (e) => rpcErrorMessage("declutter_seller_porch_places", e)) ?? []) as SellerPorchPlace[];
}

export async function chooseSellerPorchPlace(sellerId: string, placeId: string): Promise<string> {
  const r = await supabase.rpc("declutter_set_porch_place", { p_seller_id: sellerId, p_place_id: placeId });
  return rpcData(r, (e) => rpcErrorMessage("declutter_set_porch_place", e)) as string;
}

/** The place frozen on an order, or null when the order has none (the item address applies). */
export async function fetchOrderPorchPlace(orderId: string): Promise<OrderPorchPlace | null | typeof PORCH_PLACES_NOT_DEPLOYED> {
  const r = await supabase.rpc("declutter_order_place", { p_order_id: orderId });
  if (r.error && isMissingRpcNamed(r.error, "declutter_order_place")) return PORCH_PLACES_NOT_DEPLOYED;
  const rows = (rpcData(r, (e) => rpcErrorMessage("declutter_order_place", e)) ?? []) as OrderPorchPlace[];
  return rows[0] ?? null;
}

/** The seller's places for an item page (label, area, days, hours; no address). Empty when the seller has none. */
export async function fetchItemPickupPlaces(itemId: string): Promise<PickupPlaceHours[] | typeof PORCH_PLACES_NOT_DEPLOYED> {
  const r = await supabase.rpc("declutter_item_pickup_places", { p_item_id: itemId });
  if (r.error && isMissingRpcNamed(r.error, "declutter_item_pickup_places")) return PORCH_PLACES_NOT_DEPLOYED;
  return (rpcData(r, (e) => rpcErrorMessage("declutter_item_pickup_places", e)) ?? []) as PickupPlaceHours[];
}
