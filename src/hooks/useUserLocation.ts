import { useEffect, useState } from "react";
import { usePermissionRationale } from "@/hooks/usePermissionRationale";
import { isNativePlatform } from "@/lib/nativeInit";
import { persistUserLocation } from "@/lib/persistUserLocation";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { resolveParishByZip } from "@/lib/parishLookup";
import { getParishCentroid } from "@/lib/parishCentroids";

/**
 * Where a "ready" position came from, in the order the product wants them
 * tried: real geodata first, the signup ZIP second, and the parish only as the
 * last thing before giving up.
 *
 * This exists because "we don't know where you are" was the answer for most of
 * the account base. Measured against prod 2026-09-06: of 8 profiles only 2
 * carry `latitude`/`longitude`, while 4 more carry a `zip_code` that resolves
 * to a parish we hold a centroid for. Those four had a usable position on file
 * and were still told nothing — the radius filter silently kept every job.
 */
export type GeoSource = "device" | "profile" | "zip" | "parish";

export type GeoState =
  | { status: "idle" }
  | { status: "loading" }
  | {
      status: "ready";
      lat: number;
      lng: number;
      source: GeoSource;
      /**
       * True for a centroid — a parish-scale point, not a fix. The radius
       * filter still runs on it (a rough "here" beats no "here"), but a
       * surface quoting a small number of miles must say it is approximate
       * rather than implying a GPS-grade measurement.
       */
      approximate: boolean;
    }
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

/**
 * The position we can derive WITHOUT the device — geodata first, signup ZIP
 * second, parish last.
 *
 * The ordering is the whole point and is not interchangeable:
 *
 *  1. `profiles.latitude/longitude` is a real fix this account granted at some
 *     point and `persistUserLocation` wrote down. It is geodata, so it ranks
 *     above anything derived and is NOT flagged approximate.
 *  2. `zip_code` → parish → centroid. The ZIP is collected at signup, so this
 *     is the branch that rescues the majority of accounts. It goes through
 *     `resolveParishByZip` rather than a local table because that RPC is the
 *     single source of truth for the ZIP→parish map.
 *  3. `profiles.parish` directly, for an account holding a parish but no ZIP.
 *
 * `parish = null` is never the answer on its own — that was the defect. A null
 * parish falls through to "nothing could be derived", which the caller reports
 * honestly rather than pretending a radius filter ran.
 *
 * Deliberately writes NOTHING back. `persistUserLocation`'s header is explicit
 * that a centroid must never land in `profiles.latitude/longitude`: those
 * columns mean "a device told us this", and poisoning them with a parish-scale
 * point would make every future distance read silently wrong.
 */
async function deriveFallbackLocation(
  profile: {
    latitude?: number | string | null;
    longitude?: number | string | null;
    zip_code?: string | null;
    parish?: string | null;
  } | null,
): Promise<{ lat: number; lng: number; source: GeoSource; approximate: boolean } | null> {
  if (!profile) return null;

  // 1. Real geodata already on file. `numeric` columns arrive as STRINGS
  //    through PostgREST, so coerce — a typeof-number check silently skips
  //    this branch for every real row.
  const lat = profile.latitude == null ? NaN : Number(profile.latitude);
  const lng = profile.longitude == null ? NaN : Number(profile.longitude);
  if (Number.isFinite(lat) && Number.isFinite(lng)) {
    return { lat, lng, source: "profile", approximate: false };
  }

  // 2. The signup ZIP.
  if (profile.zip_code) {
    const resolved = await resolveParishByZip(profile.zip_code);
    if (resolved.status === "resolved") {
      const c = getParishCentroid(resolved.parish);
      if (c) return { lat: c.lat, lng: c.lng, source: "zip", approximate: true };
    }
  }

  // 3. A parish we hold some other way.
  const c = getParishCentroid(profile.parish);
  if (c) return { lat: c.lat, lng: c.lng, source: "parish", approximate: true };

  return null;
}

export function useUserLocation(enabled: boolean): GeoState {
  const [state, setState] = useState<GeoState>({ status: "idle" });
  const { request } = usePermissionRationale();
  const { profile } = useCurrentUser();

  useEffect(() => {
    if (!enabled) return;
    let alive = true;

    /**
     * Every path that used to end in `status: "error"` now comes through here
     * first. A denied permission is not the same as an unknown location: the
     * account may well have told us where it is at signup, and answering
     * "we don't know" while a ZIP sits on the profile is the defect this
     * closes. Only when nothing can be derived do we keep the original error,
     * so the honest "no radius could run" case still reaches the toolbar.
     */
    const failWith = (message: string) => {
      void deriveFallbackLocation(profile)
        .then((fb) => {
          if (!alive) return;
          if (fb) {
            // NOT written to the module `cached`: that cache feeds
            // getCachedUserLocation(), whose callers render a precise "~X mi"
            // pill and are entitled to assume a real fix.
            setState({ status: "ready", ...fb });
          } else {
            setState({ status: "error", message });
          }
        })
        .catch(() => {
          if (alive) setState({ status: "error", message });
        });
    };

    if (cached && Date.now() - cached.ts < TTL) {
      setState({ status: "ready", lat: cached.lat, lng: cached.lng, source: "device", approximate: false });
      return;
    }
    if (!isNativePlatform && (typeof navigator === "undefined" || !navigator.geolocation)) {
      failWith("Location not supported on this device");
      return () => { alive = false; };
    }

    const onSuccess = (lat: number, lng: number) => {
      cached = { lat, lng, ts: Date.now() };
      setState({ status: "ready", lat, lng, source: "device", approximate: false });
      // Persist the fix to the signed-in user's profile. This is the ONLY
      // funnel a granted position passes through on either platform, which is
      // why the write lives here rather than at the two call sites.
      //
      // Until now the fix died in the module cache above after five minutes,
      // so `profiles.latitude/longitude` had three readers and no writer and
      // every distance feature was inert for real accounts. Deliberately not
      // awaited: the radius filter the user actually asked for must not wait
      // on a round trip, and `persistUserLocation` reports its own failures
      // rather than swallowing them.
      void persistUserLocation(lat, lng);
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
        failWith(
          /denied|permission/i.test(msg) ? "Location permission denied" : "Couldn't get your location",
        );
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
            failWith(
              err.code === err.PERMISSION_DENIED ? "Location permission denied" : "Couldn't get your location",
            );
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
        failWith("Location permission declined");
      }
    });

    return () => {
      alive = false;
    };
  }, [enabled, request, profile]);

  return state;
}
