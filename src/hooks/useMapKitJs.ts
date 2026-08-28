import { useEffect, useState } from "react";
import { report } from "@/lib/errorLogger";

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

/** How long to wait for MapKit to report its authorization outcome. */
const AUTH_CONFIRM_TIMEOUT_MS = 5_000;

/** How long to wait for the server to mint a token before falling back to the
 *  build-time one. Deliberately short: a slow edge cold-start must not delay
 *  the map, and the fallback is a fully working token. */
const SERVER_TOKEN_TIMEOUT_MS = 3_000;

// Reported once per DISTINCT REASON, not once per session and not once per
// call. MapKit re-invokes the authorization callback on every refresh, so an
// unconditional report would flood error_logs with the same line; but a single
// once-ever flag hid the second failure mode behind the first (a 503 on the
// first call and a timeout on the tenth are different problems, and only the
// 503 was ever written down).
const reportedTokenFailures = new Set<string>();

/**
 * Whether the map currently on screen is being served by the UNRESTRICTED
 * build-time token. True means: the origin-locked server path failed and we
 * fell back to a credential that is compiled into the public JS bundle and can
 * be lifted out of it by any visitor.
 *
 * Exposed so the UI can say so calmly instead of rendering a map that looks
 * exactly like a correctly-configured one. See `useMapKitTokenSource`.
 */
export type MapKitTokenSource = "unknown" | "server" | "build-time" | "none";

let tokenSource: MapKitTokenSource = "unknown";
const tokenSourceListeners = new Set<(s: MapKitTokenSource) => void>();

function setTokenSource(next: MapKitTokenSource) {
  if (tokenSource === next) return;
  tokenSource = next;
  tokenSourceListeners.forEach((fn) => fn(next));
}

let cachedStatus: MapKitStatus = "idle";
let pending: Promise<MapKitStatus> | null = null;

function getBuildTimeToken(): string | undefined {
  // Vite injects import.meta.env.* at build time. We use bracket access
  // so a missing var doesn't blow up TS strict mode.
  const env = (import.meta as { env?: Record<string, string | undefined> }).env;
  return env?.VITE_APPLE_MAPKIT_TOKEN;
}

/**
 * Ask the server to mint a short-lived, origin-locked token.
 *
 * The build-time token is a static string with a fixed expiry (the committed
 * one dies 2027-02-14) and no `origin` claim, so it is both a scheduled outage
 * and a credential anyone can lift out of the public JS bundle and spend. The
 * `mapkit-token` edge function mints one-hour tokens locked to the requesting
 * origin, and keeps the signing key server-side.
 *
 * Returns null on ANY failure — not configured (503), offline, a cold start
 * that outruns the timeout — so the caller falls back to the build-time token
 * and maps keep working exactly as they do today. That fallback is what makes
 * this safe to deploy before the Apple secrets are set.
 *
 * VERIFIED 2026-08-25, production: this endpoint answers
 * `503 {"error":"not_configured"}` — APPLE_MAPKIT_PRIVATE_KEY / _KEY_ID /
 * _TEAM_ID were never set. So the origin-locked path has never actually run,
 * and every map in production is served by the UNRESTRICTED build-time token
 * that this function exists to replace. The failure was silent (a bare
 * `return null`), which is why it survived this long — it now reports once per
 * session so the inert hardening is visible in monitoring instead of only in
 * a console warning MapKit happens to print.
 */
async function fetchServerToken(): Promise<string | null> {
  const env = (import.meta as { env?: Record<string, string | undefined> }).env;
  const base = env?.VITE_SUPABASE_URL;
  const apikey = env?.VITE_SUPABASE_PUBLISHABLE_KEY;
  if (!base || !apikey) return null;

  try {
    // Bounded: MapKit is blocking on this callback, and a hung fetch would
    // reproduce the very "Locating… forever" hang this hook already guards.
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), SERVER_TOKEN_TIMEOUT_MS);
    const res = await fetch(`${base}/functions/v1/mapkit-token`, {
      method: "POST",
      headers: { apikey, "Content-Type": "application/json" },
      signal: controller.signal,
    }).finally(() => clearTimeout(timer));

    if (!res.ok) {
      reportServerTokenFailure(`mapkit-token responded ${res.status}`);
      return null;
    }
    const body = (await res.json()) as { token?: string };
    if (typeof body.token === "string" && body.token) return body.token;
    reportServerTokenFailure("mapkit-token returned no token");
    return null;
  } catch (e) {
    reportServerTokenFailure(e instanceof Error ? e.message : "mapkit-token request failed");
    return null;
  }
}

/**
 * Surface the fallback-to-unrestricted-token condition exactly once. Silent
 * degradation is the whole reason a permanent misconfiguration looked like a
 * working feature for months.
 */
function reportServerTokenFailure(reason: string) {
  if (reportedTokenFailures.has(reason)) return;
  reportedTokenFailures.add(reason);
  // `severity: "error"`, explicitly. This is not a degraded nicety: while it
  // is true, every map in production is authorized by a credential sitting in
  // the public bundle with no origin claim, and the daily checks must keep
  // tripping over it until APPLE_MAPKIT_PRIVATE_KEY / _KEY_ID / _TEAM_ID are
  // set. Measured 2026-08-27: 101x 503 against 96x 200 in 24h.
  report(
    new Error(`MapKit falling back to the unrestricted build-time token: ${reason}`),
    {
      severity: "error",
      tags: {
        source: "useMapKitJs.fetchServerToken",
        mapkit_token_source: "build-time-unrestricted",
      },
    },
  );
}

/**
 * The token MapKit should use right now, preferring the server.
 *
 * MapKit calls `authorizationCallback` again on refresh, so this runs more than
 * once per session and the server path gets picked up without a reload.
 */
async function resolveToken(): Promise<string | undefined> {
  const served = await fetchServerToken();
  if (served) {
    setTokenSource("server");
    return served;
  }
  const built = getBuildTimeToken();
  // The fallback STAYS — deleting it today would break every map instantly
  // rather than gracefully, and the owner's sequencing is "secrets first, then
  // remove". What changes is that it is no longer silent: the session is
  // marked degraded, so the surfaces that draw a map can say the map is not
  // trustworthy instead of drawing one that looks fine.
  setTokenSource(built ? "build-time" : "none");
  return built;
}

function loadScript(): Promise<MapKitStatus> {
  if (pending) return pending;
  if (cachedStatus === "ready") return Promise.resolve("ready");

  // NOTE: no longer short-circuits on a missing build-time token. The server
  // can mint one, so "no VITE_APPLE_MAPKIT_TOKEN" is no longer the same thing
  // as "no MapKit" — that is resolved inside the authorization callback below,
  // which reports "missing-token" only when BOTH sources come up empty.

  pending = new Promise<MapKitStatus>((resolve) => {
    cachedStatus = "loading";

    const finish = (status: MapKitStatus) => {
      cachedStatus = status;
      pending = null;
      resolve(status);
    };

    const initMapKit = () => {
      const mk = window.mapkit;
      // Optional chaining used to hide this: if the script loaded but did not
      // define `mapkit`, `window.mapkit?.init(...)` quietly did nothing and we
      // still reported "ready".
      if (!mk) return finish("error");

      try {
        // `init()` is ASYNCHRONOUS authorization. It returns immediately and
        // tells us nothing about whether Apple accepted the token — which is
        // why this used to call finish("ready") on the next line and be wrong
        // whenever VITE_APPLE_MAPKIT_TOKEN had expired. A stale token then
        // produced a "ready" MapKit whose Geocoder never invokes its
        // callback, hanging every caller that awaited one (see
        // CurrentLocationPill: the "use my location" button stuck on
        // "Locating…" forever).
        //
        // So wait for MapKit to actually report its authorization outcome.
        // Listeners are attached BEFORE init() because the events can fire
        // synchronously during initialization.
        const events = mk as unknown as {
          addEventListener?: (t: string, fn: (e: { status?: string }) => void) => void;
          removeEventListener?: (t: string, fn: (e: { status?: string }) => void) => void;
        };

        let onConfig: ((e: { status?: string }) => void) | undefined;
        let onError: ((e: { status?: string }) => void) | undefined;
        let fallbackTimer: ReturnType<typeof setTimeout> | undefined;

        const settle = (status: MapKitStatus) => {
          clearTimeout(fallbackTimer);
          if (onConfig) events.removeEventListener?.("configuration-change", onConfig);
          if (onError) events.removeEventListener?.("error", onError);
          finish(status);
        };

        if (typeof events.addEventListener === "function") {
          onConfig = (e) => {
            // "Initialized" on first auth, "Refreshed" on token renewal.
            if (e?.status === "Initialized" || e?.status === "Refreshed") settle("ready");
          };
          onError = () => settle("error");
          events.addEventListener("configuration-change", onConfig);
          events.addEventListener("error", onError);

          // Deliberate optimism on timeout. If a future MapKit stops emitting
          // these events, falling back to "ready" keeps address autocomplete
          // working exactly as it does today rather than silently disabling it
          // across all six consumers. The per-call timeout in
          // CurrentLocationPill covers the hang this leaves open.
          fallbackTimer = setTimeout(() => settle("ready"), AUTH_CONFIRM_TIMEOUT_MS);
        }

        // MapKit invokes this on init and again on every refresh, which is
        // precisely the hook short-lived server tokens need — resolve fresh
        // each time rather than closing over one string for the session.
        mk.init({
          authorizationCallback: (done) => {
            void resolveToken().then((t) => {
              if (t) {
                done(t);
                return;
              }
              // Neither source produced a token. Settle honestly instead of
              // handing MapKit an empty string, which it accepts and then
              // fails on asynchronously — the exact silent-hang this hook
              // exists to prevent.
              settle("missing-token");
            });
          },
        });

        // No event support at all — preserve the old behaviour.
        if (typeof events.addEventListener !== "function") finish("ready");
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

/**
 * Which credential MapKit is running on right now.
 *
 * Callers use this to distinguish "the map is fine" from "the map is only up
 * because we fell back to a token anyone can copy out of the bundle". It is a
 * module-level value with a subscription rather than component state because
 * MapKit resolves the token once per session (and again on refresh), long
 * before or after any given component mounts.
 */
export function useMapKitTokenSource(): MapKitTokenSource {
  const [source, setSource] = useState<MapKitTokenSource>(tokenSource);
  useEffect(() => {
    setSource(tokenSource);
    tokenSourceListeners.add(setSource);
    return () => {
      tokenSourceListeners.delete(setSource);
    };
  }, []);
  return source;
}
