import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import { toast } from "sonner";
import { useUserLocation } from "@/hooks/useUserLocation";
import { getMapKit, type MKMap } from "./mapkitRuntime";
import { laRegion } from "./MapLayers";

/*
 * The map's "my location" button, moved out of src/components/BrowseMap.tsx unchanged (Q806, the god-component
 * ratchet). BrowseMap calls it at the spot the code used to sit and hands `showMyLocation` / `locating` to
 * <MyLocationCorner> exactly as before.
 */
export function useShowMyLocation(mapRef: RefObject<MKMap | null>) {
  /**
   * VN-11 (owner decision, 2026-09-14): the crosshair button now does what its
   * glyph has always promised — centre the map on the user.
   *
   * `useUserLocation` is the app's ONE location funnel (permission rationale,
   * Capacitor on native / `navigator.geolocation` on web, the 5-minute cache,
   * and the profile/ZIP/parish fallback chain). It is effect-driven off an
   * `enabled` flag, so the button flips that flag and a second effect acts on
   * whatever the hook settles to. No `isNativePlatform` branch lives here: the
   * hook owns that, and it is a capability split, not a layout one.
   *
   * Failure is not silent and not a dead end: we fall back to the statewide
   * Louisiana frame — the old Recenter behaviour, which is still the useful
   * thing to do with a map you're lost on — and say why in a toast.
   */
  const [locationRequested, setLocationRequested] = useState(false);
  const pendingLocateRef = useRef(false);
  const geo = useUserLocation(locationRequested);
  const locating = pendingLocateRef.current && geo.status === "loading";

  const recenterLouisiana = useCallback(() => {
    const mk = getMapKit();
    const map = mapRef.current;
    if (!mk || !map) return;
    map.setRegionAnimated(laRegion(mk), true);
  }, []);

  const centerOn = useCallback((lat: number, lng: number, approximate: boolean) => {
    const mk = getMapKit();
    const map = mapRef.current;
    if (!mk || !map) return;
    // An approximate position is a parish centroid, not a fix — framing it at
    // neighbourhood zoom would claim an accuracy we do not have, so it gets a
    // parish-sized span instead.
    const span = approximate ? 0.6 : 0.08;
    map.setRegionAnimated(
      new mk.CoordinateRegion(new mk.Coordinate(lat, lng), new mk.CoordinateSpan(span, span)),
      true,
    );
  }, []);

  const showMyLocation = useCallback(() => {
    pendingLocateRef.current = true;
    if (geo.status === "ready") {
      pendingLocateRef.current = false;
      centerOn(geo.lat, geo.lng, geo.approximate);
      return;
    }
    if (geo.status === "error") {
      // Already asked and already refused this session — don't re-prompt, just
      // do the honest fallback again.
      pendingLocateRef.current = false;
      recenterLouisiana();
      toast.error(geo.message);
      return;
    }
    setLocationRequested(true);
  }, [geo, centerOn, recenterLouisiana]);

  useEffect(() => {
    if (!pendingLocateRef.current) return;
    if (geo.status === "ready") {
      pendingLocateRef.current = false;
      centerOn(geo.lat, geo.lng, geo.approximate);
    } else if (geo.status === "error") {
      pendingLocateRef.current = false;
      recenterLouisiana();
      toast.error(geo.message);
    }
  }, [geo, centerOn, recenterLouisiana]);

  return { showMyLocation, locating };
}
