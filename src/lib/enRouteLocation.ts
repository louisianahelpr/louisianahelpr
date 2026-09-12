import { registerPlugin } from "@capacitor/core";
import { isNativePlatform } from "@/lib/nativeInit";

/**
 * EN-ROUTE LOCATION WATCH — the one place that knows how to follow a helper
 * from "I'm On My Way" to "I've Arrived", on every platform, honestly.
 *
 * THE PROBLEM THIS REPLACES. JobTracking used to run
 * `setInterval(pushPosition, 45_000)` — a JavaScript timer inside the
 * WKWebView. iOS suspends the WebView (and every timer in it) the moment the
 * app is backgrounded, so the tracker was live exactly when the helper was
 * staring at the app and dead the entire time they were driving with the phone
 * locked or Maps in front. The poster's "live" map was a last-known position
 * from whenever the app was last foregrounded, presented as current.
 *
 * WHAT ACTUALLY DELIVERS IN THE BACKGROUND. Not `@capacitor/geolocation`:
 * neither it nor IONGeolocationLib ever sets
 * `CLLocationManager.allowsBackgroundLocationUpdates`, without which iOS stops
 * delivering to a suspended app no matter what Info.plist says. So the native
 * path goes through `BackgroundLocationPlugin.swift`, shipped in the app
 * target. See that file's header.
 *
 * THREE TIERS, AND THE UI IS TOLD WHICH ONE IT GOT:
 *  - "background"  native plugin present + `location` background mode declared.
 *  - "foreground"  a watch that works while the app is open and stops when it
 *                  is not. This is the web, and it is ALSO what an older
 *                  installed iOS build gets: a binary built before this plugin
 *                  existed has no `BackgroundLocation`, the bridge rejects with
 *                  UNIMPLEMENTED, and we fall through rather than going quiet.
 *  - "denied"      permission refused or revoked. A designed state, not a
 *                  dead end — the caller renders a way back.
 *
 * Never claim "background" from a code path that has not proven it: the mode
 * reported here is the mode the runtime actually established.
 */

export type EnRouteMode = "background" | "foreground" | "denied" | "unavailable";

export type EnRoutePosition = {
  lat: number;
  lng: number;
  /** Metres of horizontal uncertainty, when the platform reports it. */
  accuracy?: number;
  /** Epoch ms of the FIX, not of the moment we handled it. */
  at: number;
};

type NativeStartResult = {
  background: boolean;
  distanceFilter: number;
  authorization: string;
};

type NativeListener = { remove: () => void | Promise<void> };

type BackgroundLocationPluginShape = {
  start(options: { distanceFilter?: number }): Promise<NativeStartResult>;
  stop(): Promise<void>;
  /** Positions CoreLocation delivered to Swift that JS may never have
   *  processed. See the buffer note in BackgroundLocationPlugin.swift. */
  drain(): Promise<{
    positions: { latitude: number; longitude: number; accuracy?: number; timestamp: number }[];
  }>;
  isAvailable(): Promise<{
    available: boolean;
    backgroundModeDeclared: boolean;
    authorization: string;
  }>;
  addListener(
    event: "position",
    cb: (p: { latitude: number; longitude: number; accuracy?: number; timestamp: number }) => void,
  ): Promise<NativeListener>;
  addListener(
    event: "authorizationDenied",
    cb: (p: { authorization: string }) => void,
  ): Promise<NativeListener>;
  addListener(event: "failed", cb: (p: { message: string }) => void): Promise<NativeListener>;
};

/**
 * Module-scope `registerPlugin`, destructured nowhere near an `await` of the
 * proxy itself. `registerPlugin` returns a Proxy that manufactures a method for
 * ANY property, so `await`ing the plugin object triggers thenable assimilation
 * and the bridge rejects with `"BackgroundLocation.then()" is not implemented`
 * (CLAUDE.md). Only ever await its METHODS.
 */
const BackgroundLocation = registerPlugin<BackgroundLocationPluginShape>("BackgroundLocation");

/** Metres between writes. Matches the native default; passed explicitly so the
 *  web watch and the native watch agree on what "moved" means. */
export const EN_ROUTE_DISTANCE_FILTER_M = 50;

/** Floor on write frequency, so a helper on a bumpy GPS fix in stop-and-go
 *  traffic cannot hammer the table. Distance is the primary filter; this is the
 *  backstop the web path needs because `navigator.geolocation` has no
 *  distanceFilter of its own. */
const MIN_WRITE_INTERVAL_MS = 20_000;

/** A stationary helper still writes this often, so the poster's freshness stamp
 *  distinguishes "parked outside" from "the app stopped reporting". */
export const EN_ROUTE_HEARTBEAT_MS = 120_000;

function haversineMetres(a: EnRoutePosition, b: EnRoutePosition): number {
  const R = 6_371_000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

export type EnRouteWatchHandle = {
  /** Idempotent — safe to call from a React cleanup that may run twice. */
  stop: () => void;
};

export type EnRouteWatchOptions = {
  /** Called only for positions that pass the distance/interval filter. */
  onPosition: (p: EnRoutePosition) => void;
  /** Called once the runtime mode is known, and again if it degrades
   *  (e.g. permission revoked from Settings mid-drive). */
  onMode: (mode: EnRouteMode) => void;
};

/**
 * Start following the helper. Returns synchronously with a handle whose
 * `stop()` is always safe to call, including before the async start has
 * settled — a helper who taps "On My Way" and "I've Arrived" in quick
 * succession must not leave a watch running.
 */
export function startEnRouteWatch({ onPosition, onMode }: EnRouteWatchOptions): EnRouteWatchHandle {
  let stopped = false;
  let last: EnRoutePosition | null = null;
  let lastWriteAt = 0;
  let cleanup: (() => void) | null = null;

  const emit = (p: EnRoutePosition, force = false) => {
    if (stopped) return;
    if (force) {
      last = p;
      lastWriteAt = Date.now();
      onPosition(p);
      return;
    }
    // Rate limit FIRST — nothing writes more often than this, however jumpy
    // the fix. Then: write because they moved, or because the heartbeat is due.
    // The heartbeat is what keeps a stationary helper's "last seen" honest
    // instead of merely quiet; without it, "no writes" and "app died" look
    // identical to the poster.
    const since = Date.now() - lastWriteAt;
    if (since < MIN_WRITE_INTERVAL_MS) return;
    const movedEnough = !last || haversineMetres(last, p) >= EN_ROUTE_DISTANCE_FILTER_M;
    const heartbeatDue = since >= EN_ROUTE_HEARTBEAT_MS;
    if (!movedEnough && !heartbeatDue) return;
    last = p;
    lastWriteAt = Date.now();
    onPosition(p);
  };

  const startWeb = () => {
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      onMode("unavailable");
      return;
    }
    const id = navigator.geolocation.watchPosition(
      (pos) =>
        emit({
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
          accuracy: pos.coords.accuracy,
          at: pos.timestamp,
        }),
      (err) => {
        // 1 === PERMISSION_DENIED. Anything else (position unavailable,
        // timeout) is transient and the watch stays armed.
        if (err.code === err.PERMISSION_DENIED) onMode("denied");
      },
      { enableHighAccuracy: true, timeout: 30_000, maximumAge: 15_000 },
    );
    cleanup = () => navigator.geolocation.clearWatch(id);
    onMode("foreground");
  };

  const startNative = async () => {
    const listeners: NativeListener[] = [];
    try {
      const posListener = await BackgroundLocation.addListener("position", (p) =>
        emit({ lat: p.latitude, lng: p.longitude, accuracy: p.accuracy, at: p.timestamp }),
      );
      listeners.push(posListener);
      const denyListener = await BackgroundLocation.addListener("authorizationDenied", () =>
        onMode("denied"),
      );
      listeners.push(denyListener);

      const result = await BackgroundLocation.start({
        distanceFilter: EN_ROUTE_DISTANCE_FILTER_M,
      });
      if (stopped) {
        void BackgroundLocation.stop();
        listeners.forEach((l) => void l.remove());
        return;
      }
      // BACKFILL ON RESUME.
      //
      // CoreLocation reaching Swift in the background is guaranteed; the
      // WebView's JS being awake to run the Supabase write is not — WebKit
      // throttles background WebContent. So on every resume, take whatever
      // Swift buffered and write the newest of it.
      //
      // Only the newest: `job_tracking` holds ONE latitude/longitude, not a
      // trail, so replaying older fixes would write a position we already know
      // is out of date. If a trail is ever wanted, it needs its own table and
      // this is where the rows would come from.
      const { App } = await import("@capacitor/app");
      const resumeListener = await App.addListener("resume", () => {
        void (async () => {
          try {
            const { positions } = await BackgroundLocation.drain();
            const newest = positions[positions.length - 1];
            if (newest) {
              emit(
                {
                  lat: newest.latitude,
                  lng: newest.longitude,
                  accuracy: newest.accuracy,
                  at: newest.timestamp,
                },
                true,
              );
            }
          } catch {
            /* drain is a backstop; a failure just means no backfill this time */
          }
        })();
      });
      listeners.push(resumeListener);

      cleanup = () => {
        void BackgroundLocation.stop();
        listeners.forEach((l) => void l.remove());
      };
      // `background` is the NATIVE side's answer, derived from the real plist
      // and the real CLLocationManager — not from this file's assumptions.
      onMode(result.background ? "background" : "foreground");
    } catch (e) {
      listeners.forEach((l) => void l.remove());
      const code = (e as { code?: string } | null)?.code;
      if (code === "PERMISSION_DENIED") {
        onMode("denied");
        return;
      }
      // UNIMPLEMENTED (an installed build older than this plugin), or anything
      // else we did not anticipate: fall back to a watch that at least works
      // while the app is open, and report it as exactly that.
      if (!stopped) startWebNativeFallback();
    }
  };

  /**
   * Foreground fallback ON NATIVE. Deliberately routed through
   * `@capacitor/geolocation` rather than `navigator.geolocation`: the WKWebView
   * shim fires its own second "localhost would like to use your location"
   * prompt on top of the OS one (same reason `getLocation()` in JobTracking
   * avoids it).
   */
  const startWebNativeFallback = () => {
    let watchId: string | null = null;
    let disposed = false;
    void (async () => {
      try {
        const { Geolocation } = await import("@capacitor/geolocation");
        const id = await Geolocation.watchPosition({ enableHighAccuracy: true }, (pos, err) => {
          if (err || !pos) return;
          emit({
            lat: pos.coords.latitude,
            lng: pos.coords.longitude,
            accuracy: pos.coords.accuracy,
            at: pos.timestamp,
          });
        });
        if (disposed || stopped) {
          void Geolocation.clearWatch({ id });
          return;
        }
        watchId = id;
        onMode("foreground");
      } catch {
        // Silence is correct and deliberate here: the only way this throws is
        // the user declining the permission prompt, which is a CHOICE, not a
        // failure. `onMode("denied")` is the report — it drives the helper's
        // honesty banner and the poster's freshness stamp, so the outcome is
        // surfaced in the UI rather than swallowed. Sending it to the error
        // logger as well would fill error_logs with normal user decisions and
        // bury the faults that matter.
        onMode("denied");
      }
    })();
    cleanup = () => {
      disposed = true;
      if (watchId) void import("@capacitor/geolocation").then(({ Geolocation }) =>
        Geolocation.clearWatch({ id: watchId as string }),
      );
    };
  };

  if (isNativePlatform) {
    void startNative();
  } else {
    startWeb();
  }

  return {
    stop: () => {
      if (stopped) return;
      stopped = true;
      cleanup?.();
      cleanup = null;
    },
  };
}
