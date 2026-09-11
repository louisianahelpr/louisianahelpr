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

/**
 * How long to wait for the server to mint a token.
 *
 * WAS 3_000, on the reasoning that "a slow edge cold-start must not delay the
 * map, and the fallback is a fully working token". The second half of that
 * sentence is FALSE IN PRODUCTION and has been since this landed. Vercel prod
 * has no `VITE_APPLE_MAPKIT_TOKEN`, so Vite inlined `undefined`, constant-folded
 * `built ? "build-time" : "none"` to `"none"`, and dead-code-eliminated the
 * whole fallback branch out of the bundle — verified 2026-09-11 against the
 * deployed chunk `app-shared-CzGSMji3.js`, whose `resolveTokenUncached` minifies
 * to `async function Kf(){let e=await Vf();if(e)return Rf("server"),e;Rf("none")}`
 * with the string `build-time` absent from all 96 chunks.
 *
 * So aborting early does not fall back to anything — it means NO TOKEN AT ALL,
 * and the map dies. Measured against prod the same day, six consecutive calls
 * to `mapkit-token` on a warm wired connection: 1.48s, 1.14s, 2.18s, 3.15s,
 * 2.78s, 4.43s — two of six over the old 3s budget, and a phone on cellular is
 * worse. That is the whole outage: `error_logs` carries a steady drip of
 * "signal is aborted without reason" from this exact abort.
 *
 * Waiting is now strictly better than failing, and the wait is nearly free:
 * `primeToken()` starts this fetch in parallel with Apple's 807KB script
 * download, so in the common case the token is already in hand by the time
 * MapKit asks for it.
 */
const SERVER_TOKEN_TIMEOUT_MS = 8_000;

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
type MapKitTokenSource = "unknown" | "server" | "build-time" | "none";

let tokenSource: MapKitTokenSource = "unknown";
const tokenSourceListeners = new Set<(s: MapKitTokenSource) => void>();

function setTokenSource(next: MapKitTokenSource) {
  if (tokenSource === next) return;
  tokenSource = next;
  tokenSourceListeners.forEach((fn) => fn(next));
}

let cachedStatus: MapKitStatus = "idle";
let pending: Promise<MapKitStatus> | null = null;

/**
 * Subscribers to the load status.
 *
 * `loadScript()` hands back a ONE-SHOT promise, so for a long time the only way
 * a component learned the status was the single value that promise resolved
 * with. Every later transition was invisible to anything already mounted — and
 * there are several, because MapKit re-invokes `authorizationCallback` on every
 * hourly refresh and a refresh can fail. Worse, the optimistic
 * AUTH_CONFIRM_TIMEOUT_MS timer could resolve the promise "ready" while token
 * resolution was still in flight; when that resolution then came up empty,
 * `settle("missing-token")` updated `cachedStatus` but called `resolve()` on an
 * already-resolved promise, which is a no-op. Consumers were left holding a
 * "ready" that was a lie, MapKit was never handed a token, and its Geocoder
 * therefore never invoked its callback — which is exactly how JobLocationPreview
 * pulsed on its loading skeleton forever instead of falling through to its
 * "isn't available" state.
 *
 * Mirrors `tokenSourceListeners` below; same reasoning, same shape.
 */
const statusListeners = new Set<(s: MapKitStatus) => void>();

function setCachedStatus(next: MapKitStatus) {
  if (cachedStatus === next) return;
  cachedStatus = next;
  statusListeners.forEach((fn) => fn(next));
}

function getBuildTimeToken(): string | undefined {
  // Named property access, NOT `(import.meta as {...}).env` — that cast
  // defeats Vite's per-key static replacement (it can only inline
  // `import.meta.env.VITE_X` as a literal string when it can see the exact
  // key at the reference site), so Vite fell back to embedding the WHOLE
  // runtime `import.meta.env` object verbatim. That object reflects every
  // env var present in whichever machine ran the build — not just the ones
  // this app declares — so this chunk's content, and therefore its hashed
  // filename, differed between a GitHub Actions build and a Vercel build
  // even with identical source and identical VITE_* secrets, which is
  // exactly the class of bug that leaves Sentry unable to symbolicate a
  // production stack trace (see .github/workflows/sentry-release.yml).
  // Direct property access lets Vite inline just this one string.
  return import.meta.env.VITE_APPLE_MAPKIT_TOKEN;
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
  // Named access — see getBuildTimeToken's comment above for why the
  // bracket-cast form this replaced is a real bug, not just style.
  const base = import.meta.env.VITE_SUPABASE_URL;
  const apikey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
  if (!base || !apikey) return null;

  try {
    // Bounded: MapKit is blocking on this callback, and a hung fetch would
    // reproduce the very "Locating… forever" hang this hook already guards.
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), SERVER_TOKEN_TIMEOUT_MS);
    // GET, not POST. The edge function answers `Cache-Control: private,
    // max-age=3300` precisely so a browser can reuse the token for 55 minutes
    // (it lives 60), but a POST response is never served from the HTTP cache —
    // so that header has been inert since it was written and EVERY page load
    // paid a fresh edge round-trip, which is what keeps hitting the abort
    // above. The function is method-agnostic (only OPTIONS is special-cased);
    // verified 2026-09-11 against prod: GET → 200 with a valid token in 0.75s.
    const res = await fetch(`${base}/functions/v1/mapkit-token`, {
      method: "GET",
      headers: { apikey },
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
/**
 * A token fetch already in flight, so the network round-trip can be started
 * BEFORE MapKit asks for it.
 *
 * MapKit only invokes `authorizationCallback` once its own script has
 * downloaded, parsed and `init()` has run — so resolving the token in there
 * put an edge-function round-trip strictly AFTER Apple's CDN round-trip, for
 * two requests that have nothing to do with each other. Measured on prod
 * (/dashboard, Chromium 393x852, warm wired): mapkit.js requested 3550ms,
 * responded 3782ms; `functions/v1/mapkit-token` requested 3803ms, responded
 * 4055ms; MapKit's own `ma/bootstrap` at 4058ms — before a single tile. The
 * token wait was 252ms of pure serial dead time on a wired connection, and it
 * is a Supabase edge function, so a cold start makes it seconds.
 *
 * `primeToken()` is called at script-insertion time; `resolveToken()` consumes
 * whatever is in flight. Only the FIRST resolution is shared: MapKit calls the
 * callback again on every token refresh (~hourly) and a refresh must mint a
 * fresh token, never replay the primed one — so the slot is cleared as soon as
 * it is read.
 */
let primedToken: Promise<string | undefined> | null = null;

function primeToken(): void {
  if (primedToken) return;
  // Swallow here only to keep an unhandled rejection off the console — the
  // consumer below re-enters `resolveToken`'s normal path, which does its own
  // reporting and falls back to the build-time token.
  primedToken = resolveTokenUncached().catch(() => undefined);
}

async function resolveToken(): Promise<string | undefined> {
  const primed = primedToken;
  if (primed) {
    primedToken = null;
    const t = await primed;
    if (t) return t;
    // The primed attempt came up empty (network failure, or no token from
    // either source). Fall through and try again for real rather than
    // reporting a transient failure as a permanent one.
  }
  return resolveTokenUncached();
}

async function resolveTokenUncached(): Promise<string | undefined> {
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
    setCachedStatus("loading");

    const finish = (status: MapKitStatus) => {
      // setCachedStatus, not a bare assignment: a status reached AFTER this
      // promise has already resolved must still reach mounted consumers.
      setCachedStatus(status);
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

        let settled = false;

        const settle = (status: MapKitStatus) => {
          clearTimeout(fallbackTimer);
          fallbackTimer = undefined;
          if (onConfig) events.removeEventListener?.("configuration-change", onConfig);
          if (onError) events.removeEventListener?.("error", onError);
          settled = true;
          finish(status);
        };

        const eventsSupported = typeof events.addEventListener === "function";

        if (eventsSupported) {
          onConfig = (e) => {
            // "Initialized" on first auth, "Refreshed" on token renewal.
            if (e?.status === "Initialized" || e?.status === "Refreshed") settle("ready");
          };
          onError = () => settle("error");
          events.addEventListener("configuration-change", onConfig);
          events.addEventListener("error", onError);
          // NOTE: the optimistic fallback timer is deliberately NOT armed here.
          // See `armAuthConfirmTimeout` below.
        }

        /**
         * Arm the "assume it worked" timer — but only once MapKit has actually
         * been handed a token.
         *
         * This used to start at init time, which raced token resolution and
         * lost. `resolveToken()` can legitimately take up to two
         * SERVER_TOKEN_TIMEOUT_MS windows (the primed attempt, then a real
         * retry), and the old 5s timer beat that whenever Apple's script came
         * from the HTTP cache — i.e. on every repeat visit. It then resolved
         * the promise "ready" for a MapKit that had never been authorized and
         * never would be, producing a Geocoder whose callback is never invoked
         * and a caller that waits on it forever.
         *
         * The timer's actual purpose is narrow: cover a future MapKit that
         * stops emitting `configuration-change`. That risk only exists AFTER
         * we have given it a token, so that is when the clock should start.
         * If no token is ever produced, `settle("missing-token")` below is the
         * only honest outcome and nothing should paper over it.
         */
        const armAuthConfirmTimeout = () => {
          if (!eventsSupported || settled || fallbackTimer !== undefined) return;
          fallbackTimer = setTimeout(() => settle("ready"), AUTH_CONFIRM_TIMEOUT_MS);
        };

        // MapKit invokes this on init and again on every refresh, which is
        // precisely the hook short-lived server tokens need — resolve fresh
        // each time rather than closing over one string for the session.
        mk.init({
          authorizationCallback: (done) => {
            void resolveToken().then((t) => {
              if (t) {
                armAuthConfirmTimeout();
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
        if (!eventsSupported) finish("ready");
      } catch {
        finish("error");
      }
    };

    // If the script tag is already there (e.g. from a prior mount that
    // dropped out before resolving), reuse it.
    const existing = document.getElementById(SCRIPT_ID) as HTMLScriptElement | null;
    if (existing) {
      primeToken();
      if (window.mapkit) {
        initMapKit();
      } else {
        existing.addEventListener("load", initMapKit);
        existing.addEventListener("error", () => finish("error"));
      }
      return;
    }

    // Start the token round-trip NOW, in parallel with Apple's CDN fetch,
    // instead of waiting for MapKit to ask for it. See `primedToken`.
    primeToken();

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
    // Subscribe BEFORE kicking off the load, and keep the subscription for the
    // component's whole life. The promise below reports exactly one value; the
    // status can change after it (a failed hourly token refresh, or a late
    // `settle("missing-token")` once token resolution finally comes up empty).
    // Without this, a consumer keeps rendering a status that stopped being true
    // — which is how the job-sheet map preview stayed on its skeleton forever.
    statusListeners.add(setStatus);
    setStatus(cachedStatus);
    loadScript().then((s) => {
      if (!cancelled) setStatus(s);
    });
    return () => {
      cancelled = true;
      statusListeners.delete(setStatus);
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
