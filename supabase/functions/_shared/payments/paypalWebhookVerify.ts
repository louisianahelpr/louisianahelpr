/**
 * PayPal webhook signature verification (PayPal Plan A, phase 1). FAIL CLOSED.
 *
 * PayPal signs each delivery. PayPal's REST webhooks docs (developer site, api/rest/webhooks/rest):
 *   headers  paypal-transmission-id, paypal-transmission-time, paypal-transmission-sig,
 *            paypal-cert-url, paypal-auth-algo
 *   message  `${transmissionId}|${transmissionTime}|${webhookId}|${crc32(rawBody)}`
 *            (crc32 of the ORIGINAL raw body, in decimal), signed SHA256withRSA by the
 *            certificate at paypal-cert-url.
 *   or post the event back to /v1/notifications/verify-webhook-signature, which
 *   answers verification_status SUCCESS | FAILURE.
 *
 * verifyPayPalWebhook() tries the postback first (PayPal is the authority, and
 * it needs no certificate parsing of ours). Only when the postback cannot be
 * reached does it verify locally against the certificate. A FAILURE from
 * either is final. Neither reachable: "unavailable", and the caller answers 503
 * so PayPal redelivers (up to 25 times over 3 days, DOCS).
 *
 * The postback's PayPal-Request-Id is a hash of everything we post, never the
 * transmission id alone: PayPal replays a cached answer for a reused key, so a
 * forger who copied a real transmission id onto a different body must not be
 * handed the original "SUCCESS".
 */
import type { PayPalClient } from "./paypalClient.ts";
import type { ProviderEnv } from "./types.ts";
import { caughtMessage } from "../caughtMessage.ts";

const PAYPAL_CERT_HOSTS: Record<ProviderEnv, readonly string[]> = {
  sandbox: ["api.sandbox.paypal.com", "api-m.sandbox.paypal.com"],
  live: ["api.paypal.com", "api-m.paypal.com"],
};

export interface PayPalSignatureHeaders {
  transmissionId: string;
  transmissionTime: string;
  transmissionSig: string;
  certUrl: string;
  authAlgo: string;
}

export type VerifyOutcome =
  | { ok: true; via: "postback" | "certificate" }
  | { ok: false; final: true; reason: string }
  | { ok: false; final: false; reason: string };

/** Reads the five signature headers; null when any is missing (not PayPal). */
export function readSignatureHeaders(h: Headers): PayPalSignatureHeaders | null {
  const transmissionId = h.get("paypal-transmission-id");
  const transmissionTime = h.get("paypal-transmission-time");
  const transmissionSig = h.get("paypal-transmission-sig");
  const certUrl = h.get("paypal-cert-url");
  const authAlgo = h.get("paypal-auth-algo");
  if (!transmissionId || !transmissionTime || !transmissionSig || !certUrl || !authAlgo) return null;
  return { transmissionId, transmissionTime, transmissionSig, certUrl, authAlgo };
}

let CRC_TABLE: Uint32Array | null = null;
/** CRC-32 (IEEE 802.3), unsigned, as PayPal uses for the signed message. */
export function crc32(bytes: Uint8Array): number {
  if (!CRC_TABLE) {
    CRC_TABLE = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      CRC_TABLE[n] = c >>> 0;
    }
  }
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) crc = CRC_TABLE[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function signedMessage(h: PayPalSignatureHeaders, webhookId: string, rawBody: Uint8Array): string {
  return `${h.transmissionId}|${h.transmissionTime}|${webhookId}|${crc32(rawBody)}`;
}

/** Only PayPal's own HTTPS cert endpoint for THIS environment. */
export function isAllowedCertUrl(certUrl: string, env: ProviderEnv): boolean {
  let u: URL;
  try {
    u = new URL(certUrl);
  } catch {
    return false; // not a URL at all
  }
  return u.protocol === "https:" && u.port === "" && u.username === "" && u.password === ""
    && PAYPAL_CERT_HOSTS[env].includes(u.hostname)
    && u.pathname.startsWith("/v1/notifications/certs/");
}

// ---- minimal DER reader: just enough to find the certificate's public key and expiry ----

interface Tlv { tag: number; start: number; contentStart: number; end: number }

function readTlv(b: Uint8Array, at: number): Tlv {
  if (at + 2 > b.length) throw new Error("der: truncated");
  const tag = b[at];
  let len = b[at + 1];
  let p = at + 2;
  if (len & 0x80) {
    const n = len & 0x7f;
    if (n < 1 || n > 4 || p + n > b.length) throw new Error("der: bad length");
    len = 0;
    for (let i = 0; i < n; i++) len = len * 256 + b[p + i];
    p += n;
  }
  if (p + len > b.length) throw new Error("der: length past end");
  return { tag, start: at, contentStart: p, end: p + len };
}

function children(b: Uint8Array, parent: Tlv): Tlv[] {
  const out: Tlv[] = [];
  for (let p = parent.contentStart; p < parent.end;) {
    const t = readTlv(b, p);
    out.push(t);
    p = t.end;
  }
  return out;
}

function parseDerTime(b: Uint8Array, t: Tlv): number {
  const s = new TextDecoder().decode(b.subarray(t.contentStart, t.end));
  const m = t.tag === 0x17
    ? /^(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})Z$/.exec(s)
    : t.tag === 0x18 ? /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})Z$/.exec(s) : null;
  if (!m) throw new Error("der: unsupported time");
  let year = Number(m[1]);
  if (t.tag === 0x17) year += year >= 50 ? 1900 : 2000;
  return Date.UTC(year, Number(m[2]) - 1, Number(m[3]), Number(m[4]), Number(m[5]), Number(m[6]));
}

export interface CertInfo { spki: Uint8Array<ArrayBuffer>; notBefore: number; notAfter: number }

function pemToDer(pem: string): Uint8Array<ArrayBuffer> {
  const m = /-----BEGIN CERTIFICATE-----([\s\S]+?)-----END CERTIFICATE-----/.exec(pem);
  if (!m) throw new Error("pem: no certificate block");
  const bin = atob(m[1].replace(/\s+/g, ""));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** The FIRST certificate in the PEM (the leaf): its SubjectPublicKeyInfo and validity window. */
export function certInfoFromPem(pem: string): CertInfo {
  const der = pemToDer(pem);
  const cert = readTlv(der, 0);
  if (cert.tag !== 0x30) throw new Error("der: certificate is not a SEQUENCE");
  const tbs = children(der, cert)[0];
  if (!tbs || tbs.tag !== 0x30) throw new Error("der: no tbsCertificate");
  const f = children(der, tbs);
  const i = f[0]?.tag === 0xa0 ? 1 : 0; // optional [0] version
  // serialNumber, signature, issuer, validity, subject, subjectPublicKeyInfo
  const validity = f[i + 3];
  const spki = f[i + 5];
  if (!validity || validity.tag !== 0x30 || !spki || spki.tag !== 0x30) throw new Error("der: unexpected tbsCertificate shape");
  const [nb, na] = children(der, validity);
  return { spki: der.slice(spki.start, spki.end), notBefore: parseDerTime(der, nb), notAfter: parseDerTime(der, na) };
}

function b64ToBytes(s: string): Uint8Array<ArrayBuffer> {
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** RSASSA-PKCS1-v1_5 / SHA-256 check of `message` against the certificate's key. */
export async function verifyWithCertificate(
  pem: string,
  h: PayPalSignatureHeaders,
  webhookId: string,
  rawBody: Uint8Array,
  nowMs: number,
): Promise<boolean> {
  if (h.authAlgo !== "SHA256withRSA") return false;
  const info = certInfoFromPem(pem);
  if (nowMs < info.notBefore || nowMs > info.notAfter) return false;
  const key = await crypto.subtle.importKey("spki", info.spki, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"]);
  let sig: Uint8Array<ArrayBuffer>;
  try {
    sig = b64ToBytes(h.transmissionSig);
  } catch {
    return false; // not base64: cannot be PayPal's signature
  }
  return await crypto.subtle.verify("RSASSA-PKCS1-v1_5", key, sig, new TextEncoder().encode(signedMessage(h, webhookId, rawBody)));
}

async function sha256Hex(s: string): Promise<string> {
  const d = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s)));
  return [...d].map((x) => x.toString(16).padStart(2, "0")).join("");
}

export interface VerifyDeps {
  client: Pick<PayPalClient, "request">;
  env: ProviderEnv;
  webhookId: string;
  /** Fetches the certificate PEM (only ever called with an allowed URL). */
  fetchCert: (url: string) => Promise<string>;
  now?: () => number;
}

/**
 * PayPal redelivers for up to 3 days (DOCS); a day of margin. This MUST stay longer than PayPal's
 * retry period: a real late redelivery refused here is final (400) and only shows up as the
 * once-a-day "refused a delivery" alert.
 */
const MAX_DELIVERY_AGE_MS = 4 * 24 * 60 * 60 * 1000;
const MAX_CLOCK_SKEW_MS = 15 * 60 * 1000;

const certCache = new Map<string, { pem: string; at: number }>();
const CERT_CACHE_MS = 6 * 60 * 60 * 1000;

export async function verifyPayPalWebhook(headers: Headers, rawBody: string, deps: VerifyDeps): Promise<VerifyOutcome> {
  const h = readSignatureHeaders(headers);
  if (!h) return { ok: false, final: true, reason: "missing_signature_headers" };
  if (!deps.webhookId) return { ok: false, final: false, reason: "webhook_id_not_configured" };
  if (!isAllowedCertUrl(h.certUrl, deps.env)) return { ok: false, final: true, reason: "cert_url_not_paypal" };
  // PayPal retries for 3 days; anything older (or from the future) is a replay or a forgery, and
  // refusing it here costs no PayPal call.
  const sentAt = Date.parse(h.transmissionTime);
  const nowMs = (deps.now ?? Date.now)();
  if (!Number.isFinite(sentAt)) return { ok: false, final: true, reason: "transmission_time_invalid" };
  if (nowMs - sentAt > MAX_DELIVERY_AGE_MS || sentAt - nowMs > MAX_CLOCK_SKEW_MS) {
    return { ok: false, final: true, reason: "transmission_time_out_of_window" };
  }
  try {
    JSON.parse(rawBody);
  } catch {
    return { ok: false, final: true, reason: "body_not_json" };
  }

  // 1. Postback: PayPal decides.
  const post = `{"auth_algo":${JSON.stringify(h.authAlgo)},"cert_url":${JSON.stringify(h.certUrl)},`
    + `"transmission_id":${JSON.stringify(h.transmissionId)},"transmission_sig":${JSON.stringify(h.transmissionSig)},`
    + `"transmission_time":${JSON.stringify(h.transmissionTime)},"webhook_id":${JSON.stringify(deps.webhookId)},`
    + `"webhook_event":${rawBody}}`;
  let postbackError = "";
  try {
    const r = await deps.client.request<{ verification_status?: string }>(
      "POST",
      "/v1/notifications/verify-webhook-signature",
      { rawJsonBody: post, idempotencyKey: `lh:whverify:${await sha256Hex(post)}` },
    );
    if (r?.verification_status === "SUCCESS") return { ok: true, via: "postback" };
    if (r?.verification_status === "FAILURE") return { ok: false, final: true, reason: "postback_failure" };
    postbackError = `postback answered ${JSON.stringify(r?.verification_status ?? null)}`;
  } catch (e) {
    const status = (e as { httpStatus?: number }).httpStatus;
    // 401/403: OUR credentials are wrong (rotated secret, sandbox/live mix-up). That says nothing
    // about the event, so it is not final (503, PayPal redelivers) and the caller alerts.
    if (status === 401 || status === 403) return { ok: false, final: false, reason: `paypal_auth_failed_${status}` };
    // Any other 4xx means PayPal read our request and refused it: final, never fall back to a weaker check.
    if (typeof status === "number" && status >= 400 && status < 500 && status !== 429) {
      return { ok: false, final: true, reason: `postback_refused_${status}` };
    }
    postbackError = caughtMessage(e);
  }

  // 2. PayPal unreachable: verify locally against its certificate.
  const now = nowMs;
  try {
    let cached = certCache.get(h.certUrl);
    if (!cached || now - cached.at > CERT_CACHE_MS) {
      cached = { pem: await deps.fetchCert(h.certUrl), at: now };
      certCache.set(h.certUrl, cached);
    }
    const ok = await verifyWithCertificate(cached.pem, h, deps.webhookId, new TextEncoder().encode(rawBody), now);
    return ok ? { ok: true, via: "certificate" } : { ok: false, final: true, reason: "certificate_signature_mismatch" };
  } catch (e) {
    return { ok: false, final: false, reason: `unavailable: ${postbackError}; certificate: ${caughtMessage(e)}` };
  }
}

/** Test hook: forget cached certificates. */
export function clearCertCache(): void {
  certCache.clear();
}
