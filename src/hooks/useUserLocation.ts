import { useEffect, useState } from "react";
import { usePermissionRationale } from "@/hooks/usePermissionRationale";

export type GeoState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "ready"; lat: number; lng: number }
  | { status: "error"; message: string };

let cached: { lat: number; lng: number; ts: number } | null = null;
const TTL = 5 * 60 * 1000;

/**
 * Read the module-level location cache WITHOUT triggering the permission
 * prompt. Used by surfaces that want to surface a "~X mi" distance pill
 * for users who've already granted location elsewhere (the dashboard
 * filter, the BrowseMap, etc.) but should NOT ask just to render a pill.
 *
 * Returns null when no cache exists or the cached entry is older than the
 * 5-minute TTL. The caller silently hides the pill in that case.
 */
export function getCachedUserLocation(): { lat: number; lng: number } | null {
  if (!cached) return null;
  if (Date.now() - cached.ts >= TTL) return null;
  return { lat: cached.lat, lng: cached.lng };
}

export function useUserLocation(enabled: boolean): GeoState {
  const [state, setState] = useState<GeoState>({ status: "idle" });
  const { request } = usePermissionRationale();

  useEffect(() => {
    if (!enabled) return;
    if (cached && Date.now() - cached.ts < TTL) {
      setState({ status: "ready", lat: cached.lat, lng: cached.lng });
      return;
    }
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      setState({ status: "error", message: "Location not supported on this device" });
      return;
    }

    const fetchLocation = () =>
      new Promise<void>((resolve) => {
        setState({ status: "loading" });
        navigator.geolocation.getCurrentPosition(
          (pos) => {
            cached = { lat: pos.coords.latitude, lng: pos.coords.longitude, ts: Date.now() };
            setState({ status: "ready", lat: pos.coords.latitude, lng: pos.coords.longitude });
            resolve();
          },
          (err) => {
            setState({
              status: "error",
              message: err.code === err.PERMISSION_DENIED ? "Location permission denied" : "Couldn't get your location",
            });
            resolve();
          },
          { enableHighAccuracy: false, timeout: 10000, maximumAge: 5 * 60 * 1000 },
        );
      });

    // Show the friendly "why we want location" dialog before triggering
    // the OS prompt. The rationale hook session-gates itself, so this
    // only renders once per session per kind. iOS only shows its system
    // alert ONCE per install — a soft pre-prompt protects that one shot.
    request("location", fetchLocation).then((granted) => {
      if (!granted) {
        setState({ status: "error", message: "Location permission declined" });
      }
    });
  }, [enabled, request]);

  return state;
}
