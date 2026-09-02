// Shared JWT signing helpers for edge functions.
//
// Used by send-push-notification (APNs ES256 + FCM RS256). Reusable for
// any future function that needs to sign Apple Sign In client_secret JWTs,
// Google service-account JWTs, or other token-auth flows.
//
// All functions are pure (no Deno-only deps beyond crypto.subtle which is
// part of the Web Crypto standard). Safe to import from any Deno edge
// function.

function base64UrlEncode(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

// Import a PKCS8-encoded private key from a PEM-formatted string.
// Strips BEGIN/END armor + whitespace, base64-decodes the body, hands
// to WebCrypto importKey. Returns a CryptoKey suitable for signing.
//
// algParams selects the algorithm:
//   { name: 'ECDSA', namedCurve: 'P-256' }      — APNs (ES256)
//   { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' } — Google service accounts (RS256)
async function importPkcs8Pem(
  pem: string,
  algParams: EcKeyImportParams | RsaHashedImportParams,
): Promise<CryptoKey> {
  const b64 = pem
    .replace(/-----BEGIN PRIVATE KEY-----/g, "")
    .replace(/-----END PRIVATE KEY-----/g, "")
    .replace(/\s/g, "");
  const der = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
  return await crypto.subtle.importKey("pkcs8", der.buffer, algParams, false, ["sign"]);
}

// Build a signed JWT given a header + claims + private key + sign algorithm.
// Returns the compact serialization "<header>.<payload>.<signature>".
//
// signParams must match the algParams used to import the key:
//   ES256: { name: 'ECDSA', hash: 'SHA-256' }
//   RS256: { name: 'RSASSA-PKCS1-v1_5' }
async function signJwt(
  header: Record<string, unknown>,
  claims: Record<string, unknown>,
  key: CryptoKey,
  signParams: EcdsaParams | RsaPssParams | AlgorithmIdentifier,
): Promise<string> {
  const encoder = new TextEncoder();
  const headerB64 = base64UrlEncode(encoder.encode(JSON.stringify(header)));
  const claimsB64 = base64UrlEncode(encoder.encode(JSON.stringify(claims)));
  const signingInput = `${headerB64}.${claimsB64}`;
  const sig = await crypto.subtle.sign(signParams, key, encoder.encode(signingInput));
  return `${signingInput}.${base64UrlEncode(new Uint8Array(sig))}`;
}

// Convenience: sign an ES256 JWT (Apple APNs token-auth, Apple Sign In
// client_secret). Caller provides keyId (kid header), issuer (iss claim),
// and the .p8 PEM contents.
//
// optionalClaims merges into the iat-only base. Apple APNs only needs iss+iat;
// Apple Sign In client_secret also needs sub+aud+exp.
export async function signEs256Jwt(opts: {
  keyId: string;
  issuer: string;
  p8Pem: string;
  optionalClaims?: Record<string, unknown>;
}): Promise<string> {
  const key = await importPkcs8Pem(opts.p8Pem, { name: "ECDSA", namedCurve: "P-256" });
  const claims = {
    iss: opts.issuer,
    iat: Math.floor(Date.now() / 1000),
    ...(opts.optionalClaims ?? {}),
  };
  return await signJwt(
    { alg: "ES256", kid: opts.keyId, typ: "JWT" },
    claims,
    key,
    { name: "ECDSA", hash: "SHA-256" },
  );
}

// Convenience: sign an RS256 JWT (Google service-account assertion).
// Used for FCM v1 OAuth2 token exchange — the signed JWT is POSTed
// to oauth2.googleapis.com/token to get an access_token.
export async function signRs256Jwt(opts: {
  privateKeyPem: string;
  claims: Record<string, unknown>;
}): Promise<string> {
  const key = await importPkcs8Pem(opts.privateKeyPem, {
    name: "RSASSA-PKCS1-v1_5",
    hash: "SHA-256",
  });
  return await signJwt(
    { alg: "RS256", typ: "JWT" },
    opts.claims,
    key,
    { name: "RSASSA-PKCS1-v1_5" },
  );
}
