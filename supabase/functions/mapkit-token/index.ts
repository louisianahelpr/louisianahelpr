// Mint a short-lived Apple MapKit JS token.
//
// WHY THIS EXISTS
// ---------------
// The MapKit token used to be a static string in `VITE_APPLE_MAPKIT_TOKEN`,
// which the `VITE_` prefix inlines into the client bundle at build time. Two
// problems came with that:
//
//   1. It EXPIRES. The committed one dies 2027-02-14, with no refresh path
//      anywhere in the codebase. On that date every map, every address
//      autocomplete, and the "use my location" button stop working — silently,
//      because MapKit's init() is asynchronous and reports failure through an
//      event most callers never see. `useMapKitJs` already learned this the
//      hard way: an expired token produced a "ready" MapKit whose Geocoder
//      never invoked its callback, hanging "Locating…" forever.
//
//   2. It is UNRESTRICTED. The old token carries no `origin` claim, so anybody
//      who copied it out of the public JS bundle could bill map usage to this
//      Apple account. Tokens minted here are origin-locked and live one hour,
//      so a scraped one is worth almost nothing.
//
// The private key never leaves the server. MapKit's own `authorizationCallback`
// is designed for exactly this: it is invoked on init AND again on every
// refresh (the "Refreshed" configuration-change status `useMapKitJs` already
// handles), so short-lived tokens are the shape Apple intends.
//
// SECRETS REQUIRED (set with `supabase secrets set`, never committed):
//   APPLE_MAPKIT_PRIVATE_KEY  contents of the .p8 downloaded from Apple, the
//                             full "-----BEGIN PRIVATE KEY-----" PEM
//   APPLE_MAPKIT_KEY_ID       the key's 10-char ID  (current key: 4QA8J9TA8K)
//   APPLE_MAPKIT_TEAM_ID      the Apple team ID     (this account: P85MCK558V)
//
// They are set (measured 2026-10-05 and 2026-10-12: the function mints), and
// the client's build-time fallback token is gone (Q249): without these secrets
// the function answers 503 and maps degrade to plain inputs.

import { corsHeadersFull, jsonResponse, errorResponse } from "../_shared/cors.ts";
import { checkRateLimit, rateLimitResponse } from "../_shared/rate-limit.ts";
import { serve } from "../_shared/buildStamp.ts";
import { mapkitKeyFromEnv, signMapkitJwt } from "../_shared/mapkitJwt.ts";

/** One hour. Apple's documented maximum for a MapKit JS token is 7 days; an
 *  hour is short enough that a scraped token is near-worthless and long enough
 *  that a normal session never re-fetches. MapKit refreshes on its own. */
const TOKEN_TTL_SECONDS = 60 * 60;

/**
 * The `origin` claim locks the token to one domain: MapKit rejects a token
 * whose origin does not match the page using it.
 *
 * WHICH ORIGINS GET ONE (Q249). This used to copy ANY http(s) Origin into the
 * claim, so a page on any other site got a working token locked to itself,
 * billed to this Apple account (measured 2026-10-12 against prod:
 * Origin https://evil.example.com -> 200, origin claim https://evil.example.com).
 * Now:
 *   - our web origins (and the Android app's https://localhost, and local dev
 *     on http://localhost / 127.0.0.1) get a token locked to that origin;
 *   - the iOS app (capacitor://localhost) and a request with no Origin get one
 *     with NO origin claim, as before: Apple cannot match a capacitor:// page,
 *     and whether the WebView always sends an Origin has not been measured on
 *     a device, so refusing either could take maps away from the app. That
 *     carve-out still mints an unrestricted token for anyone who leaves the
 *     header off (rate-limited below); closing it needs a native gate (the
 *     open item filed with Q249);
 *   - every other Origin (another site, a look-alike, a sandboxed "null"
 *     document) is refused with 403.
 */
const WEB_ORIGINS = new Set([
  "https://www.louisianahelpr.com",
  "https://louisianahelpr.com",
  "https://localhost", // the Android app's WebView origin
]);
const DEV_ORIGIN = /^http:\/\/(localhost|127\.0\.0\.1)(:\d{1,5})?$/;
const NATIVE_ORIGINS = new Set(["capacitor://localhost"]);

type OriginVerdict = { kind: "locked"; origin: string } | { kind: "unlocked" } | { kind: "refused" };

function originVerdict(raw: string | null): OriginVerdict {
  if (raw === null || raw === "") return { kind: "unlocked" };
  if (NATIVE_ORIGINS.has(raw)) return { kind: "unlocked" };
  if (WEB_ORIGINS.has(raw) || DEV_ORIGIN.test(raw)) return { kind: "locked", origin: raw };
  return { kind: "refused" };
}

serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeadersFull });
  }

  // Bound the mint rate (EF-04, hole hunt 2026-09-15). This endpoint is
  // deliberately anonymous — the ONLY caller (useMapKitJs) sends just the
  // publishable `apikey`, no user JWT, and maps must work for signed-out
  // visitors and the native capacitor:// WebView that Apple cannot origin-match
  // — so requiring auth is not an option. But an unmetered anonymous endpoint
  // that mints unlimited hour-long Apple MapKit tokens lets anyone drive this
  // Apple account's daily map-view quota to exhaustion (maps down for real
  // users) with nothing to revoke. The shared limiter keys on the
  // server-derived IP here (there is no JWT subject to key the narrow window
  // on), which is exactly the ceiling this needs. The origin claim is already
  // restricted per-caller below; the native no-Origin carve-out is kept, now
  // rate-limited rather than unbounded.
  const rl = await checkRateLimit(req, {
    windowMs: 60_000,
    maxRequests: 30,
    keyPrefix: "mapkit-token",
  });
  if (!rl.allowed) return rateLimitResponse(rl.retryAfter ?? 60, corsHeadersFull);

  // Before the secrets are read: a refused origin learns nothing else.
  const verdict = originVerdict(req.headers.get("origin"));
  if (verdict.kind === "refused") {
    return errorResponse("origin_not_allowed", 403, corsHeadersFull);
  }

  const key = mapkitKeyFromEnv((name) => Deno.env.get(name));

  // Not configured. 503 rather than 500: this is "not available"; the client
  // settles "missing-token" and its pages fall back to plain inputs.
  if (!key) {
    return jsonResponse(
      {
        error: "not_configured",
        detail:
          "Set APPLE_MAPKIT_PRIVATE_KEY, APPLE_MAPKIT_KEY_ID and APPLE_MAPKIT_TEAM_ID.",
      },
      503,
      corsHeadersFull,
    );
  }

  try {
    const origin = verdict.kind === "locked" ? verdict.origin : null;
    const token = await signMapkitJwt(key, TOKEN_TTL_SECONDS, origin);

    return jsonResponse(
      { token, expiresIn: TOKEN_TTL_SECONDS },
      200,
      {
        ...corsHeadersFull,
        // Let the browser reuse it, but expire well before the token does so a
        // cached response can never be handed out after it stops working.
        "Cache-Control": `private, max-age=${TOKEN_TTL_SECONDS - 300}`,
        // Q1670: the token is locked to the caller's Origin, so a cached
        // response must never be reused for another origin (www vs apex).
        Vary: "Origin",
      },
    );
  } catch (err) {
    // Never echo the error body to the client — a key-import failure can quote
    // fragments of the private key. Log server-side, return something generic.
    console.error("mapkit-token: failed to mint token", err);
    return errorResponse("Failed to mint MapKit token", 500, corsHeadersFull);
  }
});
