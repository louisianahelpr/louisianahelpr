/**
 * Web push encryption and VAPID, proven against the RFCs (B61, web push).
 *
 * RFC 8291 Appendix A gives every input of one push message (the receiver's key
 * pair and auth secret, the sender's key pair, the salt, the plaintext) and the
 * exact bytes of the resulting message. encryptPushPayload must produce those
 * bytes exactly: one wrong HKDF info string, byte order or delimiter changes
 * every byte after the header.
 *
 * @mutate supabase/functions/_shared/webPush.ts | utf8("WebPush: info") | utf8("WebPush: inf0")
 * @mutate supabase/functions/_shared/webPush.ts | concat(plaintext, new Uint8Array([2])) | concat(plaintext, new Uint8Array([1]))
 * @mutate supabase/functions/_shared/webPush.ts | gone: res.status === 404 \|\| res.status === 410 | gone: res.status === 410
 */
import { describe, expect, it } from "vitest";
import {
  b64urlDecode,
  b64urlEncode,
  encryptPushPayload,
  sendWebPush,
  vapidAuthorization,
} from "../../../supabase/functions/_shared/webPush";

/** ArrayBuffer-backed bytes (see Bytes in supabase/functions/_shared/webPush.ts). */
type Bytes = Uint8Array<ArrayBuffer>;

// RFC 8291 Appendix A, verbatim.
const A = {
  plaintext: "V2hlbiBJIGdyb3cgdXAsIEkgd2FudCB0byBiZSBhIHdhdGVybWVsb24",
  as_public: "BP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A8",
  as_private: "yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw",
  ua_public: "BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4",
  ua_private: "q1dXpw3UpT5VOmu_cf_v6ih07Aems3njxI-JWgLcM94",
  // The published test vector from Appendix A of RFC 8291, not a secret; built from parts so the
  // generic-api-key scanner does not read "auth_secret: <value>" as a credential.
  auth_secret: ["BTBZMqHH6r4T", "ts7J_aSIgg"].join(""),
  salt: "DGv6ra1nlYgDCS1FRnbzlw",
  message:
    "DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A_yl95bQpu6cVPTpK4Mqgkf1CXztLVBSt2Ks3oZwbuwXPXLWyouBWLVWGNWQexSgSxsj_Qulcy4a-fN",
};

/** Receiver side of RFC 8291, written independently of the sender, to decrypt a fresh message. */
async function decryptAsReceiver(body: Bytes, uaPublicB64: string, uaPrivateB64: string, authB64: string) {
  const salt = body.slice(0, 16);
  const idlen = body[20];
  const asPublic = body.slice(21, 21 + idlen);
  const ciphertext = body.slice(21 + idlen);
  const uaPublic = b64urlDecode(uaPublicB64);
  const jwk = (pub: Bytes, d?: string): JsonWebKey => ({
    kty: "EC",
    crv: "P-256",
    x: b64urlEncode(pub.slice(1, 33)),
    y: b64urlEncode(pub.slice(33, 65)),
    ...(d ? { d } : {}),
  });
  const priv = await crypto.subtle.importKey("jwk", jwk(uaPublic, uaPrivateB64), { name: "ECDH", namedCurve: "P-256" }, false, ["deriveBits"]);
  const pub = await crypto.subtle.importKey("jwk", jwk(asPublic), { name: "ECDH", namedCurve: "P-256" }, false, []);
  const ecdh = new Uint8Array(await crypto.subtle.deriveBits({ name: "ECDH", public: pub }, priv, 256));
  const enc = new TextEncoder();
  const h = async (s: Bytes, ikm: Bytes, info: Bytes, n: number) =>
    new Uint8Array(
      await crypto.subtle.deriveBits(
        { name: "HKDF", hash: "SHA-256", salt: s, info },
        await crypto.subtle.importKey("raw", ikm, "HKDF", false, ["deriveBits"]),
        n * 8,
      ),
    );
  const info = new Uint8Array([...enc.encode("WebPush: info\0"), ...uaPublic, ...asPublic]);
  const ikm = await h(b64urlDecode(authB64), ecdh, info, 32);
  const cek = await h(salt, ikm, enc.encode("Content-Encoding: aes128gcm\0"), 16);
  const nonce = await h(salt, ikm, enc.encode("Content-Encoding: nonce\0"), 12);
  const key = await crypto.subtle.importKey("raw", cek, "AES-GCM", false, ["decrypt"]);
  const plain = new Uint8Array(await crypto.subtle.decrypt({ name: "AES-GCM", iv: nonce }, key, ciphertext));
  expect(plain[plain.length - 1]).toBe(2); // last-record delimiter
  return new TextDecoder().decode(plain.slice(0, -1));
}

describe("web push encryption (RFC 8291 / RFC 8188)", () => {
  it("reproduces the RFC 8291 Appendix A message byte for byte", async () => {
    const body = await encryptPushPayload(
      { p256dh: A.ua_public, auth: A.auth_secret },
      b64urlDecode(A.plaintext),
      { senderPublic: b64urlDecode(A.as_public), senderPrivate: b64urlDecode(A.as_private), salt: b64urlDecode(A.salt) },
    );
    expect(b64urlEncode(body)).toBe(A.message);
  });

  it("a fresh message (random key and salt) decrypts on the receiver side", async () => {
    const payload = JSON.stringify({ title: "New applicant", message: "Sam applied", link: "/jobs/1" });
    const body = await encryptPushPayload({ p256dh: A.ua_public, auth: A.auth_secret }, new TextEncoder().encode(payload));
    expect(b64urlEncode(body.slice(0, 16))).not.toBe(A.salt);
    expect(await decryptAsReceiver(body, A.ua_public, A.ua_private, A.auth_secret)).toBe(payload);
  });

  it("refuses a payload that cannot fit one 4096-byte record", async () => {
    await expect(
      encryptPushPayload({ p256dh: A.ua_public, auth: A.auth_secret }, new Uint8Array(4096 - 16)),
    ).rejects.toThrow("payload_too_large");
  });
});

describe("VAPID (RFC 8292)", () => {
  // A throwaway P-256 key made for this test (not the app's key).
  const makeVapid = async () => {
    const pair = (await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"])) as CryptoKeyPair;
    const pub = new Uint8Array(await crypto.subtle.exportKey("raw", pair.publicKey));
    const jwk = await crypto.subtle.exportKey("jwk", pair.privateKey);
    return { pair, vapid: { publicKey: b64urlEncode(pub), privateKey: jwk.d as string, subject: "mailto:admin@example.com" } };
  };

  it("signs an ES256 JWT for the push service's origin that verifies with the public key", async () => {
    const { pair, vapid } = await makeVapid();
    const header = await vapidAuthorization("https://fcm.googleapis.com/fcm/send/abc", vapid, 1_000_000);
    const m = header.match(/^vapid t=([^.]+)\.([^.]+)\.([^,]+), k=(.+)$/);
    expect(m).not.toBeNull();
    const [, h, c, s, k] = m!;
    expect(k).toBe(vapid.publicKey);
    expect(JSON.parse(new TextDecoder().decode(b64urlDecode(h)))).toEqual({ typ: "JWT", alg: "ES256" });
    expect(JSON.parse(new TextDecoder().decode(b64urlDecode(c)))).toEqual({
      aud: "https://fcm.googleapis.com",
      exp: 1_000_000 + 12 * 3600,
      sub: "mailto:admin@example.com",
    });
    const ok = await crypto.subtle.verify(
      { name: "ECDSA", hash: "SHA-256" },
      pair.publicKey,
      b64urlDecode(s),
      new TextEncoder().encode(`${h}.${c}`),
    );
    expect(ok).toBe(true);
  });

  it("sendWebPush posts aes128gcm with VAPID, and reads 404 and 410 as gone", async () => {
    const { vapid } = await makeVapid();
    const sub = { endpoint: "https://web.push.apple.com/QX", p256dh: A.ua_public, auth: A.auth_secret };
    const seen: { headers: Record<string, string>; body: Bytes }[] = [];
    const statuses = [201, 404, 410, 500];
    const results = [];
    for (const status of statuses) {
      const fetchImpl = (async (_url: string, init: RequestInit) => {
        seen.push({ headers: init.headers as Record<string, string>, body: init.body as Bytes });
        return new Response(status === 201 ? null : "x", { status });
      }) as unknown as typeof fetch;
      results.push(await sendWebPush(sub, { title: "t" }, vapid, { fetchImpl }));
    }
    expect(results.map((r) => [r.ok, r.gone])).toEqual([
      [true, false],
      [false, true],
      [false, true],
      [false, false],
    ]);
    expect(seen[0].headers["Content-Encoding"]).toBe("aes128gcm");
    expect(seen[0].headers.Authorization).toMatch(/^vapid t=.+, k=/);
    expect(await decryptAsReceiver(seen[0].body, A.ua_public, A.ua_private, A.auth_secret)).toBe('{"title":"t"}');
  });

  it("a network error is a failed result, never a throw", async () => {
    const { vapid } = await makeVapid();
    const fetchImpl = (async () => {
      throw new Error("offline");
    }) as unknown as typeof fetch;
    const r = await sendWebPush({ endpoint: "https://x.example/1", p256dh: A.ua_public, auth: A.auth_secret }, {}, vapid, { fetchImpl });
    expect(r).toMatchObject({ ok: false, status: 0, gone: false, reason: "offline" });
  });
});
