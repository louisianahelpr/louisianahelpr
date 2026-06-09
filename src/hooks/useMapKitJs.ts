import { useEffect, useState } from "react";

/**
 * Loads Apple's MapKit JS (the same SDK that powers maps.apple.com)
 * on demand and exposes a load-status hook.
 *
 * - Token comes from `VITE_APPLE_MAPKIT_TOKEN`. When missing, the hook
 *   returns `status: "missing-token"` and callers fall back to plain
 *   inputs. This is the explicit "graceful degrade" path called out in
 *   the handoff — the build still ships, the page still works, the
 *   poster just doesn't get autocomplete.
 *
 * - The mapkit.js script is loaded from Apple's CDN
 *   (https://cdn.apple-mapkit.com/mk/5.x.x/mapkit.js — the version
 *   string `5.x.x` is the documented "always-latest" alias). No npm
 *   dependency is needed.
 *
 * - Initialization is idempotent: subsequent callers reuse the already-
 *   loaded library and resolve immediately. A module-level cache + a
 *   single pending promise dedupe parallel `useMapKitJs()` mounts on
 *   the same page so the script never gets injected twice.
 */

export type MapKitStatus =
  | "idle"
  | "loading"
  | "ready"
  | "missing-token"
  | "error";

/** Minimal `mapkit` shape we touch — enough to keep TS honest without
 *  pulling in the full @types/mapkit-js package, which has historically
 *  drifted from Apple's runtime. We treat everything else as `any`. */
interface MapKitGlobal {
  init: (options: {
    authorizationCallback: (done: (token: string) => void) => void;
  }) => void;
  Search: new (options?: Record<string, unknown>) => any;
  Coordinate: new (lat: number, lng: number) => any;
  CoordinateRegion: new (center: any, span: any) => any;
  CoordinateSpan: new (latDelta: number, lngDelta: number) => any;
}

declare global {
  interface Window {
    mapkit?: MapKitGlobal;
  }
}

const SCRIPT_SRC = "https://cdn.apple-mapkit.com/mk/5.x.x/mapkit.js";
const SCRIPT_ID = "apple-mapkit-js";

let cachedStatus: MapKitStatus = "idle";
let pending: Promise<MapKitStatus> | null = null;

function getToken(): string | undefined {
  // Vite injects import.meta.env.* at build time. We use bracket access
  // so a missing var doesn't blow up TS strict mode.
  const env = (import.meta as { env?: Record<string, string | undefined> }).env;
  return env?.VITE_APPLE_MAPKIT_TOKEN;
}

function loadScript(): Promise<MapKitStatus> {
  if (pending) return pending;
  if (cachedStatus === "ready") return Promise.resolve("ready");

  const token = getToken();
  if (!token) {
    cachedStatus = "missing-token";
    return Promise.resolve("missing-token");
  }

  pending = new Promise<MapKitStatus>((resolve) => {
    cachedStatus = "loading";

    const finish = (status: MapKitStatus) => {
      cachedStatus = status;
      pending = null;
      resolve(status);
    };

    const initMapKit = () => {
      try {
        window.mapkit?.init({
          authorizationCallback: (done) => done(token),
        });
        finish("ready");
      } catch {
        finish("error");
      }
    };

    // If the script tag is already there (e.g. from a prior mount that
    // dropped out before resolving), reuse it.
    const existing = document.getElementById(SCRIPT_ID) as HTMLScriptElement | null;
    if (existing) {
      if (window.mapkit) {
        initMapKit();
      } else {
        existing.addEventListener("load", initMapKit);
        existing.addEventListener("error", () => finish("error"));
      }
      return;
    }

    const script = document.createElement("script");
    script.id = SCRIPT_ID;
    script.src = SCRIPT_SRC;
    script.crossOrigin = "anonymous";
    script.async = true;
    script.addEventListener("load", initMapKit);
    script.addEventListener("error", () => finish("error"));
    document.head.appendChild(script);
  });

  return pending;
}

/**
 * React hook wrapper around the module-level loader. Returns the
 * current status so a component can render its fallback (plain
 * inputs) when MapKit isn't usable, and the autocomplete when it is.
 */
export function useMapKitJs(): MapKitStatus {
  const [status, setStatus] = useState<MapKitStatus>(cachedStatus);

  useEffect(() => {
    let cancelled = false;
    loadScript().then((s) => {
      if (!cancelled) setStatus(s);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  return status;
}
