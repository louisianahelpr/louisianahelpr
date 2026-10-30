/**
 * Where a NEW listing is picked up from, once the seller has saved it (owner 2026-10-30: "Once it's saved in setting
 * that's it. I don't need to keep adding it every time."). One source for the one-item form, Sell a bunch and moving
 * out, so none of them asks again:
 *
 *   1. Saved pickup places (Declutter settings, src/lib/declutter/porchPlaces.ts): the first is the listing's own
 *      address and area; buyers still pick among them at checkout, as porch places already do.
 *   2. No place, but an address on the last listing: that address, as "Remember my setup" already carried it.
 *
 * Saved points stay exact (the owner's no-approximate-points rule): the point comes with the place or the listing,
 * never from a town or a fresh guess, and a place with no real point is not used.
 * The server's rules are unchanged: the listing still sends an area, an address and a point.
 */
import { useEffect, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { fetchLastSetup } from "@/lib/declutter/lastSetup";
import { fetchMyPorchPlaces, MY_PORCH_PLACES_KEY, type MyPorchPlace } from "@/lib/declutter/porchPlaces";
import { fetchSellerDefaults } from "@/lib/declutter/sellerDefaults";

export interface SavedPickup {
  areaLabel: string;
  address: string;
  lat: number;
  lng: number;
  /** Says which is used: "Pickup at Home", or with several, each name and that buyers pick one. */
  line: string;
}

/** The saved places as the listing's pickup, in the seller's order; null when none has a whole address and a real point. */
export function pickupFromPlaces(places: readonly MyPorchPlace[]): SavedPickup | null {
  const usable = [...places]
    .sort((a, b) => a.position - b.position)
    .filter((p) => p.address.trim() && p.area.trim() && Number.isFinite(p.lat) && Number.isFinite(p.lng));
  const first = usable[0];
  if (!first) return null;
  return {
    areaLabel: first.area.trim(),
    address: first.address.trim(),
    lat: first.lat,
    lng: first.lng,
    line: usable.length === 1 ? `Pickup at ${first.label}` : `Pickup at ${usable.map((p) => p.label).join(", ")}. Buyers pick one.`,
  };
}

/**
 * Reads the saved pickup for a new listing (`userId` undefined = a saved draft: nothing) and hands it to `apply` once,
 * when every read has settled, with the address the last listing would have filled so the caller can tell that from
 * one the seller typed. A failed read is extra help lost: the form asks as it does for a first-timer.
 */
export function useSavedPickup(userId: string | undefined, apply: (p: SavedPickup, lastAddress: string | null) => void) {
  const places = useQuery({ queryKey: MY_PORCH_PLACES_KEY, queryFn: fetchMyPorchPlaces, enabled: !!userId });
  const saved = useQuery({ queryKey: ["declutter", "seller-defaults", userId], queryFn: () => fetchSellerDefaults(userId!), enabled: !!userId });
  const last = useQuery({ queryKey: ["declutter", "last-setup", userId], queryFn: () => fetchLastSetup(userId!), enabled: !!userId, staleTime: 60_000 });
  const settled = !!userId && places.isFetched && saved.isFetched && last.isFetched;
  const hasSettings = !!saved.data;
  const fromPlaces = Array.isArray(places.data) ? pickupFromPlaces(places.data) : null;
  const lastPickup = last.data?.pickup ?? null;
  const lastPoint = lastPickup && Number.isFinite(lastPickup.lat) && Number.isFinite(lastPickup.lng) ? lastPickup : null;
  const pickup: SavedPickup | null = fromPlaces
    ?? (lastPoint && lastPickup && (last.data?.areaLabel ?? "").trim()
      ? { areaLabel: last.data!.areaLabel, address: lastPickup.address, lat: lastPickup.lat, lng: lastPickup.lng, line: `Pickup at ${lastPickup.address}` }
      : null);
  const applied = useRef(false);
  const applyNow = useRef(apply);
  applyNow.current = apply;
  useEffect(() => {
    if (!settled || applied.current || !pickup) return;
    applied.current = true;
    applyNow.current(pickup, lastPickup?.address ?? null);
  }, [settled, pickup, lastPickup]);
  return {
    settled,
    pickup,
    hasSettings,
    settings: saved.data ?? null,
    hasPlaces: !!fromPlaces,
    hasWays: (saved.data?.handovers ?? last.data?.ways ?? []).length > 0,
    failed: places.isError || saved.isError || last.isError,
    retry: () => { void places.refetch(); void saved.refetch(); void last.refetch(); },
  };
}
