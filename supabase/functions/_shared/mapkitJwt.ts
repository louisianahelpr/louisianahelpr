// mapkitJwt — sign an Apple Maps (MapKit) developer token with the account's
// MapKit key. ONE signer for both of its users:
//   - mapkit-token: the short-lived token MapKit JS uses in the app;
//   - geocodeDropoff (via appleMapsGeocoder below): the Apple Maps Server API,
//     which takes the SAME developer token and exchanges it for an access token
//     (https://developer.apple.com/documentation/applemapsserverapi).
// The private key never leaves the server.

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

export interface MapkitKey {
  privateKey: string;
  keyId: string;
  teamId: string;
}

/** The MapKit key from the function's secrets, or null when any part is unset. */
export function mapkitKeyFromEnv(readEnv: (name: string) => string | undefined): MapkitKey | null {
  const privateKey = readEnv("APPLE_MAPKIT_PRIVATE_KEY");
  const keyId = readEnv("APPLE_MAPKIT_KEY_ID");
  const teamId = readEnv("APPLE_MAPKIT_TEAM_ID");
  if (!privateKey || !keyId || !teamId) return null;
  return { privateKey, keyId, teamId };
}

/** An ES256 developer token: iss = team, iat/exp, and an `origin` claim only when given. */
export async function signMapkitJwt(key: MapkitKey, ttlSeconds: number, origin: string | null = null): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: "ES256", kid: key.keyId, typ: "JWT" };
  const payload: Record<string, unknown> = { iss: key.teamId, iat: now, exp: now + ttlSeconds };
  if (origin) payload.origin = origin;

  const signingInput = `${base64urlJson(header)}.${base64urlJson(payload)}`;
  const signature = await crypto.subtle.sign(
    // ES256 over P-256 with SHA-256. WebCrypto returns the raw r||s pair,
    // which is exactly the JOSE encoding — no DER unwrapping needed.
    { name: "ECDSA", hash: { name: "SHA-256" } },
    await importSigningKey(key.privateKey),
    new TextEncoder().encode(signingInput),
  );
  return `${signingInput}.${base64url(new Uint8Array(signature))}`;
}
