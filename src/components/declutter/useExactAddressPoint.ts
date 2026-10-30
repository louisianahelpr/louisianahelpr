/**
 * The house-level point for a typed address, shared by the sell form, the bunch and move lists and the return
 * address. Only an exact match or the member's own position at the address is ever handed back (lead 2026-10-30):
 * the handover checks refuse anyone 200 m from a stored point, so a street or town point would strand a real seller,
 * buyer or Helpr after the sale. The lookup module is import()ed here, so it only loads when a lookup is made.
 */
import { useCallback, useState } from "react";
import { metresBetween } from "../../../supabase/functions/_shared/addressMatch";
import { track } from "@/lib/analytics";

export interface AddressPoint { lat: number; lng: number; address: string }

/** How far a shared location may be from the town or street we did find: a big rural parish, not a neighboring one. */
export const SHARED_LOCATION_MAX_METRES = 40_000;

/** The form asks for the address's area point only while it is showing this note. */
export interface InexactAddress { address: string; near: { lat: number; lng: number } }

export function useExactAddressPoint(notFoundCode: "invalid_location" | "address_not_found" = "invalid_location") {
  const [point, setPoint] = useState<AddressPoint | null>(null);
  const [inexact, setInexact] = useState<InexactAddress | null>(null);
  const [locating, setLocating] = useState(false);

  /** The saved point for this address, or throws Error(<code>) for declutterErrorMessage. */
  const locate = useCallback(async (raw: string): Promise<AddressPoint> => {
    const address = raw.trim();
    if (point && point.address === address) return point;
    const { lookUpAddress } = await import("@/lib/addressLookup");
    const found = await lookUpAddress(address);
    if (found.status === "exact") {
      const p = { lat: found.lat, lng: found.lng, address };
      setPoint(p);
      setInexact(null);
      return p;
    }
    if (found.status === "approximate") {
      setInexact({ address, near: { lat: found.lat, lng: found.lng } });
      throw new Error("address_not_exact");
    }
    setInexact(null);
    throw new Error(found.status === "unavailable" ? "address_lookup_unavailable" : notFoundCode);
  }, [point, notFoundCode]);

  /** "I'm at this address": stores where the member is, once it is plausibly near the area we found. */
  const shareMyLocation = useCallback(async (): Promise<AddressPoint> => {
    if (!inexact) throw new Error(notFoundCode);
    setLocating(true);
    try {
      const { currentPosition } = await import("@/lib/declutter/position");
      const here = await currentPosition();
      if (metresBetween(here, inexact.near) > SHARED_LOCATION_MAX_METRES) {
        track("address_location_refused", { reason: "too_far" });
        throw new Error("location_far_from_address");
      }
      const p = { lat: here.lat, lng: here.lng, address: inexact.address };
      setPoint(p);
      setInexact(null);
      track("address_location_used", {});
      return p;
    } finally {
      setLocating(false);
    }
  }, [inexact, notFoundCode]);

  return { point, setPoint, inexact, locating, locate, shareMyLocation };
}
