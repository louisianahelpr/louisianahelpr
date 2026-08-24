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
// Until those are set this function returns 503 and the client falls back to
// the build-time token, so deploying it changes nothing until it is configured.

import { corsHeadersFull, jsonResponse, errorResponse } from "../_shared/cors.ts";

/** One hour. Apple's documented maximum for a MapKit JS token is 7 days; an
 *  hour is short enough that a scraped token is near-worthless and long enough
 *  that a normal session never re-fetches. MapKit refreshes on its own. */
const TOKEN_TTL_SECONDS = 60 * 60;

/** Base64url WITHOUT padding — required for JWT segments. */
function base64url(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function base64urlJson(value: unknown): string {
  return base64url(new TextEncoder().encode(JSON.stringify(value)));
}

/**
 * Import the .p8 PEM as an ECDSA P-256 signing key.
 *
 * Apple issues MapKit keys as PKCS#8 PEM. Deno's WebCrypto wants the raw DER,
 * so strip the armour and any whitespace the secret store may have introduced
 * — a PEM pasted through a web UI frequently arrives with literal "\n" rather
 * than real newlines, which is why both are normalised here.
 */
async function importSigningKey(pem: string): Promise<CryptoKey> {
  const der = pem
    .replace(/\\n/g, "\n")
    .replace(/-----BEGIN PRIVATE KEY-----/, "")
    .replace(/-----END PRIVATE KEY-----/, "")
    .replace(/\s+/g, "");

  if (!der) throw new Error("APPLE_MAPKIT_PRIVATE_KEY is empty after stripping PEM armour");

  const raw = Uint8Array.from(atob(der), (c) => c.charCodeAt(0));
  return await crypto.subtle.importKey(
    "pkcs8",
    raw,
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["sign"],
  );
}

/**
 * The `origin` claim locks the token to one domain. MapKit rejects a token
 * whose origin does not match the page using it, which is the whole point —
 * but it also means a WRONG origin breaks maps entirely, so this is derived
 * from the caller rather than hardcoded, and simply omitted when the caller has
 * no web origin at all (the native iOS/Android WebView, where the request comes
 * from a capacitor:// or file:// context that Apple cannot match anyway).
 */
function originClaimFor(req: Request): string | null {
  const origin = req.headers.get("origin");
  if (!origin) return null;
  try {
    const url = new URL(origin);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    return url.origin;
  } catch {
    return null;
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeadersFull });
  }

  const privateKey = Deno.env.get("APPLE_MAPKIT_PRIVATE_KEY");
  const keyId = Deno.env.get("APPLE_MAPKIT_KEY_ID");
  const teamId = Deno.env.get("APPLE_MAPKIT_TEAM_ID");

  // Not configured yet. 503 rather than 500: this is "not available", and the
  // client is expected to fall back to its build-time token on exactly this
  // response. Deploying this function before setting the secrets is therefore
  // a no-op rather than an outage.
  if (!privateKey || !keyId || !teamId) {
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
    const now = Math.floor(Date.now() / 1000);
    const origin = originClaimFor(req);

    const header = { alg: "ES256", kid: keyId, typ: "JWT" };
    const payload: Record<string, unknown> = {
      iss: teamId,
      iat: now,
      exp: now + TOKEN_TTL_SECONDS,
    };
    if (origin) payload.origin = origin;

    const signingInput = `${base64urlJson(header)}.${base64urlJson(payload)}`;

    const key = await importSigningKey(privateKey);
    const signature = await crypto.subtle.sign(
      // ES256 over P-256 with SHA-256. WebCrypto returns the raw r||s pair,
      // which is exactly the JOSE encoding — no DER unwrapping needed.
      { name: "ECDSA", hash: { name: "SHA-256" } },
      key,
      new TextEncoder().encode(signingInput),
    );

    const token = `${signingInput}.${base64url(new Uint8Array(signature))}`;

    return jsonResponse(
      { token, expiresIn: TOKEN_TTL_SECONDS },
      200,
      {
        ...corsHeadersFull,
        // Let the browser reuse it, but expire well before the token does so a
        // cached response can never be handed out after it stops working.
        "Cache-Control": `private, max-age=${TOKEN_TTL_SECONDS - 300}`,
      },
    );
  } catch (err) {
    // Never echo the error body to the client — a key-import failure can quote
    // fragments of the private key. Log server-side, return something generic.
    console.error("mapkit-token: failed to mint token", err);
    return errorResponse("Failed to mint MapKit token", 500, corsHeadersFull);
  }
});
