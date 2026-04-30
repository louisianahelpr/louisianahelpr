import { useEffect, useState } from "react";

export type GeoState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "ready"; lat: number; lng: number }
  | { status: "error"; message: string };

let cached: { lat: number; lng: number; ts: number } | null = null;
const TTL = 5 * 60 * 1000;

export function useUserLocation(enabled: boolean): GeoState {
  const [state, setState] = useState<GeoState>({ status: "idle" });

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
    setState({ status: "loading" });
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        cached = { lat: pos.coords.latitude, lng: pos.coords.longitude, ts: Date.now() };
        setState({ status: "ready", lat: pos.coords.latitude, lng: pos.coords.longitude });
      },
      (err) => {
        setState({
          status: "error",
          message: err.code === err.PERMISSION_DENIED ? "Location permission denied" : "Couldn't get your location",
        });
      },
      { enableHighAccuracy: false, timeout: 10000, maximumAge: 5 * 60 * 1000 },
    );
  }, [enabled]);

  return state;
}
