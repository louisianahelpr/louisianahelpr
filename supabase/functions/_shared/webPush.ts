// Web Push sender: RFC 8291 message encryption (aes128gcm, RFC 8188) and
// RFC 8292 VAPID (ES256), in WebCrypto only, so it runs unchanged in Deno edge
// functions and in Node (vitest), with no npm dependency.
//
// Why this exists: 36 of 37 real active members use the website (push lane root
// cause, 2026-10-21) and the only push sender spoke APNs. A browser hands the app
// a PushSubscription (endpoint + p256dh + auth); public.push_subscriptions keeps
// it, and send-push-notification posts one encrypted message per row with this.
//
// Proof: src/test/edge/webPushRfc8291.test.ts encrypts the RFC 8291 Appendix A
// plaintext with the appendix's keys and salt and compares the whole message byte
// for byte, then decrypts what encryptPushPayload makes with a fresh key.

export interface WebPushSubscriptionKeys {
  endpoint: string;
  p256dh: string; // base64url, 65-byte uncompressed P-256 point
  auth: string; // base64url, 16 bytes
}

export interface VapidKeys {
  publicKey: string; // base64url, 65-byte uncompressed P-256 point
  privateKey: string; // base64url, 32-byte private scalar
  subject: string; // mailto: or https: contact (RFC 8292 section 2.1)
}

export function b64urlEncode(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function b64urlDecode(text: string): Uint8Array {
  const b64 = text.replace(/-/g, "+").replace(/_/g, "/").replace(/=+$/, "");
  const padded = b64 + "=".repeat((4 - (b64.length % 4)) % 4);
  return Uint8Array.from(atob(padded), (c) => c.charCodeAt(0));
}

function concat(...parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

const utf8 = (s: string) => new TextEncoder().encode(s);

/** A JWK for a P-256 key from its raw uncompressed public point (and private scalar). */
function p256Jwk(publicRaw: Uint8Array, privateRaw?: Uint8Array): JsonWebKey {
  if (publicRaw.length !== 65 || publicRaw[0] !== 0x04) {
    throw new Error("invalid_p256_public_key");
  }
  const jwk: JsonWebKey = {
    kty: "EC",
    crv: "P-256",
    x: b64urlEncode(publicRaw.slice(1, 33)),
    y: b64urlEncode(publicRaw.slice(33, 65)),
    ext: true,
  };
  if (privateRaw) {
    if (privateRaw.length !== 32) throw new Error("invalid_p256_private_key");
    jwk.d = b64urlEncode(privateRaw);
  }
  return jwk;
}

async function hkdf(salt: Uint8Array, ikm: Uint8Array, info: Uint8Array, bytes: number): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey("raw", ikm, "HKDF", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "HKDF", hash: "SHA-256", salt, info }, key, bytes * 8);
  return new Uint8Array(bits);
}

/** Test seam: the RFC vectors fix the sender's key pair and the salt. */
export interface EncryptOverrides {
  senderPublic?: Uint8Array; // 65 bytes
  senderPrivate?: Uint8Array; // 32 bytes
  salt?: Uint8Array; // 16 bytes
  recordSize?: number;
}

/**
 * Encrypt one push message for one subscription (RFC 8291 section 3.4 + RFC 8188
 * aes128gcm, a single record). Returns the whole request body: the aes128gcm
 * header (salt, record size, the sender's public key) followed by the ciphertext.
 */
export async function encryptPushPayload(
  sub: Pick<WebPushSubscriptionKeys, "p256dh" | "auth">,
  plaintext: Uint8Array,
  overrides: EncryptOverrides = {},
): Promise<Uint8Array> {
  const uaPublic = b64urlDecode(sub.p256dh);
  const authSecret = b64urlDecode(sub.auth);
  if (authSecret.length !== 16) throw new Error("invalid_auth_secret");
  const recordSize = overrides.recordSize ?? 4096;
  // One record: plaintext + the 0x02 last-record delimiter + the 16-byte tag must fit.
  if (plaintext.length + 1 + 16 > recordSize) throw new Error("payload_too_large");

  let senderPublic: Uint8Array;
  let senderPrivateKey: CryptoKey;
  if (overrides.senderPublic && overrides.senderPrivate) {
    senderPublic = overrides.senderPublic;
    senderPrivateKey = await crypto.subtle.importKey(
      "jwk",
      p256Jwk(senderPublic, overrides.senderPrivate),
      { name: "ECDH", namedCurve: "P-256" },
      false,
      ["deriveBits"],
    );
  } else {
    const pair = (await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, [
      "deriveBits",
    ])) as CryptoKeyPair;
    senderPublic = new Uint8Array(await crypto.subtle.exportKey("raw", pair.publicKey));
    senderPrivateKey = pair.privateKey;
  }
  const uaKey = await crypto.subtle.importKey(
    "jwk",
    p256Jwk(uaPublic),
    { name: "ECDH", namedCurve: "P-256" },
    false,
    [],
  );
  const ecdhSecret = new Uint8Array(
    await crypto.subtle.deriveBits({ name: "ECDH", public: uaKey }, senderPrivateKey, 256),
  );

  // RFC 8291 3.3/3.4: IKM = HKDF(auth_secret, ecdh_secret, "WebPush: info" 0x00 ua_public as_public, 32)
  const keyInfo = concat(utf8("WebPush: info"), new Uint8Array([0]), uaPublic, senderPublic);
  const ikm = await hkdf(authSecret, ecdhSecret, keyInfo, 32);
  const salt = overrides.salt ?? crypto.getRandomValues(new Uint8Array(16));
  // RFC 8188 2.2/2.3
  const cek = await hkdf(salt, ikm, concat(utf8("Content-Encoding: aes128gcm"), new Uint8Array([0])), 16);
  const nonce = await hkdf(salt, ikm, concat(utf8("Content-Encoding: nonce"), new Uint8Array([0])), 12);

  const aesKey = await crypto.subtle.importKey("raw", cek, "AES-GCM", false, ["encrypt"]);
  const record = concat(plaintext, new Uint8Array([2]));
  const ciphertext = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv: nonce }, aesKey, record));

  const rs = new Uint8Array(4);
  new DataView(rs.buffer).setUint32(0, recordSize, false);
  return concat(salt, rs, new Uint8Array([senderPublic.length]), senderPublic, ciphertext);
}

/** RFC 8292: the `Authorization: vapid t=<jwt>, k=<public key>` header for one push service. */
export async function vapidAuthorization(
  endpoint: string,
  vapid: VapidKeys,
  nowSeconds: number = Math.floor(Date.now() / 1000),
): Promise<string> {
  const audience = new URL(endpoint).origin;
  const key = await crypto.subtle.importKey(
    "jwk",
    p256Jwk(b64urlDecode(vapid.publicKey), b64urlDecode(vapid.privateKey)),
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["sign"],
  );
  const header = b64urlEncode(utf8(JSON.stringify({ typ: "JWT", alg: "ES256" })));
  // 12 hours: RFC 8292 section 2 caps exp at 24 h from the request.
  const claims = b64urlEncode(utf8(JSON.stringify({ aud: audience, exp: nowSeconds + 12 * 3600, sub: vapid.subject })));
  const input = `${header}.${claims}`;
  // WebCrypto ECDSA returns r||s (IEEE P1363), which is exactly JWS ES256.
  const sig = new Uint8Array(await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, key, utf8(input)));
  return `vapid t=${input}.${b64urlEncode(sig)}, k=${vapid.publicKey}`;
}

export interface WebPushResult {
  ok: boolean;
  status: number;
  /** 404/410: the subscription is gone for good; the caller deletes the row. */
  gone: boolean;
  reason: string;
}

/** Send one encrypted message. Never throws: a network error is `{ ok: false, status: 0 }`. */
export async function sendWebPush(
  sub: WebPushSubscriptionKeys,
  payload: unknown,
  vapid: VapidKeys,
  opts: { ttlSeconds?: number; urgency?: "very-low" | "low" | "normal" | "high"; fetchImpl?: typeof fetch } = {},
): Promise<WebPushResult> {
  try {
    const body = await encryptPushPayload(sub, utf8(JSON.stringify(payload)));
    const res = await (opts.fetchImpl ?? fetch)(sub.endpoint, {
      method: "POST",
      headers: {
        Authorization: await vapidAuthorization(sub.endpoint, vapid),
        "Content-Encoding": "aes128gcm",
        "Content-Type": "application/octet-stream",
        TTL: String(opts.ttlSeconds ?? 86400),
        Urgency: opts.urgency ?? "normal",
      },
      body,
    });
    const reason = res.ok ? "" : (await res.text().catch(() => "")).slice(0, 200);
    return { ok: res.ok, status: res.status, gone: res.status === 404 || res.status === 410, reason };
  } catch (err) {
    return { ok: false, status: 0, gone: false, reason: err instanceof Error ? err.message : String(err) };
  }
}
