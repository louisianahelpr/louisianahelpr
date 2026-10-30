/**
 * Where a new bunch starts from. The area and pickup address start from the seller's last listing (the single form's
 * "Remember my setup": the same read and cache entry). Applied once, only to a box still blank. A failed read is extra
 * help lost, not a blocker: the boxes start blank, and the app's QueryCache reports the error.
 *
 * Saved settings are the source once they exist (owner 2026-10-30, "I don't need to keep adding it every time"): they
 * replace what the last listing filled in, never what the seller typed or a bunch that came back.
 */
import { useEffect, useRef, type Dispatch, type SetStateAction } from "react";
import { useQuery } from "@tanstack/react-query";
import { fetchLastSetup } from "@/lib/declutter/lastSetup";
import type { AddressPoint } from "./useExactAddressPoint";
import { useSavedPickup } from "./useSavedPickup";

export function useBunchStartingPlace(
  userId: string | undefined,
  setAreaLabel: Dispatch<SetStateAction<string>>,
  setPickupAddress: Dispatch<SetStateAction<string>>,
  setPoint: Dispatch<SetStateAction<AddressPoint | null>>,
) {
  const lastSetup = useQuery({ queryKey: ["declutter", "last-setup", userId], queryFn: () => fetchLastSetup(userId!), enabled: !!userId, staleTime: 60_000 });
  const savedSetup = useSavedPickup(userId, (p, lastAddress) => {
    const mine = (address: string) => !address.trim() || address === lastAddress;
    setPickupAddress((a) => (mine(a) ? p.address : a));
    setAreaLabel((a) => (!a.trim() || a === lastSetup.data?.areaLabel ? p.areaLabel : a));
    setPoint((c) => (!c || mine(c.address) ? { lat: p.lat, lng: p.lng, address: p.address } : c));
  });
  const placeLoaded = useRef(false);
  useEffect(() => {
    const s = lastSetup.data;
    if (!s || placeLoaded.current) return;
    placeLoaded.current = true;
    setAreaLabel((a) => (a.trim() ? a : s.areaLabel));
    if (!s.pickup) return;
    setPickupAddress((a) => (a.trim() ? a : s.pickup!.address));
    setPoint((c) => c ?? { ...s.pickup! });
  }, [lastSetup.data, setAreaLabel, setPickupAddress, setPoint]);
  return savedSetup;
}
