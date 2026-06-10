import { useEffect, useState } from "react";
import { usePermissionRationale } from "@/hooks/usePermissionRationale";
import { isNativePlatform } from "@/lib/nativeInit";

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
    if (!isNativePlatform && (typeof navigator === "undefined" || !navigator.geolocation)) {
      setState({ status: "error", message: "Location not supported on this device" });
      return;
    }

    const onSuccess = (lat: number, lng: number) => {
      cached = { lat, lng, ts: Date.now() };
      setState({ status: "ready", lat, lng });
    };

    // Native (Capacitor) reads through @capacitor/geolocation so iOS/Android
    // get the OS-native CLLocationManager prompt + accuracy, not the WKWebView
    // navigator.geolocation shim (which is unreliable inside the native shell).
    // Dynamic import keeps the plugin chunk off the web critical-path bundle.
    const fetchNative = async () => {
      setState({ status: "loading" });
      try {
        const { Geolocation } = await import("@capacitor/geolocation");
        const pos = await Geolocation.getCurrentPosition({
          enableHighAccuracy: false,
          timeout: 10000,
          maximumAge: 5 * 60 * 1000,
        });
        onSuccess(pos.coords.latitude, pos.coords.longitude);
      } catch (err) {
        const msg = String((err as { message?: string })?.message ?? "");
        setState({
          status: "error",
          message: /denied|permission/i.test(msg) ? "Location permission denied" : "Couldn't get your location",
        });
      }
    };

    const fetchWeb = () =>
      new Promise<void>((resolve) => {
        setState({ status: "loading" });
        navigator.geolocation.getCurrentPosition(
          (pos) => {
            onSuccess(pos.coords.latitude, pos.coords.longitude);
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

    const fetchLocation = () => (isNativePlatform ? fetchNative() : fetchWeb());

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
